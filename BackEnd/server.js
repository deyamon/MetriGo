const express = require('express');
const { findShortestPath } = require('./routing/dijkstra');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');       // password hashing
const crypto = require('crypto');       // PNR generation (built-in Node module)

// ─────────────────────────────────────────────
// SECURITY / OBSERVABILITY
// Lightweight in-memory rate limiting keeps abusive bursts from overwhelming
// the app. It is intentionally dependency-free; for a multi-instance production
// deployment this should eventually move to a shared store such as Redis.
// ─────────────────────────────────────────────
const REQUEST_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 15000;
const GENERAL_RATE_WINDOW_MS = 60 * 1000;
const GENERAL_RATE_LIMIT = Number(process.env.API_RATE_LIMIT) || 120;
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT = Number(process.env.AUTH_RATE_LIMIT) || 10;
const BOOKING_RATE_LIMIT = Number(process.env.BOOKING_RATE_LIMIT) || 20;
const ROUTE_RATE_LIMIT = Number(process.env.ROUTE_RATE_LIMIT) || 60;
const rateBuckets = new Map();

function requestId() {
    return crypto.randomBytes(8).toString('hex');
}

function logEvent(level, message, meta = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta
    };
    const output = JSON.stringify(entry);
    if (level === 'error') console.error(output);
    else if (level === 'warn') console.warn(output);
    else console.log(output);
}

function clientKey(req) {
    return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

function rateLimit({ windowMs, max, keyPrefix = 'general' }) {
    return (req, res, next) => {
        const now = Date.now();
        const key = `${keyPrefix}:${clientKey(req)}`;
        let bucket = rateBuckets.get(key);

        if (!bucket || now >= bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
        }
        bucket.count += 1;
        rateBuckets.set(key, bucket);

        const remaining = Math.max(0, max - bucket.count);
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

        if (bucket.count > max) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfter));
            logEvent('warn', 'Rate limit exceeded', { requestId: req.id, ip: clientKey(req), path: req.path, keyPrefix });
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.',
                retryAfter
            });
        }
        next();
    };
}

// Remove stale rate-limit buckets periodically.
const rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) {
        if (now >= bucket.resetAt) rateBuckets.delete(key);
    }
}, 5 * 60 * 1000);
rateLimitCleanup.unref?.();

const app = express();
const PORT = Number(process.env.PORT) || 8080;

// Baseline security headers. These are intentionally dependency-free so the
// project remains easy to deploy on Vercel and on a local Node server.
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be configured in production');
}

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

const SALT_ROUNDS = 10; // bcrypt cost factor — higher = slower but more secure

app.use(express.json({ limit: '100kb' }));

// Request IDs make server logs traceable from a browser error report.
app.use((req, res, next) => {
    req.id = requestId();
    res.setHeader('X-Request-ID', req.id);
    next();
});

app.use((req, res, next) => {
    res.on('finish', () => {
        if (res.statusCode >= 400) {
            logEvent(res.statusCode >= 500 ? 'error' : 'warn', 'HTTP request completed with error status', {
                requestId: req.id,
                method: req.method,
                path: req.path,
                status: res.statusCode
            });
        }
    });
    next();
});

// Reject requests that spend too long inside the API.
app.use((req, res, next) => {
    if (req.path.startsWith('/api') || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const timer = setTimeout(() => {
            if (!res.headersSent) {
                logEvent('error', 'Request timeout', { requestId: req.id, method: req.method, path: req.path });
                res.status(504).json({ success: false, message: 'The server took too long to respond. Please try again.' });
            }
        }, REQUEST_TIMEOUT_MS);
        res.once('finish', () => clearTimeout(timer));
        res.once('close', () => clearTimeout(timer));
    }
    next();
});

// Global API guard. More sensitive endpoints receive tighter limits below.
app.use((req, res, next) => {
    const isApiRequest = req.originalUrl.startsWith('/api') || req.path.startsWith('/api');
    if (!isApiRequest && req.method === 'GET') return next();
    return rateLimit({ windowMs: GENERAL_RATE_WINDOW_MS, max: GENERAL_RATE_LIMIT })(req, res, next);
});


// ─────────────────────────────────────────────
// DATA LAYER
// JSON is still our development datastore for now, but all access goes
// through these helpers so the booking model can later move to a DBMS
// without rewriting every route.
// ─────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const TRAINS_FILE = path.join(DATA_DIR, 'trains.json');

function readJsonArray(file) {
    if (!fs.existsSync(file)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error(`Failed to read ${file}:`, error);
        throw new Error('Data store is unavailable');
    }
}

function writeJsonArray(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, file);
}

function readBookings() {
    return readJsonArray(BOOKINGS_FILE);
}

function readTrains() {
    return readJsonArray(TRAINS_FILE);
}

function getTrainConfig(trainName, cls) {
    const train = readTrains().find(t => t.name === trainName);
    if (!train) return null;
    const classConfig = train.classes.find(c => c.type === cls);
    if (!classConfig) return null;
    return { ...train, classConfig };
}

function writeBookings(bookings) {
    writeJsonArray(BOOKINGS_FILE, bookings);
}

// Normalize old one-seat records and newer multi-seat records to one shape.
function normalizeBooking(booking) {
    const seats = Array.isArray(booking.seats)
        ? booking.seats.map(String).filter(Boolean)
        : (booking.seat ? [String(booking.seat)] : []);

    return {
        ...booking,
        seats,
        seat: seats[0] || null,
        travelDate: booking.travelDate || null,
        status: booking.status || 'Confirmed'
    };
}

function normalizeTravelDate(value) {
    if (!value) return null;

    // Frontend sends YYYY-MM-DD. Reject other ambiguous formats.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) return null;

    return value;
}

function isPastTravelDate(value) {
    const normalized = normalizeTravelDate(value);
    if (!normalized) return true;
    const today = new Date().toISOString().slice(0, 10);
    return normalized < today;
}

function getBookedSeats(bookings, trainName, travelDate, cls = null) {
    const normalizedDate = normalizeTravelDate(travelDate);
    if (!normalizedDate) return new Set();

    return new Set(
        bookings
            .map(normalizeBooking)
            .filter(b =>
                (b.trainName || 'Metro Express') === trainName &&
                b.travelDate === normalizedDate &&
                b.status !== 'Cancelled' &&
                (!cls || (b.cls || 'CC') === cls)
            )
            .flatMap(b => b.seats)
    );
}

// Seat inventory: physical layout is 5 coaches × 12 rows × 6 seats.
// Each train/class exposes its configured capacity from data/trains.json.
const COACHES = ['C1', 'C2', 'C3', 'C4', 'C5'];
const ROWS_PER_COACH = 12;
const SEATS_PER_ROW = 6;

function isValidSeatId(seatId) {
    const match = /^C([1-5])-(\d+)([A-F])$/.exec(String(seatId));
    if (!match) return false;
    const row = Number(match[2]);
    return row >= 1 && row <= ROWS_PER_COACH;
}

function getPhysicalSeatIds() {
    const seats = [];
    for (const coach of COACHES) {
        for (let row = 1; row <= ROWS_PER_COACH; row++) {
            for (let col = 0; col < SEATS_PER_ROW; col++) {
                seats.push(`${coach}-${row}${String.fromCharCode(65 + col)}`);
            }
        }
    }
    return seats;
}

function getInventorySeatIds(capacity) {
    const max = COACHES.length * ROWS_PER_COACH * SEATS_PER_ROW;
    const count = Math.max(0, Math.min(Number(capacity) || 0, max));
    return getPhysicalSeatIds().slice(0, count);
}

// API compatibility layer: frontend uses /api/* in every environment.
// Existing route handlers remain unchanged while requests are normalized
// internally to /login, /stations, /bookings, etc.
app.use((req, res, next) => {
    if (req.url === '/api' || req.url.startsWith('/api/')) {
        req.url = req.url.slice(4) || '/';
    }
    next();
});

// Lightweight health endpoint for local/Vercel smoke checks.
app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, service: 'MetriGo API', status: 'ok', timestamp: new Date().toISOString() });
});

app.use(session({
    secret: process.env.SESSION_SECRET || "dev-metro-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000
    }
}));


// ─────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
}


// ─────────────────────────────────────────────
// HELPER: Build hash map from users array
//
// Converts: [{ email, password, ... }, ...]
// Into:     { "user@example.com": { email, password, ... }, ... }
//
// This gives O(1) lookup by email instead of O(n) linear scan.
// The JSON file stays as an array — we only convert in memory.
// ─────────────────────────────────────────────
function buildUserMap(usersArray) {
    const map = {};
    for (const user of usersArray) {
        const normalized = normalizeEmail(user.email);
        if (normalized) map[normalized] = user;
    }
    return map;
}

// Helper: read users.json and return both the array and the hash map
function readUsers() {
    const arr = readJsonArray(USERS_FILE);
    return { arr, map: buildUserMap(arr) };
}

function writeUsers(arr) {
    writeJsonArray(USERS_FILE, arr);
}


// ─────────────────────────────────────────────
// HELPER: Generate a unique hashed PNR
//
// Algorithm:
//   1. Combine email + current timestamp + random 4-byte salt
//   2. SHA-256 hash the combined string
//   3. Take first 8 hex characters → prefix with "MG"
//   4. Check bookings.json for collision; if collision, retry with new salt
//
// Result: "MG" + 8 uppercase hex chars = 10-char unique PNR
// Example: "MG3F8A1C2B"
// ─────────────────────────────────────────────
function generatePNR(email) {
    const existingBookings = readBookings();

    // Build a Set of existing PNRs for O(1) collision check
    const existingPNRs = new Set(existingBookings.map(b => b.pnr));

    let pnr;
    let attempts = 0;

    do {
        // Fresh random salt each attempt prevents collision and timing attacks
        const salt = crypto.randomBytes(4).toString('hex');
        const raw = `${email}|${Date.now()}|${salt}`;

        // SHA-256 digest → take first 8 hex chars → uppercase → prepend "MG"
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        pnr = 'MG' + hash.substring(0, 8).toUpperCase();

        attempts++;
        if (attempts > 10) {
            // Extremely unlikely to reach here, but use longer slice as fallback
            pnr = 'MG' + hash.substring(0, 12).toUpperCase();
            break;
        }
    } while (existingPNRs.has(pnr));

    return pnr;
}

function allocateSeats(requestedSeats, bookedSeats) {
    const totalSeats = Number(requestedSeats);
    if (!Number.isInteger(totalSeats) || totalSeats <= 0) return [];

    const bookedSet = new Set(bookedSeats);

    for (let row = 1; row <= 10; row++) {
        for (let startSeat = 1; startSeat <= 4 - totalSeats + 1; startSeat++) {
            const adjacentSeats = [];

            for (let seat = startSeat; seat < startSeat + totalSeats; seat++) {
                const seatId = `${row}-${seat}`;
                if (bookedSet.has(seatId)) break;
                adjacentSeats.push(seatId);
            }

            if (adjacentSeats.length === totalSeats) {
                return adjacentSeats;
            }
        }
    }

    const nearestSeats = [];

    for (let row = 1; row <= 10 && nearestSeats.length < totalSeats; row++) {
        for (let seat = 1; seat <= 4 && nearestSeats.length < totalSeats; seat++) {
            const seatId = `${row}-${seat}`;
            if (!bookedSet.has(seatId)) {
                nearestSeats.push(seatId);
            }
        }
    }

    return nearestSeats;
}

function getPeakMultiplier(departureTime) {
    const hour = Number(String(departureTime || '12:00').split(':')[0]);
    if (hour >= 8 && hour < 11) return 1.2;
    if (hour >= 17 && hour < 20) return 1.3;
    return 1;
}

function applyPeakPricing(baseFare, departureTime) {
    return Math.round((Number(baseFare) || 0) * getPeakMultiplier(departureTime));
}



// Authoritative train/class catalog used by the booking UI.
app.get('/trains', requireLogin, (req, res) => {
    res.json({ success: true, trains: readTrains() });
});


// ─────────────────────────────────────────────
// ROUTE: POST /login
// Uses bcrypt.compare() — never compares plain text passwords
// Uses hash map for O(1) user lookup instead of linear scan
// ─────────────────────────────────────────────
app.post('/login', rateLimit({ windowMs: AUTH_RATE_WINDOW_MS, max: AUTH_RATE_LIMIT, keyPrefix: 'login' }), async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.json({ success: false, message: "Email and password required" });
    }

    const { map } = readUsers();

    // O(1) hash map lookup — replaces users.find(u => u.email === email)
    const user = map[email];

    if (!user) {
        return res.json({ success: false });
    }

    // bcrypt.compare: safely checks password against stored hash
    // Never exposes the raw password or hash in the comparison
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (passwordMatch) {
        return req.session.regenerate((error) => {
            if (error) {
                logEvent('error', 'Session regeneration failed', { requestId: req.id, error: error.message });
                return res.status(500).json({ success: false, message: 'Unable to start your session. Please try again.' });
            }
            req.session.user = email;
            req.session.save((saveError) => {
                if (saveError) {
                    logEvent('error', 'Session save failed', { requestId: req.id, error: saveError.message });
                    return res.status(500).json({ success: false, message: 'Unable to save your session. Please try again.' });
                }
                return res.json({ success: true });
            });
        });
    }

    res.json({ success: false });
});


// ─────────────────────────────────────────────
// ROUTE: POST /register
// Hashes password with bcrypt before saving to disk
// Plain text password is NEVER written to users.json
// ─────────────────────────────────────────────
app.post('/register', rateLimit({ windowMs: AUTH_RATE_WINDOW_MS, max: AUTH_RATE_LIMIT, keyPrefix: 'register' }), async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.json({ success: false, message: "Email and password required" });
    }

    if (password.length < 8) {
        return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }

    const { arr, map } = readUsers();

    // O(1) duplicate check using hash map
    if (map[email]) {
        return res.json({ success: false, message: "User already exists" });
    }

    // Hash the password before saving — bcrypt adds its own salt internally
    // Result looks like: "$2b$10$randomsalthere...hashedpasswordhere"
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = {
        email,
        password: hashedPassword,   // stored as bcrypt hash, never plain text
        name: "",
        createdAt: new Date().toISOString(),
        favorites: []
    };

    arr.push(newUser);
    writeUsers(arr);

    return req.session.regenerate((error) => {
        if (error) {
            logEvent('error', 'Registration session regeneration failed', { requestId: req.id, error: error.message });
            return res.status(500).json({ success: false, message: 'Registration succeeded, but the session could not be started. Please log in.' });
        }
        req.session.user = email;
        req.session.save((saveError) => {
            if (saveError) {
                logEvent('error', 'Registration session save failed', { requestId: req.id, error: saveError.message });
                return res.status(500).json({ success: false, message: 'Registration succeeded, but the session could not be saved. Please log in.' });
            }
            return res.json({ success: true, message: "Registration successful" });
        });
    });
});

// ─────────────────────────────────────────────
// PASSWORD RESET
// Tokens are stored as SHA-256 hashes and expire after 15 minutes.
// In development, the API returns a reset URL so the flow can be tested
// without configuring an email provider. Production intentionally does not
// expose the token; an email provider can be wired in later.
// ─────────────────────────────────────────────
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_MODE = process.env.PASSWORD_RESET_MODE || 'development';

function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

app.post('/forgot-password', rateLimit({ windowMs: AUTH_RATE_WINDOW_MS, max: AUTH_RATE_LIMIT, keyPrefix: 'forgot-password' }), (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email required' });
    }

    const { arr, map } = readUsers();
    const user = map[email];

    // Do not reveal whether an account exists in production.
    if (!user) {
        return res.json({
            success: true,
            message: 'If an account exists for that email, password reset instructions have been generated.'
        });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = hashResetToken(resetToken);
    const resetTokenExpiry = Date.now() + RESET_TOKEN_TTL_MS;
    const userIndex = arr.findIndex(u => normalizeEmail(u.email) === email);

    arr[userIndex].resetTokenHash = resetTokenHash;
    arr[userIndex].resetTokenExpiry = resetTokenExpiry;
    delete arr[userIndex].resetToken;
    writeUsers(arr);

    const response = {
        success: true,
        message: 'If an account exists for that email, password reset instructions have been generated.'
    };

    // Development convenience only. Never expose reset credentials in production.
    if (PASSWORD_RESET_MODE === 'development' && process.env.NODE_ENV !== 'production') {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        response.resetUrl = `${baseUrl}/reset-password.html?token=${encodeURIComponent(resetToken)}`;
    }

    res.json(response);
});

app.post('/reset-password', rateLimit({ windowMs: AUTH_RATE_WINDOW_MS, max: AUTH_RATE_LIMIT, keyPrefix: 'reset-password' }), async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Reset link and new password are required' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const { arr } = readUsers();
    const tokenHash = hashResetToken(token);
    const userIndex = arr.findIndex(u => u.resetTokenHash === tokenHash);

    if (userIndex === -1) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });
    }

    if (!arr[userIndex].resetTokenExpiry || Date.now() > Number(arr[userIndex].resetTokenExpiry)) {
        delete arr[userIndex].resetTokenHash;
        delete arr[userIndex].resetTokenExpiry;
        writeUsers(arr);
        return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });
    }

    arr[userIndex].password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    delete arr[userIndex].resetTokenHash;
    delete arr[userIndex].resetTokenExpiry;
    delete arr[userIndex].resetToken;
    writeUsers(arr);

    res.json({ success: true, message: 'Password reset successful' });
});


// ─────────────────────────────────────────────
// ROUTE: GET /profile
// ─────────────────────────────────────────────
app.get('/profile', requireLogin, (req, res) => {
    const { map } = readUsers();

    // O(1) lookup by session email
    const user = map[req.session.user];

    if (!user) return res.json({ success: false });

    res.json({
        success: true,
        data: {
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            favorites: user.favorites
        }
    });
});


// ─────────────────────────────────────────────
// ROUTE: POST /update-profile
// Password update also hashes the new value
// ─────────────────────────────────────────────
app.post('/update-profile', requireLogin, async (req, res) => {
    const { name, password } = req.body;
    const { arr } = readUsers();

    const userIndex = arr.findIndex(u => u.email === req.session.user);

    if (userIndex === -1) return res.json({ success: false });

    if (name !== undefined) arr[userIndex].name = name;

    // If changing password, hash the new one before saving
    if (password) {
        arr[userIndex].password = await bcrypt.hash(password, SALT_ROUNDS);
    }

    writeUsers(arr);
    res.json({ success: true });
});


// ─────────────────────────────────────────────
// ROUTE: GET /logout
// ─────────────────────────────────────────────
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});


// ─────────────────────────────────────────────
// ROUTE: GET /stations
// ─────────────────────────────────────────────
app.get('/stations', requireLogin, (req, res) => {
    const filePath = path.join(__dirname, 'data', 'stations.csv');

    if (!fs.existsSync(filePath)) {
        return res.json({ success: false, message: "stations.csv not found" });
    }

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const stations = [];

    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 2 && parts[1].trim()) {
            stations.push({
                id: parts[0].trim(),
                name: parts[1].trim(),
                line: parts[2] ? parts[2].trim() : ''
            });
        }
    }

    res.json(stations);
});


// ─────────────────────────────────────────────
// ROUTE: POST /shortest-path
// ─────────────────────────────────────────────
app.post('/shortest-path', rateLimit({ windowMs: GENERAL_RATE_WINDOW_MS, max: ROUTE_RATE_LIMIT, keyPrefix: 'shortest-path' }), requireLogin, (req, res) => {
    const { from, to } = req.body;

    if (!from || !to) {
        return res.json({ success: false, message: "Missing stations" });
    }

    try {
        const result = findShortestPath(from, to);
        return res.json(result);
    } catch (error) {
        console.error('Shortest path error:', error);
        return res.status(500).json({
            success: false,
            message: "Unable to calculate route"
        });
    }
});


// ─────────────────────────────────────────────
// ROUTE: POST /save-booking
//
// Called only when user clicks "Confirm & Pay".
// If user clicks "Cancel Booking" on the frontend,
// this route is never reached — no booking is saved.
//
// Generates server-side PNR via SHA-256 hashing.
// Saves booking to data/bookings.json.
// ─────────────────────────────────────────────
app.post('/save-booking', rateLimit({ windowMs: GENERAL_RATE_WINDOW_MS, max: BOOKING_RATE_LIMIT, keyPrefix: 'save-booking' }), requireLogin, (req, res) => {
    const { trainName, from, to, cls, price, seats, travelDate, passengerCount } = req.body;

    if (!from || !to || !Array.isArray(seats) || seats.length === 0) {
        return res.json({ success: false, message: "Missing booking details" });
    }

    const normalizedDate = normalizeTravelDate(travelDate);
    if (!normalizedDate) {
        return res.status(400).json({ success: false, message: "A valid travel date is required" });
    }
    if (isPastTravelDate(normalizedDate)) {
        return res.status(400).json({ success: false, message: "Travel date cannot be in the past" });
    }

    const requestedSeats = seats.map(seat => String(seat).trim()).filter(Boolean);
    if (
        requestedSeats.length !== seats.length ||
        new Set(requestedSeats).size !== requestedSeats.length ||
        requestedSeats.some(seat => !isValidSeatId(seat))
    ) {
        return res.status(400).json({ success: false, message: "Invalid seat selection" });
    }

    const selectedTrain = trainName || 'Metro Express';
    const selectedClass = cls || 'CC';
    const trainConfig = getTrainConfig(selectedTrain, selectedClass);
    if (!trainConfig) {
        return res.status(400).json({ success: false, message: 'Invalid train or class selection' });
    }

    const inventory = getInventorySeatIds(trainConfig.classConfig.seats);
    if (requestedSeats.some(seat => !inventory.includes(seat))) {
        return res.status(400).json({ success: false, message: 'One or more selected seats are not available in this class' });
    }

    const bookings = readBookings();
    const bookedSeatSet = getBookedSeats(bookings, selectedTrain, normalizedDate, selectedClass);

    if (requestedSeats.some(seat => bookedSeatSet.has(seat))) {
        return res.status(409).json({
            success: false,
            message: "One or more seats are already booked for this journey date"
        });
    }

    const count = Number(passengerCount) || requestedSeats.length;
    if (!Number.isInteger(count) || count !== requestedSeats.length || count < 1 || count > 6) {
        return res.status(400).json({ success: false, message: "Invalid passenger count" });
    }

    const authoritativeBasePrice = Number(trainConfig.classConfig.price);
    const finalPrice = applyPeakPricing(authoritativeBasePrice, trainConfig.departureTime);
    const pnr = generatePNR(req.session.user);

    const newBooking = normalizeBooking({
        pnr,
        userEmail: req.session.user,
        trainName: selectedTrain,
        from,
        to,
        cls: selectedClass,
        basePrice: authoritativeBasePrice,
        price: finalPrice,
        seats: requestedSeats,
        seat: requestedSeats[0],
        passengerCount: count,
        travelDate: normalizedDate,
        status: 'Confirmed',
        bookedAt: new Date().toISOString()
    });

    bookings.push(newBooking);
    writeBookings(bookings);

    res.json({
        success: true,
        pnr,
        seats: requestedSeats,
        finalPrice,
        travelDate: normalizedDate
    });
});

// Return server-authoritative seat availability for a specific journey date.
// Return bookings belonging to the authenticated user. This becomes the
// single source of truth for booking history; the browser no longer mirrors
// server bookings in localStorage.
app.get('/my-bookings', requireLogin, (req, res) => {
    const bookings = readBookings()
        .map(normalizeBooking)
        .filter(b => b.userEmail === req.session.user)
        .sort((a, b) => new Date(b.bookedAt || 0) - new Date(a.bookedAt || 0));

    res.json({ success: true, bookings });
});

// Cancel an existing booking owned by the authenticated user.
// Cancellation is represented by status rather than deleting the record,
// preserving a complete booking history while releasing its seats.
app.post('/cancel-booking', rateLimit({ windowMs: GENERAL_RATE_WINDOW_MS, max: BOOKING_RATE_LIMIT, keyPrefix: 'cancel-booking' }), requireLogin, (req, res) => {
    const pnr = String(req.body?.pnr || '').trim().toUpperCase();

    if (!/^MG[A-Z0-9]{8,12}$/.test(pnr)) {
        return res.status(400).json({ success: false, message: 'A valid PNR is required' });
    }

    const bookings = readBookings();
    const index = bookings.findIndex(
        booking => booking.pnr === pnr && booking.userEmail === req.session.user
    );

    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = normalizeBooking(bookings[index]);

    if (booking.status === 'Cancelled') {
        return res.status(409).json({ success: false, message: 'This booking is already cancelled' });
    }

    if (booking.travelDate && isPastTravelDate(booking.travelDate)) {
        return res.status(400).json({ success: false, message: 'Past journeys cannot be cancelled' });
    }

    const bookedAtMs = Date.parse(booking.bookedAt || '');
    if (!Number.isFinite(bookedAtMs) || Date.now() - bookedAtMs > 2 * 60 * 60 * 1000) {
        return res.status(400).json({ success: false, message: 'Cancellation is available only within 2 hours of booking' });
    }

    booking.status = 'Cancelled';
    booking.cancelledAt = new Date().toISOString();
    bookings[index] = booking;
    writeBookings(bookings);

    return res.json({
        success: true,
        message: 'Booking cancelled successfully',
        booking
    });
});

app.get('/booked-seats', requireLogin, (req, res) => {
    const trainName = String(req.query.trainName || 'Metro Express');
    const cls = String(req.query.cls || 'CC');
    const travelDate = normalizeTravelDate(req.query.travelDate);

    if (!travelDate) {
        return res.status(400).json({ success: false, message: "A valid travel date is required" });
    }

    const trainConfig = getTrainConfig(trainName, cls);
    if (!trainConfig) {
        return res.status(400).json({ success: false, message: 'Invalid train or class selection' });
    }

    const inventory = getInventorySeatIds(trainConfig.classConfig.seats);
    const bookedSeats = [...getBookedSeats(readBookings(), trainName, travelDate, cls)]
        .filter(seat => inventory.includes(seat));

    res.json({
        success: true, trainName, cls, travelDate,
        departureTime: trainConfig.departureTime,
        basePrice: trainConfig.classConfig.price,
        peakMultiplier: getPeakMultiplier(trainConfig.departureTime),
        bookedSeats, totalSeats: inventory.length,
        availableSeats: inventory.length - bookedSeats.length
    });
});


// ─────────────────────────────────────────────
// ROUTE: GET /check-pnr?pnr=MGXXXXXXXX
//
// Looks up a booking by PNR number.
// Scoped to the currently logged-in user for security.
// ─────────────────────────────────────────────
app.get('/check-pnr', requireLogin, (req, res) => {
    const pnr = String(req.query?.pnr || '').trim().toUpperCase();

    if (!pnr) {
        return res.json({ success: false, message: "PNR required" });
    }

    const bookings = readBookings();

    // Match PNR and scope to current user
    const booking = bookings.find(
        b => String(b.pnr || '').toUpperCase() === pnr && b.userEmail === req.session.user
    );

    if (!booking) {
        return res.json({ success: false, message: "Booking not found" });
    }

    res.json({ success: true, booking });
});


// API responses should not be cached by browsers or intermediary proxies.
app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health' || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});

// Central error handler: return safe messages to clients and detailed structured logs server-side.
app.use((err, req, res, next) => {
    logEvent('error', 'Unhandled request error', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        error: err?.message,
        stack: err?.stack
    });

    if (res.headersSent) return next(err);
    const status = err?.type === 'entity.too.large' ? 413 : 500;
    return res.status(status).json({
        success: false,
        message: status === 413 ? 'Request payload is too large' : 'An unexpected server error occurred',
        requestId: req.id
    });
});

// ─────────────────────────────────────────────
// STATIC FILES + INDEX PROTECTION
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, "../FrontEnd/login.html"));
});

app.use((req, res, next) => {
    if (req.path === "/index.html" && !req.session.user) {
        return res.redirect("/login.html");
    }
    next();
});

app.use(express.static(path.join(__dirname, "../FrontEnd")));


process.on('unhandledRejection', (reason) => {
    logEvent('error', 'Unhandled promise rejection', {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
    });
});

process.on('uncaughtException', (error) => {
    logEvent('error', 'Uncaught exception', { error: error.message, stack: error.stack });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

module.exports = app;

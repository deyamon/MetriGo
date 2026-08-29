const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');       // password hashing
const crypto = require('crypto');       // PNR generation (built-in Node module)

const app = express();
const PORT = 8080;

const SALT_ROUNDS = 10; // bcrypt cost factor — higher = slower but more secure

app.use(cors());
app.use(express.json());

app.use(session({
    secret: "metro-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
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
        map[user.email] = user;
    }
    return map;
}

// Helper: read users.json and return both the array and the hash map
function readUsers() {
    const usersFile = path.join(__dirname, 'data', 'users.json');
    if (!fs.existsSync(usersFile)) return { arr: [], map: {} };
    const arr = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const map = buildUserMap(arr);
    return { arr, map };
}

// Helper: write users array back to JSON file
function writeUsers(arr) {
    const usersFile = path.join(__dirname, 'data', 'users.json');
    fs.writeFileSync(usersFile, JSON.stringify(arr, null, 2));
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
    const bookingsFile = path.join(__dirname, 'data', 'bookings.json');
    const existingBookings = fs.existsSync(bookingsFile)
        ? JSON.parse(fs.readFileSync(bookingsFile, 'utf8'))
        : [];

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

function greedyAllocateSeats(count, bookedSet) {
    const totalSeats = Number(count);
    if (!Number.isInteger(totalSeats) || totalSeats <= 0) return [];

    for (let row = 1; row <= 10; row++) {
        for (let startSeat = 1; startSeat <= 4 - totalSeats + 1; startSeat++) {
            const seats = [];

            for (let seat = startSeat; seat < startSeat + totalSeats; seat++) {
                const seatId = `${row}-${seat}`;
                if (bookedSet.has(seatId)) break;
                seats.push(seatId);
            }

            if (seats.length === totalSeats) return seats;
        }
    }

    const nearestSeats = [];

    for (let row = 1; row <= 10 && nearestSeats.length < totalSeats; row++) {
        for (let seat = 1; seat <= 4 && nearestSeats.length < totalSeats; seat++) {
            const seatId = `${row}-${seat}`;
            if (!bookedSet.has(seatId)) nearestSeats.push(seatId);
        }
    }

    return nearestSeats;
}

function findBestSeats(allSeats, bookedSet, k) {
    const count = Number(k);
    if (!Number.isInteger(count) || count <= 0) return [];

    const availableSeats = allSeats.filter(seat => !bookedSet.has(seat));
    if (availableSeats.length < count) return [];

    let bestSeats = [];
    let bestScore = -Infinity;
    let explored = 0;
    const maxExplored = 5000;
    const perfectScore = 10 + ((count - 1) * 5);

    function scoreSeats(seats) {
        const parsed = seats.map(seat => {
            const [row, number] = seat.split('-').map(Number);
            return { row, number };
        }).sort((a, b) => a.row - b.row || a.number - b.number);

        const rowSet = new Set(parsed.map(seat => seat.row));
        let score = rowSet.size === 1 ? 10 : 0;

        for (let i = 1; i < parsed.length; i++) {
            if (parsed[i].row === parsed[i - 1].row && parsed[i].number === parsed[i - 1].number + 1) {
                score += 5;
            }
        }

        score -= (rowSet.size - 1) * 3;

        return score;
    }

    function backtrack(startIndex, chosen) {
        if (bestScore >= perfectScore || explored >= maxExplored) return;

        if (chosen.length === count) {
            explored++;
            const score = scoreSeats(chosen);

            if (score > bestScore) {
                bestScore = score;
                bestSeats = [...chosen];
            }

            return;
        }

        if (chosen.length + (availableSeats.length - startIndex) < count) return;

        for (let i = startIndex; i < availableSeats.length; i++) {
            chosen.push(availableSeats[i]);
            backtrack(i + 1, chosen);
            chosen.pop();

            if (bestScore >= perfectScore || explored >= maxExplored) return;
        }
    }

    backtrack(0, []);

    return bestSeats;
}

function toAllocationSeatId(seatId) {
    const match = String(seatId).match(/^[A-Z]\d+-(\d+)([A-Z])$/i);
    if (match) {
        const row = Number(match[1]);
        const seat = match[2].toUpperCase().charCodeAt(0) - 64;
        return row >= 1 && row <= 10 && seat >= 1 && seat <= 4 ? `${row}-${seat}` : null;
    }

    return /^\d+-[1-4]$/.test(String(seatId)) ? String(seatId) : null;
}

function applyPeakPricing(baseFare, timeSlot) {
    const fare = Number(baseFare) || 0;
    let multiplier = 1;

    if (timeSlot === "morning_peak") multiplier = 1.3;
    else if (timeSlot === "evening_peak") multiplier = 1.4;
    else if (timeSlot === "afternoon") multiplier = 0.9;
    else if (timeSlot === "early_morning") multiplier = 0.8;

    return Math.round(fare * multiplier);
}


// ─────────────────────────────────────────────
// ROUTE: POST /login
// Uses bcrypt.compare() — never compares plain text passwords
// Uses hash map for O(1) user lookup instead of linear scan
// ─────────────────────────────────────────────
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

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
        req.session.user = email;
        return res.json({ success: true });
    }

    res.json({ success: false });
});


// ─────────────────────────────────────────────
// ROUTE: POST /register
// Hashes password with bcrypt before saving to disk
// Plain text password is NEVER written to users.json
// ─────────────────────────────────────────────
app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.json({ success: false, message: "Email and password required" });
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

    req.session.user = email; // auto-login after registration

    res.json({ success: true, message: "Registration successful" });
});

// ─────────────────────────────────────────────
// ROUTE: POST /forgot-password
// Generates a short-lived reset token for password recovery.
// ─────────────────────────────────────────────
app.post('/forgot-password', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.json({ success: false, message: "Email required" });
    }

    const { arr, map } = readUsers();
    const user = map[email];

    if (!user) {
        return res.json({ success: false, message: "User not found" });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + (15 * 60 * 1000);

    const userIndex = arr.findIndex(u => u.email === email);
    arr[userIndex].resetToken = resetToken;
    arr[userIndex].resetTokenExpiry = resetTokenExpiry;

    writeUsers(arr);

    res.json({ success: true, token: resetToken });
});

// ─────────────────────────────────────────────
// ROUTE: POST /reset-password
// Resets password when a valid, unexpired token is supplied.
// ─────────────────────────────────────────────
app.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.json({ success: false, message: "Token and new password required" });
    }

    const { arr } = readUsers();
    const userIndex = arr.findIndex(u => u.resetToken === token);

    if (userIndex === -1) {
        return res.json({ success: false, message: "Invalid reset token" });
    }

    if (!arr[userIndex].resetTokenExpiry || Date.now() > arr[userIndex].resetTokenExpiry) {
        delete arr[userIndex].resetToken;
        delete arr[userIndex].resetTokenExpiry;
        writeUsers(arr);
        return res.json({ success: false, message: "Reset token expired" });
    }

    arr[userIndex].password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    delete arr[userIndex].resetToken;
    delete arr[userIndex].resetTokenExpiry;

    writeUsers(arr);

    res.json({ success: true, message: "Password reset successful" });
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
app.post('/shortest-path', requireLogin, (req, res) => {
    const { from, to } = req.body;

    if (!from || !to) {
        return res.json({ success: false, message: "Missing stations" });
    }

    const exePath = path.join(__dirname, 'metro.exe');

    execFile(exePath, [from, to], (error, stdout) => {
        if (error) {
            console.log(error);
            return res.json({ success: false, message: "C program failed" });
        }

        try {
            const jsonStart = stdout.indexOf('{');
            if (jsonStart === -1) throw new Error("No JSON found");
            const result = JSON.parse(stdout.substring(jsonStart));
            res.json(result);
        } catch (err) {
            res.json({ success: false, message: "Parse error", raw: stdout });
        }
    });
});

// ─────────────────────────────────────────────
// ROUTE: POST /suggest-seats
// Returns greedy and backtracking-based seat suggestions.
// ─────────────────────────────────────────────
app.post('/suggest-seats', requireLogin, (req, res) => {
    const count = parseInt(req.body.count, 10);
    const trainName = req.body.trainName || 'Metro Express';

    if (!Number.isInteger(count) || count <= 0) {
        return res.json({ success: false, message: "Seat count required" });
    }

    const bookingsFile = path.join(__dirname, 'data', 'bookings.json');
    const bookings = fs.existsSync(bookingsFile)
        ? JSON.parse(fs.readFileSync(bookingsFile, 'utf8'))
        : [];

    const bookedSet = new Set(
        bookings
            .filter(b => (b.trainName || 'Metro Express') === trainName)
            .flatMap(b => Array.isArray(b.seats) ? b.seats : [b.seat])
            .map(toAllocationSeatId)
            .filter(Boolean)
    );

    const allSeats = [];
    for (let row = 1; row <= 10; row++) {
        for (let seat = 1; seat <= 4; seat++) {
            allSeats.push(`${row}-${seat}`);
        }
    }

    const greedy = greedyAllocateSeats(count, bookedSet);
    const suggested = count > 4 ? greedy : findBestSeats(allSeats, bookedSet, count);

    res.json({ success: true, greedy, suggested });
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
app.post('/save-booking', requireLogin, (req, res) => {
    const { trainName, from, to, cls, price, seats, timeSlot } = req.body;

    if (!from || !to || !Array.isArray(seats) || seats.length === 0) {
        return res.json({ success: false, message: "Missing booking details" });
    }

    const requestedSeats = seats.map(seat => String(seat).trim()).filter(Boolean);

    if (requestedSeats.length !== seats.length || new Set(requestedSeats).size !== requestedSeats.length) {
        return res.json({ success: false, message: "Invalid seat selection" });
    }

    const bookingsFile = path.join(__dirname, 'data', 'bookings.json');
    const selectedTrain = trainName || 'Metro Express';

    // Read existing bookings or initialize empty array
    const bookings = fs.existsSync(bookingsFile)
        ? JSON.parse(fs.readFileSync(bookingsFile, 'utf8'))
        : [];

    const bookedSeats = bookings
        .filter(b => (b.trainName || 'Metro Express') === selectedTrain)
        .flatMap(b => Array.isArray(b.seats) ? b.seats : [b.seat])
        .filter(Boolean);

    const bookedSeatSet = new Set(bookedSeats);
    const hasConflict = requestedSeats.some(seat => bookedSeatSet.has(seat));

    if (hasConflict) {
        return res.json({ success: false, message: "One or more seats are already booked" });
    }

    const selectedTimeSlot = timeSlot || 'early_morning';
    const finalPrice = applyPeakPricing(price, selectedTimeSlot);

    // Generate unique hashed PNR — uses session email as entropy source
    const pnr = generatePNR(req.session.user);

    const newBooking = {
        pnr,
        userEmail: req.session.user,
        trainName: selectedTrain,
        from,
        to,
        cls: cls || 'CC',
        price: finalPrice,
        seats: requestedSeats,
        seat: requestedSeats[0],
        timeSlot: selectedTimeSlot,
        status: 'Confirmed',
        bookedAt: new Date().toISOString()
    };

    bookings.push(newBooking);
    fs.writeFileSync(bookingsFile, JSON.stringify(bookings, null, 2));

    res.json({ success: true, pnr, seats: requestedSeats, finalPrice });
});


// ─────────────────────────────────────────────
// ROUTE: GET /check-pnr?pnr=MGXXXXXXXX
//
// Looks up a booking by PNR number.
// Scoped to the currently logged-in user for security.
// ─────────────────────────────────────────────
app.get('/check-pnr', requireLogin, (req, res) => {
    const { pnr } = req.query;

    if (!pnr) {
        return res.json({ success: false, message: "PNR required" });
    }

    const bookingsFile = path.join(__dirname, 'data', 'bookings.json');

    if (!fs.existsSync(bookingsFile)) {
        return res.json({ success: false, message: "No bookings found" });
    }

    const bookings = JSON.parse(fs.readFileSync(bookingsFile, 'utf8'));

    // Match PNR and scope to current user
    const booking = bookings.find(
        b => b.pnr === pnr && b.userEmail === req.session.user
    );

    if (!booking) {
        return res.json({ success: false, message: "Booking not found" });
    }

    res.json({ success: true, booking });
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


// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

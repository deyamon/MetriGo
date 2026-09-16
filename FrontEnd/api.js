// MetriGo API client
// Centralized API routing, credentials, timeouts and consistent error handling.
const METRIGO_API_BASE = '/api';
const DEFAULT_API_TIMEOUT_MS = 10000;

class ApiTimeoutError extends Error {
    constructor(message = 'The request timed out. Please check your connection and try again.') {
        super(message);
        this.name = 'ApiTimeoutError';
    }
}

async function apiFetch(endpoint, options = {}) {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_API_TIMEOUT_MS;
    const externalSignal = options.signal;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;
    delete fetchOptions.signal;
    fetchOptions.credentials = 'include';
    fetchOptions.signal = controller.signal;

    try {
        const response = await fetch(`${METRIGO_API_BASE}${normalizedEndpoint}`, fetchOptions);

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const error = new Error(`Too many requests. Please try again${retryAfter ? ` in ${retryAfter} seconds` : ' later'}.`);
            error.status = 429;
            throw error;
        }

        if (response.status >= 500) {
            const error = new Error('MetriGo is having trouble responding right now. Please try again.');
            error.status = response.status;
            throw error;
        }

        return response;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new ApiTimeoutError();
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

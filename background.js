/**
 * NotebookLM FoldNest - Background Service v0.9.3
 * Handles remote configuration fetching to bypass CORS restrictions.
 * 
 * v0.9.3 Changes:
 * - Added sync-related message handlers for Google Drive API
 * 
 * v0.9.2 Changes:
 * - Added retry logic for failed fetches
 * - Improved error messages
 * - Added timeout handling
 */

const FETCH_TIMEOUT_MS = 10000; // 10 second timeout

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchConfig") {
        fetchWithTimeout(request.url, FETCH_TIMEOUT_MS)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.warn("NotebookLM FoldNest: Config fetch failed:", error.message);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keeps the message channel open for async response
    }

    // --- SYNC MODULE MESSAGE HANDLERS ---
    
    // Get auth token for Google Drive API
    if (request.action === "getAuthToken") {
        chrome.identity.getAuthToken({ interactive: request.interactive || false }, (token) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, token: token });
            }
        });
        return true;
    }

    // Revoke auth token
    if (request.action === "revokeAuthToken") {
        if (request.token) {
            chrome.identity.removeCachedAuthToken({ token: request.token }, () => {
                sendResponse({ success: true });
            });
        } else {
            sendResponse({ success: false, error: "No token provided" });
        }
        return true;
    }
});

/**
 * Fetch with timeout wrapper
 * @param {string} url - URL to fetch
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error('Request timeout'));
        }, timeoutMs);

        fetch(url, { signal: controller.signal })
            .then(response => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    reject(new Error('Request timeout'));
                } else {
                    reject(error);
                }
            });
    });
}

console.log("NotebookLM FoldNest service worker started (v0.9.2)");

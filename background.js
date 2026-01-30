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
        console.log(`[FoldNest BG] 🔑 getAuthToken request, interactive: ${request.interactive}`);
        (async () => {
            try {
                console.log('[FoldNest BG] 🔑 Calling chrome.identity.getAuthToken...');
                // Use Promise-based API (Chrome 116+)
                const result = await chrome.identity.getAuthToken({ 
                    interactive: request.interactive || false 
                });
                console.log('[FoldNest BG] ✅ Token received successfully');
                console.log(`[FoldNest BG] 🔑 Token length: ${result.token?.length || 0} chars`);
                sendResponse({ success: true, token: result.token });
            } catch (error) {
                console.error('[FoldNest BG] ❌ getAuthToken error:', error);
                console.error('[FoldNest BG] 💡 Error details:');
                console.error('   - Error name:', error.name);
                console.error('   - Error message:', error.message);
                if (error.message?.includes('OAuth2')) {
                    console.error('[FoldNest BG] 💡 OAuth2 error - check:');
                    console.error('   1. manifest.json has correct oauth2.client_id');
                    console.error('   2. Google Cloud Console OAuth client is type "Chrome extension"');
                    console.error('   3. Extension ID is added to OAuth client');
                }
                sendResponse({ success: false, error: error.message || 'Authentication failed' });
            }
        })();
        return true;
    }

    // Revoke auth token
    if (request.action === "revokeAuthToken") {
        (async () => {
            try {
                if (request.token) {
                    await chrome.identity.removeCachedAuthToken({ token: request.token });
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: "No token provided" });
                }
            } catch (error) {
                console.warn('[FoldNest] revokeAuthToken error:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
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

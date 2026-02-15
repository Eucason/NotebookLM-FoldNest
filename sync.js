/**
 * NotebookLM FoldNest - Sync Module v1.0.0
 * 
 * Provides optional cross-device sync functionality using Google Drive's appdata folder.
 * This module is completely self-contained and does not interfere with existing functionality.
 * 
 * Features:
 * - Optional toggle (off by default)
 * - Google OAuth authentication via chrome.identity
 * - Google Drive appdata storage (private to extension)
 * - Automatic sync on state changes
 * - Manual sync trigger
 * - Conflict detection with timestamp-based resolution
 * - Sync status indicator
 */

(function () {
    'use strict';

    // --- CONSTANTS ---
    const SYNC_STORAGE_KEY = 'foldnest_sync_settings';
    const SYNC_FILE_NAME = 'foldnest_state.json';
    const DASHBOARD_SYNC_FILE_NAME = 'foldnest_dashboard.json';
    const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
    const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';
    const SYNC_DEBOUNCE_MS = 2000; // Debounce sync uploads
    const SYNC_COOLDOWN_MS = 5000; // Minimum time between syncs

    // --- STATE ---
    let syncSettings = {
        enabled: false,
        lastSyncTime: null,
        autoSync: true // Auto-sync on changes
    };
    let isSyncing = false;
    let syncDebounceTimer = null;
    let lastSyncAttempt = 0;
    let cachedToken = null;
    let isOnline = navigator.onLine;

    // Page type tracking
    let currentPageType = null; // 'notebook' or 'dashboard'
    let currentNotebookId = null;

    // Reload prevention - track if we just synced to avoid reload loop
    const JUST_SYNCED_KEY = 'foldnest_just_synced';
    const RELOAD_GRACE_PERIOD = 5000; // 5 seconds

    // --- OFFLINE QUEUE ---
    const OFFLINE_QUEUE_KEY = 'foldnest_sync_offline_queue';
    let offlineQueue = [];

    /**
     * Load offline queue from storage
     */
    async function loadOfflineQueue() {
        try {
            const result = await chrome.storage.local.get([OFFLINE_QUEUE_KEY]);
            offlineQueue = result[OFFLINE_QUEUE_KEY] || [];
        } catch (e) {
            console.warn('[FoldNest Sync] Failed to load offline queue:', e);
            offlineQueue = [];
        }
    }

    /**
     * Save offline queue to storage
     */
    async function saveOfflineQueue() {
        try {
            await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: offlineQueue });
        } catch (e) {
            console.warn('[FoldNest Sync] Failed to save offline queue:', e);
        }
    }

    /**
     * Add operation to offline queue
     * @param {string} type - 'notebook' or 'dashboard'
     * @param {object} state - State to sync
     */
    async function queueOfflineOperation(type, state) {
        // Remove duplicate operations for same type
        offlineQueue = offlineQueue.filter(op => op.type !== type);

        offlineQueue.push({
            type,
            state,
            timestamp: Date.now()
        });

        await saveOfflineQueue();
        console.log('[FoldNest Sync] Queued offline operation:', type);
        showToast(`Offline: ${type} sync queued`, 'warning');
    }

    /**
     * Process offline queue when back online
     */
    async function processOfflineQueue() {
        if (offlineQueue.length === 0 || !syncSettings.enabled) return;

        console.log('[FoldNest Sync] Processing offline queue:', offlineQueue.length, 'operations');
        showToast(`Syncing ${offlineQueue.length} queued changes...`, 'info');

        const queue = [...offlineQueue];
        offlineQueue = [];
        await saveOfflineQueue();

        let successCount = 0;
        for (const op of queue) {
            try {
                const success = await uploadState(op.type);
                if (success) successCount++;
            } catch (e) {
                console.error('[FoldNest Sync] Failed to process queued operation:', e);
                // Re-queue failed operation
                offlineQueue.push(op);
            }
        }

        await saveOfflineQueue();

        if (successCount > 0) {
            showToast(`Synced ${successCount} queued changes`, 'success');
        }
        if (offlineQueue.length > 0) {
            showToast(`${offlineQueue.length} changes still pending`, 'warning');
        }
    }

    /**
     * Setup online/offline listeners
     */
    function setupConnectivityListeners() {
        window.addEventListener('online', () => {
            isOnline = true;
            console.log('[FoldNest Sync] Back online');
            showToast('Back online - syncing...', 'info');
            processOfflineQueue();
        });

        window.addEventListener('offline', () => {
            isOnline = false;
            console.log('[FoldNest Sync] Went offline');
            showToast('Offline - changes will sync when connected', 'warning');
            updateSyncStatus('offline', 'No internet connection');
        });
    }

    // --- INITIALIZATION ---

    /**
     * Check if extension context is still valid
     * (Context becomes invalid after extension reload)
     */
    function isContextValid() {
        try {
            return chrome?.runtime?.id != null;
        } catch {
            return false;
        }
    }

    /**
     * Detect if we're on notebook or dashboard page
     */
    function detectPageType() {
        const url = window.location.href;

        if (url.includes('/notebook/')) {
            currentPageType = 'notebook';

            // Extract notebook ID from URL
            const match = url.match(/\/notebook\/([^/?#]+)/);
            if (match) {
                currentNotebookId = match[1];
                console.log(`[FoldNest Sync] Detected notebook page, ID: ${currentNotebookId}`);
            }
        } else if (url.includes('notebooklm.google.com')) {
            currentPageType = 'dashboard';
            currentNotebookId = null;
            console.log('[FoldNest Sync] Detected dashboard page');
        }
    }

    /**
     * Initialize the sync module
     */
    async function initSync() {
        try {
            // IMMEDIATELY clear just-synced flag on page load to prevent stale timestamps
            await chrome.storage.local.remove(JUST_SYNCED_KEY);

            // Detect page type first
            detectPageType();

            // Load sync settings
            const result = await chrome.storage.local.get([SYNC_STORAGE_KEY]);
            if (result[SYNC_STORAGE_KEY]) {
                syncSettings = { ...syncSettings, ...result[SYNC_STORAGE_KEY] };
            }

            // Clear just-synced flag after grace period
            const justSyncedResult = await chrome.storage.local.get([JUST_SYNCED_KEY]);
            const justSynced = justSyncedResult[JUST_SYNCED_KEY] || 0;
            if (Date.now() - justSynced > RELOAD_GRACE_PERIOD) {
                await chrome.storage.local.remove(JUST_SYNCED_KEY);
            }

            // Load offline queue
            await loadOfflineQueue();

            // Setup connectivity listeners
            setupConnectivityListeners();

            // Process any pending offline operations
            if (isOnline && offlineQueue.length > 0) {
                setTimeout(() => processOfflineQueue(), 3000);
            }

            // Add sync UI elements
            setupSyncUI();

            // If sync is enabled, perform initial sync after UI is ready
            if (syncSettings.enabled && isOnline) {
                setTimeout(() => {
                    performFullSync().catch(err => {
                        console.error('[FoldNest Sync] Initial sync failed:', err);
                    });
                }, 2000);
            }

            console.log('[FoldNest Sync] Module initialized, enabled:', syncSettings.enabled, 'page:', currentPageType);
        } catch (e) {
            console.error('[FoldNest Sync] Init failed:', e);
        }
    }

    // --- AUTHENTICATION ---

    /**
     * Get OAuth token via background script (chrome.identity not available in content scripts)
     * @param {boolean} interactive - Whether to show auth UI
     * @returns {Promise<string|null>} Access token or null
     */
    async function getAuthToken(interactive = false) {
        console.log(`[FoldNest Sync] 🔑 getAuthToken called, interactive: ${interactive}, hasCachedToken: ${!!cachedToken}`);

        return new Promise((resolve) => {
            // Check if we have a valid cached token
            if (cachedToken && !interactive) {
                console.log('[FoldNest Sync] 🔑 Using cached token');
                resolve(cachedToken);
                return;
            }

            console.log('[FoldNest Sync] 🔑 Requesting token from background script...');

            // Request token from background script
            chrome.runtime.sendMessage(
                { action: 'getAuthToken', interactive },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[FoldNest Sync] ❌ Auth message failed:', chrome.runtime.lastError.message);
                        console.error('[FoldNest Sync] 💡 This usually means:');
                        console.error('   - Extension was reloaded (refresh this page)');
                        console.error('   - Background service worker crashed');
                        cachedToken = null;
                        resolve(null);
                    } else if (response && response.success) {
                        console.log('[FoldNest Sync] ✅ Token received successfully');
                        console.log(`[FoldNest Sync] 🔑 Token length: ${response.token?.length || 0} chars`);
                        cachedToken = response.token;
                        resolve(response.token);
                    } else {
                        console.error('[FoldNest Sync] ❌ Auth failed:', response?.error);
                        console.error('[FoldNest Sync] 💡 Possible causes:');
                        console.error('   - User cancelled OAuth consent');
                        console.error('   - OAuth client not configured as "Chrome extension" type');
                        console.error('   - Extension ID not added to OAuth client');
                        cachedToken = null;
                        resolve(null);
                    }
                }
            );
        });
    }

    /**
     * Revoke current auth token via background script
     */
    async function revokeAuthToken() {
        if (cachedToken) {
            await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { action: 'revokeAuthToken', token: cachedToken },
                    () => resolve()
                );
            });
            cachedToken = null;
        }
    }

    /**
     * Make an authenticated request with auto-retry on 401
     * @param {string} url - Request URL
     * @param {object} options - Fetch options (without auth header)
     * @param {boolean} isRetry - Whether this is a retry attempt
     * @returns {Promise<Response>}
     */
    async function makeAuthenticatedRequest(url, options = {}, isRetry = false) {
        const token = await getAuthToken(isRetry);
        if (!token) {
            const error = new Error('Not authenticated - no token received');
            error.code = 'NO_TOKEN';
            console.error('[FoldNest Sync] No auth token available. User may need to re-enable sync.');
            throw error;
        }

        const response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            }
        });

        // Handle token expiration - retry once with fresh token
        if (response.status === 401 && !isRetry) {
            console.log('[FoldNest Sync] Token expired, refreshing...');
            await revokeAuthToken();
            return makeAuthenticatedRequest(url, options, true);
        }

        // Handle 403 - permission issue
        if (response.status === 403) {
            const errorBody = await response.text().catch(() => 'Could not read error body');
            console.error('[FoldNest Sync] ❌ 403 Forbidden');
            console.error('[FoldNest Sync] 📋 Response body:', errorBody);
            console.error('[FoldNest Sync] 💡 How to fix:');
            console.error('   1. Go to Google Cloud Console: https://console.cloud.google.com/apis/credentials');
            console.error('   2. Enable "Google Drive API" in APIs & Services');
            console.error('   3. Edit your OAuth 2.0 Client ID');
            console.error('   4. Make sure Application type is "Chrome extension"');
            console.error('   5. Add your Extension ID (from chrome://extensions)');
            console.error('   6. Save and reload the extension');
            const error = new Error('Permission denied - see console for setup instructions');
            error.code = 'FORBIDDEN';
            throw error;
        }

        return response;
    }

    // --- GOOGLE DRIVE API ---

    /**
     * Find a file in Drive appdata folder
     * @param {string} fileName - File name to find
     * @returns {Promise<{id: string, modifiedTime: string}|null>}
     */
    async function findFile(fileName) {
        console.log(`[FoldNest Sync] 🔍 Finding file: ${fileName}`);
        try {
            const params = new URLSearchParams({
                spaces: 'appDataFolder',
                q: `name='${fileName}'`,
                fields: 'files(id, name, modifiedTime)'
            });

            const url = `${DRIVE_API_URL}/files?${params}`;
            console.log(`[FoldNest Sync] 🌐 API URL: ${url}`);

            const response = await makeAuthenticatedRequest(url);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                console.error(`[FoldNest Sync] ❌ Find file HTTP ${response.status}: ${errorText}`);
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log(`[FoldNest Sync] 📁 Found ${data.files?.length || 0} files`);

            if (data.files && data.files.length > 0) {
                console.log(`[FoldNest Sync] ✅ File found: ${data.files[0].id}`);
            }

            return data.files && data.files.length > 0 ? data.files[0] : null;
        } catch (e) {
            console.error('[FoldNest Sync] ❌ Find file failed:', e.message);
            return null;
        }
    }

    /**
     * Download file content from Drive
     * @param {string} fileId - Drive file ID
     * @returns {Promise<object|null>} Parsed JSON content or null
     */
    async function downloadFile(fileId) {
        try {
            const response = await makeAuthenticatedRequest(`${DRIVE_API_URL}/files/${fileId}?alt=media`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (e) {
            console.error('[FoldNest Sync] Download failed:', e);
            return null;
        }
    }

    /**
     * Upload/update file in Drive appdata folder
     * @param {string} fileName - File name
     * @param {object} content - Content to upload
     * @param {string|null} existingFileId - Existing file ID to update
     * @returns {Promise<boolean>} Success status
     */
    async function uploadFile(fileName, content, existingFileId = null) {
        try {
            const metadata = {
                name: fileName,
                mimeType: 'application/json'
            };

            if (!existingFileId) {
                metadata.parents = ['appDataFolder'];
            }

            // Add sync metadata
            const contentWithMeta = {
                ...content,
                _syncMeta: {
                    lastModified: Date.now(),
                    version: '1.0.0'
                }
            };

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([JSON.stringify(contentWithMeta)], { type: 'application/json' }));

            const url = existingFileId
                ? `${DRIVE_UPLOAD_URL}/files/${existingFileId}?uploadType=multipart`
                : `${DRIVE_UPLOAD_URL}/files?uploadType=multipart`;

            const response = await makeAuthenticatedRequest(url, {
                method: existingFileId ? 'PATCH' : 'POST',
                body: form
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return true;
        } catch (e) {
            console.error('[FoldNest Sync] Upload failed:', e);
            return false;
        }
    }

    // --- SYNC OPERATIONS ---

    /**
     * Upload current state to Drive
     * @param {string} type - 'notebook' or 'dashboard'
     * @returns {Promise<boolean>}
     */
    async function uploadState(type = 'notebook') {
        if (!syncSettings.enabled || isSyncing) return false;

        const now = Date.now();
        if (now - lastSyncAttempt < SYNC_COOLDOWN_MS) {
            console.debug('[FoldNest Sync] Cooldown active, skipping upload');
            return false;
        }

        try {
            isSyncing = true;
            lastSyncAttempt = now;
            updateSyncStatus('syncing');

            // Check if offline - queue instead of sync
            if (!isOnline) {
                const api = window.NotebookLMFoldNest;
                let state;
                if (type === 'dashboard') {
                    const result = await chrome.storage.local.get(['notebookLM_dashboardFolders']);
                    state = result['notebookLM_dashboardFolders'];
                } else if (api) {
                    state = api.getState();
                }
                if (state) {
                    await queueOfflineOperation(type, state);
                }
                updateSyncStatus('offline', 'Queued for later');
                return false;
            }

            let state, fileName;

            if (type === 'dashboard') {
                // Get dashboard state from local storage
                const result = await chrome.storage.local.get(['notebookLM_dashboardFolders']);
                state = result['notebookLM_dashboardFolders'];
                fileName = DASHBOARD_SYNC_FILE_NAME;
            } else {
                // Get notebook state - need notebook ID from content script
                const api = window.NotebookLMFoldNest;
                if (!api) {
                    updateSyncStatus('idle');
                    return false;
                }
                state = api.getState();
                // Get current notebook ID from URL
                const match = window.location.pathname.match(/\/notebook\/([^\/\?]+)/);
                if (!match) {
                    updateSyncStatus('idle');
                    return false;
                }
                const notebookId = match[1];
                fileName = `foldnest_notebook_${notebookId}.json`;
            }

            if (!state) {
                updateSyncStatus('idle');
                return false;
            }

            // Find existing file
            const existingFile = await findFile(fileName);

            // Upload
            const success = await uploadFile(fileName, state, existingFile?.id);

            if (success) {
                // Update local storage with sync metadata to prevent reload loops
                const syncMeta = {
                    lastModified: now,
                    version: '1.0.0'
                };

                if (type === 'dashboard') {
                    // _syncMeta is now maintained by saveDashboardState() in content.js,
                    // so we don't need to re-save it here after upload.
                } else {
                    // _syncMeta is now maintained by saveState() in content.js,
                    // so we don't need to re-save it here after upload.
                }

                syncSettings.lastSyncTime = now;
                saveSyncSettings();
                updateSyncStatus('success');
                console.log('[FoldNest Sync] Upload successful:', fileName);
            } else {
                updateSyncStatus('error', 'Upload failed');
            }

            return success;
        } catch (e) {
            console.error('[FoldNest Sync] Upload error:', e);
            updateSyncStatus('error', e.message);
            return false;
        } finally {
            isSyncing = false;
        }
    }

    /**
     * Download state from Drive
     * @param {string} type - 'notebook' or 'dashboard'
     * @returns {Promise<object|null>}
     */
    async function downloadState(type = 'notebook') {
        if (!syncSettings.enabled || isSyncing) return null;

        try {
            isSyncing = true;
            updateSyncStatus('syncing');

            // Check if offline
            if (!isOnline) {
                updateSyncStatus('offline', 'No internet connection');
                return null;
            }

            let fileName;
            if (type === 'dashboard') {
                fileName = DASHBOARD_SYNC_FILE_NAME;
            } else {
                const match = window.location.pathname.match(/\/notebook\/([^\/\?]+)/);
                if (!match) {
                    updateSyncStatus('idle');
                    return null;
                }
                fileName = `foldnest_notebook_${match[1]}.json`;
            }

            // Find file
            const file = await findFile(fileName);
            if (!file) {
                console.log('[FoldNest Sync] No remote file found:', fileName);
                updateSyncStatus('idle');
                return null;
            }

            // Download content
            const content = await downloadFile(file.id);
            if (!content) {
                updateSyncStatus('error', 'Download failed');
                return null;
            }

            // Extract sync metadata for comparison, but keep it in data for storage
            const { _syncMeta } = content;

            updateSyncStatus('success');
            console.log('[FoldNest Sync] Download successful:', fileName);

            // Return full content (WITH _syncMeta) so local storage gets proper timestamps
            return { data: content, meta: _syncMeta };
        } catch (e) {
            console.error('[FoldNest Sync] Download error:', e);
            updateSyncStatus('error', e.message);
            return null;
        } finally {
            isSyncing = false;
        }
    }

    /**
     * Perform full sync (download then upload if needed)
     * @returns {Promise<boolean>}
     */
    async function performFullSync() {
        if (!syncSettings.enabled) return false;

        // Guard: Skip if extension context invalidated (happens during dev reload)
        if (!isContextValid()) {
            console.warn('[FoldNest Sync] Extension context invalidated, skipping sync');
            return false;
        }

        try {
            updateSyncStatus('syncing');

            // Sync dashboard state
            const dashboardRemote = await downloadState('dashboard');
            if (dashboardRemote) {
                // Get local state
                const localResult = await chrome.storage.local.get(['notebookLM_dashboardFolders']);
                const localState = localResult['notebookLM_dashboardFolders'];

                // Compare timestamps for conflict resolution (last-write-wins)
                const localTime = localState?._syncMeta?.lastModified || 0;
                const remoteTime = dashboardRemote.meta?.lastModified || 0;

                if (remoteTime > localTime) {
                    // Remote is newer - try to apply without reload
                    console.log('[FoldNest Sync] Dashboard remote is newer, applying state...');

                    // CHANGED: Use applyState if available, otherwise just save to storage
                    const api = window.NotebookLMFoldNest;
                    if (api?.applyState) {
                        const applied = api.applyState(dashboardRemote.data, 'dashboard');
                        if (applied) {
                            console.log('[FoldNest Sync] ✓ Dashboard state applied via applyState');
                        } else {
                            // Fallback: just save to storage (no reload needed for dashboard)
                            await chrome.storage.local.set({ 'notebookLM_dashboardFolders': dashboardRemote.data });
                            showToast('Dashboard synced from cloud', 'success');
                        }
                    } else {
                        // applyState not available, just save to storage
                        await chrome.storage.local.set({ 'notebookLM_dashboardFolders': dashboardRemote.data });
                        showToast('Dashboard synced from cloud', 'success');
                    }
                }
            }

            // Sync notebook state (if on notebook page)
            const match = window.location.pathname.match(/\/notebook\/([^\/\?]+)/);
            if (match) {
                const notebookRemote = await downloadState('notebook');
                if (notebookRemote) {
                    const notebookId = match[1];
                    const stateKey = `notebookTreeState_${notebookId}`;
                    const localResult = await chrome.storage.local.get([stateKey]);
                    const localState = localResult[stateKey];

                    const localTime = localState?._syncMeta?.lastModified || 0;
                    const remoteTime = notebookRemote.meta?.lastModified || 0;

                    console.log('[FoldNest Sync] Notebook times - Local:', localTime, 'Remote:', remoteTime);

                    if (remoteTime > localTime) {
                        // Remote is newer - try to apply without reload
                        if (!isContextValid()) {
                            console.warn('[FoldNest Sync] Context invalidated, cannot sync');
                            return false;
                        }

                        // CHANGED: Use applyState if available, fall back to reload only if it fails
                        const api = window.NotebookLMFoldNest;
                        if (api?.applyState) {
                            console.log('[FoldNest Sync] Attempting to apply state without reload...');
                            const applied = api.applyState(notebookRemote.data, 'notebook');
                            if (applied) {
                                console.log('[FoldNest Sync] ✓ Notebook state applied via applyState (no reload)');
                                // Also update storage with the new state (applyState calls saveState internally)
                                await chrome.storage.local.set({ [stateKey]: notebookRemote.data });
                            } else {
                                // applyState failed - fall back to reload
                                console.warn('[FoldNest Sync] applyState returned false, falling back to reload');
                                await chrome.storage.local.set({ [stateKey]: notebookRemote.data });
                                showToast('Notebook synced from cloud', 'success');
                                console.log('[FoldNest Sync] ⚡ Reloading page as fallback...');
                                window.location.reload();
                                return true;
                            }
                        } else {
                            // applyState not available - fall back to reload
                            console.log('[FoldNest Sync] applyState not available, using reload fallback');
                            await chrome.storage.local.set({ [stateKey]: notebookRemote.data });
                            showToast('Notebook synced from cloud', 'success');
                            console.log('[FoldNest Sync] ⚡ Reloading page...');
                            window.location.reload();
                            return true;
                        }
                    } else if (localTime > remoteTime) {
                        // Local is newer - upload to cloud
                        console.log('[FoldNest Sync] 📤 Local notebook is newer, uploading...');
                        await uploadState('notebook');
                    } else {
                        console.log('[FoldNest Sync] ✓ Notebook already in sync');
                    }
                }
            }

            syncSettings.lastSyncTime = Date.now();
            saveSyncSettings();
            updateSyncStatus('success');
            return true;
        } catch (e) {
            console.error('[FoldNest Sync] Full sync failed:', e);
            updateSyncStatus('error', e.message);
            return false;
        }
    }

    /**
     * Debounced upload trigger
     * @param {string} type - 'notebook' or 'dashboard'
     */
    function triggerUpload(type = 'notebook') {
        if (!syncSettings.enabled || !syncSettings.autoSync) return;

        if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
        }

        syncDebounceTimer = setTimeout(() => {
            uploadState(type);
        }, SYNC_DEBOUNCE_MS);
    }

    // --- SETTINGS MANAGEMENT ---

    /**
     * Save sync settings to storage
     */
    function saveSyncSettings() {
        if (!isContextValid()) {
            console.warn('[FoldNest Sync] Extension context invalidated, skipping save');
            return;
        }
        chrome.storage.local.set({ [SYNC_STORAGE_KEY]: syncSettings });
    }

    /**
     * Enable sync functionality
     * @returns {Promise<boolean>}
     */
    async function enableSync() {
        console.log('[FoldNest Sync] 🚀 Enabling sync...');
        try {
            updateSyncStatus('syncing');

            console.log('[FoldNest Sync] Step 1: Requesting auth token (interactive)...');
            // Request auth token with interactive mode
            const token = await getAuthToken(true);
            if (!token) {
                console.error('[FoldNest Sync] ❌ Step 1 failed: No token received');
                updateSyncStatus('error', 'Authentication failed');
                showToast('Sync: Authentication failed - check console for details', 'error');
                return false;
            }
            console.log('[FoldNest Sync] ✅ Step 1 complete: Token received');

            console.log('[FoldNest Sync] Step 2: Saving sync settings...');
            syncSettings.enabled = true;
            saveSyncSettings();
            console.log('[FoldNest Sync] ✅ Step 2 complete: Settings saved');

            console.log('[FoldNest Sync] Step 3: Performing initial sync...');
            // Perform initial sync
            await performFullSync();
            console.log('[FoldNest Sync] ✅ Step 3 complete: Initial sync done');

            updateSyncIndicator();
            showToast('Cloud sync enabled', 'success');
            console.log('[FoldNest Sync] ✅ Sync enabled successfully!');
            return true;
        } catch (e) {
            console.error('[FoldNest Sync] ❌ Enable failed at step:', e.message);
            console.error('[FoldNest Sync] Stack:', e.stack);
            showToast('Failed to enable sync - check console', 'error');
            return false;
        }
    }

    /**
     * Disable sync functionality
     */
    async function disableSync() {
        syncSettings.enabled = false;
        saveSyncSettings();
        await revokeAuthToken();
        updateSyncIndicator();
        updateSyncStatus('idle');
        showToast('Cloud sync disabled');
    }

    /**
     * Toggle sync on/off
     */
    async function toggleSync() {
        if (syncSettings.enabled) {
            await disableSync();
        } else {
            await enableSync();
        }
    }

    // --- UI ---

    let syncStatusEl = null;
    let currentSyncStatus = 'idle';

    /**
     * Setup sync UI elements
     */
    function setupSyncUI() {
        // Wait for FoldNest to be ready - look for the controls area
        const checkReady = setInterval(() => {
            const controlsArea = document.querySelector('.plugin-controls-area');
            if (controlsArea && !document.querySelector('.foldnest-sync-btn')) {
                clearInterval(checkReady);
                addSyncButton(controlsArea);
            }
        }, 1000);

        // Stop checking after 60 seconds
        setTimeout(() => clearInterval(checkReady), 60000);

        // Also try to add to any future containers
        const observer = new MutationObserver(() => {
            const controlsArea = document.querySelector('.plugin-controls-area');
            if (controlsArea && !document.querySelector('.foldnest-sync-btn')) {
                addSyncButton(controlsArea);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Add sync button to header
     * @param {HTMLElement} container
     */
    function addSyncButton(container) {
        // Create sync button
        const syncBtn = document.createElement('button');
        syncBtn.className = 'foldnest-sync-btn plugin-btn secondary';
        syncBtn.title = syncSettings.enabled ? 'Sync enabled - Click to sync now' : 'Click to enable sync';
        syncBtn.innerHTML = getSyncIcon();
        syncBtn.onclick = handleSyncClick;

        // Create status indicator
        syncStatusEl = document.createElement('span');
        syncStatusEl.className = 'foldnest-sync-status';
        syncBtn.appendChild(syncStatusEl);

        // Insert at end of controls area
        container.appendChild(syncBtn);

        updateSyncIndicator();
    }

    /**
     * Handle sync button click
     */
    async function handleSyncClick(e) {
        e.stopPropagation();

        if (!syncSettings.enabled) {
            // Show enable/disable menu
            showSyncMenu(e);
        } else {
            // Perform manual sync
            await performFullSync();
        }
    }

    /**
     * Show sync options menu
     * @param {Event} e
     */
    function showSyncMenu(e) {
        // Remove existing menu
        document.querySelectorAll('.foldnest-sync-menu').forEach(el => el.remove());

        const menu = document.createElement('div');
        menu.className = 'foldnest-sync-menu plugin-dropdown-menu';

        // Enable/Disable toggle
        const toggleItem = document.createElement('div');
        toggleItem.className = 'plugin-dropdown-item';
        toggleItem.innerHTML = syncSettings.enabled
            ? '<span style="color: #f28b82;">⏻ Disable Cloud Sync</span>'
            : '<span style="color: #81c995;">⏻ Enable Cloud Sync</span>';
        toggleItem.onclick = async () => {
            menu.remove();
            await toggleSync();
        };
        menu.appendChild(toggleItem);

        if (syncSettings.enabled) {
            // Sync now option
            const syncNowItem = document.createElement('div');
            syncNowItem.className = 'plugin-dropdown-item';
            syncNowItem.textContent = '↻ Sync Now';
            syncNowItem.onclick = async () => {
                menu.remove();
                await performFullSync();
            };
            menu.appendChild(syncNowItem);

            // Last sync time
            if (syncSettings.lastSyncTime) {
                const timeItem = document.createElement('div');
                timeItem.className = 'plugin-dropdown-item disabled';
                timeItem.style.fontSize = '11px';
                timeItem.style.opacity = '0.6';
                timeItem.textContent = `Last sync: ${formatTime(syncSettings.lastSyncTime)}`;
                menu.appendChild(timeItem);
            }
        }

        // Position menu
        const rect = e.currentTarget.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.zIndex = '10001';

        document.body.appendChild(menu);

        // Close on click outside
        const closeMenu = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 10);
    }

    /**
     * Update sync status indicator
     * @param {string} status - 'idle', 'syncing', 'success', 'error', 'offline'
     * @param {string} message - Optional error message
     */
    function updateSyncStatus(status, message = '') {
        currentSyncStatus = status;

        if (!syncStatusEl) return;

        syncStatusEl.className = `foldnest-sync-status ${status}`;
        syncStatusEl.title = message || status;

        // Update button icon
        const btn = syncStatusEl.parentElement;
        if (btn) {
            btn.innerHTML = getSyncIcon();
            btn.appendChild(syncStatusEl);

            if (status === 'syncing') {
                btn.classList.add('syncing');
            } else {
                btn.classList.remove('syncing');
            }

            // Add offline indicator
            if (status === 'offline') {
                btn.classList.add('offline');
            } else {
                btn.classList.remove('offline');
            }
        }

        // Show toast for error/offline status
        if (status === 'error' && message) {
            showToast(`Sync error: ${message}`, 'error');
        } else if (status === 'offline' && message) {
            showToast(message, 'warning');
        }

        // Auto-clear success status
        if (status === 'success') {
            setTimeout(() => {
                if (currentSyncStatus === 'success') {
                    updateSyncStatus('idle');
                }
            }, 3000);
        }

        // Auto-clear offline status when back online
        if (status === 'offline') {
            const checkOnline = setInterval(() => {
                if (navigator.onLine) {
                    clearInterval(checkOnline);
                    updateSyncStatus('idle');
                }
            }, 5000);
        }
    }

    /**
     * Update sync indicator based on settings
     */
    function updateSyncIndicator() {
        const btn = document.querySelector('.foldnest-sync-btn');
        if (!btn) return;

        if (syncSettings.enabled) {
            btn.classList.add('enabled');
            btn.title = 'Cloud sync enabled - Click to sync now';
        } else {
            btn.classList.remove('enabled');
            btn.title = 'Cloud sync disabled - Click to enable';
        }
    }

    /**
     * Get sync icon SVG
     */
    function getSyncIcon() {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
        </svg>`;
    }

    /**
     * Format timestamp for display
     * @param {number} timestamp
     */
    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString();
    }

    /**
     * Show toast notification (uses FoldNest's toast if available)
     * @param {string} message
     * @param {string} type - 'info', 'success', 'warning', 'error'
     */
    function showToast(message, type = 'info') {
        if (window.NotebookLMFoldNest && window.NotebookLMFoldNest.showToast) {
            window.NotebookLMFoldNest.showToast(message);
        } else {
            // Fallback: create our own toast
            createFallbackToast(message, type);
        }
    }

    /**
     * Create fallback toast when FoldNest toast is unavailable
     * @param {string} message
     * @param {string} type - 'info', 'success', 'warning', 'error'
     */
    function createFallbackToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.foldnest-sync-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `foldnest-sync-toast foldnest-sync-toast-${type}`;

        // Color scheme based on type
        const colors = {
            info: { bg: '#1a73e8', icon: 'ℹ️' },
            success: { bg: '#34a853', icon: '✓' },
            warning: { bg: '#fbbc04', icon: '⚠' },
            error: { bg: '#ea4335', icon: '✕' }
        };
        const color = colors[type] || colors.info;

        toast.innerHTML = `
            <span class="foldnest-sync-toast-icon">${color.icon}</span>
            <span class="foldnest-sync-toast-message">${message}</span>
        `;

        // Inline styles for reliability (CSS may not be loaded yet)
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: color.bg,
            color: 'white',
            padding: '12px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: '100001',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'Google Sans, Roboto, sans-serif',
            fontSize: '14px',
            fontWeight: '500',
            animation: 'foldnest-toast-in 0.3s ease-out',
            maxWidth: '400px'
        });

        // Add animation keyframes if not present
        if (!document.querySelector('#foldnest-sync-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'foldnest-sync-toast-styles';
            style.textContent = `
                @keyframes foldnest-toast-in {
                    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes foldnest-toast-out {
                    from { opacity: 1; transform: translateX(-50%) translateY(0); }
                    to { opacity: 0; transform: translateX(-50%) translateY(20px); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        // Auto-dismiss
        setTimeout(() => {
            toast.style.animation = 'foldnest-toast-out 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, type === 'error' ? 5000 : 3000);

        console.log(`[FoldNest Sync] ${type.toUpperCase()}: ${message}`);
    }

    // --- PUBLIC API ---

    window.FoldNestSync = {
        // Core operations
        uploadState,
        downloadState,
        performFullSync,
        triggerUpload,

        // Settings
        enableSync,
        disableSync,
        toggleSync,
        isEnabled: () => syncSettings.enabled,
        getSettings: () => ({ ...syncSettings }),

        // Status
        getStatus: () => currentSyncStatus,
        isSyncing: () => isSyncing,

        // Page info
        getPageType: () => currentPageType,
        getNotebookId: () => currentNotebookId,
        isOnline: () => isOnline,

        // Offline queue
        getQueueLength: () => offlineQueue.length,
        processOfflineQueue
    };

    // --- STARTUP ---

    let syncInitialized = false;

    /**
     * Safe initialization wrapper
     */
    function safeInit() {
        if (syncInitialized) return;
        syncInitialized = true;
        initSync();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safeInit);
    } else {
        // Small delay to ensure other scripts (content.js) are ready
        setTimeout(safeInit, 100);
    }

    // Also try on window load as fallback
    window.addEventListener('load', () => {
        setTimeout(safeInit, 500);
    });

    // Listen for SPA navigation (NotebookLM is a SPA)
    let lastUrl = window.location.href;
    let urlObserver = null;

    /**
     * Setup URL change observer for SPA navigation
     */
    function setupUrlObserver() {
        if (urlObserver) return; // Already set up

        // Wait for document.body to exist
        if (!document.body) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupUrlObserver);
            } else {
                // Retry after a short delay
                setTimeout(setupUrlObserver, 100);
            }
            return;
        }

        try {
            urlObserver = new MutationObserver(() => {
                if (window.location.href !== lastUrl) {
                    lastUrl = window.location.href;
                    console.log('[FoldNest Sync] URL changed, re-detecting page type');
                    detectPageType();

                    // Re-setup UI for new page
                    if (syncInitialized) {
                        setupSyncUI();

                        // Sync on page navigation if enabled
                        if (syncSettings.enabled && isOnline) {
                            setTimeout(() => performFullSync(), 1500);
                        }
                    }
                }
            });

            urlObserver.observe(document.body, { childList: true, subtree: true });
            console.log('[FoldNest Sync] URL observer started');
        } catch (e) {
            console.warn('[FoldNest Sync] Failed to setup URL observer:', e.message);
        }
    }

    // Start URL observer when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupUrlObserver);
    } else {
        setupUrlObserver();
    }

    console.log('[FoldNest Sync v1.0.0] Module loaded, waiting for initialization...');

})();

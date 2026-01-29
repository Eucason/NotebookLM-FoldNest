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

    // --- INITIALIZATION ---

    /**
     * Initialize the sync module
     */
    async function initSync() {
        try {
            // Load sync settings
            const result = await chrome.storage.local.get([SYNC_STORAGE_KEY]);
            if (result[SYNC_STORAGE_KEY]) {
                syncSettings = { ...syncSettings, ...result[SYNC_STORAGE_KEY] };
            }

            // Add sync UI elements
            setupSyncUI();

            console.log('[FoldNest Sync] Module initialized, enabled:', syncSettings.enabled);
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
        return new Promise((resolve) => {
            // Check if we have a valid cached token
            if (cachedToken && !interactive) {
                resolve(cachedToken);
                return;
            }

            // Request token from background script
            chrome.runtime.sendMessage(
                { action: 'getAuthToken', interactive },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[FoldNest Sync] Auth message failed:', chrome.runtime.lastError.message);
                        cachedToken = null;
                        resolve(null);
                    } else if (response && response.success) {
                        cachedToken = response.token;
                        resolve(response.token);
                    } else {
                        console.warn('[FoldNest Sync] Auth failed:', response?.error);
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

    // --- GOOGLE DRIVE API ---

    /**
     * Find a file in Drive appdata folder
     * @param {string} token - Auth token
     * @param {string} fileName - File name to find
     * @returns {Promise<{id: string, modifiedTime: string}|null>}
     */
    async function findFile(token, fileName) {
        try {
            const params = new URLSearchParams({
                spaces: 'appDataFolder',
                q: `name='${fileName}'`,
                fields: 'files(id, name, modifiedTime)'
            });

            const response = await fetch(`${DRIVE_API_URL}/files?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    // Token expired, clear cache
                    await revokeAuthToken();
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data.files && data.files.length > 0 ? data.files[0] : null;
        } catch (e) {
            console.error('[FoldNest Sync] Find file failed:', e);
            return null;
        }
    }

    /**
     * Download file content from Drive
     * @param {string} token - Auth token
     * @param {string} fileId - Drive file ID
     * @returns {Promise<object|null>} Parsed JSON content or null
     */
    async function downloadFile(token, fileId) {
        try {
            const response = await fetch(`${DRIVE_API_URL}/files/${fileId}?alt=media`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

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
     * @param {string} token - Auth token
     * @param {string} fileName - File name
     * @param {object} content - Content to upload
     * @param {string|null} existingFileId - Existing file ID to update
     * @returns {Promise<boolean>} Success status
     */
    async function uploadFile(token, fileName, content, existingFileId = null) {
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

            const response = await fetch(url, {
                method: existingFileId ? 'PATCH' : 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
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

            const token = await getAuthToken(false);
            if (!token) {
                updateSyncStatus('error', 'Not authenticated');
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
            const existingFile = await findFile(token, fileName);

            // Upload
            const success = await uploadFile(token, fileName, state, existingFile?.id);

            if (success) {
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

            const token = await getAuthToken(false);
            if (!token) {
                updateSyncStatus('error', 'Not authenticated');
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
            const file = await findFile(token, fileName);
            if (!file) {
                console.log('[FoldNest Sync] No remote file found:', fileName);
                updateSyncStatus('idle');
                return null;
            }

            // Download content
            const content = await downloadFile(token, file.id);
            if (!content) {
                updateSyncStatus('error', 'Download failed');
                return null;
            }

            // Remove sync metadata before returning
            const { _syncMeta, ...stateData } = content;

            updateSyncStatus('success');
            console.log('[FoldNest Sync] Download successful:', fileName);

            return { data: stateData, meta: _syncMeta };
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
                    // Remote is newer, apply it
                    await chrome.storage.local.set({ 'notebookLM_dashboardFolders': dashboardRemote.data });
                    showToast('Dashboard synced from cloud');
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

                    if (remoteTime > localTime) {
                        await chrome.storage.local.set({ [stateKey]: notebookRemote.data });
                        showToast('Notebook synced from cloud');
                        // Trigger page refresh to apply changes
                        window.location.reload();
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
        chrome.storage.local.set({ [SYNC_STORAGE_KEY]: syncSettings });
    }

    /**
     * Enable sync functionality
     * @returns {Promise<boolean>}
     */
    async function enableSync() {
        try {
            updateSyncStatus('syncing');

            // Request auth token with interactive mode
            const token = await getAuthToken(true);
            if (!token) {
                updateSyncStatus('error', 'Authentication failed');
                showToast('Sync: Authentication failed');
                return false;
            }

            syncSettings.enabled = true;
            saveSyncSettings();

            // Perform initial sync
            await performFullSync();

            updateSyncIndicator();
            showToast('Cloud sync enabled');
            return true;
        } catch (e) {
            console.error('[FoldNest Sync] Enable failed:', e);
            showToast('Failed to enable sync');
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
     * @param {string} status - 'idle', 'syncing', 'success', 'error'
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
        }

        // Auto-clear success status
        if (status === 'success') {
            setTimeout(() => {
                if (currentSyncStatus === 'success') {
                    updateSyncStatus('idle');
                }
            }, 3000);
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
     */
    function showToast(message) {
        if (window.NotebookLMFoldNest && window.NotebookLMFoldNest.showToast) {
            window.NotebookLMFoldNest.showToast(message);
        } else {
            console.log('[FoldNest Sync]', message);
        }
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
        isSyncing: () => isSyncing
    };

    // --- STARTUP ---

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSync);
    } else {
        initSync();
    }

})();

/**
 * NotebookLM FoldNest - Studio Export Module
 * v1.0.0 - Export generated Studio artifacts in various formats
 *
 * Features:
 * - Download button injected into Studio panel header (between title and dock button)
 * - Centered modal with artifact list, checkboxes, format chips
 * - Format Memory via localStorage
 * - ZIP packaging for multiple selections (JSZip)
 * - Concise filename naming using artifact titles only
 * - Progress toast with live updates
 * - Conversion engine: MD→DOCX, MD→PDF, JSON→CSV, JSON→XLSX, Slides→PPTX/PDF
 * - Empty state when no artifacts exist
 * - Graceful error handling with per-artifact toast on failure
 */

(function () {
    'use strict';

    // =========================================================================
    // CONSTANTS & STATE
    // =========================================================================
    const MODULE_TAG = '[FoldNest Export]';

    let _modalEl = null;         // Current live modal DOM element
    let _bodyObserver = null;    // MutationObserver for watching studio header
    let _toastProgressEl = null; // Progress toast element
    let _renderQueued = false;   // requestAnimationFrame lock

    // =========================================================================
    // ARTIFACT TYPE CONFIG
    // =========================================================================
    const ARTIFACT_CONFIG = {
        flashcards: {
            label: 'Flashcards',
            formats: ['csv', 'txt'],
            folderName: 'Flashcards',
            accent: 'teal',
            iconName: 'cards_star',
            empty: 'No flashcards yet',
        },
        mind_maps: {
            label: 'Mind Maps',
            formats: [],
            folderName: 'Mind Maps',
            accent: 'gold',
            iconName: 'flowchart',
            empty: 'No mind maps yet',
            downloadHint: 'PNG — expanded nodes',
        },
        media: {
            label: 'Media (Video/Audio)',
            formats: ['wav'],
            folderName: 'Media',
            accent: 'silver',
            iconName: 'subscriptions',
            empty: 'No media yet',
            downloadHint: 'Direct browser download',
        },
        reports: {
            label: 'Reports',
            formats: ['docx', 'pdf'],
            folderName: 'Reports',
            accent: 'silver',
            iconName: 'auto_tab_group',
            empty: 'No reports yet',
        },
        infographics: {
            label: 'Infographics',
            formats: [],
            folderName: 'Infographics',
            accent: 'silver',
            iconName: 'stacked_bar_chart',
            empty: 'No infographics yet',
            downloadHint: 'PNG screenshot',
        },
        slide_decks: {
            label: 'Slide Decks',
            formats: ['pdf', 'pptx'],
            folderName: 'Slide Decks',
            accent: 'silver',
            iconName: 'tablet',
            empty: 'No slide decks yet',
        },
        quiz: {
            label: 'Quiz',
            formats: ['txt'],
            folderName: 'Quizzes',
            accent: 'silver',
            iconName: 'quiz',
            empty: 'No quiz yet',
        },
        data_tables: {
            label: 'Data Tables',
            formats: ['xlsx'],
            folderName: 'Data Tables',
            accent: 'silver',
            iconName: 'table_view',
            empty: 'No data tables yet',
        },
        unknown: {
            label: 'Notes',
            formats: ['md', 'docx'],
            folderName: 'Notes',
            accent: 'silver',
            iconName: 'article',
            empty: 'No notes yet',
        }
    };

    // Section display order (matching reference keys)
    const SECTION_ORDER = ['flashcards', 'mind_maps', 'media', 'infographics', 'slide_decks', 'quiz', 'reports', 'data_tables'];


    // Format labels for display
    const FORMAT_LABELS = {
        csv:  'CSV',
        txt:  'TXT',
        md:   'Markdown',
        docx: 'DOCX',
        pdf:  'PDF',
        xlsx: 'Excel',
        pptx: 'PPTX',
        wav:  'WAV',
        mp3:  'MP3',
    };

    // =========================================================================
    // ENTRY POINT
    // =========================================================================

    /**
     * Initialize — starts the MutationObserver immediately, no namespace gate.
     * The FoldNest namespace is only needed when the modal is opened, not for injection.
     */
    function initExportStudio() {
        console.debug(`${MODULE_TAG} Starting — setting up MutationObserver`);
        _bindGlobalListeners();
        _watchForStudioHeader();
    }

    // =========================================================================
    // DOM INJECTION — DOWNLOAD BUTTON (Dropdown Pattern from Reference)
    // =========================================================================

    const ROOT_ID = 'fn-export-root';

    /**
     * Global listeners for closing the dropdown on outside click and Escape key.
     * Registered once at init, not per-open.
     */
    function _bindGlobalListeners() {
        document.addEventListener('click', (event) => {
            if (!_modalEl) return;
            const root = document.getElementById(ROOT_ID);
            if (root && !root.contains(event.target)) {
                _closeExportModal();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && _modalEl) {
                _closeExportModal();
            }
        });
    }

    /**
     * Sets up a MutationObserver on document.body so the button is injected
     * as soon as the Studio panel header appears, and re-injected after SPA navigation.
     */
    function _watchForStudioHeader() {
        if (_bodyObserver) {
            _bodyObserver.disconnect();
        }
        _bodyObserver = new MutationObserver(() => _queueRefresh());
        _bodyObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-expanded']
        });
        // Also attempt immediately
        _queueRefresh();
    }

    /**
     * Gated rendering via requestAnimationFrame as seen in the reference.
     */
    function _queueRefresh() {
        if (_renderQueued) return;
        _renderQueued = true;
        window.requestAnimationFrame(() => {
            _renderQueued = false;
            _ensureUI();
        });
    }

    /**
     * Core UI injection — adopts the reference's approach:
     * Creates a root container div that holds BOTH the button AND the dropdown card.
     * The dropdown is toggled via hidden attribute, not a body-level overlay.
     */
    function _ensureUI() {
        try {
            // Step 1: Find the Studio header using the reference's exact pattern
            const header = Array.from(document.querySelectorAll('.panel-header')).find(candidate => {
                const titleNode = candidate.querySelector('.panel-header-content span');
                return _normalizeText(_getText(titleNode)) === 'studio';
            });

            const collapseBtn = header?.querySelector('.toggle-studio-panel-button');
            if (!header || !collapseBtn) return;

            // Step 2: Check if root already exists and is properly parented
            let root = document.getElementById(ROOT_ID);
            if (root && root.parentElement !== header) {
                root.remove();
                root = null;
            }

            // Step 3: Create root container if needed
            if (!root) {
                root = document.createElement('div');
                root.id = ROOT_ID;
                root.className = 'fn-export-root';

                // Build the DOWNLOAD button
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'fn-export-btn';
                button.setAttribute('aria-label', 'Export Studio artifacts');
                button.setAttribute('title', 'Export artifacts');

                // Download Icon (SVG via DOM API — Trusted Types safe)
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 -960 960 960');
                svg.setAttribute('width', '18');
                svg.setAttribute('height', '18');
                svg.setAttribute('fill', 'currentColor');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z');
                svg.appendChild(path);
                button.appendChild(svg);

                const span = document.createElement('span');
                span.textContent = 'DOWNLOAD';
                button.appendChild(span);

                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    _toggleDropdown();
                });

                // Build the dropdown container (initially hidden)
                const dropdown = document.createElement('div');
                dropdown.className = 'fn-export-dropdown';
                dropdown.hidden = true;

                root.appendChild(button);
                root.appendChild(dropdown);
                header.insertBefore(root, collapseBtn);

                console.debug(`${MODULE_TAG} ✓ Root container with button + dropdown injected`);
            }
        } catch (e) {
            console.debug(`${MODULE_TAG} ensureUI error:`, e.message);
        }
    }

    /**
     * Text normalization utilities as seen in the reference.
     */
    function _normalizeText(val) {
        return (val || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
    }

    /**
     * Gets text from a node, checking aria-label, title, innerText, textContent.
     */
    function _getText(node) {
        return node ? String(node.getAttribute?.('aria-label') || node.getAttribute?.('title') || node.innerText || node.textContent || '').trim() : '';
    }

    /**
     * Finds the Studio panel's dock/collapse button (used by _findStudioPanel).
     */
    function _findDockButton() {
        const header = Array.from(document.querySelectorAll('.panel-header')).find(candidate => {
            const titleNode = candidate.querySelector('.panel-header-content span');
            return _normalizeText(_getText(titleNode)) === 'studio';
        });
        if (!header) return null;
        return header.querySelector('.toggle-studio-panel-button') ||
               header.querySelector('button[aria-label*="Collapse"]') ||
               header.querySelector('button[aria-label*="Expand"]');
    }

    /**
     * Finds the Studio panel element using multiple selector fallbacks.
     * Used by artifact scanning.
     */
    function _findStudioPanel() {
        const selectors = [
            'section.studio-panel',
            '.studio-panel',
            'studio-panel',
            '[data-panel="studio"]',
            'div[role="complementary"]',
            'mat-drawer[class*="studio"]',
            'section[class*="studio"]',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const text = _normalizeText(el.innerText || '');
                if (text.includes('studio')) return el;
            }
        }
        // Fallback: find via dock button ancestry
        const dock = _findDockButton();
        if (dock) {
            let el = dock.parentElement;
            while (el && el !== document.body) {
                const tag = (el.tagName || '').toLowerCase();
                const cls = (el.className || '');
                if (tag.includes('studio') || cls.includes('studio-panel') || cls.includes('studio')) return el;
                if (tag === 'section' || tag === 'mat-drawer' || tag === 'aside') return el;
                el = el.parentElement;
            }
        }
        return null;
    }

    // =========================================================================
    // DROPDOWN — TOGGLE / OPEN / CLOSE
    // =========================================================================

    function _toggleDropdown(force) {
        const root = document.getElementById(ROOT_ID);
        if (!root) return;

        const dropdown = root.querySelector('.fn-export-dropdown');
        if (!dropdown) return;

        const shouldOpen = typeof force === 'boolean' ? force : dropdown.hidden;

        if (shouldOpen) {
            _openExportModal();
        } else {
            _closeExportModal();
        }
    }

    function _openExportModal() {
        try {
            const root = document.getElementById(ROOT_ID);
            if (!root) return;

            const dropdown = root.querySelector('.fn-export-dropdown');
            if (!dropdown) return;

            console.debug(`${MODULE_TAG} Opening Export Dropdown...`);

            // Scan artifacts and render the card content
            let artifacts = _scanStudioArtifacts();
            console.debug(`${MODULE_TAG} Scanned ${artifacts.length} artifacts`);

            // Clear old content and rebuild
            while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
            const card = _buildExportCard(artifacts);
            dropdown.appendChild(card);

            // Show
            dropdown.hidden = false;
            root.classList.add('open');
            _modalEl = dropdown; // Track for global close detection

            // Close when clicking the overlay backdrop (not the card itself)
            dropdown.addEventListener('mousedown', (e) => {
                if (e.target === dropdown) _closeExportModal();
            }, { once: true });

            console.debug(`${MODULE_TAG} ✓ Dropdown visible`);
        } catch (err) {
            console.error(`${MODULE_TAG} Error in _openExportModal:`, err);
        }
    }

    function _closeExportModal() {
        const root = document.getElementById(ROOT_ID);
        if (!root) return;

        const dropdown = root.querySelector('.fn-export-dropdown');
        if (dropdown) dropdown.hidden = true;
        root.classList.remove('open');
        _modalEl = null;
    }

    // =========================================================================
    // MODAL — BUILD
    // =========================================================================

    function _buildExportCard(artifacts) {
        const card = document.createElement('div');
        card.className = 'fn-export-card';

        // --- Header ---
        const header = document.createElement('div');
        header.className = 'fn-export-header';

        const title = document.createElement('h2');
        title.className = 'fn-export-title';
        title.textContent = 'Export Artifacts';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'fn-export-close-btn';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.setAttribute('title', 'Close');

        const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        closeSvg.setAttribute('viewBox', '0 -960 960 960');
        closeSvg.setAttribute('width', '18');
        closeSvg.setAttribute('height', '18');
        closeSvg.setAttribute('fill', 'currentColor');
        const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        closePath.setAttribute('d', 'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z');
        closeSvg.appendChild(closePath);
        closeBtn.appendChild(closeSvg);
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); _closeExportModal(); });
        header.appendChild(closeBtn);

        card.appendChild(header);

        // --- Select All ---
        const selectAllRow = document.createElement('div');
        selectAllRow.className = 'fn-select-all-row';
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllCheckbox.className = 'fn-checkbox';
        selectAllCheckbox.checked = true;
        const selectAllLabel = document.createElement('label');
        selectAllLabel.className = 'fn-select-all-label';
        selectAllLabel.textContent = 'Select All';
        selectAllRow.appendChild(selectAllCheckbox);
        selectAllRow.appendChild(selectAllLabel);
        card.appendChild(selectAllRow);

        // --- Scroller ---
        const listContainer = document.createElement('div');
        listContainer.className = 'fn-artifact-list';
        card.appendChild(listContainer);

        const allCheckboxes = [];
        const artifactData = [];
        const formatSelects = {};

        // Group artifacts by type
        const groups = {};
        SECTION_ORDER.forEach(type => {
            groups[type] = artifacts.filter(a => a.type === type);
        });

        SECTION_ORDER.forEach(type => {
            const items = groups[type] || [];
            const config = ARTIFACT_CONFIG[type] || ARTIFACT_CONFIG.unknown;

            const section = document.createElement('div');
            section.className = 'fn-export-section';
            
            // Section Header
            const sHeader = document.createElement('div');
            sHeader.className = `fn-export-section-header fn-accent-${config.accent || 'silver'}`;
            
            // Chevron
            const chevron = document.createElement('div');
            chevron.className = 'fn-section-chevron';
            chevron.textContent = '▼';
            sHeader.appendChild(chevron);

            // Group Icon (Always use config icon for header)
            const sIconNode = _createIconNode(config.iconName);
            sHeader.appendChild(sIconNode);

            // Group Title
            const sTitle = document.createElement('div');
            sTitle.className = 'fn-export-section-title';
            sTitle.textContent = config.label;
            sHeader.appendChild(sTitle);

            section.appendChild(sHeader);

            // Section Content (Pills + Rows)
            const sContent = document.createElement('div');
            sContent.className = 'fn-section-content';

            if (config.formats.length > 0) {
                const pillRow = document.createElement('div');
                pillRow.className = 'fn-section-pills';

                let activeFormat = config.formats[0];
                formatSelects[type] = () => activeFormat;

                config.formats.forEach(fmt => {
                    const pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'fn-chip' + (fmt === activeFormat ? ' fn-chip-active' : '');
                    pill.textContent = (FORMAT_LABELS[fmt] || fmt.toUpperCase());
                    pill.setAttribute('title', `Export as ${FORMAT_LABELS[fmt] || fmt.toUpperCase()}`);
                    pill.addEventListener('click', (e) => {
                        e.stopPropagation();
                        pillRow.querySelectorAll('.fn-chip').forEach(p => p.classList.remove('fn-chip-active'));
                        pill.classList.add('fn-chip-active');
                        activeFormat = fmt;
                    });
                    pillRow.appendChild(pill);
                });
                sContent.appendChild(pillRow);
            }

            // Artifact Rows
            if (items.length === 0) {
                const emptyRow = document.createElement('div');
                emptyRow.className = 'fn-artifact-row fn-empty-state';
                emptyRow.style.opacity = '0.7';
                emptyRow.style.cursor = 'default';
                emptyRow.style.padding = '12px 0 4px';
                emptyRow.style.display = 'flex';
                emptyRow.style.justifyContent = 'center';
                
                const emSpan = document.createElement('span');
                emSpan.style.fontStyle = 'italic';
                emSpan.style.fontSize = '14px';
                emSpan.style.color = '#a3b9b6';
                emSpan.textContent = config.empty || 'None generated yet';
                emptyRow.appendChild(emSpan);
                
                sContent.appendChild(emptyRow);
            } else {
                items.forEach((art, i) => {
                    const row = document.createElement('div');
                    row.className = 'fn-artifact-row';
                    
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'fn-checkbox';
                    cb.checked = true;
                    allCheckboxes.push(cb);
                    artifactData.push({ art, cb, type });

                    let rIcon;
                    if (art.nativeIcon) {
                        rIcon = art.nativeIcon.cloneNode(true);
                        rIcon.classList.remove('fn-artifact-icon');
                        rIcon.classList.add('fn-artifact-icon');
                    } else {
                        // Fallback: Use config icon but prefer audio_magic_eraser for all types of Media entries
                        let iconName = (type === 'media') ? 'audio_magic_eraser' : config.iconName;
                        rIcon = _createIconNode(iconName);
                    }
                    rIcon.style.opacity = '0.7';
                    rIcon.style.width = '20px';
                    rIcon.style.height = '20px';
                    rIcon.style.fontSize = '20px';
                    rIcon.style.marginLeft = '4px';
                    
                    const rTitle = document.createElement('div');
                    rTitle.className = 'fn-artifact-title';
                    rTitle.textContent = art.title;
                    rTitle.title = art.title;
                    rTitle.style.marginLeft = '12px';
                    rTitle.style.fontSize = '14px';
                    rTitle.style.fontWeight = '500';

                    row.appendChild(cb);
                    row.appendChild(rIcon);
                    row.appendChild(rTitle);
                    sContent.appendChild(row);
                });
            }

            section.appendChild(sContent);
            listContainer.appendChild(section);

            sHeader.addEventListener('click', () => {
                section.classList.toggle('collapsed');
            });
        });

        // --- Footer ---
        const footer = document.createElement('div');
        footer.className = 'fn-export-footer';

        const countLabel = document.createElement('div');
        countLabel.className = 'fn-export-count';
        footer.appendChild(countLabel);

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'fn-export-download-btn';
        downloadBtn.setAttribute('title', '');

        const dlSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        dlSvg.setAttribute('viewBox', '0 -960 960 960');
        dlSvg.setAttribute('width', '20');
        dlSvg.setAttribute('height', '20');
        dlSvg.setAttribute('fill', 'currentColor');
        const dlPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        dlPath.setAttribute('d', 'M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z');
        dlSvg.appendChild(dlPath);
        downloadBtn.appendChild(dlSvg);

        const dlSpan = document.createElement('span');
        dlSpan.textContent = 'Download Selected';
        downloadBtn.appendChild(dlSpan);

        footer.appendChild(downloadBtn);
        card.appendChild(footer);

        selectAllCheckbox.addEventListener('change', () => {
            const isChecked = selectAllCheckbox.checked;
            allCheckboxes.forEach(c => c.checked = isChecked);
            _updateDownloadButtonState(downloadBtn, allCheckboxes, countLabel);
        });

        allCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const checkedCount = allCheckboxes.filter(c => c.checked).length;
                selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
                selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
                _updateDownloadButtonState(downloadBtn, allCheckboxes, countLabel);
            });
        });

        _updateDownloadButtonState(downloadBtn, allCheckboxes, countLabel);

        downloadBtn.addEventListener('click', () => {
            const selected = artifactData.filter(d => d.cb.checked).map(d => ({
                ...d.art,
                selectedFormat: formatSelects[d.type] ? formatSelects[d.type]() : (ARTIFACT_CONFIG[d.type] || ARTIFACT_CONFIG.unknown).formats[0] || 'md'
            }));
            if (selected.length === 0) return;
            _closeExportModal();
            bulkDownloadArtifacts(selected);
        });

        return card;
    }

    function _updateDownloadButtonState(btn, cbs, countLabelEl) {
        const checkedCount = cbs.filter(c => c.checked).length;
        const isDisabled = checkedCount === 0;
        btn.disabled = isDisabled;
        btn.setAttribute('title', isDisabled ? 'Select at least one artifact' : '');

        // Update count label if provided
        if (countLabelEl) {
            if (checkedCount === 0) {
                countLabelEl.innerHTML = '<span>No items selected</span>';
            } else {
                const noun = checkedCount === 1 ? 'item' : 'items';
                countLabelEl.innerHTML = `<strong>${checkedCount}</strong> ${noun} selected`;
            }
        }
    }

    function _createIconNode(name) {
        if (!name) return document.createElement('div');
        
        // Use Mat-Icon (Material Symbol)
        const icon = document.createElement('mat-icon');
        icon.className = 'mat-icon notranslate material-symbols-outlined google-symbols mat-icon-no-color fn-artifact-icon';
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('data-mat-icon-type', 'font');
        icon.setAttribute('focusable', 'false');
        icon.style.display = 'inline-flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.verticalAlign = 'middle';
        icon.style.userSelect = 'none';
        icon.style.fontSize = '20px'; // Matching the image size
        icon.textContent = String(name).trim();
        return icon;
    }

    // =========================================================================
    // ARTIFACT SCANNING
    // =========================================================================

    /**
     * Scans the document for rendered artifact tiles/items.
     * Adopts the global discovery method from the reference studio.js.
     */
    function _scanStudioArtifacts() {
        const artifacts = [];
        try {
            // Consistent selectors for library artifacts as seen in reference
            const selectors = [
                'artifact-library-note',
                'artifact-library-item',
                '.artifact-library-item',
                'mat-card.artifact-library-item',
                '.studio-note-item',
            ];

            // 1. Collect all potential tiles across the entire document
            let allTiles = [];
            selectors.forEach(sel => {
                const results = Array.from(document.querySelectorAll(sel));
                allTiles = allTiles.concat(results);
            });

            // 2. Deduplicate and filter by visibility
            const seen = new Set();
            const tiles = allTiles.filter(tile => {
                if (!tile || seen.has(tile)) return false;
                seen.add(tile);
                // Visibility check: must be active in the viewport/DOM
                return _isVisible(tile);
            });

            tiles.forEach((tile, idx) => {
                try {
                    // --- Type Detection ---
                    let type = _detectArtifactType(tile);

                    // --- Title Detection ---
                    let title = _detectArtifactTitle(tile) || `Artifact ${idx + 1}`;

                    // --- Native Icon ---
                    let nativeIconNode = tile.querySelector('.artifact-icon');
                    if (!nativeIconNode) {
                        const iconCandidates = Array.from(tile.querySelectorAll('mat-icon'));
                        nativeIconNode = iconCandidates.find(ic => {
                            const iconText = _getText(ic).toLowerCase();
                            return !['create_new_folder', 'folder_shared', 'more_vert', 'share', 'add', 'close'].includes(iconText);
                        });
                    }
                    
                    let nativeIcon = null;
                    if (nativeIconNode) {
                        nativeIcon = nativeIconNode.cloneNode(true);
                        nativeIcon.removeAttribute('id');
                        nativeIcon.removeAttribute('style');
                        nativeIcon.classList.remove('blue', 'green', 'pink', 'yellow', 'orange', 'cyan', 'grey');
                        nativeIcon.setAttribute('aria-hidden', 'true');
                        nativeIcon.setAttribute('focusable', 'false');
                    }

                    // Only push if it matches a valid type in SECTION_ORDER
                    if (SECTION_ORDER.includes(type)) {
                        const config = ARTIFACT_CONFIG[type];
                        artifacts.push({
                            id: `artifact-${idx}-${Date.now()}`,
                            type,
                            title,
                            element: tile,
                            formats: config.formats,
                            nativeIcon
                        });
                    }
                } catch (e) {
                    console.debug(`${MODULE_TAG} Error scanning tile ${idx}:`, e.message);
                }
            });

        } catch (e) {
            console.debug(`${MODULE_TAG} scanStudioArtifacts error:`, e.message);
        }
        return artifacts;
    }

    /**
     * Phase 2 (Deep Structure): The "Leaky" ID Extractor
     * Extracts NotebookLM artifact metadata via deep DOM querying.
     */
    function _inventoryAllArtifacts() {
        const results = [];

        try {
            // 1. Query all elements
            const selectors = 'artifact-library-note, artifact-library-item';
            const allTiles = Array.from(document.querySelectorAll(selectors));
            
            // 3. Filter visible tiles
            const visibleTiles = allTiles.filter(tile => {
                const style = window.getComputedStyle(tile);
                return style.display !== 'none';
            });

            // 2. Extract Metadata per Tile
            for (const tile of visibleTiles) {
                try {
                    let title = 'Unknown Title';
                    let artifactId = null;
                    let type = 'UNKNOWN';
                    let details = '';

                    // a. Extract title
                    const titleEl = tile.querySelector('.artifact-title');
                    if (titleEl && titleEl.textContent) {
                        title = titleEl.textContent.trim();
                    }

                    // b. Extract UUID
                    const labelsEl = tile.querySelector('.artifact-labels');
                    if (labelsEl && labelsEl.id) {
                        const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
                        const match = labelsEl.id.match(uuidRegex);
                        if (match) {
                            artifactId = match[1];
                        }
                    }

                    // c. Extract type
                    const buttonEl = tile.querySelector('button[aria-description]');
                    if (buttonEl) {
                        type = buttonEl.getAttribute('aria-description');
                    }

                    // d. Extract details
                    const detailsEl = tile.querySelector('.artifact-details');
                    if (detailsEl && detailsEl.textContent) {
                        details = detailsEl.textContent.trim();
                    }

                    // 4. Return array format
                    results.push({ title, type, artifactId, details, element: tile });

                } catch (tileError) {
                    console.error('[FoldNest Inventory] Error parsing tile:', tileError, tile);
                }
            }
            console.debug(`[FoldNest] Inventory complete: ${results.length} artifacts found`);
        } catch (globalError) {
            console.error('[FoldNest Inventory] Fatal error:', globalError);
        }

        return results;
    }

    // Assign window helper
    window._fnInventory = () => {
        const results = _inventoryAllArtifacts();
        console.table(results.map(a => ({
            title: a.title,
            type: a.type,
            artifactId: a.artifactId
        })));
        return results;
    };

    /**
     * Detects the type of an artifact from its DOM element using the "Haystack" method.
     * Searches title, icon, description, and details for identifying keywords.
     */
    function _detectArtifactType(tile) {
        // 1. Gather text context from tile to form a haystack
        const iconNodes = Array.from(tile.querySelectorAll('mat-icon'));
        const identityIconNode = iconNodes.find(ic => {
            const txt = _getText(ic).toLowerCase();
            return !['create_new_folder', 'folder_shared', 'more_vert', 'share', 'add', 'close'].includes(txt);
        });
        
        const title = _normalizeText(_getText(tile.querySelector('.artifact-title, .title, h3, h2, mat-card-title')) || _detectArtifactTitle(tile));
        const icon = _normalizeText(_getText(identityIconNode));
        const description = _normalizeText(tile.querySelector('button, [role="button"], a')?.getAttribute('aria-description') || '');
        const details = _normalizeText(_getText(tile.querySelector('.artifact-details, .details')));
        
        // Full text fallback for maximum discovery
        const fullText = _normalizeText(tile.innerText || '');
        
        const haystack = `${title} ${icon} ${description} ${details} ${fullText}`.toLowerCase();

        // 2. Classification Logic (Matching Reference + Synonyms)
        if (/flashcard|cards_star/.test(haystack)) return 'flashcards';
        if (/mind map|mindmap|flowchart/.test(haystack)) return 'mind_maps';
        if (/video overview|audio overview|podcast|subscriptions|audio_magic_eraser|audiotrack|headphones|listening_on|play_circle/.test(haystack)) return 'media';
        if (/infographic|stacked_bar_chart|diagram|visual/.test(haystack)) return 'infographics';
        if (/slide deck|slides|presentation|powerpoint|tablet/.test(haystack)) return 'slide_decks';
        if (/quiz|practice exam|test/.test(haystack)) return 'quiz';
        if (/data table|table_view|spreadsheet|xlsx|csv/.test(haystack)) return 'data_tables';
        if (/report|briefing doc|investment prospectus|auto_tab_group|sticky_note_2|summary|analysis|review/.test(haystack)) return 'reports';

        return 'unknown';
    }

    /**
     * Extracts the display title from an artifact tile.
     */
    function _detectArtifactTitle(tile) {
        const selectors = [
            '.artifact-title',
            '.title',
            'h3',
            'h2',
            '.note-title',
            '[class*="title"]',
            'mat-card-title',
        ];
        for (const sel of selectors) {
            const el = tile.querySelector(sel);
            if (el) {
                const txt = (el.innerText || el.textContent || '').trim();
                if (txt) return txt;
            }
        }
        // Try aria-label on the tile itself
        const aria = tile.getAttribute('aria-label');
        if (aria) return aria.trim();
        return null;
    }

    // =========================================================================
    // EXPORT / DOWNLOAD LOGIC
    // =========================================================================

    /**
     * Master Orchestrator: Bulk Download Artifacts
     * Handles zipping Blob files and queuing external native downloads.
     */
    async function bulkDownloadArtifacts(selectedArtifacts) {
        const total = selectedArtifacts.length;
        _updateProgressToast(`Preparing download…`, 0, total);

        try {
            // 1. Initialize JSZip (or fallback to null)
            const JSZipObj = typeof JSZip !== 'undefined' ? JSZip : (await _loadJSZip());
            const zip = JSZipObj ? new JSZipObj() : null;
            
            if (!zip) {
                console.warn(`${MODULE_TAG} JSZip is missing. Falling back to sequential individual downloads.`);
                const api = window.NotebookLMFoldNest;
                if (api && api.showToast) api.showToast('JSZip missing — downloading files individually');
            }

            // 2. Separate into two phases
            const externalQueue = [];
            let completedBlobs = 0;

            // 4. Concurrency pool for _convertArtifact
            const processBatch = async (items, concurrencyLimit) => {
                const results = [];
                const executing = new Set();

                for (const item of items) {
                    const p = Promise.resolve().then(async () => {
                        try {
                            // 3. Call soon-to-be-refactored _convertArtifact(tile)
                            const result = await _convertArtifact(item);
                            if (!result) return;

                            if (result.external) {
                                // 5. Add to external queue
                                externalQueue.push({ item, result });
                            } else {
                                // 4. Add Blob/Text to JSZip
                                const content = result.blob || result.data || result;
                                const filename = result.filename || `artifact-${Date.now()}.txt`;
                                const folderName = item.type && ARTIFACT_CONFIG[item.type] ? ARTIFACT_CONFIG[item.type].folderName : '';

                                if (zip) {
                                    if (folderName) {
                                        zip.folder(folderName).file(filename, content);
                                    } else {
                                        zip.file(filename, content);
                                    }
                                } else {
                                    // NO ZIP FALLBACK: Push to external sequential queue
                                    externalQueue.push({ 
                                        item, 
                                        result: { 
                                            trigger: () => _triggerDownload(content instanceof Blob ? content : new Blob([content]), filename)
                                        } 
                                    });
                                }
                            }
                        } catch (err) {
                            console.error(`${MODULE_TAG} Error processing tile:`, err);
                        } finally {
                            completedBlobs++;
                            _updateProgressToast(`Processing files… (${completedBlobs}/${total})`, completedBlobs, total);
                        }
                    });

                    results.push(p);
                    executing.add(p);
                    const clean = p.finally(() => executing.delete(p));

                    if (executing.size >= concurrencyLimit) {
                        await Promise.race(executing);
                    }
                }
                return Promise.all(results);
            };

            // Process blobs with max 3 concurrency
            await processBatch(selectedArtifacts, 3);

            // 6. Generate ZIP and trigger
            if (zip) {
                let hasZipFiles = false;
                zip.forEach(() => { hasZipFiles = true; });

                if (hasZipFiles) {
                    _updateProgressToast(`Generating ZIP file…`, completedBlobs, total);
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    _triggerDownload(zipBlob, 'NotebookLM_Export.zip');
                }
            }

            // 7. Process external queue sequentially with delay
            if (externalQueue.length > 0) {
                for (let i = 0; i < externalQueue.length; i++) {
                    const { item, result } = externalQueue[i];
                    _updateProgressToast(`Triggering external downloads… (${i + 1}/${externalQueue.length})`, completedBlobs, total);
                    
                    // Execute trigger if it's a function (soon-to-be-refactored behavior)
                    if (typeof result.execute === 'function') {
                        await result.execute();
                    } else if (typeof result.trigger === 'function') {
                        await result.trigger();
                    }
                    
                    // Chrome spam-block delay
                    await new Promise(r => setTimeout(r, 600));
                }
            }

            _updateProgressToast(`Download complete ✓`, total, total, true);

        } catch (e) {
            console.error(`${MODULE_TAG} Bulk download error:`, e);
            _updateProgressToast('Download failed — check console', total, total, true);
        }
    }

    // =========================================================================
    // CONVERSION ENGINE
    // =========================================================================

    /**
     * Master conversion dispatcher.
     * Acts as the primary routing dispatcher for the new pipelines.
     * Returns { blob, filename } or { external: true, trigger: fn }
     */
    async function _convertArtifact(tile) {
        try {
            // 1. Call our surface scanner
            const inventory = _inventoryAllArtifacts();

            // 2. Find the specific metadata object
            const el = tile.element || tile;
            const meta = inventory.find(m => m.element === el);

            // Robust artifactId extraction
            let artifactId = (meta && meta.artifactId) ? meta.artifactId : null;
            if (!artifactId && el) {
                const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
                const elsWithId = el.querySelectorAll('[id], [data-id]');
                for (const c of elsWithId) {
                    const match = (c.id || c.getAttribute('data-id') || '').match(uuidRegex);
                    if (match) { artifactId = match[1]; break; }
                }
                if (!artifactId) {
                    const match = el.innerHTML.match(uuidRegex);
                    if (match) { artifactId = match[1]; }
                }
            }

            const format = tile.selectedFormat || (ARTIFACT_CONFIG[tile.type] && ARTIFACT_CONFIG[tile.type].formats[0]) || 'md';
            const notebookTitle = typeof _getNotebookTitle === 'function' ? _getNotebookTitle() : 'NotebookLM';
            const title = (meta && meta.title) || tile.title || 'Artifact';
            const filename = typeof _buildFilename === 'function' ? _buildFilename(notebookTitle, title, format) : `${title}.${format}`;

            // Priority 1: Flashcards via RPC
            if (tile.type === 'flashcards') {
                if (!artifactId) throw new Error("Missing Artifact ID");
                const cards = await _fetchFlashcardsViaRpc(artifactId);
                if (cards && Array.isArray(cards)) {
                    if (format === 'txt') {
                        const txtContent = cards.map(c => `Q: ${c.front || c.q || ''}\nA: ${c.back || c.a || ''}\n`).join('\n');
                        return { blob: new Blob([txtContent], { type: 'text/plain' }), filename };
                    } else {
                        // default: csv
                        let csvContent = 'Front,Back\n';
                        csvContent += cards.map(c => {
                            const front = (c.front || c.q || '').replace(/"/g, '""');
                            const back = (c.back || c.a || '').replace(/"/g, '""');
                            return `"${front}","${back}"`;
                        }).join('\n');
                        return { blob: new Blob([csvContent], { type: 'text/csv' }), filename };
                    }
                }
                throw new Error("Failed to parse cards from response");
            }

            // Priority 2: Reports, Tables, and Slides via Google Docs pipeline
            if (tile.type === 'reports' || tile.type === 'data_tables' || tile.type === 'slide_decks') {
                if (!artifactId) throw new Error("Missing Artifact ID");
                let docType = 'REPORT';
                if (tile.type === 'data_tables') docType = 'TABLE';
                if (tile.type === 'slide_decks') docType = 'SLIDES';
                
                const docResult = await _exportViaGoogleDocs(artifactId, title, docType);
                if (docResult && docResult.external) {
                    return { external: true }; // Orchestrator handles background script send
                }
                throw new Error("Failed to initiate external export");
            }

            // Priority 3: Media & Everything else that has a native "Download" button
            // If it's something we cannot faithfully construct from DOM (like a flowchart png, video), 
            // use the proxy trigger to click the native download button.
            if (['mind_maps', 'media', 'infographics', 'quiz'].includes(tile.type)) {
                return { 
                    external: true, 
                    filename: filename,
                    trigger: async () => {
                        await _toMedia(tile, format, title);
                    }
                };
            }

            // Priority 4: Pure Notes / Unknown (Fallback to DOM text extraction)
            
            const content = _extractArtifactContent(tile);

            switch (format) {
                case 'csv': return await _toCsv(content, tile, filename);
                case 'txt': return await _toTxt(content, filename);
                case 'md': return await _toMarkdown(content, filename);
                case 'docx': return await _toDocx(content, title, filename);
                case 'pdf': return await _toPdf(content, title, filename);
                case 'xlsx': return await _toXlsx(content, tile, filename);
                case 'pptx': return await _toPptx(content, title, filename);
                case 'wav':
                case 'mp3':
                case 'mp4':
                    return {
                        external: true,
                        filename: filename,
                        trigger: async () => await _toMedia(tile, format, filename)
                    };
                default:
                    const blob = new Blob([content || '(No exportable content)'], { type: 'text/plain' });
                    return { blob, filename: `${title}.txt` };
            }

        } catch (err) {
            console.error(`${MODULE_TAG} Conversion dispatcher failed:`, err);
            const api = window.NotebookLMFoldNest;
            if (api && api.showToast) {
                const typeLabel = (ARTIFACT_CONFIG[tile.type] && ARTIFACT_CONFIG[tile.type].label) || tile.type;
                api.showToast(`Failed to fetch ${typeLabel}: ${err.message}`);
            }
            return null;
        }
    }

    /**
     * Extracts raw text/JSON content from artifact's DOM element.
     */
    function _extractArtifactContent(artifact) {
        try {
            const el = artifact.element;
            if (!el) return '';

            // Try to get the most content-rich inner element
            const contentSelectors = [
                '.artifact-content',
                '.note-body',
                '.ql-editor',
                '.ProseMirror',
                '[contenteditable]',
                '.content',
                'p, li, td',
            ];

            for (const sel of contentSelectors) {
                const contentEl = el.querySelector(sel);
                if (contentEl) {
                    return (contentEl.innerText || contentEl.textContent || '').trim();
                }
            }

            // Fallback: get all text
            return (el.innerText || el.textContent || '').trim();
        } catch (e) {
            return '';
        }
    }

    // --- Format-Specific Converters ---

    async function _toTxt(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        return { blob, filename };
    }

    async function _toMarkdown(content, filename) {
        // Content is already text; try to preserve markdown-like structure
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        return { blob, filename };
    }

    /**
     * CSV export for Flashcards and Data Tables.
     * Smart serialization from the DOM table or Q&A content.
     */
    async function _toCsv(content, artifact, filename) {
        let csvContent = '';

        // Try to find a table in the artifact element
        const table = artifact.element && artifact.element.querySelector('table');
        if (table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            csvContent = rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td, th'));
                return cells.map(cell => {
                    const text = (cell.innerText || cell.textContent || '').trim().replace(/"/g, '""');
                    return `"${text}"`;
                }).join(',');
            }).join('\n');
        } else {
            // For flashcards: try Q&A pattern or just dump content
            // Look for front/back card structures
            const fronts = artifact.element ? Array.from(artifact.element.querySelectorAll('.front, .question, [class*="front"], [class*="question"]')) : [];
            const backs = artifact.element ? Array.from(artifact.element.querySelectorAll('.back, .answer, [class*="back"], [class*="answer"]')) : [];

            if (fronts.length > 0 && fronts.length === backs.length) {
                csvContent = 'Front,Back\n';
                csvContent += fronts.map((f, i) => {
                    const front = (f.innerText || '').trim().replace(/"/g, '""');
                    const back = (backs[i].innerText || '').trim().replace(/"/g, '""');
                    return `"${front}","${back}"`;
                }).join('\n');
            } else {
                // Generic: split lines into rows
                const lines = content.split('\n').filter(l => l.trim());
                csvContent = lines.map(line => `"${line.replace(/"/g, '""')}"`).join('\n');
            }
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        return { blob, filename };
    }

    /**
     * DOCX export using a simple document structure.
     * Creates a valid DOCX file without external libraries using XML.
     */
    async function _toDocx(content, title, filename) {
        // Minimal DOCX via the Open XML format (ZIP-based)
        // We'll create a very basic DOCX structure
        try {
            const JSZip = await _loadJSZip();
            if (!JSZip) throw new Error('JSZip not available for DOCX generation');

            const zip = new JSZip();

            // Escape XML special chars
            const xmlEscape = (s) => String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');

            // Convert content to XML paragraphs
            const paragraphs = content.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return '<w:p><w:r><w:t></w:t></w:r></w:p>';
                return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(trimmed)}</w:t></w:r></w:p>`;
            }).join('\n');

            const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
            xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            mc:Ignorable="w14 wp14">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>${xmlEscape(title)}</w:t></w:r>
    </w:p>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

            const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

            const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

            const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`;

            const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

            zip.file('[Content_Types].xml', contentTypesXml);
            zip.file('_rels/.rels', relsXml);
            zip.file('word/document.xml', documentXml);
            zip.file('word/styles.xml', stylesXml);
            zip.file('word/_rels/document.xml.rels', wordRelsXml);

            const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            return { blob, filename };
        } catch (e) {
            console.warn(`${MODULE_TAG} DOCX generation failed, falling back to TXT:`, e.message);
            // Fallback to TXT
            const blob = new Blob([`# ${title}\n\n${content}`], { type: 'text/plain;charset=utf-8' });
            return { blob, filename: filename.replace('.docx', '.txt') };
        }
    }

    /**
     * PDF export using the browser's print-to-PDF capability via an iframe.
     * Opens a hidden iframe, prints to PDF programmatically.
     */
    async function _toPdf(content, title, filename) {
        // We generate an HTML page and invoke the print dialog / blob
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${_htmlEscape(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid #eee; }
    p { margin-bottom: 12px; font-size: 14px; }
    @media print {
      body { margin: 0; padding: 20px; }
    }
  </style>
</head>
<body>
  <h1>${_htmlEscape(title)}</h1>
  ${content.split('\n').map(line => line.trim() ? `<p>${_htmlEscape(line)}</p>` : '<br>').join('\n')}
</body>
</html>`;

        // Use Blob URL + iframe approach to trigger print
        const htmlBlob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const htmlUrl = URL.createObjectURL(htmlBlob);

        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;';
            iframe.src = htmlUrl;
            document.body.appendChild(iframe);

            iframe.onload = () => {
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                } catch (e) {
                    console.warn(`${MODULE_TAG} PDF print error:`, e.message);
                }
                // Return the HTML blob as a fallback "PDF" (user prints via dialog)
                setTimeout(() => {
                    iframe.remove();
                    URL.revokeObjectURL(htmlUrl);
                    // Resolve with the HTML blob since we can't programmatically get PDF bytes
                    const fallbackBlob = new Blob([htmlContent], { type: 'application/pdf' });
                    resolve({ blob: fallbackBlob, filename: filename });
                }, 1500);
            };

            iframe.onerror = () => {
                iframe.remove();
                URL.revokeObjectURL(htmlUrl);
                // Fallback to text
                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                resolve({ blob, filename: filename.replace('.pdf', '.txt') });
            };

            document.body.appendChild(iframe);
        });
    }

    /**
     * Excel (XLSX) export using SheetJS if available, otherwise CSV fallback.
     */
    async function _toXlsx(content, artifact, filename) {
        try {
            // Check if SheetJS is available
            if (typeof window.XLSX !== 'undefined') {
                const XLSX = window.XLSX;
                let data = [];

                const table = artifact.element && artifact.element.querySelector('table');
                if (table) {
                    const rows = Array.from(table.querySelectorAll('tr'));
                    data = rows.map(row => {
                        return Array.from(row.querySelectorAll('td, th')).map(cell =>
                            (cell.innerText || cell.textContent || '').trim()
                        );
                    });
                } else {
                    data = content.split('\n')
                        .filter(line => line.trim())
                        .map(line => [line.trim()]);
                }

                const ws = XLSX.utils.aoa_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Data');
                const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                const blob = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                return { blob, filename };
            }
        } catch (e) {
            console.warn(`${MODULE_TAG} SheetJS XLSX error:`, e.message);
        }

        // Fallback to CSV
        console.warn(`${MODULE_TAG} SheetJS not available, falling back to CSV`);
        return _toCsv(content, artifact, filename.replace('.xlsx', '.csv'));
    }

    /**
     * PPTX export using PptxGenJS if available, otherwise HTML fallback.
     */
    async function _toPptx(content, title, filename) {
        try {
            if (typeof window.PptxGenJS !== 'undefined' || typeof window.pptxgen !== 'undefined') {
                const PptxGenJS = window.PptxGenJS || window.pptxgen;
                const pptx = new PptxGenJS();
                pptx.title = title;

                const lines = content.split('\n').filter(l => l.trim());
                const LINES_PER_SLIDE = 10;

                for (let i = 0; i < Math.max(1, Math.ceil(lines.length / LINES_PER_SLIDE)); i++) {
                    const slide = pptx.addSlide();

                    if (i === 0) {
                        slide.addText(title, {
                            x: 0.5, y: 0.5, w: '90%', h: 1.2,
                            fontSize: 28, bold: true, color: '363636',
                        });
                    }

                    const slideLines = lines.slice(i * LINES_PER_SLIDE, (i + 1) * LINES_PER_SLIDE);
                    if (slideLines.length > 0) {
                        const bodyText = slideLines.map(l => ({ text: l + '\n', options: { fontSize: 16 } }));
                        slide.addText(bodyText, {
                            x: 0.5, y: i === 0 ? 2.0 : 0.5, w: '90%', h: i === 0 ? 4.5 : 6.5,
                            color: '363636', valign: 'top',
                        });
                    }
                }

                const pptBlob = await pptx.write({ outputType: 'blob' });
                return { blob: pptBlob, filename };
            }
        } catch (e) {
            console.warn(`${MODULE_TAG} PptxGenJS error:`, e.message);
        }

        // Fallback: HTML presentation
        console.warn(`${MODULE_TAG} PptxGenJS not available, falling back to HTML presentation`);
        const htmlSlides = content.split('\n')
            .filter(l => l.trim())
            .map((line, i) => `<section style="padding: 40px; border-bottom: 2px solid #eee;"><p style="font-size: 18px;">${_htmlEscape(line)}</p></section>`)
            .join('\n');

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${_htmlEscape(title)}</title>
<style>body{font-family:Arial,sans-serif;margin:0;padding:20px;}h1{font-size:32px;}</style>
</head><body><h1>${_htmlEscape(title)}</h1>${htmlSlides}</body></html>`;

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        return { blob, filename: filename.replace('.pptx', '.html') };
    }

    // =========================================================================
    // DOWNLOAD TRIGGER
    // =========================================================================

    /**
     * Phase 2: Core API Handlers for FoldNest.
     */
    async function _downloadFromContribution(token, filename, format) {
        try {
            const url = `https://contribution.usercontent.google.com/download?c=${token}&filename=${filename}.${format}&authuser=0`;
            const response = await fetch(url, { credentials: 'include' });
            
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('AUTH_REQUIRED');
                }
                throw new Error(`HTTP Error ${response.status} when downloading ${filename}.${format}`);
            }
            
            console.debug(`[FoldNest Download] Successfully fetched ${filename}.${format}`);
            return await response.blob();
        } catch (error) {
            throw error;
        }
    }

    /**
     * Phase 2: Core API Handlers for FoldNest.
     * Attempts to fetch media directly. If CORS blocks it, falls back to a hidden anchor download.
     */
    async function _downloadMedia(mediaUrl, filename) {
        try {
            const response = await fetch(mediaUrl, { credentials: 'include' });
            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status} when fetching media`);
            }
            console.debug(`[FoldNest Download] Successfully fetched media Blob for ${filename}`);
            return await response.blob();
        } catch (error) {
            console.warn(`[FoldNest Download] CORS/Fetch error for ${filename}, falling back to native anchor download.`, error);
            
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = mediaUrl;
            a.download = filename;
            
            document.body.appendChild(a);
            a.click();
            a.remove();
            
            return { external: true };
        }
    }

    /**
     * Phase 3: Complex RPC Handlers.
     * Exports Reports/Tables to Google Docs/Sheets and sends ID to background script.
     */
    async function _exportViaGoogleDocs(artifactId, title, docType) {
        try {
            console.debug(`[FoldNest Export] Starting batchexecute export for ${docType}`);
            const isReport = docType === 'REPORT';
            const isSlides = docType === 'SLIDES';
            const rpcid = (docType === 'TABLE') ? 'Krh3pd' : 'ciyUvf';
            
            const { bl, at } = await _getSessionParams();
            const url = `/_/LabsTailwindUi/data/batchexecute?rpcids=${rpcid}&bl=${bl}&at=${at}`;
            
            // Use JSON.stringify to safely encode quotes in the title
            const innerStr = JSON.stringify([null, artifactId, null, title, 2]);
            const payloadArr = [[[rpcid, innerStr, null, "generic"]]];
            const reqData = `f.req=${encodeURIComponent(JSON.stringify(payloadArr))}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Same-Domain': '1',
                    'X-Goog-AuthUser': '0'
                },
                body: reqData,
                credentials: 'include'
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[FoldNest API Error] _exportViaGoogleDocs failed: ${response.status} ${response.statusText}`, errText);
                console.error(`[FoldNest API Error] URL was: ${url}`);
                console.error(`[FoldNest API Error] Request payload:`, reqData);
                throw new Error(`HTTP Error ${response.status}`);
            }

            const responseText = await response.text();
            
            const parsedArrays = _parseBatchexecute(responseText);
            let innerPayloadStr = null;
            
            for (const arr of parsedArrays) {
                if (arr && arr[0] && typeof arr[0][2] === 'string') {
                    innerPayloadStr = arr[0][2];
                    break;
                }
            }

            if (!innerPayloadStr) {
                console.error("[FoldNest Export] No payload found in Docs response:", responseText.substring(0, 500));
                throw new Error('Invalid batchexecute response or missing Docs payload');
            }
            
            // Extract the generated Google Docs/Sheets ID
            const match = innerPayloadStr.match(/"([a-zA-Z0-9-_]{35,})"/);
            if (!match) {
                throw new Error('Could not find Google Docs/Sheets ID in response');
            }
            const docId = match[1];

            let format, extUrl;
            if (isReport) {
                format = 'docx';
                extUrl = `https://docs.google.com/document/d/${docId}/export?format=${format}`;
            } else if (isSlides) {
                format = 'pptx';
                extUrl = `https://docs.google.com/presentation/d/${docId}/export/pptx`;
            } else {
                format = 'xlsx';
                extUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=${format}`;
            }
            
            const exportFilename = `${title}.${format}`;

            console.debug(`[FoldNest Export] Triggering background download for doc ID: ${docId}`);
            
            // CRITICAL STEP: Send to background script
            chrome.runtime.sendMessage({
                action: 'downloadUrl',
                url: extUrl,
                filename: exportFilename
            });

            return { external: true };

        } catch (error) {
            console.error(`[FoldNest Export] Export failed for ${title}:`, error);
            throw error;
        }
    }

    /**
     * Triggers a file download using chrome.downloads API if available,
     * with <a download> fallback.
     */
    function _triggerDownload(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);

            if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
                chrome.downloads.download({ url, filename }, () => {
                    // Revoke after short delay
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                });
            } else {
                // <a download> fallback
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            }
        } catch (e) {
            console.error(`${MODULE_TAG} Download trigger error:`, e.message);
        }
    }

    /**
     * Media-specific "converter" that triggers the native NotebookLM download flow.
     */
    async function _toMedia(artifact, format, filename) {
        console.debug(`${MODULE_TAG} Triggering native media download for: ${artifact.title}`);

        // We attempt to trigger the download button in the artifact's menu
        const success = await _triggerNativeDownload(artifact);

        if (!success) {
            _showFallbackToast(`Failed to trigger download for "${artifact.title}". Try manual download.`);
            return null;
        }

        // Return external flag to signal that the download was handled externally
        return { external: true, filename };
    }

    /**
     * Programmatically opens the artifact's "more_vert" menu and clicks the "Download" button.
     */
    async function _triggerNativeDownload(artifact) {
        try {
            const tile = artifact.element;
            if (!tile) return false;

            // 1. Find the menu button (more_vert)
            // Strategy: look for common patterns in material button labels or icons
            const menuBtn = tile.querySelector('button[aria-label*="menu"], button[aria-label*="More Options"], .more-vert-button') ||
                            Array.from(tile.querySelectorAll('button')).find(b => {
                                const txt = (b.innerText || b.textContent || '').toLowerCase();
                                return txt.includes('more_vert') || b.querySelector('mat-icon')?.innerText.includes('more_vert');
                            });

            if (!menuBtn) {
                console.warn(`${MODULE_TAG} Could not find menu button for media artifact`);
                return false;
            }

            // 2. Click the menu button
            menuBtn.click();

            // 3. Wait for the menu to appear in the DOM
            // Increase delay slightly to ensure DOM render of M3 menus
            await new Promise(r => setTimeout(r, 800));

            // 4. Find the "Download" menu item
            const menuItems = Array.from(document.querySelectorAll('.mat-menu-item, [role="menuitem"], .mat-mdc-menu-item, .mdc-list-item, button, span, a'));
            const downloadBtn = menuItems.find(item => {
                const isOverlay = item.closest('.cdk-overlay-container, .mat-mdc-menu-panel, .mdc-menu-surface, [role="menu"]');
                if (!isOverlay) return false;
                
                const txt = (item.innerText || item.textContent || '').toLowerCase();
                const icon = (item.querySelector('mat-icon, .material-symbols-outlined, svg')?.innerText || '').toLowerCase();
                return txt.includes('download') || icon.includes('save_alt') || icon.includes('download');
            });

            if (!downloadBtn) {
                console.warn(`${MODULE_TAG} Could not find 'Download' option in context menu`);
                // Click backdrop to close menu
                document.querySelector('.cdk-overlay-backdrop')?.click();
                return false;
            }

            // 5. Click the download button
            downloadBtn.click();

            // 6. Return success
            return true;
        } catch (e) {
            console.error(`${MODULE_TAG} _triggerNativeDownload error:`, e);
            return false;
        }
    }

    // =========================================================================
    // PROGRESS TOAST
    // =========================================================================

    function _showProgressToast(message, done, total) {
        // Remove any existing progress toast
        if (_toastProgressEl) {
            _toastProgressEl.remove();
            _toastProgressEl = null;
        }

        const toast = document.createElement('div');
        toast.id = 'fn-export-progress-toast';
        toast.className = 'fn-progress-toast';

        const msgEl = document.createElement('div');
        msgEl.className = 'fn-progress-msg';
        msgEl.textContent = message;

        const progressBar = document.createElement('div');
        progressBar.className = 'fn-progress-bar-wrap';

        const progressFill = document.createElement('div');
        progressFill.className = 'fn-progress-bar-fill';
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        progressFill.style.width = `${pct}%`;

        progressBar.appendChild(progressFill);
        toast.appendChild(msgEl);
        toast.appendChild(progressBar);
        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('fn-toast-visible');
            });
        });

        _toastProgressEl = toast;
    }

    function _updateProgressToast(message, done, total, isDone = false) {
        if (!_toastProgressEl) {
            _showProgressToast(message, done, total);
            return;
        }
        const msgEl = _toastProgressEl.querySelector('.fn-progress-msg');
        const fillEl = _toastProgressEl.querySelector('.fn-progress-bar-fill');

        if (msgEl) msgEl.textContent = message;
        if (fillEl) {
            const pct = total > 0 ? Math.round((done / total) * 100) : 100;
            fillEl.style.width = `${pct}%`;
        }

        if (isDone) {
            _toastProgressEl.classList.add('fn-toast-done');
            const el = _toastProgressEl;
            setTimeout(() => {
                el.classList.remove('fn-toast-visible');
                setTimeout(() => el.remove(), 400);
            }, 3000);
            _toastProgressEl = null;
        }
    }

    function _showFallbackToast(message) {
        const api = window.NotebookLMFoldNest;
        if (api && api.showToast) {
            api.showToast(message);
        }
    }
    // =========================================================================
    // FORMAT MEMORY
    // =========================================================================

    function _loadFormatMemory() {
        try {
            return JSON.parse(localStorage.getItem(FORMAT_MEMORY_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function _saveFormatMemory(mem) {
        try {
            localStorage.setItem(FORMAT_MEMORY_KEY, JSON.stringify(mem));
        } catch (e) {
            console.debug(`${MODULE_TAG} Format memory save failed:`, e.message);
        }
    }

    // =========================================================================
    // UTILITIES
    // =========================================================================

    function _getNotebookTitle() {
        try {
            // Try FoldNest API first
            const api = window.NotebookLMFoldNest;
            // Attempt the getCurrentNotebookTitle from the global scope (it's defined in content.js)
            if (typeof getCurrentNotebookTitle === 'function') {
                return getCurrentNotebookTitle() || 'Notebook';
            }
            // Fallback: parse from document title
            if (document.title && document.title.includes(' - NotebookLM')) {
                return document.title.replace(' - NotebookLM', '').trim();
            }
            return 'Notebook';
        } catch (e) {
            return 'Notebook';
        }
    }

    function _buildFilename(notebookTitle, artifactTitle, ext) {
        const clean = (s) => (s || '').replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
        const art = clean(artifactTitle) || 'Artifact';
        const extension = ext ? `.${ext}` : '';
        return `${art}${extension}`;
    }


    function _htmlEscape(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function _isVisible(node) {
        if (!node || !(node instanceof Element)) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * Lazy-loads JSZip from the bundled lib path.
     * Falls back to window.JSZip if already loaded.
     */
    function _loadJSZip() {
        return new Promise((resolve) => {
            if (typeof window.JSZip !== 'undefined') {
                resolve(window.JSZip);
                return;
            }
            // Try to load from extension's web_accessible_resources
            try {
                const script = document.createElement('script');
                const src = typeof chrome !== 'undefined' && chrome.runtime
                    ? chrome.runtime.getURL('lib/jszip.min.js')
                    : null;
                if (!src) {
                    resolve(null);
                    return;
                }
                script.src = src;
                script.onload = () => resolve(window.JSZip || null);
                script.onerror = () => resolve(null);
                document.head.appendChild(script);
            } catch (e) {
                resolve(null);
            }
        });
    }

    // =========================================================================
    // RPC FETCHERS
    // =========================================================================

    /**
     * Extracts Build Label (bl) and Action Token (at) from the page scripts.
     */
    async function _getSessionParams() {
        let bl = '';
        let at = '';
        
        // Strategy 1: Page context injection (safest way to read WIZ_global_data)
        try {
            const data = await new Promise((resolve) => {
                const scriptId = 'fn-session-extractor-' + Date.now();
                const script = document.createElement('script');
                script.id = scriptId;
                script.textContent = `
                    (function() {
                        try {
                            const data = window.WIZ_global_data || window.IJ_values || {};
                            const bl = data.bl || (data.cfb2h ? data.cfb2h.bl : '') || '';
                            const at = data.SNlM0e || '';
                            document.getElementById('${scriptId}').setAttribute('data-wiz', JSON.stringify({bl, at}));
                        } catch(e) {}
                    })();
                `;
                document.documentElement.appendChild(script);
                setTimeout(() => {
                    try {
                        const raw = document.getElementById(scriptId)?.getAttribute('data-wiz');
                        script.remove();
                        if (raw) resolve(JSON.parse(raw));
                        else resolve({bl: '', at: ''});
                    } catch(e) {
                        resolve({bl: '', at: ''});
                    }
                }, 100);
            });
            
            bl = data.bl;
            at = data.at;
        } catch(e) {}
        
        // Strategy 2: Regex fallback
        if (!at || !bl) {
            const html = document.documentElement.innerHTML;
            if (!at) {
                const atMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
                if (atMatch) at = atMatch[1];
            }
            if (!bl) {
                const blMatch = html.match(/"(boq_[a-zA-Z0-9_\-.]+)"/);
                if (blMatch) bl = blMatch[1];
            }
        }
        
        if (!bl) bl = 'boq_labstailwinduiserver_20240401.00_p0'; // Final fallback
        
        console.debug(`[FoldNest Session Debug] Extracted bl: ${bl}`);
        console.debug(`[FoldNest Session Debug] Extracted at: ${at ? 'Present (' + at.substring(0, 5) + '...)' : 'MISSING'}`);
        
        return { bl, at };
    }

    /**
     * Safely parses Google's chunked batchexecute responses.
     */
    function _parseBatchexecute(text) {
        const results = [];
        const lines = text.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('[')) {
                try {
                    results.push(JSON.parse(line));
                } catch (e) {}
            }
        }
        return results;
    }

    /**
     * Fetches flashcards directly from the NotebookLM backend via RPC.
     * Makes two sequential POST requests to batchexecute.
     */
    async function _fetchFlashcardsViaRpc(artifactId) {
        console.debug(`[FoldNest Flashcards] Starting RPC fetch for ${artifactId}`);

        const notebookIdMatch = window.location.pathname.match(/\/notebook\/([^/]+)/);
        const notebookId = notebookIdMatch ? notebookIdMatch[1] : '';

        const { bl, at } = await _getSessionParams();
        console.debug(`[FoldNest Flashcards] Config: notebookId=${notebookId}, bl=${bl}`);

        const baseUrl = '/_/LabsTailwindUi/data/batchexecute';
        const queryParams = `source-path=/notebook/${notebookId}&bl=${bl}&at=${at}&hl=en&soc-app=1&soc-platform=1&soc-device=1&rt=c`;

        try {
            // REQUEST 1 - Prepare artifact
            console.debug(`[FoldNest Flashcards] Executing Request 1 (v9rmvd)`);
            const req1Body = new URLSearchParams();
            const payload1 = `[[["v9rmvd","[\\"${artifactId}\\",[2,null,null,[1,null,null,null,null,null,null,null,null,null,[1]],[[1,4,2,3,6,5]]]]",null,"generic"]]]`;
            req1Body.append('f.req', payload1);

            const res1 = await fetch(`${baseUrl}?rpcids=v9rmvd&${queryParams}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Same-Domain': '1',
                    'X-Goog-AuthUser': '0'
                },
                body: req1Body
            });

            if (!res1.ok) {
                const errText1 = await res1.text();
                console.error(`[FoldNest API Error] Flashcards Req 1 failed: ${res1.status} ${res1.statusText}`, errText1);
                console.error(`[FoldNest API Error] URL was: ${baseUrl}?rpcids=v9rmvd&${queryParams}`);
                console.error(`[FoldNest API Error] Payload was:`, payload1);
                throw new Error(`Request 1 failed with status: ${res1.status}`);
            }

            // REQUEST 2 - Fetch card data
            console.debug(`[FoldNest Flashcards] Executing Request 2 (ulBSjf)`);
            const req2Body = new URLSearchParams();
            const payload2 = `[[["ulBSjf","[[2,null,null,[1,null,null,null,null,null,null,null,null,null,[1]],[[1,4,2,3,6,5]]],\\"${artifactId}\\"]",null,"generic"]]]`;
            req2Body.append('f.req', payload2);

            const res2 = await fetch(`${baseUrl}?rpcids=ulBSjf&${queryParams}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Same-Domain': '1',
                    'X-Goog-AuthUser': '0'
                },
                body: req2Body
            });

            if (!res2.ok) {
                const errText2 = await res2.text();
                console.error(`[FoldNest API Error] Flashcards Req 2 failed: ${res2.status} ${res2.statusText}`, errText2);
                console.error(`[FoldNest API Error] URL was: ${baseUrl}?rpcids=ulBSjf&${queryParams}`);
                console.error(`[FoldNest API Error] Payload was:`, payload2);
                throw new Error(`Request 2 failed with status: ${res2.status}`);
            }

            const rawText = await res2.text();
            console.debug(`[FoldNest Flashcards] Request 2 raw response length: ${rawText.length}`);

            // Parse response safely using chunk parser
            const parsedArrays = _parseBatchexecute(rawText);
            let innerArr = null;

            for (const arr of parsedArrays) {
                if (arr && arr[0] && typeof arr[0][2] === 'string') {
                    try {
                        innerArr = JSON.parse(arr[0][2]);
                        break;
                    } catch (e) {}
                }
            }

            if (!innerArr) {
                console.error("[FoldNest Flashcards] No valid payload found:", rawText.substring(0, 500));
                throw new Error('Unexpected batchexecute response structure');
            }

            const cards = [];
            let cardList = null;

            const searchForCardList = (node) => {
                if (Array.isArray(node)) {
                    // Filter children that are arrays containing at least 2 strings
                    const validCards = node.filter(child => {
                        if (!Array.isArray(child)) return false;
                        const strCount = child.filter(v => typeof v === 'string' && v.trim().length > 0).length;
                        return strCount >= 2;
                    });

                    // If more than 0 cards found, and they make up at least some portion of the array
                    if (validCards.length > 0) {
                        cardList = validCards; // Use the filtered valid cards array directly!
                        return;
                    }
                    
                    for (const child of node) {
                        if (!cardList) searchForCardList(child);
                    }
                }
            };

            searchForCardList(innerArr);

            if (cardList) {
                for (const cardArr of cardList) {
                    const strings = cardArr.filter(v => typeof v === 'string' && v.trim().length > 0);
                    if (strings.length >= 3) {
                        cards.push({ front: strings[1], back: strings[2] });
                    } else if (strings.length >= 2) {
                        cards.push({ front: strings[0], back: strings[1] });
                    }
                }
            } else {
                console.debug(`[FoldNest Flashcards] Could not definitively find card list node, using broad heuristic.`);
                const fallbackSearch = (arr) => {
                    if (!Array.isArray(arr)) return;
                    const strs = arr.filter(v => typeof v === 'string' && v.trim().length > 0);
                    if (strs.length >= 2 && !arr.some(Array.isArray)) {
                        if (strs.length >= 3) cards.push({ front: strs[1], back: strs[2] });
                        else cards.push({ front: strs[0], back: strs[1] });
                    } else {
                        arr.forEach(fallbackSearch);
                    }
                };
                fallbackSearch(innerArr);
            }

            console.debug(`[FoldNest Flashcards] Extracted ${cards.length} cards`);
            return cards;

        } catch (e) {
            console.error(`[FoldNest Flashcards] Error during RPC fetch:`, e);
            throw e;
        }
    }

    // =========================================================================
    // START
    // =========================================================================

    initExportStudio();

})();

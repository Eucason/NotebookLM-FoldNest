/**
 * NotebookLM FoldNest — Export Module (Phase 1: Artifacts)
 * Author: eucason
 * 
 * Provides export functionality for Studio/Artifacts panel:
 * - Flashcards → CSV (native trigger) or TXT (custom scraping)
 * - Mind Map → PNG (html2canvas capture)
 * 
 * Registers on window.FoldNestExport. Called from content.js startApp().
 */
(function () {
  'use strict';

  // Avoid double-init
  if (window.FoldNestExport) return;

  const DEBUG = true;
  const log = (...args) => DEBUG && console.debug('[FoldNest Export]', ...args);

  // =========================================================================
  // CORE UTILITIES
  // =========================================================================

  /**
   * Downloads a Blob as a file. Falls back to chrome.downloads if available.
   */
  function downloadFile(blob, filename) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      log('Downloaded:', filename);
    } catch (e) {
      console.error('[FoldNest Export] Download failed:', e);
      toast('Export failed — please retry.', 'error');
    }
  }

  /**
   * Show toast via FoldNest's existing toast system.
   */
  function toast(message) {
    if (window.NotebookLMFoldNest && window.NotebookLMFoldNest.showToast) {
      window.NotebookLMFoldNest.showToast(message);
    } else {
      log('Toast (no handler):', message);
    }
  }

  /**
   * Show a rename modal before downloading. Calls onConfirm(finalName) with the full filename.
   */
  function showRenameModal(defaultName, extension, onConfirm) {
    // Remove any existing rename modal
    const existing = document.getElementById('plugin-rename-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'plugin-rename-modal';
    overlay.className = 'plugin-modal-overlay';

    const content = document.createElement('div');
    content.className = 'plugin-modal-content plugin-rename-modal-content';

    // Title
    const title = document.createElement('div');
    title.className = 'plugin-modal-title';
    title.textContent = 'Save As';
    content.appendChild(title);

    // Input row
    const field = document.createElement('div');
    field.className = 'plugin-edit-field';
    const label = document.createElement('label');
    label.textContent = 'Filename';
    field.appendChild(label);

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultName;
    input.style.cssText = 'flex:1;';
    input.setAttribute('aria-label', 'Export filename');
    const extSpan = document.createElement('span');
    extSpan.textContent = '.' + extension;
    extSpan.style.cssText = 'color:var(--plugin-text-secondary);font-size:14px;white-space:nowrap;';
    inputRow.appendChild(input);
    inputRow.appendChild(extSpan);
    field.appendChild(inputRow);
    content.appendChild(field);

    // Buttons
    const buttons = document.createElement('div');
    buttons.className = 'plugin-modal-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'plugin-modal-btn cancel';
    cancelBtn.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'plugin-modal-btn confirm';
    saveBtn.textContent = 'Download';
    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);
    content.appendChild(buttons);

    overlay.appendChild(content);

    const closeModal = () => overlay.remove();

    cancelBtn.onclick = closeModal;
    saveBtn.onclick = () => {
      const name = input.value.trim() || defaultName;
      closeModal();
      onConfirm(name + '.' + extension);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') saveBtn.click();
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  }

  /**
   * Converts CSV content (Front,Back rows) to readable TXT format.
   * "Front: question\nBack: answer\n---"
   */
  function csvToTxt(csvContent) {
    try {
      const lines = csvContent.trim().split('\n');
      const result = [];
      for (const line of lines) {
        const fields = parseCSVLine(line);
        if (fields.length >= 2) {
          result.push(`Front: ${fields[0]}\nBack: ${fields[1]}\n---`);
        } else if (fields.length === 1) {
          result.push(`Card: ${fields[0]}\n---`);
        }
      }
      return result.join('\n');
    } catch (e) {
      log('csvToTxt failed:', e);
      return csvContent;
    }
  }

  /**
   * Parse a single CSV line, respecting quoted fields.
   */
  function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  // =========================================================================
  // DROPDOWN MENU
  // =========================================================================

  let activeDropdown = null;
  let activeDropdownCleanup = null;

  function closeActiveDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
    if (activeDropdownCleanup) {
      activeDropdownCleanup();
      activeDropdownCleanup = null;
    }
  }

  /**
   * Show the final Artifacts export dropdown (mint-grey, cyan-green, golden).
   */
  function showExportDropdown(btnEl) {
    // Toggle off if already open
    if (activeDropdown) {
      closeActiveDropdown();
      return;
    }

    console.log('[FoldNest] Final artifacts dropdown rendered');
    console.log('[FoldNest] Icons rendered as real Material Symbols');

    // ── State ──────────────────────────────────────────────────────────────
    const state = {
      flashcardFormat: 'csv',  // 'csv' | 'txt'
      mindmapFormat: 'png',    // 'png' | 'jpg'
      selectedFlashcards: new Set(),
      selectedMindmaps: new Set()
    };

    // ── Root container ──────────────────────────────────────────────────────
    const menu = document.createElement('div');
    menu.className = 'ad-dropdown';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Download Studio Artifacts');

    // ── Title ───────────────────────────────────────────────────────────────
    const titleEl = document.createElement('h2');
    titleEl.className = 'ad-title';
    titleEl.textContent = 'Download Studio Artifacts';
    menu.appendChild(titleEl);

    // ── Flashcards section ──────────────────────────────────────────────────
    const flashSection = adMakeSection();

    // Heading
    const flashHeading = adMakeSectionHeading('cards_star', 'Flashcards', 'cyan');
    flashSection.appendChild(flashHeading);

    // Format pills
    const [csvPill, txtPill] = adMakePills(
      [{ id: 'csv', label: 'CSV (.csv)' }, { id: 'txt', label: 'Plain Text (.txt)' }],
      'csv',
      'cyan',
      (id) => { state.flashcardFormat = id; }
    );
    const flashPillGroup = document.createElement('div');
    flashPillGroup.className = 'ad-pill-group';
    flashPillGroup.append(csvPill, txtPill);
    flashSection.appendChild(flashPillGroup);

    // Divider
    flashSection.appendChild(adMakeDivider());

    // Item list — from artifact library DOM
    const flashArtifacts = adScrapeArtifactLibrary('flashcard');
    const flashNames = flashArtifacts.map(a => a.title);
    const flashList = adMakeList(
      flashNames.length > 0 ? flashNames : null,
      'No flashcards yet',
      (idx, checked) => {
        if (checked) state.selectedFlashcards.add(idx);
        else state.selectedFlashcards.delete(idx);
      }
    );
    // Pre-select all
    flashArtifacts.forEach((_, i) => state.selectedFlashcards.add(i));
    flashSection.appendChild(flashList);

    menu.appendChild(flashSection);

    // ── Section divider ─────────────────────────────────────────────────────
    menu.appendChild(adMakeSectionDivider());

    // ── Mind maps section ────────────────────────────────────────────────────
    const mindSection = adMakeSection();

    const mindHeading = adMakeSectionHeading('flowchart', 'Mind maps', 'golden');
    mindSection.appendChild(mindHeading);

    const [pngPill, jpgPill] = adMakePills(
      [{ id: 'png', label: 'PNG' }, { id: 'jpg', label: 'JPG' }],
      'png',
      'golden',
      (id) => { state.mindmapFormat = id; }
    );
    const mindPillGroup = document.createElement('div');
    mindPillGroup.className = 'ad-pill-group';
    mindPillGroup.append(pngPill, jpgPill);
    mindSection.appendChild(mindPillGroup);

    mindSection.appendChild(adMakeDivider());

    // Detect mind maps from artifact library
    const mindArtifacts = adScrapeArtifactLibrary('mindmap');
    const mindNames = mindArtifacts.map(a => a.title);
    const mindList = adMakeList(
      mindNames.length > 0 ? mindNames : null,
      'No mind maps yet',
      (idx, checked) => {
        if (checked) state.selectedMindmaps.add(idx);
        else state.selectedMindmaps.delete(idx);
      }
    );
    // Pre-select all
    mindArtifacts.forEach((_, i) => state.selectedMindmaps.add(i));
    mindSection.appendChild(mindList);

    menu.appendChild(mindSection);

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'ad-footer';

    const previewBtn = document.createElement('button');
    previewBtn.className = 'ad-btn ad-btn-preview';
    previewBtn.textContent = 'Preview';
    previewBtn.onclick = () => toast('Preview coming in Stage 2');
    footer.appendChild(previewBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'ad-btn ad-btn-download';
    downloadBtn.textContent = 'Download';
    downloadBtn.onclick = () => adHandleDownload(state);
    footer.appendChild(downloadBtn);

    menu.appendChild(footer);

    // ── Position ──────────────────────────────────────────────────────────────
    document.body.appendChild(menu);
    const rect = btnEl.getBoundingClientRect();
    menu.style.top = (rect.bottom + 8) + 'px';
    menu.style.left = Math.max(8, rect.right - 360) + 'px';

    // Viewport protection
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth - 8) {
        menu.style.left = (window.innerWidth - 368) + 'px';
      }
      if (mr.bottom > window.innerHeight - 8) {
        menu.style.top = (rect.top - mr.height - 8) + 'px';
      }
    });

    activeDropdown = menu;

    // ── Events ────────────────────────────────────────────────────────────────
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && !btnEl.contains(e.target)) {
        closeActiveDropdown();
      }
    };
    const escHandler = (e) => { if (e.key === 'Escape') closeActiveDropdown(); };
    setTimeout(() => {
      document.addEventListener('click', closeHandler, true);
      document.addEventListener('keydown', escHandler, true);
    }, 50);
    activeDropdownCleanup = () => {
      document.removeEventListener('click', closeHandler, true);
      document.removeEventListener('keydown', escHandler, true);
    };
  }

  // ── Dropdown Helper Functions ─────────────────────────────────────────────

  function adMakeSection() {
    const s = document.createElement('div');
    s.className = 'ad-section';
    return s;
  }

  function adMakeSectionHeading(iconName, text, accent) {
    const h = document.createElement('div');
    h.className = `ad-section-heading ${accent}`;
    // Use mat-icon so Angular/NotebookLM renders real Material Symbols
    const icon = document.createElement('mat-icon');
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-hidden', 'true');
    icon.className = 'material-symbols-outlined google-symbols ad-heading-icon';
    icon.textContent = iconName;
    const label = document.createElement('span');
    label.textContent = text;
    h.append(icon, label);
    return h;
  }

  /**
   * Returns array of pill <button> elements.
   * @param {Array<{id,label}>} options
   * @param {string} defaultId
   * @param {'cyan'|'golden'} accent
   * @param {Function} onChange(id)
   */
  function adMakePills(options, defaultId, accent, onChange) {
    const pills = options.map(({ id, label }) => {
      const p = document.createElement('button');
      p.className = 'ad-pill' + (id === defaultId ? ' active' + (accent === 'golden' ? ' golden-pill' : '') : '');
      p.textContent = label;
      p.dataset.pillId = id;
      p.onclick = (e) => {
        e.stopPropagation();
        // Toggle siblings
        const siblings = p.parentElement.querySelectorAll('.ad-pill');
        siblings.forEach(s => s.classList.remove('active', 'golden-pill'));
        p.classList.add('active');
        if (accent === 'golden') p.classList.add('golden-pill');
        onChange(id);
      };
      return p;
    });
    return pills;
  }

  function adMakeDivider() {
    const d = document.createElement('div');
    d.className = 'ad-divider';
    return d;
  }

  function adMakeSectionDivider() {
    const d = document.createElement('div');
    d.className = 'ad-section-divider';
    return d;
  }

  /**
   * Build a checkbox item list.
   * @param {string[]|null} items — null means show empty state
   * @param {string} emptyMsg
   * @param {Function} onChange(idx, checked)
   */
  function adMakeList(items, emptyMsg, onChange) {
    const list = document.createElement('div');
    list.className = 'ad-item-list';

    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ad-empty';
      empty.textContent = emptyMsg;
      list.appendChild(empty);
      return list;
    }

    items.forEach((name, idx) => {
      const row = document.createElement('div');
      row.className = 'ad-item-row';

      const cbWrap = document.createElement('label');
      cbWrap.className = 'ad-cb-wrap';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.onchange = (e) => onChange(idx, e.target.checked);

      const box = document.createElement('span');
      box.className = 'ad-cb-box';

      cbWrap.append(input, box);

      const label = document.createElement('span');
      label.className = 'ad-item-name';
      label.title = name;
      label.textContent = name;

      row.append(cbWrap, label);
      row.onclick = (e) => {
        // cbWrap is a <label> — browser natively toggles input when anything inside it is clicked.
        // Skip the manual toggle for label area clicks to prevent double-toggling.
        if (cbWrap.contains(e.target)) return;
        input.checked = !input.checked;
        onChange(idx, input.checked);
      };

      list.appendChild(row);
    });

    return list;
  }

  /**
   * Scrape the Studio artifact library for items of a given type.
   * Uses the confirmed live DOM structure:
   *   button.artifact-button-content (each artifact row)
   *   mat-icon inside it — text content = icon ligature name
   *     'cards_star' → flashcard
   *     'flowchart'  → mind map
   *   span.artifact-title (or div.title-container) — the artifact name
   *
   * @param {'flashcard'|'mindmap'} type
   * @returns {Array<{title: string, el: Element}>}
   */
  function adScrapeArtifactLibrary(type) {
    const iconName = type === 'flashcard' ? 'cards_star' : 'flowchart';
    const results = [];

    // Primary: query all artifact button rows in the library
    // These live inside [class*='artifact-library'] or the panel-content-scrollable area
    const rows = document.querySelectorAll(
      'button.artifact-button-content, .artifact-item-button button, [class*="artifact-library"] button'
    );

    rows.forEach(btn => {
      // Find the mat-icon inside this button
      const icon = btn.querySelector('mat-icon');
      if (!icon) return;
      const iconText = (icon.textContent || '').trim();
      if (iconText !== iconName) return;

      // Get the artifact title
      let title = '';
      const titleEl = btn.querySelector('span.artifact-title, .artifact-title, div.title-container, [class*="title"]');
      if (titleEl) {
        title = (titleEl.textContent || '').trim();
      } else {
        // Fallback: use all text except the icon text
        title = (btn.textContent || '').replace(iconText, '').trim();
      }

      if (title) {
        results.push({ title, el: btn });
        log(`[adScrapeArtifactLibrary] Found ${type}: "${title}"`);
      }
    });

    // Fallback: look for treeitem / listitem with matching icon
    if (results.length === 0) {
      const treeItems = document.querySelectorAll(
        '[role="treeitem"], [role="listitem"], mat-tree-node'
      );
      treeItems.forEach(item => {
        const icon = item.querySelector('mat-icon');
        if (!icon) return;
        if ((icon.textContent || '').trim() !== iconName) return;
        const titleEl = item.querySelector('span.artifact-title, [class*="title"], span');
        const title = titleEl ? (titleEl.textContent || '').trim() : (item.textContent || '').replace(iconName, '').trim();
        if (title) results.push({ title, el: item });
      });
    }

    log(`[adScrapeArtifactLibrary] ${type} count: ${results.length}`);
    return results;
  }

  function adFindMindMapEl() {
    // First check the library for a mind map item
    const mindmaps = adScrapeArtifactLibrary('mindmap');
    if (mindmaps.length > 0) return mindmaps[0].el;

    // Fallback to rendered content selectors
    const selectors = [
      '[data-artifact-type*="mind"]',
      '[data-artifact-type*="mindmap"]',
      '[class*="mind-map"] canvas',
      '[class*="mind-map"]',
      '[class*="mindmap"]',
      'svg[class*="mind"]',
      '.graph-container'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  async function adHandleDownload(state) {
    closeActiveDropdown();

    let didSomething = false;

    if (state.selectedFlashcards.size > 0) {
      didSomething = true;
      if (state.flashcardFormat === 'csv') {
        exportFlashcardsCSV();
      } else {
        exportFlashcardsTXT();
      }
    }

    if (state.selectedMindmaps.size > 0) {
      didSomething = true;
      exportMindMap(state.mindmapFormat);
    }

    if (!didSomething) {
      toast('No items selected for download');
    }
  }


  // =========================================================================
  // FLASHCARD FORMAT CHOICE
  // =========================================================================

  /**
   * Show sub-choice for flashcard format: Native CSV (fast) or Custom TXT (readable)
   */
  function showFlashcardFormatChoice() {
    const existing = document.getElementById('plugin-format-choice-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'plugin-format-choice-modal';
    overlay.className = 'plugin-modal-overlay';

    const content = document.createElement('div');
    content.className = 'plugin-modal-content';
    content.style.cssText = 'min-width:300px;max-width:380px;';

    // Title
    const title = document.createElement('div');
    title.className = 'plugin-modal-title';
    title.textContent = 'Flashcards Export Format';
    content.appendChild(title);

    // Description
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:13px;color:var(--plugin-text-secondary);margin-bottom:16px;text-align:center;line-height:1.5;';
    desc.textContent = 'Choose your preferred format for flashcard export.';
    content.appendChild(desc);

    // Format buttons container
    const formatRow = document.createElement('div');
    formatRow.className = 'plugin-format-pills';

    // CSV Button
    const csvBtn = document.createElement('button');
    csvBtn.className = 'plugin-format-pill';
    csvBtn.setAttribute('aria-label', 'Export flashcards as CSV');
    csvBtn.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:24px;margin-bottom:4px;">table_chart</span>
      <span style="font-weight:500;">CSV</span>
      <span style="font-size:11px;color:var(--plugin-text-secondary);">Anki / Quizlet</span>
    `;
    csvBtn.onclick = () => {
      overlay.remove();
      exportFlashcardsCSV();
    };
    formatRow.appendChild(csvBtn);

    // TXT Button
    const txtBtn = document.createElement('button');
    txtBtn.className = 'plugin-format-pill';
    txtBtn.setAttribute('aria-label', 'Export flashcards as plain text');
    txtBtn.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:24px;margin-bottom:4px;">description</span>
      <span style="font-weight:500;">TXT</span>
      <span style="font-size:11px;color:var(--plugin-text-secondary);">Readable text</span>
    `;
    txtBtn.onclick = () => {
      overlay.remove();
      exportFlashcardsTXT();
    };
    formatRow.appendChild(txtBtn);

    content.appendChild(formatRow);

    // Cancel button
    const cancelRow = document.createElement('div');
    cancelRow.style.cssText = 'text-align:center;margin-top:12px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'plugin-modal-btn cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => overlay.remove();
    cancelRow.appendChild(cancelBtn);
    content.appendChild(cancelRow);

    overlay.appendChild(content);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
  }

  // =========================================================================
  // FLASHCARDS EXPORT — CSV (Native Button Trigger)
  // =========================================================================

  /**
   * Try to trigger NotebookLM's native flashcard download button for CSV.
   * Uses resilient selector chain with retry.
   */
  function exportFlashcardsCSV() {
    log('Attempting native CSV export...');

    if (!hasFlashcardsVisible()) {
      toast('No flashcards available to export.');
      return;
    }

    const selectors = [
      'button[aria-label*="Download"]',
      '#download-btn',
      'button[mattooltip="Download"]',
      'button:has(mat-icon)',
      '.inline-icon-button:has(mat-icon)'
    ];

    let nativeBtn = findNativeDownloadBtn(selectors);

    if (nativeBtn) {
      log('Found native download button, triggering click...');
      nativeBtn.click();
      toast('Flashcards CSV downloading...');
      return;
    }

    log('Native button not found, retrying in 1.5s...');
    toast('Looking for download button...');
    setTimeout(() => {
      nativeBtn = findNativeDownloadBtn(selectors);
      if (nativeBtn) {
        log('Found native download button on retry');
        nativeBtn.click();
        toast('Flashcards CSV downloading...');
      } else {
        log('Native button not found after retry, falling back to scrape');
        exportFlashcardsByScrapingCSV();
      }
    }, 1500);
  }

  /**
   * Find the native download button using a chain of selectors.
   */
  function findNativeDownloadBtn(selectors) {
    for (const sel of selectors) {
      try {
        const candidates = document.querySelectorAll(sel);
        for (const btn of candidates) {
          const iconEl = btn.querySelector('mat-icon');
          const iconText = iconEl ? (iconEl.textContent || '').trim() : '';
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const tooltip = (btn.getAttribute('mattooltip') || '').toLowerCase();

          if (iconText === 'download' || ariaLabel.includes('download') || tooltip.includes('download')) {
            const inStudio = btn.closest('.studio-panel, section[class*="studio"], .artifact-panel, [class*="artifact"]');
            if (inStudio) return btn;
            if (candidates.length === 1) return btn;
          }
        }
      } catch (e) {
        // Selector might be invalid
      }
    }
    return null;
  }

  /**
   * Fallback: Scrape flashcard DOM and export as CSV.
   */
  function exportFlashcardsByScrapingCSV() {
    const cards = scrapeFlashcards();
    if (!cards || cards.length === 0) {
      toast('No flashcards found to export.');
      return;
    }

    const csvContent = cards.map(card => {
      const front = escapeCSV(card.front);
      const back = escapeCSV(card.back);
      return `"${front}","${back}"`;
    }).join('\n');

    showRenameModal('flashcards', 'csv', (filename) => {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      downloadFile(blob, filename);
      toast(`Exported ${cards.length} flashcards as CSV ✓`);
    });
  }

  // =========================================================================
  // FLASHCARDS EXPORT — TXT (Custom Scraping)
  // =========================================================================

  /**
   * Scrape flashcards from DOM and export as readable TXT.
   */
  function exportFlashcardsTXT() {
    log('Attempting custom TXT export via scraping...');

    if (!hasFlashcardsVisible()) {
      toast('No flashcards available to export.');
      return;
    }

    const cards = scrapeFlashcards();
    if (!cards || cards.length === 0) {
      toast('No flashcards found to export.');
      return;
    }

    const txtContent = cards.map((card, i) => {
      return `Card ${i + 1}\nFront: ${card.front}\nBack: ${card.back}\n---`;
    }).join('\n\n');

    showRenameModal('flashcards', 'txt', (filename) => {
      const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
      downloadFile(blob, filename);
      toast(`Exported ${cards.length} flashcards as TXT ✓`);
    });
  }

  // =========================================================================
  // FLASHCARD DOM SCRAPING HELPERS
  // =========================================================================

  /**
   * Check if flashcards are visibly present in the artifact panel.
   */
  function hasFlashcardsVisible() {
    const indicators = [
      '[data-artifact-type*="flashcard"]',
      '[data-artifact-type*="flash"]',
      '[class*="flashcard"]',
      '[class*="flash-card"]',
      '.study-card',
      '.quiz-card'
    ];
    for (const sel of indicators) {
      if (document.querySelector(sel)) return true;
    }

    const headers = document.querySelectorAll('.artifact-title, [class*="artifact"] h2, [class*="artifact"] h3, [class*="artifact-header"]');
    for (const h of headers) {
      if ((h.textContent || '').toLowerCase().includes('flashcard')) return true;
    }

    const downloadBtns = document.querySelectorAll('button[aria-label*="Download"], #download-btn');
    if (downloadBtns.length > 0) return true;

    return false;
  }

  /**
   * Scrape flashcard front/back pairs from the DOM.
   */
  function scrapeFlashcards() {
    const cards = [];

    const selectors = [
      { container: '.flashcard, .study-card, .quiz-card, [class*="flashcard"]', front: '.front, .question, [class*="front"], [class*="question"]', back: '.back, .answer, [class*="back"], [class*="answer"]' },
      { container: '[data-artifact-type*="flash"] .card, [data-artifact-type*="flash"] [class*="card"]', front: ':first-child', back: ':last-child' }
    ];

    for (const strat of selectors) {
      const containerEls = document.querySelectorAll(strat.container);
      if (containerEls.length > 0) {
        containerEls.forEach(el => {
          const frontEl = el.querySelector(strat.front);
          const backEl = el.querySelector(strat.back);
          if (frontEl && backEl) {
            const front = (frontEl.textContent || '').trim();
            const back = (backEl.textContent || '').trim();
            if (front || back) cards.push({ front, back });
          }
        });
        if (cards.length > 0) {
          log(`Scraped ${cards.length} flashcards via strategy`);
          return cards;
        }
      }
    }

    const rows = document.querySelectorAll('table[class*="flash"] tr, [class*="flashcard"] tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td, th');
      if (cells.length >= 2) {
        cards.push({
          front: (cells[0].textContent || '').trim(),
          back: (cells[1].textContent || '').trim()
        });
      }
    });
    if (cards.length > 0) {
      log(`Scraped ${cards.length} flashcards via table strategy`);
      return cards;
    }

    const container = document.querySelector('[data-artifact-type*="flash"], [class*="flashcard-list"], [class*="flash-cards"]');
    if (container) {
      const allText = container.querySelectorAll('p, div > span, li');
      const textBlocks = [];
      allText.forEach(el => {
        const t = (el.textContent || '').trim();
        if (t && t.length > 1) textBlocks.push(t);
      });
      for (let i = 0; i < textBlocks.length - 1; i += 2) {
        cards.push({ front: textBlocks[i], back: textBlocks[i + 1] });
      }
      if (cards.length > 0) {
        log(`Scraped ${cards.length} flashcards via text-pair strategy`);
        return cards;
      }
    }

    log('No flashcards found via any scraping strategy');
    return cards;
  }

  function escapeCSV(str) {
    if (!str) return '';
    return str.replace(/"/g, '""');
  }

  // =========================================================================
  // MIND MAP EXPORT
  // =========================================================================

  /**
   * Capture the mind map visualization as a PNG image.
   */
  function exportMindMap() {
    log('Starting mind map export...');

    const mindMapSelectors = [
      '[data-artifact-type*="mind"] .visualization-container',
      '[data-artifact-type*="mind-map"]',
      '[data-artifact-type*="mindmap"]',
      '[class*="mind-map"] canvas',
      '[class*="mind-map"]',
      '[class*="mindmap"]',
      'svg[class*="mind"]',
      '.graph-container',
      '.visualization-container'
    ];

    let mindMapEl = null;
    for (const sel of mindMapSelectors) {
      mindMapEl = document.querySelector(sel);
      if (mindMapEl) break;
    }

    if (!mindMapEl) {
      const headers = document.querySelectorAll('[class*="artifact"] h2, [class*="artifact"] h3, .artifact-title');
      for (const h of headers) {
        if ((h.textContent || '').toLowerCase().includes('mind map')) {
          mindMapEl = h.closest('[class*="artifact"]') || h.parentElement;
          break;
        }
      }
    }

    if (!mindMapEl) {
      toast('No mind map found. Generate one first.');
      return;
    }

    const spinner = mindMapEl.querySelector('.loading-spinner, [class*="loading"], .mat-progress-spinner, mat-spinner');
    if (spinner) {
      toast('Mind map is generating — try again soon.');
      return;
    }

    const svgEl = mindMapEl.tagName === 'svg' ? mindMapEl : mindMapEl.querySelector('svg');
    const overlay = showSpinnerOverlay(mindMapEl);

    if (svgEl && svgEl.querySelector('path, circle, rect, line, text')) {
      try {
        exportSVGAsPNG(svgEl, overlay);
        return;
      } catch (e) {
        log('SVG direct export failed, falling back to html2canvas:', e);
      }
    }

    if (typeof html2canvas === 'undefined') {
      removeSpinnerOverlay(overlay);
      toast('Export library not loaded. Please reload the page.');
      return;
    }

    const timeoutId = setTimeout(() => {
      removeSpinnerOverlay(overlay);
      toast('Mind map export timed out. Try with a smaller map.');
    }, 10000);

    html2canvas(mindMapEl, {
      scale: 2,
      backgroundColor: null,
      useCORS: true,
      logging: false,
      allowTaint: true
    }).then(canvas => {
      clearTimeout(timeoutId);
      removeSpinnerOverlay(overlay);

      canvas.toBlob(blob => {
        if (!blob) {
          toast('Failed to generate image.');
          return;
        }
        showRenameModal('mindmap', 'png', (filename) => {
          downloadFile(blob, filename);
          toast('Mind map exported as PNG ✓');
        });
      }, 'image/png');
    }).catch(err => {
      clearTimeout(timeoutId);
      removeSpinnerOverlay(overlay);
      console.error('[FoldNest Export] html2canvas error:', err);
      toast('Mind map export failed — check console.');
    });
  }

  /**
   * Export an SVG element as a high-res PNG.
   */
  function exportSVGAsPNG(svgEl, spinnerOverlay) {
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      removeSpinnerOverlay(spinnerOverlay);

      canvas.toBlob(blob => {
        if (!blob) {
          toast('Failed to generate image.');
          return;
        }
        showRenameModal('mindmap', 'png', (filename) => {
          downloadFile(blob, filename);
          toast('Mind map exported as PNG ✓');
        });
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      removeSpinnerOverlay(spinnerOverlay);
      toast('SVG export failed — try again.');
    };
    img.src = url;
  }

  /**
   * Show a spinner overlay on the target element during mind map capture.
   */
  function showSpinnerOverlay(targetEl) {
    const overlay = document.createElement('div');
    overlay.className = 'plugin-export-spinner-overlay';
    overlay.innerHTML = `
      <div class="plugin-export-spinner"></div>
      <span style="margin-top:8px;font-size:13px;color:var(--plugin-text-secondary);">Capturing mind map...</span>
    `;
    const rect = targetEl.getBoundingClientRect();
    overlay.style.cssText = `
      position:fixed;top:${rect.top}px;left:${rect.left}px;
      width:${rect.width}px;height:${rect.height}px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.3);border-radius:8px;z-index:10003;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function removeSpinnerOverlay(overlay) {
    if (overlay && overlay.parentNode) overlay.remove();
  }

  // =========================================================================
  // STUDIO PANEL BUTTON INJECTION (FIXED — stable selectors + aggressive retry)
  // =========================================================================

  let exportButtonInjected = false;
  let panelObserver = null;
  let retryTimer = null;
  let retryCount = 0;
  const MAX_RETRIES = 15;
  const RETRY_INTERVAL_MS = 800;

  /**
   * Initialize the artifacts export feature.
   * Uses aggressive retry polling + MutationObserver for reliable injection.
   */
  function initArtifactsExport() {
    console.log('[FoldNest Export] === initArtifactsExport() called ===');

    // Try immediate injection
    if (tryInjectExportButton()) {
      console.log('[FoldNest Export] Immediate injection succeeded');
      return;
    }

    // Start aggressive retry polling
    retryCount = 0;
    console.log('[FoldNest Export] Starting retry polling (every ' + RETRY_INTERVAL_MS + 'ms, max ' + MAX_RETRIES + ' attempts)');
    retryTimer = setInterval(() => {
      retryCount++;
      console.log('[FoldNest Export] Retry attempt ' + retryCount + '/' + MAX_RETRIES);

      if (tryInjectExportButton()) {
        console.log('[FoldNest Export] Injection succeeded on retry #' + retryCount);
        clearInterval(retryTimer);
        retryTimer = null;
        return;
      }

      if (retryCount >= MAX_RETRIES) {
        console.warn('[FoldNest Export] Max retries reached (' + MAX_RETRIES + '). Button NOT injected. Studio panel may not be open.');
        clearInterval(retryTimer);
        retryTimer = null;
      }
    }, RETRY_INTERVAL_MS);

    // Also watch for DOM changes (SPA navigation, panel open/close, late render)
    if (panelObserver) {
      panelObserver.disconnect();
    }
    panelObserver = new MutationObserver(() => {
      // Check if button was removed (SPA re-rendered the panel)
      if (exportButtonInjected && !document.querySelector('.plugin-export-btn')) {
        console.log('[FoldNest Export] Button was removed from DOM (SPA re-render), re-injecting...');
        exportButtonInjected = false;
      }

      if (!exportButtonInjected) {
        if (tryInjectExportButton()) {
          console.log('[FoldNest Export] MutationObserver triggered successful injection');
        }
      }
    });
    panelObserver.observe(document.body, { childList: true, subtree: true });
    console.log('[FoldNest Export] MutationObserver active on document.body (subtree: true)');
  }

  /**
   * Try to find the Studio panel header and inject the export button.
   * Returns true if injection succeeded, false otherwise.
   */
  function tryInjectExportButton() {
    // Check if already injected
    const existingBtn = document.querySelector('.plugin-export-btn');
    if (existingBtn) {
      console.log('[FoldNest Export] Button already exists? true — skipping');
      exportButtonInjected = true;
      return true;
    }
    console.log('[FoldNest Export] Button already exists? false');

    // Step 1: Find .panel-header elements
    const panelHeaders = document.querySelectorAll('.panel-header');
    console.log('[FoldNest Export] Searching for .panel-header — found: ' + panelHeaders.length);

    // Step 2: Find the Studio span using stable selectors
    const studioSpan = findStudioSpan();
    if (!studioSpan) {
      console.log('[FoldNest Export] Studio span NOT found yet');
      return false;
    }
    console.log('[FoldNest Export] Found header, checking span');
    console.log('[FoldNest Export] Studio span found, text = "' + studioSpan.textContent.trim() + '"');

    // Step 3: Navigate up to get the h2 and panel-header div
    // Live DOM: div.panel-header > h2.panel-header-content > span{Studio}
    const h2 = studioSpan.closest('h2');
    if (!h2) {
      console.log('[FoldNest Export] Could not find parent h2 of Studio span');
      return false;
    }
    console.log('[FoldNest Export] Found h2 parent, class = "' + h2.className + '"');

    // The panel-header is the h2's parent div (NOT h2 itself)
    const panelHeader = h2.parentElement;
    if (!panelHeader) {
      console.log('[FoldNest Export] h2 has no parentElement');
      return false;
    }
    console.log('[FoldNest Export] Panel header div found, class = "' + panelHeader.className + '"');

    // Step 4: Inject the button
    console.log('[FoldNest Export] Attempting injection...');
    try {
      injectExportButton(h2, panelHeader);
      exportButtonInjected = true;
      console.log('[FoldNest Export] ✅ Injection succeeded! Button should now be visible.');
      return true;
    } catch (e) {
      console.error('[FoldNest Export] ❌ Injection failed:', e);
      return false;
    }
  }

  /**
   * Find the <span> containing "Studio" text in a panel header.
   * Uses stable class selectors derived from the live DOM:
   *   div.panel-header > h2.panel-header-content > span
   */
  function findStudioSpan() {
    // Strategy 1: Most precise — use stable classes from live DOM
    const spans1 = document.querySelectorAll('.panel-header > h2.panel-header-content > span');
    console.log('[FoldNest Export] Strategy 1 (.panel-header > h2.panel-header-content > span): ' + spans1.length + ' spans');
    for (const span of spans1) {
      const text = span.textContent.trim();
      console.log('[FoldNest Export]   span text: "' + text + '"');
      if (text === 'Studio') return span;
    }

    // Strategy 2: Slightly looser — any h2 > span inside .panel-header
    const h2s = document.querySelectorAll('.panel-header > h2');
    console.log('[FoldNest Export] Strategy 2 (.panel-header > h2): ' + h2s.length + ' h2 elements');
    for (const h2 of h2s) {
      const spans = h2.querySelectorAll(':scope > span');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text === 'Studio') {
          console.log('[FoldNest Export]   Found "Studio" via Strategy 2');
          return span;
        }
      }
    }

    // Strategy 3: Broadest — any span with text "Studio" that's inside an h2
    console.log('[FoldNest Export] Strategy 3: broad span search...');
    const allH2Spans = document.querySelectorAll('h2 > span');
    for (const span of allH2Spans) {
      if (span.textContent.trim() === 'Studio') {
        console.log('[FoldNest Export]   Found "Studio" via Strategy 3 (h2 > span)');
        return span;
      }
    }

    // Strategy 4: Absolute broadest — any span anywhere
    const everySpan = document.querySelectorAll('span');
    for (const span of everySpan) {
      if (span.textContent.trim() === 'Studio' && span.closest('.panel-header, h2')) {
        console.log('[FoldNest Export]   Found "Studio" via Strategy 4 (broad + closest check)');
        return span;
      }
    }

    return null;
  }

  /**
   * Create and inject the export button into the panel header.
   * Places it between the <h2> and the toggle-studio-panel-button.
   */
  function injectExportButton(h2El, panelHeader) {
    const btn = document.createElement('button');
    btn.className = 'plugin-export-btn';
    btn.setAttribute('aria-label', 'Export artifacts');
    btn.setAttribute('title', 'Export Artifacts');
    btn.setAttribute('tabindex', '0');
    // Force essential visibility with inline styles as safety net
    btn.style.cssText = 'display:inline-flex !important;visibility:visible !important;opacity:1 !important;';

    // Material Symbols icon — matches NotebookLM's icon style
    const icon = document.createElement('mat-icon');
    icon.className = 'mat-icon notranslate material-symbols-outlined google-symbols mat-icon-no-color';
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('data-mat-icon-type', 'font');
    icon.textContent = 'download';
    icon.style.cssText = 'font-size:20px;pointer-events:none;';
    btn.appendChild(icon);

    // Add label text
    const label = document.createElement('span');
    label.className = 'plugin-export-btn-label';
    label.textContent = 'Download';
    btn.appendChild(label);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showExportDropdown(btn);
    });

    // Keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showExportDropdown(btn);
      }
    });

    // Find the dock/collapse button to insert before it
    // Live DOM: <button class="... toggle-studio-panel-button ..."> with dock_to_left icon
    const dockBtn = panelHeader.querySelector('.toggle-studio-panel-button');
    console.log('[FoldNest Export] Dock button found? ' + !!dockBtn);

    if (dockBtn) {
      // Insert right before the dock button
      console.log('[FoldNest Export] Inserting before .toggle-studio-panel-button (aria-label: "' + (dockBtn.getAttribute('aria-label') || '') + '")');
      panelHeader.insertBefore(btn, dockBtn);
    } else if (h2El.nextElementSibling) {
      // Insert after h2, before whatever comes next
      console.log('[FoldNest Export] Inserting before h2.nextElementSibling');
      panelHeader.insertBefore(btn, h2El.nextElementSibling);
    } else {
      // Fallback: append to header
      console.log('[FoldNest Export] Appending to panelHeader (fallback)');
      panelHeader.appendChild(btn);
    }

    // Verify injection
    const check = document.querySelector('.plugin-export-btn');
    console.log('[FoldNest Export] Post-injection check — button in DOM: ' + !!check);
    if (check) {
      const rect = check.getBoundingClientRect();
      console.log('[FoldNest Export] Button rect: top=' + Math.round(rect.top) + ' left=' + Math.round(rect.left) + ' w=' + Math.round(rect.width) + ' h=' + Math.round(rect.height));
      if (rect.width === 0 || rect.height === 0) {
        console.warn('[FoldNest Export] ⚠️ Button has zero dimensions — may be hidden by CSS. Forcing layout.');
        check.style.cssText = 'display:inline-flex !important;visibility:visible !important;opacity:1 !important;width:36px !important;height:36px !important;align-items:center;justify-content:center;';
      }
    }
  }

  // =========================================================================
  // MAIN INIT
  // =========================================================================

  function init() {
    console.log('[FoldNest Export] === init() called ===');
    console.log('[FoldNest Export] Current URL:', window.location.href);
    console.log('[FoldNest Export] Pathname:', window.location.pathname);

    // Only run in notebook mode (not dashboard)
    const path = window.location.pathname;
    if (path === '/' || path === '') {
      console.log('[FoldNest Export] On dashboard, skipping artifact export init');
      return;
    }

    initArtifactsExport();
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  window.FoldNestExport = {
    init,
    exportFlashcardsCSV,
    exportFlashcardsTXT,
    exportMindMap,
    closeActiveDropdown
  };

  console.log('[FoldNest Export] Export module loaded');
})();

// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

// i18n System
let currentLang = 'de';
let translations = {};
let currentDialogFilePath = '';

// File selection dialog state
let availableFiles = [];
let selectedPaths = new Set();

// Custom dropdown instances (sort + language), built on DOMContentLoaded.
let sortSelectInstance = null;
let languageInstance = null;

// Theme System (dark is the default)
const THEME_META_COLORS = { dark: '#0a0c12', light: '#eef1f7' };

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META_COLORS[theme] || THEME_META_COLORS.dark);
    updateThemeToggleLabel();
}

function toggleTheme() {
    const next = getCurrentTheme() === 'light' ? 'dark' : 'light';
    try {
        localStorage.setItem('dovi_theme', next);
    } catch (e) { /* localStorage unavailable -> theme just won't persist */ }
    applyTheme(next);
}

function updateThemeToggleLabel() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const label = t(getCurrentTheme() === 'light' ? 'theme_toggle_dark' : 'theme_toggle_light');
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
    const hiddenLabel = document.getElementById('themeToggleLabel');
    if (hiddenLabel) hiddenLabel.textContent = label;
}

function initTheme() {
    let saved = null;
    try {
        saved = localStorage.getItem('dovi_theme');
    } catch (e) { /* localStorage unavailable -> keep default */ }
    applyTheme(saved === 'light' ? 'light' : 'dark');
}

async function loadTranslations(lang) {
    try {
        const response = await fetch(`/static/locale/${lang}.json`);
        if (!response.ok) throw new Error('Translation file not found');
        translations = await response.json();
        return true;
    } catch (error) {
        console.error('Error loading translations:', error);
        return false;
    }
}

function t(key, replacements = {}) {
    let text = translations[key] || key;
    for (const [placeholder, value] of Object.entries(replacements)) {
        text = text.replace(`{${placeholder}}`, value);
    }
    return text;
}

function applyTranslations() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) {
            // For option elements, set text property; for others, set textContent
            if (el.tagName === 'OPTION') {
                el.text = translations[key];
            } else {
                el.textContent = translations[key];
            }
        }
    });
    
    // HTML content
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (translations[key]) el.innerHTML = translations[key];
    });
    
    // Placeholder attributes
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[key]) el.placeholder = translations[key];
    });
    
    // Data labels
    document.querySelectorAll('[data-label-i18n]').forEach(el => {
        const key = el.getAttribute('data-label-i18n');
        if (translations[key]) el.setAttribute('data-label', translations[key]);
    });
    
    // Aria labels
    document.querySelectorAll('[data-aria-label-i18n]').forEach(el => {
        const key = el.getAttribute('data-aria-label-i18n');
        if (translations[key]) el.setAttribute('aria-label', translations[key]);
    });
    
    // Refresh the sort dropdown so its option labels follow the active language.
    if (sortSelectInstance) sortSelectInstance.refresh();

    updateLanguageButtons();
    updateThemeToggleLabel();
}

function updateLanguageButtons() {
    // Keep the language dropdown in sync with the active language,
    // otherwise it falls back to the hardcoded default after a reload.
    if (languageInstance) languageInstance.setValue(currentLang);
}

async function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('dovi_language', lang);
    document.documentElement.lang = lang;
    const loaded = await loadTranslations(lang);
    if (loaded) {
        applyTranslations();
        loadFileList(); // Update dropdown
    }
}

async function initLanguage() {
    const savedLang = localStorage.getItem('dovi_language') || 'de';
    currentLang = savedLang;
    document.documentElement.lang = savedLang;
    await loadTranslations(savedLang);
    applyTranslations();
}

// File-list loading, the multi-select scan dialog, and the sorting/search
// logic below drive the scan controls and the media table.

function loadFileList() {
    return fetch('/get_files')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                availableFiles = data.files || [];

                // Drop selections whose files have vanished (e.g. after a scan
                // reload or deletion) so the selection stays valid.
                const existing = new Set(availableFiles.map(f => f.path));
                selectedPaths.forEach(p => {
                    if (!existing.has(p)) selectedPaths.delete(p);
                });

                updateFileTriggerLabel();

                // Keep the dialog in sync if it is currently open.
                if (isFileDialogOpen()) {
                    renderFileDialogList();
                }
            }
        })
        .catch(error => {
            console.error('Error loading file list:', error);
        });
}

// Refresh the trigger button: show how many files are selected, or the
// placeholder when nothing is chosen yet.
function updateFileTriggerLabel() {
    const label = document.getElementById('fileSelectLabel');
    const trigger = document.getElementById('fileSelectTrigger');
    if (!label || !trigger) return;

    const count = selectedPaths.size;
    if (count > 0) {
        label.textContent = t('files_selected', { count: count });
        trigger.classList.add('has-selection');
    } else {
        label.textContent = t('select_file');
        trigger.classList.remove('has-selection');
    }
}

function isFileDialogOpen() {
    const overlay = document.getElementById('fileDialogOverlay');
    return overlay && overlay.classList.contains('active');
}

function openFileDialog() {
    const overlay = document.getElementById('fileDialogOverlay');
    if (!overlay) return;

    const search = document.getElementById('fileDialogSearch');
    if (search) search.value = '';

    renderFileDialogList();

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Focus the search field for quick filtering.
    if (search) {
        setTimeout(() => search.focus(), 50);
    }
}

function closeFileDialog(event) {
    if (event) event.stopPropagation();
    const overlay = document.getElementById('fileDialogOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// Files currently visible in the dialog (honouring the search filter).
function getFilteredFiles() {
    const searchEl = document.getElementById('fileDialogSearch');
    const term = (searchEl ? searchEl.value : '').trim().toLowerCase();
    return term
        ? availableFiles.filter(f => f.name.toLowerCase().includes(term))
        : availableFiles.slice();
}

// Build the grouped, multi-selectable file list (unscanned first, then
// scanned), honouring the current search filter.
function renderFileDialogList() {
    const list = document.getElementById('fileDialogList');
    if (!list) return;

    const filtered = getFilteredFiles();

    list.innerHTML = '';

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'file-dialog-empty';
        empty.textContent = t('file_dialog_empty');
        list.appendChild(empty);
        updateScanSelectedButton();
        return;
    }

    const unscanned = filtered.filter(f => !f.scanned);
    const scanned = filtered.filter(f => f.scanned);

    if (unscanned.length > 0) {
        list.appendChild(buildFileGroup(t('files_unscanned'), unscanned, false));
    }
    if (scanned.length > 0) {
        list.appendChild(buildFileGroup(t('files_scanned'), scanned, true));
    }

    updateScanSelectedButton();
}

function buildFileGroup(titleText, files, scanned) {
    const group = document.createElement('div');
    group.className = 'file-group';

    const header = document.createElement('div');
    header.className = 'file-group-header';

    const heading = document.createElement('span');
    heading.className = 'file-group-title';
    heading.textContent = titleText;

    const count = document.createElement('span');
    count.className = 'file-group-count';
    count.textContent = files.length;

    header.appendChild(heading);
    header.appendChild(count);
    group.appendChild(header);

    files.forEach(file => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'file-item' + (scanned ? ' scanned' : ' unscanned');
        item.setAttribute('data-path', file.path);
        item.setAttribute('role', 'checkbox');
        const isChecked = selectedPaths.has(file.path);
        item.setAttribute('aria-checked', isChecked ? 'true' : 'false');
        if (isChecked) item.classList.add('selected');

        // Custom checkbox (selection state)
        const checkbox = document.createElement('span');
        checkbox.className = 'file-item-checkbox';
        checkbox.setAttribute('aria-hidden', 'true');
        checkbox.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

        const name = document.createElement('span');
        name.className = 'file-item-name';
        name.textContent = file.name;
        name.title = file.name;

        // Scan-status badge on the right
        const status = document.createElement('span');
        status.className = 'file-item-status';
        status.setAttribute('aria-hidden', 'true');
        status.title = scanned ? t('files_scanned') : t('files_unscanned');
        if (scanned) {
            status.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        }

        item.appendChild(checkbox);
        item.appendChild(name);
        item.appendChild(status);
        item.addEventListener('click', () => toggleFileSelection(file.path, item));

        group.appendChild(item);
    });

    return group;
}

function toggleFileSelection(path, item) {
    if (selectedPaths.has(path)) {
        selectedPaths.delete(path);
        item.classList.remove('selected');
        item.setAttribute('aria-checked', 'false');
    } else {
        selectedPaths.add(path);
        item.classList.add('selected');
        item.setAttribute('aria-checked', 'true');
    }
    updateScanSelectedButton();
    updateFileTriggerLabel();
}

// Select every file currently visible in the dialog.
function selectAllFiles() {
    getFilteredFiles().forEach(f => selectedPaths.add(f.path));
    renderFileDialogList();
    updateFileTriggerLabel();
}

// Deselect every file currently visible in the dialog.
function deselectAllFiles() {
    getFilteredFiles().forEach(f => selectedPaths.delete(f.path));
    renderFileDialogList();
    updateFileTriggerLabel();
}

// Keep the primary "scan selected" button label and enabled state in sync.
function updateScanSelectedButton() {
    const btn = document.getElementById('fileScanSelected');
    if (!btn) return;
    const count = selectedPaths.size;
    btn.textContent = count > 0
        ? `${t('scan_selected')} (${count})`
        : t('scan_selected');
    btn.disabled = count === 0;
}

// Scan all currently selected files. Progress is streamed back over SSE and
// handled by setupSSE(), which drives the progress bar and reloads on done.
function scanSelectedFiles() {
    if (selectedPaths.size === 0) return;

    const paths = Array.from(selectedPaths);
    const message = document.getElementById('message');
    const scanProgress = document.getElementById('scanProgress');
    const scanProgressBar = document.getElementById('scanProgressBar');
    const scanProgressText = document.getElementById('scanProgressText');

    closeFileDialog();

    if (message) message.style.display = 'none';

    // Show progress bar at 0%
    if (scanProgress) {
        if (scanProgressBar) scanProgressBar.style.width = '0%';
        if (scanProgressText) scanProgressText.textContent = '0%';
        scanProgress.style.display = 'inline-flex';
    }

    fetch(`/scan_files?lang=${currentLang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_paths: paths })
    })
        .then(response => {
            if (!response.ok) throw new Error('Server error');
            return response.json();
        })
        .then(data => {
            // Scan runs in the background - progress arrives via SSE.
            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }
        })
        .catch(error => {
            if (scanProgress) scanProgress.style.display = 'none';
            console.error(error);
            if (!message) return;
            message.className = 'message error';
            setMessageContent(message, 'error', t('scan_error'));
            message.style.display = 'block';
        });
}

/* -------------------------------
   Custom Dropdowns (sort + language)
   ------------------------------- */

// Small stroke-based icons (24x24) that match the rest of the UI. Several sort
// modes intentionally share an icon (all profile* -> film, audio* -> volume).
const SVG_ATTR = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SORT_ICONS = {
    file:     `<svg viewBox="0 0 24 24" ${SVG_ATTR}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    drive:    `<svg viewBox="0 0 24 24" ${SVG_ATTR}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`,
    inbox:    `<svg viewBox="0 0 24 24" ${SVG_ATTR}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
    star:     `<svg viewBox="0 0 24 24" ${SVG_ATTR}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" ${SVG_ATTR}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    clock:    `<svg viewBox="0 0 24 24" ${SVG_ATTR}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`,
    film:     `<svg viewBox="0 0 24 24" ${SVG_ATTR}><rect x="2.5" y="3" width="19" height="18" rx="2"/><line x1="7" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><line x1="2.5" y1="12" x2="21.5" y2="12"/><line x1="2.5" y1="7.5" x2="7" y2="7.5"/><line x1="17" y1="7.5" x2="21.5" y2="7.5"/><line x1="2.5" y1="16.5" x2="7" y2="16.5"/><line x1="17" y1="16.5" x2="21.5" y2="16.5"/></svg>`,
    volume:   `<svg viewBox="0 0 24 24" ${SVG_ATTR}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
    monitor:  `<svg viewBox="0 0 24 24" ${SVG_ATTR}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    target:   `<svg viewBox="0 0 24 24" ${SVG_ATTR}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>`
};

const SORT_OPTIONS = [
    { value: 'filename',             i18n: 'sort_by_filename',             icon: 'file' },
    { value: 'filesize',             i18n: 'sort_by_filesize',             icon: 'drive' },
    { value: 'added',                i18n: 'sort_by_added',                icon: 'inbox' },
    { value: 'rating',               i18n: 'sort_by_rating',               icon: 'star' },
    { value: 'year',                 i18n: 'sort_by_year',                 icon: 'calendar' },
    { value: 'duration',             i18n: 'sort_by_duration',             icon: 'clock' },
    { value: 'profile',              i18n: 'sort_by_profile',              icon: 'film' },
    { value: 'profile_audio',        i18n: 'sort_by_profile_audio',        icon: 'film' },
    { value: 'profile_videobitrate', i18n: 'sort_by_profile_videobitrate', icon: 'film' },
    { value: 'profile_audiobitrate', i18n: 'sort_by_profile_audiobitrate', icon: 'film' },
    { value: 'audio',                i18n: 'sort_by_audio',                icon: 'volume' },
    { value: 'audio_audiobitrate',   i18n: 'sort_by_audio_audiobitrate',   icon: 'volume' },
    { value: 'videobitrate',         i18n: 'sort_by_videobitrate',         icon: 'monitor' },
    { value: 'audiobitrate',         i18n: 'sort_by_audiobitrate',         icon: 'volume' },
    { value: 'cm_version',           i18n: 'sort_by_cm_version',           icon: 'target' }
];

// Simplified inline SVG flags (20x14) for the language switcher.
const FLAG_SVGS = {
    de: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#000"/><rect y="4.67" width="20" height="4.67" fill="#D00"/><rect y="9.33" width="20" height="4.67" fill="#FFCE00"/></svg>',
    en: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#B22234"/><g fill="#fff"><rect y="2" width="20" height="2"/><rect y="6" width="20" height="2"/><rect y="10" width="20" height="2"/></g><rect width="9" height="8" fill="#3C3B6E"/></svg>',
    fr: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#0055A4"/><rect x="13.33" width="6.67" height="14" fill="#EF4135"/></svg>',
    es: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#AA151B"/><rect y="3.5" width="20" height="7" fill="#F1BF00"/></svg>',
    it: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#009246"/><rect x="13.33" width="6.67" height="14" fill="#CE2B37"/></svg>',
    pt: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#F00"/><rect width="8" height="14" fill="#060"/><circle cx="8" cy="7" r="2.2" fill="#FC0" stroke="#fff" stroke-width="0.4"/></svg>',
    nl: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#fff"/><rect width="20" height="4.67" fill="#AE1C28"/><rect y="9.33" width="20" height="4.67" fill="#21468B"/></svg>',
    pl: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#DC143C"/><rect width="20" height="7" fill="#fff"/></svg>',
    ru: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#fff"/><rect y="4.67" width="20" height="4.67" fill="#0039A6"/><rect y="9.33" width="20" height="4.67" fill="#D52B1E"/></svg>',
    tr: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#E30A17"/><circle cx="8" cy="7" r="3" fill="#fff"/><circle cx="9" cy="7" r="2.4" fill="#E30A17"/><polygon points="14.6,7 13.52,6.62 13.49,5.48 12.8,6.39 11.71,6.06 12.36,7 11.71,7.94 12.8,7.61 13.49,8.52 13.52,7.38" fill="#fff"/></svg>',
    zh: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#DE2910"/><polygon points="5,2.5 5.9,5.2 8.7,5.2 6.4,6.9 7.3,9.6 5,7.9 2.7,9.6 3.6,6.9 1.3,5.2 4.1,5.2" fill="#FFDE00"/></svg>'
};

const LANG_OPTIONS = [
    { value: 'de', label: 'DE' },
    { value: 'en', label: 'EN' },
    { value: 'fr', label: 'FR' },
    { value: 'es', label: 'ES' },
    { value: 'it', label: 'IT' },
    { value: 'pt', label: 'PT' },
    { value: 'nl', label: 'NL' },
    { value: 'pl', label: 'PL' },
    { value: 'ru', label: 'RU' },
    { value: 'tr', label: 'TR' },
    { value: 'zh', label: '中文' }
];

// Registry so an outside click / Escape can close every open dropdown.
const _customSelects = [];
function closeAllCustomSelects(except) {
    _customSelects.forEach(s => { if (s !== except) s.close(); });
}
document.addEventListener('click', e => {
    _customSelects.forEach(s => { if (!s.wrap.contains(e.target)) s.close(); });
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllCustomSelects();
});

// Build an accessible custom dropdown that mirrors a native <select> but lets
// each option carry an inline SVG icon (impossible with real <option>s).
function buildCustomSelect(cfg) {
    const wrap = document.getElementById(cfg.wrapId);
    const trigger = document.getElementById(cfg.triggerId);
    const current = document.getElementById(cfg.currentId);
    const menu = document.getElementById(cfg.menuId);
    if (!wrap || !trigger || !current || !menu) return null;

    let value = cfg.initialValue;

    function innerHTMLFor(opt) {
        return `<span class="custom-select-opt-icon">${cfg.iconFor(opt)}</span>` +
               `<span class="custom-select-opt-label"></span>`;
    }
    function fillLabel(el, opt) {
        const labelEl = el.querySelector('.custom-select-opt-label');
        if (labelEl) labelEl.textContent = cfg.labelFor(opt);
    }

    function renderCurrent() {
        const opt = cfg.options.find(o => o.value === value) || cfg.options[0];
        current.innerHTML = innerHTMLFor(opt);
        fillLabel(current, opt);
    }

    function renderMenu() {
        menu.innerHTML = '';
        cfg.options.forEach(opt => {
            const li = document.createElement('li');
            li.className = 'custom-select-option' + (opt.value === value ? ' selected' : '');
            li.setAttribute('role', 'option');
            li.setAttribute('data-value', opt.value);
            li.setAttribute('aria-selected', opt.value === value ? 'true' : 'false');
            li.innerHTML = innerHTMLFor(opt);
            fillLabel(li, opt);
            li.addEventListener('click', () => { select(opt.value); close(); });
            menu.appendChild(li);
        });
    }

    function open() {
        closeAllCustomSelects(api);
        wrap.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
    }
    function close() {
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }
    function toggle() { wrap.classList.contains('open') ? close() : open(); }

    function select(v, silent) {
        value = v;
        renderCurrent();
        menu.querySelectorAll('.custom-select-option').forEach(li => {
            const sel = li.getAttribute('data-value') === v;
            li.classList.toggle('selected', sel);
            li.setAttribute('aria-selected', sel ? 'true' : 'false');
        });
        if (!silent && cfg.onSelect) cfg.onSelect(v);
    }

    trigger.addEventListener('click', e => { e.stopPropagation(); toggle(); });

    renderMenu();
    renderCurrent();

    const api = {
        wrap,
        close,
        getValue: () => value,
        setValue: v => select(v, true),
        refresh: () => { renderMenu(); renderCurrent(); }
    };
    _customSelects.push(api);
    return api;
}

function initCustomSelects() {
    sortSelectInstance = buildCustomSelect({
        wrapId: 'sortSelectWrap',
        triggerId: 'sortSelectTrigger',
        currentId: 'sortSelectCurrent',
        menuId: 'sortSelectMenu',
        options: SORT_OPTIONS,
        initialValue: localStorage.getItem('dovi_sort_mode') || 'filename',
        iconFor: opt => SORT_ICONS[opt.icon] || '',
        labelFor: opt => t(opt.i18n),
        onSelect: v => {
            localStorage.setItem('dovi_sort_mode', v);
            applySort(v);
        }
    });

    languageInstance = buildCustomSelect({
        wrapId: 'languageWrap',
        triggerId: 'languageTrigger',
        currentId: 'languageCurrent',
        menuId: 'languageMenu',
        options: LANG_OPTIONS,
        initialValue: currentLang,
        iconFor: opt => FLAG_SVGS[opt.value] || '',
        labelFor: opt => opt.label,
        onSelect: v => setLanguage(v)
    });
}

/* -------------------------------
   New Sorting Logic (client-side)
   ------------------------------- */

// Real-time search function
function searchMedia() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const rows = document.querySelectorAll('#mediaTable tbody tr');
    
    let visibleRowCount = 0;
    
    rows.forEach(row => {
        // Get searchable content from specific cells only
        const posterCell = row.querySelector('td:nth-child(1)');
        const hdrCell = row.querySelector('td:nth-child(2)');
        const audioCell = row.querySelector('td:nth-child(3)');
        const resolutionCell = row.querySelector('td:nth-child(4)');
        
        // Build searchable text from relevant content
        let searchableText = '';
        
        // From poster cell: get title or filename
        if (posterCell) {
            const posterTitle = posterCell.querySelector('.poster-title');
            const filenameFallback = posterCell.querySelector('.filename-fallback');
            if (posterTitle) {
                searchableText += posterTitle.textContent + ' ';
            } else if (filenameFallback) {
                searchableText += filenameFallback.textContent + ' ';
            } else {
                // Fallback to title attribute
                const title = posterCell.getAttribute('title');
                if (title) searchableText += title + ' ';
            }
        }
        
        // From other cells: get text content
        if (hdrCell) searchableText += hdrCell.textContent + ' ';
        if (resolutionCell) searchableText += resolutionCell.textContent + ' ';
        if (audioCell) searchableText += audioCell.textContent + ' ';
        
        // Check if search term is in the searchable text
        const isVisible = searchableText.toLowerCase().includes(searchTerm);
        row.style.display = isVisible ? '' : 'none';
        
        if (isVisible) {
            visibleRowCount++;
        }
    });
    
    // Handle table header and no-results message visibility
    const table = document.getElementById('mediaTable');
    const thead = table ? table.querySelector('thead') : null;
    
    if (searchTerm && visibleRowCount === 0) {
        // Hide table header when no results
        if (thead) {
            thead.style.display = 'none';
        }
        
        // Show or create no-results message
        let noResultsMsg = document.getElementById('search-no-results');
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('div');
            noResultsMsg.id = 'search-no-results';
            noResultsMsg.className = 'empty-state';
            
            const heading = document.createElement('h2');
            heading.textContent = t('search_no_results');
            noResultsMsg.appendChild(heading);
            
            // Insert after the table
            if (table && table.parentNode) {
                table.parentNode.insertBefore(noResultsMsg, table.nextSibling);
            }
        }
        noResultsMsg.style.display = 'block';
    } else {
        // Show table header when there are results or no search term
        if (thead) {
            thead.style.display = '';
        }
        
        // Hide no-results message
        const noResultsMsg = document.getElementById('search-no-results');
        if (noResultsMsg) {
            noResultsMsg.style.display = 'none';
        }
    }
    
    // Update clear button visibility
    updateClearButton();
    // Update profile stats based on visible rows
    updateProfileStats();
}

// Clear search function
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    searchMedia(); // Re-run search to show all rows
}

// Update clear button visibility
function updateClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');
    if (clearBtn) {
        clearBtn.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
    }
}

// Update profile statistics
function updateProfileStats() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const visibleRows = rows.filter(row => row.style.display !== 'none');
    
    const stats = {
        FEL: 0,
        MEL: 0,
        'Profile 8': 0,
        'Profile 5': 0,
        'HDR10+': 0,
        'SL-HDR': 0,
        'HDR Vivid': 0,
        'HDR10': 0,
        'HLG': 0,
        'SDR': 0
    };
    
    visibleRows.forEach(row => {
        const elType = (row.getAttribute('data-el-type') || '').toUpperCase();
        const hdrFormat = (row.getAttribute('data-hdr-format') || '').toLowerCase();
        const hdrDetail = (row.getAttribute('data-hdr-detail') || '').toLowerCase();
        
        // Check for FEL or MEL
        if (elType === 'FEL') {
            stats.FEL++;
        } else if (elType === 'MEL') {
            stats.MEL++;
        } 
        // Check for Profile 8
        else if (
            hdrDetail.includes('profile 8') ||
            hdrDetail.includes('profile8') ||
            hdrDetail.includes('p8') ||
            hdrFormat.includes('profile 8') ||
            hdrFormat.includes('p8')
        ) {
            stats['Profile 8']++;
        }
        // Check for Profile 5
        else if (
            hdrDetail.includes('profile 5') ||
            hdrDetail.includes('profile5') ||
            hdrDetail.includes('p5')
        ) {
            stats['Profile 5']++;
        }
        // Check for HDR10+ (must check before HDR10 to avoid false matches)
        else if (
            hdrFormat.includes('hdr10+') ||
            hdrDetail.includes('hdr10+') ||
            hdrFormat.includes('hdr10plus') ||
            hdrDetail.includes('hdr10plus')
        ) {
            stats['HDR10+']++;
        }
        // Check for SL-HDR1 / SL-HDR2 / SL-HDR3
        else if (hdrFormat.includes('sl-hdr') || hdrDetail.includes('sl-hdr')) {
            stats['SL-HDR']++;
        }
        // Check for HDR Vivid
        else if (hdrFormat.includes('vivid') || hdrDetail.includes('vivid')) {
            stats['HDR Vivid']++;
        }
        // Check for HDR10 (but not HDR10+) - explicitly exclude HDR10+
        else if (
            (hdrFormat.includes('hdr10') ||
             hdrDetail.includes('hdr10') ||
             hdrFormat.includes('smpte2084')) &&
            !hdrFormat.includes('hdr10+') &&
            !hdrDetail.includes('hdr10+') &&
            !hdrFormat.includes('hdr10plus') &&
            !hdrDetail.includes('hdr10plus')
        ) {
            stats['HDR10']++;
        }
        // Check for HLG
        else if (hdrFormat.includes('hlg') || hdrDetail.includes('hlg')) {
            stats['HLG']++;
        }
        // Check for SDR
        else if (hdrFormat.includes('sdr') || hdrDetail.includes('sdr')) {
            stats['SDR']++;
        }
    });
    
    // Build stat chips (only show profiles with at least 1 title)
    const chipOrder = [
        ['FEL', stats.FEL],
        ['MEL', stats.MEL],
        ['P8', stats['Profile 8']],
        ['P5', stats['Profile 5']],
        ['HDR10+', stats['HDR10+']],
        ['SL-HDR', stats['SL-HDR']],
        ['HDR Vivid', stats['HDR Vivid']],
        ['HDR10', stats['HDR10']],
        ['HLG', stats['HLG']],
        ['SDR', stats['SDR']]
    ];
    const statsArray = chipOrder
        .filter(([, count]) => count > 0)
        .map(([label, count]) => `<span class="stat-chip">${label} <strong>${count}</strong></span>`);
    const profileStatsElement = document.getElementById('profileStats');
    if (profileStatsElement) {
        profileStatsElement.innerHTML = statsArray.join('');
    }
}

function getProfileRank(hdrFormat, hdrDetail, elType) {
    // Normalize strings
    const f = (hdrFormat || '').toLowerCase();
    const d = (hdrDetail || '').toLowerCase();
    const e = (elType || '').toLowerCase();

    // 0: Profile 7 FEL
    if ((d.includes('profile 7') || d.includes('prof 7') || d.includes('p7') || d.includes('profile7') || f.includes('dolby vision') || f.includes('dolby')) && e.includes('fel')) {
        return 0;
    }
    // 1: Profile 7 MEL
    if ((d.includes('profile 7') || d.includes('prof 7') || d.includes('p7') || d.includes('profile7') || f.includes('dolby vision') || f.includes('dolby')) && e.includes('mel')) {
        return 1;
    }
    // 2: Profile 8
    if (d.includes('profile 8') || d.includes('profile8') || d.includes('p8') || f.includes('profile 8') || f.includes('p8') ) {
        return 2;
    }
    // 3: Profile 5
    if (d.includes('profile 5') || d.includes('profile5') || d.includes('p5') ) {
        return 3;
    }
    // 4: HDR10+
    if (f.includes('hdr10+') || d.includes('hdr10+') || f.includes('hdr10plus') || d.includes('hdr10plus')) {
        return 4;
    }
    // 5: SL-HDR1 / SL-HDR2 / SL-HDR3
    if (f.includes('sl-hdr') || d.includes('sl-hdr')) {
        return 5;
    }
    // 6: HDR Vivid
    if (f.includes('vivid') || d.includes('vivid')) {
        return 6;
    }
    // 7: HDR (HDR10 or HLG)
    if (f.includes('hdr10') || d.includes('hdr10') || f.includes('hlg') || d.includes('hlg') || f.includes('smpte2084') || d.includes('smpte2084')) {
        return 7;
    }
    // 8: SDR
    if (f.includes('sdr') || d.includes('sdr')) {
        return 8;
    }
    // 9: fallback / unknown
    return 9;
}

function getCmVersionRank(cmVersion) {
    const v = (cmVersion || '').toLowerCase().trim();
    if (v === 'cmv4.0') return 0;
    if (v === 'cmv2.9') return 1;
    return 2;
}

function getFilenameFromRow(row) {
    // Try multiple places: title attribute, .poster-title, .filename-fallback
    const td = row.querySelector('td[data-label-i18n="table_header_poster"]');
    if (!td) return '';
    // title attribute on td
    if (td.getAttribute('title')) return td.getAttribute('title').trim();
    const posterTitle = td.querySelector('.poster-title');
    if (posterTitle) return posterTitle.textContent.trim();
    const fallback = td.querySelector('.filename-fallback');
    if (fallback) return fallback.textContent.trim();
    return td.textContent.trim();
}

function sortTableByProfile() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aFmt = a.getAttribute('data-hdr-format') || '';
        const aDet = a.getAttribute('data-hdr-detail') || '';
        const aEl  = a.getAttribute('data-el-type') || '';

        const bFmt = b.getAttribute('data-hdr-format') || '';
        const bDet = b.getAttribute('data-hdr-detail') || '';
        const bEl  = b.getAttribute('data-el-type') || '';

        const aRank = getProfileRank(aFmt, aDet, aEl);
        const bRank = getProfileRank(bFmt, bDet, bEl);

        if (aRank !== bRank) return aRank - bRank;

        // If same priority, sort secondarily by filename
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    // Rearrange order in DOM
    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByProfileAudio() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody. querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aFmt = a.getAttribute('data-hdr-format') || '';
        const aDet = a.getAttribute('data-hdr-detail') || '';
        const aEl  = a.getAttribute('data-el-type') || '';

        const bFmt = b.getAttribute('data-hdr-format') || '';
        const bDet = b.getAttribute('data-hdr-detail') || '';
        const bEl  = b.getAttribute('data-el-type') || '';

        const aRank = getProfileRank(aFmt, aDet, aEl);
        const bRank = getProfileRank(bFmt, bDet, bEl);

        if (aRank !== bRank) return aRank - bRank;

        const aAudio = getAudioCodecFromRow(a);
        const bAudio = getAudioCodecFromRow(b);
        const aAudioRank = getAudioRank(aAudio);
        const bAudioRank = getAudioRank(bAudio);

        if (aAudioRank !== bAudioRank) return aAudioRank - bAudioRank;

        const aChannels = getChannelCount(aAudio);
        const bChannels = getChannelCount(bAudio);
        if (aChannels !== bChannels) return bChannels - aChannels;

        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByProfileVideoBitrate() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aFmt = a. getAttribute('data-hdr-format') || '';
        const aDet = a. getAttribute('data-hdr-detail') || '';
        const aEl  = a. getAttribute('data-el-type') || '';

        const bFmt = b.getAttribute('data-hdr-format') || '';
        const bDet = b.getAttribute('data-hdr-detail') || '';
        const bEl  = b.getAttribute('data-el-type') || '';

        const aRank = getProfileRank(aFmt, aDet, aEl);
        const bRank = getProfileRank(bFmt, bDet, bEl);

        if (aRank !== bRank) return aRank - bRank;

        const aVideoBitrate = parseFloat(a.getAttribute('data-video-bitrate')) || 0;
        const bVideoBitrate = parseFloat(b.getAttribute('data-video-bitrate')) || 0;

        if (bVideoBitrate !== aVideoBitrate) return bVideoBitrate - aVideoBitrate;

        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByProfileAudioBitrate() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aFmt = a.getAttribute('data-hdr-format') || '';
        const aDet = a.getAttribute('data-hdr-detail') || '';
        const aEl  = a.getAttribute('data-el-type') || '';

        const bFmt = b. getAttribute('data-hdr-format') || '';
        const bDet = b. getAttribute('data-hdr-detail') || '';
        const bEl  = b. getAttribute('data-el-type') || '';

        const aRank = getProfileRank(aFmt, aDet, aEl);
        const bRank = getProfileRank(bFmt, bDet, bEl);

        if (aRank !== bRank) return aRank - bRank;

        const aAudioBitrate = parseFloat(a.getAttribute('data-audio-bitrate')) || 0;
        const bAudioBitrate = parseFloat(b.getAttribute('data-audio-bitrate')) || 0;

        if (bAudioBitrate !== aAudioBitrate) return bAudioBitrate - aAudioBitrate;

        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByFilename() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function getAudioCodecFromRow(row) {
    // Get audio codec from the audio cell
    const audioCell = row.querySelector('td.audio-codec');
    if (!audioCell) return '';
    return audioCell.textContent.trim();
}

function getAudioRank(audioCodec) {
    // Normalize audio codec string
    const audio = (audioCodec || '').toLowerCase();
    
    // Priority ranking based on audio quality/format
    // 0: Dolby TrueHD (Atmos)
    if (audio.includes('truehd') && audio.includes('atmos')) {
        return 0;
    }
    // 1: DTS:X
    if (audio.includes('dts:x') || audio.includes('dts-x') || audio.includes('dtsx')) {
        return 1;
    }
    // 2: Dolby TrueHD
    if (audio.includes('truehd')) {
        return 2;
    }
    // 3: DTS-HD MA
    if (audio.includes('dts-hd ma') || audio.includes('dts-hd master audio')) {
        return 3;
    }
    // 4: DTS-HD HRA
    if (audio.includes('dts-hd hra') || audio.includes('dts-hd high resolution')) {
        return 4;
    }
    // 5: Dolby Digital Plus (Atmos)
    if (audio.includes('digital plus') && audio.includes('atmos')) {
        return 5;
    }
    // 6: Dolby Digital Plus
    if (audio.includes('digital plus')) {
        return 6;
    }
    // 7: DTS (but not DTS-HD or DTS:X)
    if (audio.includes('dts') && !audio.includes('dts-hd') && !audio.includes('dts:x') && !audio.includes('dts-x') && !audio.includes('dtsx')) {
        return 7;
    }
    // 8: Dolby Digital (but not Plus)
    if ((audio.includes('dolby digital') || audio.includes('ac-3')) && !audio.includes('plus')) {
        return 8;
    }
    // 9+: Other formats (AAC, FLAC, MP3, PCM, etc.)
    return 9;
}

function getChannelCount(audioCodec) {
    const audio = (audioCodec || '').toLowerCase();
    const channelMatch = audio.match(/\s(\d+\.\d+)(?=\s|$|\()/);

    if (channelMatch) {
        return parseFloat(channelMatch[1]);
    }

    return 0;
}

function sortTableByAudio() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aAudio = getAudioCodecFromRow(a);
        const bAudio = getAudioCodecFromRow(b);
        
        const aRank = getAudioRank(aAudio);
        const bRank = getAudioRank(bAudio);
        
        if (aRank !== bRank) return aRank - bRank;
		
        const aChannels = getChannelCount(aAudio);
        const bChannels = getChannelCount(bAudio);
        if (aChannels !== bChannels) return bChannels - aChannels;
        
        const aLower = aAudio.toLowerCase();
        const bLower = bAudio.toLowerCase();
        if (aLower < bLower) return -1;
        if (aLower > bLower) return 1;
        
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByCmVersion() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aCmv = a.getAttribute('data-dv-cm-version') || '';
        const bCmv = b.getAttribute('data-dv-cm-version') || '';

        const aRank = getCmVersionRank(aCmv);
        const bRank = getCmVersionRank(bCmv);

        if (aRank !== bRank) return aRank - bRank;

        const aFmt = a.getAttribute('data-hdr-format') || '';
        const aDet = a.getAttribute('data-hdr-detail') || '';
        const aEl  = a.getAttribute('data-el-type') || '';
        const bFmt = b.getAttribute('data-hdr-format') || '';
        const bDet = b.getAttribute('data-hdr-detail') || '';
        const bEl  = b.getAttribute('data-el-type') || '';

        const aProfileRank = getProfileRank(aFmt, aDet, aEl);
        const bProfileRank = getProfileRank(bFmt, bDet, bEl);

        if (aProfileRank !== bProfileRank) return aProfileRank - bProfileRank;

        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByRating() {
    sortTableByNumericAttribute('data-tmdb-rating');
}

function sortTableByFileSize() {
    sortTableByNumericAttribute('data-file-size');
}

function sortTableByVideoBitrate() {
    sortTableByNumericAttribute('data-video-bitrate');
}

function sortTableByAudioBitrate() {
    sortTableByNumericAttribute('data-audio-bitrate');
}

function sortTableByAudioAudioBitrate() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        // Primary sorting by Audio Codec
        const aAudio = getAudioCodecFromRow(a);
        const bAudio = getAudioCodecFromRow(b);
        
        const aRank = getAudioRank(aAudio);
        const bRank = getAudioRank(bAudio);
        
        if (aRank !== bRank) return aRank - bRank;
        
        const aChannels = getChannelCount(aAudio);
        const bChannels = getChannelCount(bAudio);
        if (aChannels !== bChannels) return bChannels - aChannels;

        // Secondary sorting by Audio Bitrate (descending, highest first)
        const aAudioBitrate = parseFloat(a.getAttribute('data-audio-bitrate')) || 0;
        const bAudioBitrate = parseFloat(b.getAttribute('data-audio-bitrate')) || 0;
        if (bAudioBitrate !== aAudioBitrate) return bAudioBitrate - aAudioBitrate;

        // Tertiary sorting by Filename (alphabetical)
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByYear() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aYear = parseInt(a.getAttribute('data-year')) || 0;
        const bYear = parseInt(b.getAttribute('data-year')) || 0;
        
        // Sort descending (newest first)
        if (bYear !== aYear) return bYear - aYear;
        
        // If same year, sort secondarily by filename
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByDuration() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aDuration = parseFloat(a.getAttribute('data-duration')) || 0;
        const bDuration = parseFloat(b.getAttribute('data-duration')) || 0;
        
        // Sort descending (longest first)
        if (bDuration !== aDuration) return bDuration - aDuration;
        
        // If same duration, sort secondarily by filename
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByNumericAttribute(attribute) {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aValue = parseFloat(a.getAttribute(attribute)) || 0;
        const bValue = parseFloat(b.getAttribute(attribute)) || 0;
        
        // Sort descending (highest/largest first)
        if (bValue !== aValue) return bValue - aValue;
        
        // If same value, sort secondarily by filename
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByAdded() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Sort by file modification time (descending - newest first)
    rows.sort((a, b) => {
        const aMtime = parseFloat(a.getAttribute('data-mtime') || 0);
        const bMtime = parseFloat(b.getAttribute('data-mtime') || 0);
        
        // Sort descending (newest first)
        if (bMtime !== aMtime) return bMtime - aMtime;
        
        // If same, sort secondarily by filename
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function applySort(mode) {
    if (!mode) mode = localStorage.getItem('dovi_sort_mode') || 'filename';
    if (sortSelectInstance) sortSelectInstance.setValue(mode);

    if (mode === 'profile') {
        sortTableByProfile();
    } else if (mode === 'profile_audio') {
        sortTableByProfileAudio();
    } else if (mode === 'profile_videobitrate') {
        sortTableByProfileVideoBitrate();
    } else if (mode === 'profile_audiobitrate') {
        sortTableByProfileAudioBitrate();
    } else if (mode === 'audio') {
        sortTableByAudio();
    } else if (mode === 'rating') {
        sortTableByRating();
    } else if (mode === 'filesize') {
        sortTableByFileSize();
    } else if (mode === 'videobitrate') {
        sortTableByVideoBitrate();
    } else if (mode === 'audiobitrate') {
        sortTableByAudioBitrate();
    } else if (mode === 'audio_audiobitrate') {
        sortTableByAudioAudioBitrate();
    } else if (mode === 'year') {
        sortTableByYear();
    } else if (mode === 'duration') {
        sortTableByDuration();
    } else if (mode === 'added') {
        sortTableByAdded();
    } else if (mode === 'cm_version') {
        sortTableByCmVersion();
    } else {
        sortTableByFilename();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize theme (labels are refreshed once translations are loaded)
    initTheme();

    // Initialize language first
    initLanguage().then(() => {
        // Build the custom sort/language dropdowns before anything reads them.
        initCustomSelects();

        // Load file list for scan dropdown
        loadFileList();

        // Apply initial sorting
        applySort();

        // Update profile statistics on initial load
        updateProfileStats();
        
        // Update clear button state on initial load
        updateClearButton();

        // Sort selection is handled by the custom dropdown's onSelect callback
        // (see initCustomSelects), which persists the mode and re-sorts.

        // Listener for search bar
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', searchMedia);
        }
        
        // Listener for the file dialog search field (live filtering)
        const fileDialogSearch = document.getElementById('fileDialogSearch');
        if (fileDialogSearch) {
            fileDialogSearch.addEventListener('input', renderFileDialogList);
        }

        // Listener for Escape key to close dialogs
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const fileOverlay = document.getElementById('fileDialogOverlay');
                if (fileOverlay && fileOverlay.classList.contains('active')) {
                    closeFileDialog();
                    return;
                }
                const overlay = document.getElementById('mediaDialogOverlay');
                if (overlay && overlay.classList.contains('active')) {
                    closeMediaDialog();
                }
            }
        });
        
        // Set up Server-Sent Events for real-time deletion updates
        setupSSE();
		
        // Setup scroll up/down toggle button
        setupScrollButton();
		
        // Setup clear db button
        setupClearButton();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.collapse-btn').forEach(btn => {
        const controlsAttr = btn.getAttribute('aria-controls') || '';
        const ids = controlsAttr.split(/\s+/).filter(Boolean);
        const targets = ids.map(id => document.getElementById(id)).filter(Boolean);

        const extraTargets = [];
        targets.forEach(t => {
            if (t.tagName && t.tagName.toLowerCase() === 'tbody') {
                const table = t.closest('table');
                if (table) {
                    const thead = table.querySelector('thead');
                    if (thead) extraTargets.push(thead);
                }
            }
        });

        const elements = targets.concat(extraTargets);
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';

        elements.forEach(el => {
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (tag === 'thead') {
                el.style.display = isExpanded ? 'table-header-group' : 'none';
            } else if (tag === 'tbody') {
                el.style.display = isExpanded ? 'table-row-group' : 'none';
            } else {
                el.style.display = isExpanded ? '' : 'none';
            }
        });

        const hideSvg = btn.querySelector('.hide');
        const showSvg = btn.querySelector('.show');
        if (hideSvg && showSvg) {
            hideSvg.style.display = isExpanded ? 'none' : 'flex';
            showSvg.style.display = isExpanded ? 'flex' : 'none';
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.collapse-btn').forEach(btn => {
        const controlsAttr = btn.getAttribute('aria-controls') || '';
        const ids = controlsAttr.split(/\s+/).filter(Boolean);
        const targets = ids.map(id => document.getElementById(id)).filter(Boolean);

        const isMobile = window.matchMedia('(max-width: 900px)').matches;
        const extraTargets = [];
        if (!isMobile) {
            targets.forEach(t => {
                if (t.tagName && t.tagName.toLowerCase() === 'tbody') {
                    const table = t.closest('table');
                    if (table) {
                        const thead = table.querySelector('thead');
                        if (thead) extraTargets.push(thead);
                    }
                }
            });
        }

        const elements = targets.concat(extraTargets);
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';

        elements.forEach(el => {
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (tag === 'thead') {
                el.style.display = isExpanded ? 'table-header-group' : 'none';
            } else if (tag === 'tbody') {
                el.style.display = isExpanded ? 'table-row-group' : 'none';
            } else {
                el.style.display = isExpanded ? '' : 'none';
            }
        });

        const hideSvg = btn.querySelector('.hide');
        const showSvg = btn.querySelector('.show');
        if (hideSvg && showSvg) {
            hideSvg.style.display = isExpanded ? 'none' : 'flex';
            showSvg.style.display = isExpanded ? 'flex' : 'none';
        }
    });
});

document.addEventListener('click', e => {
    const btn = e.target.closest('.collapse-btn');
    if (!btn) return;

    const controlsAttr = btn.getAttribute('aria-controls') || '';
    const ids = controlsAttr.split(/\s+/).filter(Boolean);
    const targets = ids.map(id => document.getElementById(id)).filter(Boolean);

    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const extraTargets = [];
    if (!isMobile) {
        targets.forEach(t => {
            if (t.tagName && t.tagName.toLowerCase() === 'tbody') {
                const table = t.closest('table');
                if (table) {
                    const thead = table.querySelector('thead');
                    if (thead) extraTargets.push(thead);
                }
            }
        });
    }

    const elements = targets.concat(extraTargets);
    if (elements.length === 0) return;

    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    const next = !isExpanded;
    btn.setAttribute('aria-expanded', String(next));

    elements.forEach(el => {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'thead') {
            el.style.display = next ? 'table-header-group' : 'none';
        } else if (tag === 'tbody') {
            el.style.display = next ? 'table-row-group' : 'none';
        } else {
            el.style.display = next ? '' : 'none';
        }
    });

    const hideSvg = btn.querySelector('.hide');
    const showSvg = btn.querySelector('.show');
    if (hideSvg && showSvg) {
        hideSvg.style.display = next ? 'none' : 'flex';
        showSvg.style.display = next ? 'flex' : 'none';
    }
});

function applyControlsCollapsed(collapsed) {
    const container = document.querySelector('.container');
    const btn = document.getElementById('toggleControlsBtn');
    if (!container) return;

    container.classList.toggle('controls-hidden', collapsed);

    if (btn) {
        btn.setAttribute('aria-expanded', String(!collapsed));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('dovi_controls_collapsed');
    const collapsed = saved === null ? true : (saved === 'true');

    applyControlsCollapsed(collapsed);

    const toggleBtn = document.getElementById('toggleControlsBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const container = document.querySelector('.container');
            if (!container) return;
            const nowCollapsed = container.classList.contains('controls-hidden');
            const nextCollapsed = !nowCollapsed;

            applyControlsCollapsed(nextCollapsed);
            localStorage.setItem('dovi_controls_collapsed', String(nextCollapsed));
        });
    }
});

// Status message icons (success / info / error), rendered as inline SVG.
const MSG_ICONS = {
    success: `<svg viewBox="0 0 24 24" ${SVG_ATTR}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" ${SVG_ATTR}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" ${SVG_ATTR}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
};

// Render a status message with a leading SVG icon; text is set via textContent
// so translated strings are never interpreted as HTML.
function setMessageContent(el, type, text) {
    if (!el) return;
    el.innerHTML = `<span class="message-icon">${MSG_ICONS[type] || ''}</span><span class="message-text"></span>`;
    el.querySelector('.message-text').textContent = text;
}

/* -------------------------------
   Server-Sent Events for Live Updates
   ------------------------------- */

function setupSSE() {
    if (typeof EventSource === 'undefined') {
        console.warn('EventSource not supported by browser');
        return;
    }
    
    const eventSource = new EventSource('/events');
    
    eventSource.addEventListener('file_deleted', function(e) {
        try {
            const data = JSON.parse(e.data);
            const filePath = data.file_path;
            
            if (filePath) {
                removeFileFromTable(filePath);
            }
        } catch (error) {
            console.error('Error parsing deletion event:', error);
        }
    });

    eventSource.addEventListener('scan_progress', function(e) {
        try {
            const data = JSON.parse(e.data);
            const scanProgress = document.getElementById('scanProgress');
            const scanProgressBar = document.getElementById('scanProgressBar');
            const scanProgressText = document.getElementById('scanProgressText');
            const message = document.getElementById('message');

            if (data.status === 'scanning') {
                if (scanProgress) {
                    scanProgressBar.style.width = data.percent + '%';
                    scanProgressText.textContent = data.current + '/' + data.total + ' (' + data.percent + '%)';
                    scanProgress.style.display = 'inline-flex';
                }
            } else if (data.status === 'done') {
                if (scanProgress) scanProgress.style.display = 'none';
                if (message) {
                    message.className = 'message';
                    if (data.new_files > 0) {
                        message.classList.add('success');
                        setMessageContent(message, 'success', t('scan_complete', { count: data.new_files }));
                        setTimeout(function() { location.reload(); }, 2000);
                    } else {
                        message.classList.add('info');
                        setMessageContent(message, 'info', t('no_new_files'));
                        setTimeout(function() { location.reload(); }, 2000);
                    }
                    message.style.display = 'block';
                }
            } else if (data.status === 'error') {
                if (scanProgress) scanProgress.style.display = 'none';
                if (message) {
                    message.className = 'message error';
                    setMessageContent(message, 'error', t('scan_error'));
                    message.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Error parsing scan progress event:', error);
        }
    });
    
    eventSource.onerror = function(e) {
        console.error('SSE connection error:', e);
        // EventSource will automatically try to reconnect
    };
}

function removeFileFromTable(filePath) {
    // Find the table row that corresponds to the deleted file
    const table = document.getElementById('mediaTable');
    if (!table) return;
    
    const rows = table.querySelectorAll('tbody tr');
    
    for (const row of rows) {
        // Try to find the title attribute which contains the filename
        const posterCell = row.querySelector('td[data-label-i18n="table_header_poster"]');
        if (posterCell && posterCell.getAttribute('title') === filePath) {
            row.remove();
            updateFileCount();
            updateProfileStats();
            console.log(`Removed deleted file from table: ${filePath}`);
            return;
        }
        
        // Fallback: check if filename matches (without full path)
        const filename = filePath.split('/').pop();
        if (posterCell && posterCell.getAttribute('title') === filename) {
            row.remove();
            updateFileCount();
            updateProfileStats();
            console.log(`Removed deleted file from table: ${filename}`);
            return;
        }
    }
}

function updateFileCount() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    
    const visibleRows = table.querySelectorAll('tbody tr:not([style*="display: none"])');
    const fileCountElement = document.getElementById('fileCount');
    
    if (fileCountElement) {
        const count = visibleRows.length;
        fileCountElement.innerHTML = `${count} <span data-i18n="media_count"></span>`;
        applyTranslations();
    }
}

/* -------------------------------
   Media Details Dialog Functions
   ------------------------------- */

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return t('unknown');
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        const secs = Math.floor(seconds % 60);
        return `${minutes}m ${secs}s`;
    }
}

function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined || bytes < 0) return t('unknown');
    
    // Always convert to GB
    const GB_IN_BYTES = 1024 * 1024 * 1024;
    const sizeInGB = bytes / GB_IN_BYTES;
    
    // Format with 1 decimal place and use appropriate decimal separator based on locale
    const formattedSize = currentLang === 'de' 
        ? sizeInGB.toFixed(1).replace('.', ',')  // German: comma
        : sizeInGB.toFixed(1);                    // English: period
    return `${formattedSize} GB`;
}

function formatMbps(kbitPerSec) {
    const mbps = kbitPerSec / 1000;
    const formatted = currentLang === 'de'
        ? mbps.toFixed(2).replace('.', ',')  // German: comma
        : mbps.toFixed(2);                    // English: period
    return formatted;
}

function formatLuminance(value) {
    // Luminances come from hdrprobe as cd/m² floats (e.g. 4000 or 0.005);
    // print them without trailing zeros and fall back to 0 when unavailable
    const num = Number(value);
    if (!isFinite(num) || num <= 0) return '0';
    return String(parseFloat(num.toFixed(4)));
}

function formatNits(value) {
    // Whole-nit values (MaxCLL / MaxFALL), 0 when unavailable
    const num = Number(value);
    if (!isFinite(num) || num <= 0) return '0';
    return String(Math.round(num));
}

function formatOffset(value) {
    const num = Number(value);
    if (!isFinite(num) || num < 0) return '0';
    return String(Math.round(num));
}

function updateHdrMetadataRows(hdrFormat, hdrMetadata) {
    // HDR10 mastering display and content light apply to every HDR10 base
    // (plain HDR10 as well as HDR10+); the RPU and L5 rows only exist on
    // Dolby Vision. SDR and everything else shows none of them.
    const format = (hdrFormat || '').toLowerCase();
    const isDolbyVision = format.includes('dolby vision');
    const showHdr10 = isDolbyVision || format.includes('hdr10');
    const meta = hdrMetadata || {};

    const rows = [
        ['dialogHdr10Mdl', 'dialogHdr10MdlText', showHdr10,
            `${formatLuminance(meta.hdr10_mdl_max)} | ${formatLuminance(meta.hdr10_mdl_min)} cd/m²`],
        ['dialogHdr10ContentLight', 'dialogHdr10ContentLightText', showHdr10,
            `${formatNits(meta.hdr10_max_cll)} | ${formatNits(meta.hdr10_max_fall)} cd/m²`],
        ['dialogRpuMdl', 'dialogRpuMdlText', isDolbyVision,
            `${formatLuminance(meta.rpu_mdl_max)} | ${formatLuminance(meta.rpu_mdl_min)} cd/m²`],
        ['dialogRpuContentLight', 'dialogRpuContentLightText', isDolbyVision,
            `${formatNits(meta.rpu_max_cll)} | ${formatNits(meta.rpu_max_fall)} cd/m²`],
        ['dialogL5ActiveArea', 'dialogL5ActiveAreaText', isDolbyVision,
            `${formatOffset(meta.l5_left)} | ${formatOffset(meta.l5_right)} | ` +
            `${formatOffset(meta.l5_top)} | ${formatOffset(meta.l5_bottom)}`]
    ];

    rows.forEach(([itemId, valueId, visible, text]) => {
        const item = document.getElementById(itemId);
        const value = document.getElementById(valueId);
        if (!item || !value) return;
        if (visible) {
            value.textContent = text;
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function showMediaDialog(title, year, duration, videoBitrate, audioBitrate, fileSize, posterUrl, tmdbId, plot, directors, cast, tmdbRating, filename, dvCmVersion, filePath, hdrFormat, hdrMetadata) {
    const overlay = document.getElementById('mediaDialogOverlay');
    const dialogTitle = document.getElementById('dialogTitle');
    const dialogDuration = document.getElementById('dialogDuration');
    const dialogFileSize = document.getElementById('dialogFileSize');
    const dialogVideoBitrate = document.getElementById('dialogVideoBitrate');
    const dialogAudioBitrate = document.getElementById('dialogAudioBitrate');
    const dialogPoster = document.getElementById('dialogPoster');
    const dialogPosterImg = document.getElementById('dialogPosterImg');
    const dialogTmdbBadge = document.getElementById('dialogTmdbBadge');
    const dialogTmdbRatingElement = document.getElementById('dialogTmdbRating');
    const dialogTmdbLink = document.getElementById('dialogTmdbLink');
    const dialogTrailer = document.getElementById('dialogTrailer');
    const dialogTrailerLink = document.getElementById('dialogTrailerLink');
    const dialogLinksContainer = document.getElementById('dialogLinksContainer');
    const dialogPlot = document.getElementById('dialogPlot');
    const dialogPlotText = document.getElementById('dialogPlotText');
    const dialogDirectors = document.getElementById('dialogDirectors');
    const dialogDirectorsText = document.getElementById('dialogDirectorsText');
    const dialogCast = document.getElementById('dialogCast');
    const dialogCastText = document.getElementById('dialogCastText');
    const dialogFilenameItem = document.getElementById('dialogFilenameItem');
    const dialogFilename = document.getElementById('dialogFilename');
    const dialogCmVersion = document.getElementById('dialogCmVersion');
    const dialogCmVersionText = document.getElementById('dialogCmVersionText');
    const dialogDeleteContainer = document.getElementById('dialogDeleteContainer');

    // Store current file path for delete
    currentDialogFilePath = filePath || '';
    
    // Set title with year if available
    if (year && year !== '') {
        dialogTitle.textContent = `${title} (${year})`;
    } else {
        dialogTitle.textContent = title;
    }
    
    // Set poster image if available
    if (posterUrl && posterUrl !== '' && posterUrl !== 'None') {
        dialogPosterImg.src = posterUrl;
        dialogPoster.style.display = 'block';
        
        // Set filename if available
        if (dialogFilenameItem && dialogFilename && filename && filename.trim() !== '') {
            dialogFilename.textContent = filename;
            dialogFilenameItem.style.display = 'flex';
        } else if (dialogFilenameItem) {
            dialogFilenameItem.style.display = 'none';
        }
    } else {
        dialogPoster.style.display = 'none';
    }
    
    // Set TMDB rating badge if available
    if (dialogTmdbBadge && dialogTmdbRatingElement) {
        if (tmdbRating && tmdbRating !== '' && tmdbRating !== 'None' && parseFloat(tmdbRating) > 0) {
            dialogTmdbRatingElement.textContent = parseFloat(tmdbRating).toFixed(1);
            dialogTmdbBadge.style.display = 'flex';
        } else {
            dialogTmdbBadge.style.display = 'none';
        }
    }
    
    // Set plot if available, otherwise show fallback text
    if (plot && plot !== '' && plot !== 'None') {
        dialogPlotText.textContent = plot;
        dialogPlot.style.display = 'flex';
    } else {
        dialogPlot.style.display = 'none';
    }
    
    // Set directors if available
    if (directors && directors !== '') {
        dialogDirectorsText.textContent = directors;
        dialogDirectors.style.display = 'flex';
    } else {
        dialogDirectors.style.display = 'none';
    }
    
    // Set cast if available (with "..." to indicate more actors)
    if (cast && cast !== '') {
        dialogCastText.textContent = cast + ' ...';
        dialogCast.style.display = 'flex';
    } else {
        dialogCast.style.display = 'none';
    }
    
    // Set duration
    dialogDuration.textContent = formatDuration(duration);
    
    // Set file size
    if (fileSize !== null && fileSize !== undefined && fileSize >= 0) {
        dialogFileSize.textContent = formatFileSize(fileSize);
    } else {
        dialogFileSize.textContent = t('unknown');
    }
    
    // Set video bitrate
    if (videoBitrate && videoBitrate > 0) {
        dialogVideoBitrate.textContent = `${formatMbps(videoBitrate)} ${t('unit_Mb')}`;
    } else {
        dialogVideoBitrate.textContent = t('unknown');
    }

    // Set audio bitrate
    if (audioBitrate && audioBitrate > 0) {
        dialogAudioBitrate.textContent = `${audioBitrate} ${t('unit_Kb')}`;
    } else {
        dialogAudioBitrate.textContent = t('unknown');
    }

    // Show the static HDR metadata rows that apply to this file's format
    updateHdrMetadataRows(hdrFormat, hdrMetadata);

    // Show CM Version when available
    if (dialogCmVersion && dialogCmVersionText) {
        if (dvCmVersion && dvCmVersion !== '') {
            dialogCmVersionText.textContent = dvCmVersion;
            dialogCmVersion.style.display = 'flex';
        } else {
            dialogCmVersion.style.display = 'none';
        }
    }

    // Show delete button when file path is available
    if (dialogDeleteContainer) {
        dialogDeleteContainer.style.display = currentDialogFilePath !== '' ? 'flex' : 'none';
    }
    
    // Set up links
    dialogTmdbLink.classList.remove(...dialogTmdbLink.classList);
    dialogTmdbLink.classList.add('dialog-link', 'tmdb');
    dialogTrailerLink.classList.remove(...dialogTrailerLink.classList);
    dialogTrailerLink.classList.add('dialog-link', 'youtube');

    if (tmdbId && tmdbId !== 'None') {
        // TMDb link - direct to movie page
        dialogTmdbLink.href = `https://www.themoviedb.org/movie/${tmdbId}`;
        dialogTmdbLink.style.display = 'inline-flex';
        
        // Set up YouTube trailer link
        if (title && title !== '') {
            const searchQuery = year && year !== '' ?
                `${title} (${year}) - Trailer` :
                `${title} - Trailer`;
            const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
            dialogTrailerLink.href = youtubeUrl;
            dialogTrailerLink.style.display = 'inline-flex';

            if (dialogTrailer && dialogTrailer.style) dialogTrailer.style.display = '';
        } else {
            dialogTrailerLink.style.display = 'none';
        }
        
        // Show links container
        if (dialogLinksContainer) dialogLinksContainer.style.display = '';
    } else {
        // Hide links if no TMDb ID
        dialogTmdbLink.style.display = 'none';
        dialogTrailerLink.style.display = 'none';
        
        // Hide entire links container
        if (dialogLinksContainer) dialogLinksContainer.style.display = 'none';
    }
    
    // Show dialog
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Apply translations
    applyTranslations();
    
    // Setup swipe gesture for mobile (only once)
    if (!swipeListenersAttached) {
        setupSwipeToClose();
    }
}

function showMediaDialogFromData(element) {
    // Extract data attributes safely from the clicked element
    const title = element.getAttribute('data-title') || '';
    const year = element.getAttribute('data-year') || '';
    const duration = parseFloat(element.getAttribute('data-duration')) || null;
    const videoBitrate = parseInt(element.getAttribute('data-video-bitrate')) || null;
    const audioBitrate = parseInt(element.getAttribute('data-audio-bitrate')) || null;
    const fileSize = parseInt(element.getAttribute('data-file-size')) || null;
    const posterUrl = element.getAttribute('data-poster-url') || '';
    const tmdbId = element.getAttribute('data-tmdb-id') || '';
    const tmdbRating = element.getAttribute('data-tmdb-rating') || '';
    const plot = element.getAttribute('data-plot') || '';
    const directors = element.getAttribute('data-directors') || '';
    const cast = element.getAttribute('data-cast') || '';
    const filename = element.getAttribute('data-filename') || '';
    const dvCmVersion = element.getAttribute('data-dv-cm-version') || '';
    const filePath = element.getAttribute('data-path') || '';
    const hdrFormat = element.getAttribute('data-hdr-format') || '';

    // Entries scanned before the HDR metadata was collected carry no payload;
    // the dialog then falls back to zeroed values
    let hdrMetadata = {};
    try {
        hdrMetadata = JSON.parse(element.getAttribute('data-hdr-metadata') || '{}') || {};
    } catch (e) {
        hdrMetadata = {};
    }

    showMediaDialog(title, year, duration, videoBitrate, audioBitrate, fileSize, posterUrl, tmdbId, plot, directors, cast, tmdbRating, filename, dvCmVersion, filePath, hdrFormat, hdrMetadata);
}

async function deleteCurrentEntry() {
    if (!currentDialogFilePath) return;

    if (!window.confirm(t('delete_entry_confirm'))) return;

    try {
        const response = await fetch('/delete_entry', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({file_path: currentDialogFilePath})
        });
        const data = await response.json();
        if (data.success) {
            closeMediaDialog();
            // Remove the row from the DOM by data-path attribute on the poster/fallback element
            const el = document.querySelector(
                `.poster-container[data-path="${CSS.escape(currentDialogFilePath)}"], ` +
                `.filename-fallback[data-path="${CSS.escape(currentDialogFilePath)}"]`
            );
            if (el) {
                const row = el.closest('tr');
                if (row) row.remove();
            }
            updateFileCount();
            updateProfileStats();
            currentDialogFilePath = '';
            loadFileList();
        } else {
            alert(t('delete_entry_error') + ': ' + (data.error || ''));
        }
    } catch (e) {
        alert(t('delete_entry_error') + ': ' + e.message);
    }
}

function setupScrollButton() {
  'use strict';
  if (window.__scrollButtonInit) return;
  window.__scrollButtonInit = true;

  function init() {
    const btn = document.getElementById('scrollToggle');
    if (!btn) return;
    const icon = btn.querySelector('.icon');
    const doc = document.documentElement;
    const body = document.body;

    const nearBottomPx = 120;
    const minimalMove = 5;
    const hideAtTopPx = 20;
    const inactivityDelay = 3000;

    let lastScrollTop = window.scrollY || window.pageYOffset || 0;
    let rafScheduled = false;
    let inactivityTimer = null;
    let currentState = 'bottom';

    function getMaxScrollTop() {
      const vh = window.innerHeight || doc.clientHeight;
      const full = Math.max(body.scrollHeight, doc.scrollHeight);
      return Math.max(0, full - vh);
    }

    function getScrollTop() {
      return window.scrollY || window.pageYOffset || 0;
    }

    function isAtTop() {
      return getScrollTop() <= hideAtTopPx;
    }

    function isAtBottom() {
      const scrollY = getScrollTop();
      const vh = window.innerHeight || doc.clientHeight;
      const full = Math.max(body.scrollHeight, doc.scrollHeight);
      return (full - (scrollY + vh)) <= nearBottomPx;
    }

    const ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    const ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';

    function setStateTop() {
      currentState = 'top';
      icon && (icon.innerHTML = ARROW_UP);
    }

    function setStateBottom() {
      currentState = 'bottom';
      icon && (icon.innerHTML = ARROW_DOWN);
    }

    function clearInactivityTimer() {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    }

    function resetInactivityTimer() {
      clearInactivityTimer();
      inactivityTimer = setTimeout(() => {
        if (!isAtTop() && !isAtBottom() && !isDialogOpen()) hideButton();
      }, inactivityDelay);
    }

    function showButton() {
      if (isAtTop() || isAtBottom() || isDialogOpen()) {
        hideButton();
        return;
      }
      btn.classList.remove('hidden');
      resetInactivityTimer();
    }

    function hideButton() {
      btn.classList.add('hidden');
      clearInactivityTimer();
    }

    function updateInitial() {
      const max = getMaxScrollTop();
      if (max === 0) { hideButton(); return; }

      if (isAtTop() || isAtBottom() || isDialogOpen()) {
        hideButton();
        setStateBottom();
        return;
      }

      setStateBottom();
      showButton();
    }

    function handleScrollDirection() {
      const current = getScrollTop();
      const delta = current - lastScrollTop;
      lastScrollTop = Math.max(0, current);

      if (getMaxScrollTop() === 0) { hideButton(); return; }

      if (isAtTop() || isAtBottom() || isDialogOpen()) {
        hideButton();
        return;
      }

      if (Math.abs(delta) < minimalMove) return;

      if (delta > 0) {
        setStateBottom();
        showButton();
      } else {
        setStateTop();
        showButton();
      }
    }

    function onScrollOrResize() {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        handleScrollDirection();
        rafScheduled = false;
      });
    }

    // Media dialog overlay detection and observer
    const overlay = document.getElementById('mediaDialogOverlay') || document.querySelector('.media-dialog-overlay');
    function isDialogOpen() {
      return overlay && overlay.classList && overlay.classList.contains('active');
    }
    if (overlay) {
      const overlayObserver = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            if (isDialogOpen()) {
              hideButton();
              clearInactivityTimer();
            } else {
              updateInitial();
            }
            break;
          }
        }
      });
      overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });

      // Sync initial state with dialog (if already open)
      if (isDialogOpen()) hideButton();
    }

    async function scrollToBottomWithRetries({
      retries = 8,
      delay = 300,
      threshold = 8
    } = {}) {
      const getViewport = () =>
        window.innerHeight || document.documentElement.clientHeight;

      const getFullHeight = () =>
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

      const isAtBottomLocal = () => {
        const scrollTop = getScrollTop();
        return (getFullHeight() - (scrollTop + getViewport())) <= threshold;
      };

      for (let i = 0; i < retries; i++) {
        window.scrollTo({ top: getFullHeight(), behavior: 'smooth' });
        await new Promise(r => setTimeout(r, delay));
        if (isAtBottomLocal()) return true;
      }

      window.scrollTo(0, getFullHeight());
      return isAtBottomLocal();
    }

    btn.addEventListener(
      'click',
      function () {
        if (isDialogOpen()) return;

        if (currentState === 'top') {
          btn.disabled = true;
          window.scrollTo({ top: 0, behavior: 'smooth' });

          setTimeout(() => {
            btn.disabled = false;
          }, 600);

          resetInactivityTimer();
          return;
        }

        btn.disabled = true;

        scrollToBottomWithRetries({ retries: 8, delay: 350, threshold: 6 })
          .finally(() => {
            btn.disabled = false;

            if (getMaxScrollTop() === 0 || isAtTop() || isAtBottom()) {
              hideButton();
            } else {
              setStateBottom();
              showButton();
            }

            resetInactivityTimer();
          });
      },
      { passive: true }
    );

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    updateInitial();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

function closeMediaDialog(event) {
    if (event) {
        event.stopPropagation();
    }
    
    const overlay = document.getElementById('mediaDialogOverlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

function setupClearButton() {
    const btn = document.getElementById('clearDbButton');
    if (!btn) return;

    const label = btn.querySelector('[data-i18n="clear_db"]');

    const originalText = t('clear_db');
    label.textContent = originalText;

    btn.addEventListener('click', async () => {

        const confirmed = window.confirm(t('clear_db_confirm'));
        if (!confirmed) return;

        btn.disabled = true;
        label.textContent = t('please_wait');

        try {
            const resp = await fetch('/clear_database', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            const data = await resp.json().catch(() => ({}));

            if (resp.ok && data.success) {
                window.location.reload();
            } else {
                alert('Error during deletion: ' + (data.error || 'Unknown error'));
                btn.disabled = false;
                label.textContent = originalText;
            }

        } catch (e) {
            alert('Network error during deletion: ' + e);
            btn.disabled = false;
            label.textContent = originalText;
        }
    });
}

// Swipe gesture handling for mobile
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let swipeListenersAttached = false;

function setupSwipeToClose() {
    const dialog = document.querySelector('.media-dialog');
    
    if (!dialog || swipeListenersAttached) return;
    
    dialog.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    
    dialog.addEventListener('touchend', function(e) {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    }, { passive: true });
    
    swipeListenersAttached = true;
}

function handleSwipe() {
    const swipeThreshold = 100;
    const horizontalSwipe = Math.abs(touchEndX - touchStartX);
    const verticalSwipe = Math.abs(touchEndY - touchStartY);
    
    // Only consider horizontal swipes (left or right)
    if (horizontalSwipe > swipeThreshold && horizontalSwipe > verticalSwipe) {
        closeMediaDialog();
    }
}

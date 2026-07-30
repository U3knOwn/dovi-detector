// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The file selection dialog and the scan it starts.
 */

import { currentLang, onLanguageChange, t } from '../core/i18n.js';
import { debounce } from '../helpers/dom.js';
import { setMessageContent } from './message.js';
import { fetchMediaFiles, requestScan } from '../core/api.js';

// File selection dialog state
let availableFiles = [];

// Whether the list has ever been fetched. The media directory is only walked
// when the list is actually wanted - that walk covers every file below it, and
// on a large library on network storage it is the slowest thing the server
// does. Nothing but this dialog shows the list, so nothing but opening it
// should pay for it.
let filesLoaded = false;

export let selectedPaths = new Set();

export function loadFileList() {
    return fetchMediaFiles()
        .then(data => {
            if (data.success) {
                availableFiles = data.files || [];
                filesLoaded = true;

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

/**
 * Bring an already fetched list up to date, e.g. after an entry was deleted.
 *
 * A list that was never fetched is left alone: the dialog fetches it when it
 * opens, so there is nothing here that could go stale.
 */
export function refreshFileList() {
    if (!filesLoaded) return Promise.resolve();
    return loadFileList();
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

export function openFileDialog() {
    const overlay = document.getElementById('fileDialogOverlay');
    if (!overlay) return;

    const search = document.getElementById('fileDialogSearch');
    if (search) search.value = '';

    // What is already known is shown at once, so a second open is instant; the
    // fetch behind it refreshes the list in place (loadFileList re-renders an
    // open dialog), and on the first open it is what fills it.
    renderFileDialogList();

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    loadFileList();

    // Deliberately nothing is focused here: auto-focusing the search field pops
    // the on-screen keyboard open on mobile before the list can even be seen.
}

export function closeFileDialog(event) {
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
        : availableFiles;
}

// A file row is built by cloning these instead of parsing the same markup
// again for every entry - on a large library that is thousands of identical
// SVG parses, which is what made opening the dialog slow.
let fileItemPrototype = null;
let fileStatusIconPrototype = null;

function getFileItemPrototype() {
    if (!fileItemPrototype) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'file-item';
        item.setAttribute('role', 'checkbox');

        // Custom checkbox (selection state)
        const checkbox = document.createElement('span');
        checkbox.className = 'file-item-checkbox';
        checkbox.setAttribute('aria-hidden', 'true');
        checkbox.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

        const name = document.createElement('span');
        name.className = 'file-item-name';

        // Scan-status badge on the right
        const status = document.createElement('span');
        status.className = 'file-item-status';
        status.setAttribute('aria-hidden', 'true');

        item.appendChild(checkbox);
        item.appendChild(name);
        item.appendChild(status);
        fileItemPrototype = item;

        const icon = document.createElement('span');
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        fileStatusIconPrototype = icon.firstChild;
    }
    return fileItemPrototype;
}

// Build the grouped, multi-selectable file list (unscanned first, then
// scanned), honouring the current search filter.
export function renderFileDialogList() {
    const list = document.getElementById('fileDialogList');
    if (!list) return;

    const filtered = getFilteredFiles();

    list.innerHTML = '';

    if (filtered.length === 0) {
        // Nothing is said while the list is still on its way: "no files found"
        // would be a wrong answer for as long as the walk over the media
        // directory takes.
        if (!filesLoaded) {
            updateScanSelectedButton();
            return;
        }

        const empty = document.createElement('div');
        empty.className = 'file-dialog-empty';
        empty.textContent = t('file_dialog_empty');
        list.appendChild(empty);
        updateScanSelectedButton();
        return;
    }

    const unscanned = [];
    const scanned = [];
    filtered.forEach(f => (f.scanned ? scanned : unscanned).push(f));

    // One insertion instead of one per group / per item
    const fragment = document.createDocumentFragment();
    if (unscanned.length > 0) {
        fragment.appendChild(buildFileGroup(t('files_unscanned'), unscanned, false));
    }
    if (scanned.length > 0) {
        fragment.appendChild(buildFileGroup(t('files_scanned'), scanned, true));
    }
    list.appendChild(fragment);

    // One delegated handler for the whole list, however many entries it holds
    if (!list.dataset.clickBound) {
        list.addEventListener('click', event => {
            const item = event.target.closest('.file-item');
            if (item && list.contains(item)) {
                toggleFileSelection(item.getAttribute('data-path'), item);
            }
        });
        list.dataset.clickBound = 'true';
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

    const prototype = getFileItemPrototype();
    const statusTitle = scanned ? t('files_scanned') : t('files_unscanned');

    files.forEach(file => {
        const item = prototype.cloneNode(true);
        item.classList.add(scanned ? 'scanned' : 'unscanned');
        item.setAttribute('data-path', file.path);

        const isChecked = selectedPaths.has(file.path);
        item.setAttribute('aria-checked', isChecked ? 'true' : 'false');
        if (isChecked) item.classList.add('selected');

        const name = item.children[1];
        name.textContent = file.name;
        name.title = file.name;

        const status = item.children[2];
        status.title = statusTitle;
        if (scanned) status.appendChild(fileStatusIconPrototype.cloneNode(true));

        group.appendChild(item);
    });

    return group;
}

function toggleFileSelection(path, item) {
    if (!path) return;
    setFileSelected(path, !selectedPaths.has(path), item);
    updateScanSelectedButton();
    updateFileTriggerLabel();
}

// Set one file's selection state, keeping its list entry (if rendered) in sync.
function setFileSelected(path, selected, item) {
    if (selected) {
        selectedPaths.add(path);
    } else {
        selectedPaths.delete(path);
    }
    if (item) {
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
}

// Select or deselect every file currently visible in the dialog. The rendered
// entries are updated in place - rebuilding the whole list to flip a class
// would be the expensive part on a large library.
function setAllFilesSelected(selected) {
    const list = document.getElementById('fileDialogList');
    const items = list ? list.querySelectorAll('.file-item') : [];
    const rendered = new Map();
    items.forEach(item => rendered.set(item.getAttribute('data-path'), item));

    getFilteredFiles().forEach(f => setFileSelected(f.path, selected, rendered.get(f.path)));

    updateScanSelectedButton();
    updateFileTriggerLabel();
}

export function selectAllFiles() {
    setAllFilesSelected(true);
}

export function deselectAllFiles() {
    setAllFilesSelected(false);
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
export function scanSelectedFiles() {
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

    requestScan(paths, currentLang)
        .then(data => {
            // Scan runs in the background - progress arrives via SSE.
            if (data.success) return;

            // A scan that was already running is not a failure: it keeps
            // reporting its own progress, so the bar stays where it is and the
            // user is only told why this request did not start another one.
            if (data.code === 'scan_running') {
                if (!message) return;
                message.className = 'message info';
                setMessageContent(message, 'info', t('scan_already_running'));
                message.style.display = 'block';
                return;
            }

            throw new Error(data.error || 'Unknown error');
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

export const debouncedRenderFileDialogList = debounce(renderFileDialogList, 120);

// Only the labels are language-dependent, the file list itself is not - so the
// dialog is relabelled instead of the whole media directory being walked again
// server-side.
onLanguageChange(() => {
    updateFileTriggerLabel();
    updateScanSelectedButton();
    if (isFileDialogOpen()) renderFileDialogList();
});

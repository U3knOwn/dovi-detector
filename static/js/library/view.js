// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Loading the library and keeping the table and its chrome in sync.
 */

import { fetchLibrary } from '../core/api.js';
import { onLanguageChange, t } from '../core/i18n.js';
import { debounce, makeElement } from '../helpers/dom.js';
import { prepareMediaItem, prepareMediaSearchText } from './model.js';
import { applySort } from './sorting.js';
import {
    mediaItems, mediaLoaded, mediaSearchTerm, mediaVisible,
    setMediaItems, setMediaLoaded, setMediaSearchTerm, setMediaVisible
} from './store.js';
import { getMediaBody, renderMediaWindow } from './virtual-table.js';

export function loadMediaLibrary() {
    return fetchLibrary()
        .then(data => {
            if (!data || !data.success) throw new Error('Library request failed');
            setMediaItems((data.files || []).map(prepareMediaItem));
            setMediaLoaded(true);
            // Sorting runs the filter and the render, so the table appears in
            // the order the user last chose rather than in load order.
            applySort();
        })
        .catch(error => {
            console.error('Error loading library:', error);
            setMediaLoaded(true);
            updateMediaChrome();
        });
}

// Recompute what is shown and put it on screen. Every change to the data, the
// sort order or the search term ends here.
export function applyMediaFilter() {
    setMediaVisible(mediaSearchTerm
        ? mediaItems.filter(item => item.searchText.includes(mediaSearchTerm))
        : mediaItems);

    updateMediaChrome();
    renderMediaWindow(true);
}

// Table visibility, the empty states, the counter and the profile chips.
function updateMediaChrome() {
    const table = document.getElementById('mediaTable');
    const emptyState = document.getElementById('emptyState');
    const tbody = getMediaBody();
    const thead = table ? table.querySelector('thead') : null;

    const hasEntries = mediaItems.length > 0;
    const hasVisible = mediaVisible.length > 0;

    if (emptyState) emptyState.hidden = !mediaLoaded || hasEntries;
    if (table) table.hidden = !hasEntries;
    // A lone table header above a "nothing found" message reads as a bug -
    // but never fight the show/hide toggle for it.
    if (thead && tbody && tbody.style.display !== 'none') {
        thead.style.display = hasVisible ? '' : 'none';
    }

    updateSearchNoResults(mediaSearchTerm !== '' && !hasVisible);
    updateFileCount();
    updateProfileStats();
}

// Show or hide the "no results" message below the table, creating it on first
// use.
function updateSearchNoResults(show) {
    let message = document.getElementById('search-no-results');

    if (!show) {
        if (message) message.style.display = 'none';
        return;
    }

    if (!message) {
        const table = document.getElementById('mediaTable');
        if (!table || !table.parentNode) return;
        message = document.createElement('div');
        message.id = 'search-no-results';
        message.className = 'empty-state';
        message.appendChild(makeElement('h2', null, t('search_no_results')));
        table.parentNode.insertBefore(message, table.nextSibling);
    } else {
        const heading = message.querySelector('h2');
        if (heading) heading.textContent = t('search_no_results');
    }
    message.style.display = 'block';
}

// Real-time search function
export function searchMedia() {
    const input = document.getElementById('searchInput');
    setMediaSearchTerm((input ? input.value : '').trim().toLowerCase());
    applyMediaFilter();
    updateClearButton();
}

// Short enough to still feel live, long enough to skip the intermediate
// filtering passes while a word is being typed.
export const debouncedSearchMedia = debounce(searchMedia, 120);

// Clear search function
export function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    searchMedia(); // Re-run search to show all rows
}

// Update clear button visibility
export function updateClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');
    if (clearBtn && searchInput) {
        clearBtn.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
    }
}

/**
 * The entry counter below the table.
 *
 * It states the size of the library, and while a search narrows it down the
 * number of matches is put in front of that total ("12 / 5000 Dateien") - so
 * the number never quietly means something else than it did a moment ago, and
 * it stays right after an entry is deleted. Written as digits and a slash so
 * it reads the same in every language.
 */
export function updateFileCount() {
    const fileCountElement = document.getElementById('fileCount');
    if (!fileCountElement) return;

    const total = mediaItems.length;
    const count = mediaVisible.length === total ? `${total} ` : `${mediaVisible.length} / ${total} `;

    // Only the number changes; rewriting the element would mean re-translating
    // it as well.
    const label = fileCountElement.querySelector('[data-i18n="media_count"]');
    const countNode = fileCountElement.firstChild;
    if (label && countNode && countNode.nodeType === Node.TEXT_NODE) {
        countNode.textContent = count;
        return;
    }

    fileCountElement.innerHTML = '';
    fileCountElement.appendChild(document.createTextNode(count));
    const span = makeElement('span', null, t('media_count'));
    span.setAttribute('data-i18n', 'media_count');
    fileCountElement.appendChild(span);
}

// Order the stat chips are shown in; only categories with at least one title
// are rendered.
const STAT_CHIP_ORDER = [
    'FEL', 'MEL', 'P8', 'P5', 'HDR10+', 'SL-HDR', 'HDR Vivid', 'HDR10', 'HLG', 'SDR'
];

// Update profile statistics
export function updateProfileStats() {
    const profileStatsElement = document.getElementById('profileStats');
    if (!profileStatsElement) return;

    const stats = new Map();
    mediaVisible.forEach(item => {
        if (item.statKey) stats.set(item.statKey, (stats.get(item.statKey) || 0) + 1);
    });

    profileStatsElement.innerHTML = STAT_CHIP_ORDER
        .filter(label => stats.get(label) > 0)
        .map(label => `<span class="stat-chip">${label} <strong>${stats.get(label)}</strong></span>`)
        .join('');
}

// Drop an entry from the table, e.g. after it was deleted or its file vanished.
export function removeFileFromTable(filePath) {
    const remaining = mediaItems.filter(item => item.path !== filePath);
    if (remaining.length === mediaItems.length) return false;

    setMediaItems(remaining);
    applyMediaFilter();
    console.log(`Removed deleted file from table: ${filePath}`);
    return true;
}

// An entry with unknown values carries a translated badge, and that badge is
// part of what the search matches against.
onLanguageChange(() => {
    mediaItems.forEach(prepareMediaSearchText);
    applyMediaFilter();
});

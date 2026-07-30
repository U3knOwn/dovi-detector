// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Entry point: pulls the modules together and starts the app.
 *
 * The code lives in three groups - core/ (translations, theme, server calls,
 * live updates), helpers/ (small pure utilities), library/ (the scanned
 * entries, their sorting and the table that shows them) and ui/ (everything
 * the user clicks on).
 */

import { fetchLibrary, fetchScanStatus } from './core/api.js';
import { initLanguage, setLanguage } from './core/i18n.js';
import { setupSSE } from './core/sse.js';
import { initTheme, toggleTheme } from './core/theme.js';
import { mediaTitleText } from './library/model.js';
import { applySort, initSortDirection, toggleSortDirection } from './library/sorting.js';
import { mediaItems, mediaVisible } from './library/store.js';
import {
    applyMediaFilter, clearSearch, debouncedSearchMedia, loadMediaLibrary,
    removeFileFromTable, searchMedia, updateClearButton, updateFileCount,
    updateProfileStats
} from './library/view.js';
import {
    getMediaWindow, renderMediaWindow, setupMediaVirtualScroll
} from './library/virtual-table.js';
import { setupClearButton } from './ui/clear-database.js';
import { initCustomSelects } from './ui/custom-select.js';
import {
    closeFileDialog, debouncedRenderFileDialogList, deselectAllFiles,
    openFileDialog, renderFileDialogList, scanSelectedFiles, selectAllFiles, selectedPaths
} from './ui/file-dialog.js';
import {
    closeMediaDialog, deleteCurrentEntry, rescanCurrentEntry, setupMediaTableInteraction,
    showMediaDialog, toggleDialogPlot
} from './ui/media-dialog.js';
import { setupScrollButton } from './ui/scroll-button.js';

// Loaded for their side effects: they wire up the collapsible header, the
// control bar and the scroll button on their own.
import './ui/layout.js';

document.addEventListener('DOMContentLoaded', function() {
    // Initialize theme (labels are refreshed once translations are loaded)
    initTheme();

    // Restore the saved sort direction before anything sorts or renders it
    initSortDirection();

    // The library request the page started in its <head>, long before this
    // module could run - it is rendered further down, once the dropdowns the
    // sort order is read from exist. Waiting for the translations first would
    // only queue the two round trips up behind each other; neither needs the
    // other. Without the head's request (a template that does not start one)
    // it is made here instead, caught so the browser does not call the
    // rejection unhandled while the translations are still on their way -
    // loadMediaLibrary reports the failure either way.
    const libraryRequest = window.__uvsLibraryRequest || fetchLibrary().catch(() => null);

    // Initialize language first
    initLanguage().then(() => {
        // Build the custom sort/language dropdowns before anything reads them.
        initCustomSelects();

        // The file list behind the scan dropdown is deliberately not fetched
        // here: it costs a walk over the whole media directory and only the
        // dialog shows it, so it is fetched when that dialog opens.

        // Only the rows in view are rendered, so the table has to follow the
        // scroll position and react to a viewport change.
        setupMediaVirtualScroll();
        setupMediaTableInteraction();

        // Render the library that was requested above, in the stored sort order
        loadMediaLibrary(libraryRequest);

        // Update clear button state on initial load
        updateClearButton();

        // Sort selection is handled by the custom dropdown's onSelect callback
        // (see initCustomSelects), which persists the mode and re-sorts.

        // Listener for search bar. Filtering thousands of rows on every single
        // keystroke makes typing feel sticky, so it runs once the user pauses -
        // the clear button follows the field immediately.
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                updateClearButton();
                debouncedSearchMedia();
            });
        }

        // Listener for the file dialog search field (live filtering)
        const fileDialogSearch = document.getElementById('fileDialogSearch');
        if (fileDialogSearch) {
            fileDialogSearch.addEventListener('input', debouncedRenderFileDialogList);
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


/* -------------------------------
   Bridge to the page

   The template calls a handful of these straight from an onclick attribute,
   so they have to be reachable as globals. Everything else is grouped under
   window.uvs, which is also the handle for poking at the app from the browser
   console - the modules themselves stay free of globals.
   ------------------------------- */

const inlineHandlers = {
    clearSearch,
    closeFileDialog,
    closeMediaDialog,
    deleteCurrentEntry,
    deselectAllFiles,
    openFileDialog,
    rescanCurrentEntry,
    scanSelectedFiles,
    selectAllFiles,
    toggleDialogPlot,
    toggleTheme
};

Object.assign(window, inlineHandlers);

window.uvs = {
    ...inlineHandlers,
    applyMediaFilter,
    applySort,
    fetchScanStatus,
    getMediaWindow,
    loadMediaLibrary,
    mediaTitleText,
    removeFileFromTable,
    renderFileDialogList,
    renderMediaWindow,
    searchMedia,
    setLanguage,
    showMediaDialog,
    toggleSortDirection,
    updateFileCount,
    updateProfileStats,
    // Live views of the library - the arrays are replaced on every sort and
    // filter, so these have to be read through a getter.
    get items() { return mediaItems; },
    get visible() { return mediaVisible; },
    get selectedPaths() { return selectedPaths; }
};

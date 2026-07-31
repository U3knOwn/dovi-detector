// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Staying where the user was across a reload.
 *
 * The browser's own scroll restoration is no help here: it runs while the page
 * is still a bare header with no table under it, finds nothing to scroll to and
 * gives up at the top - a reload halfway down a large library always came back
 * at the very beginning. So it is turned off and done here instead, once the
 * library has actually been rendered and the page has its height back.
 *
 * What is stored is the entry at the top edge (see getMediaScrollAnchor), not a
 * pixel offset - the position survives an entry being deleted above it, and it
 * cannot drift with the row height estimates the table works with.
 */

import { debounce } from '../helpers/dom.js';
import { getMediaScrollAnchor, scrollMediaToAnchor } from './virtual-table.js';

// Per page, so a second view in the same tab keeps its own position.
const STORAGE_KEY = `dovi_scroll_anchor:${location.pathname}`;

// Nothing is stored before the saved position has been restored - the page sits
// at the top until then, and writing that away would be the one thing that
// throws the position the user is waiting for.
let restored = false;

function readAnchor() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        // sessionStorage unavailable or the entry is not readable -> start fresh
        return null;
    }
}

function saveAnchor() {
    if (!restored) return;
    try {
        const anchor = getMediaScrollAnchor();
        if (anchor) {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(anchor));
        } else {
            // Back at the top: nothing to come back to.
            sessionStorage.removeItem(STORAGE_KEY);
        }
    } catch (e) { /* sessionStorage unavailable -> the position won't persist */ }
}

// Scrolling fires far too often to write on every event, and the position only
// has to be right by the time the page goes away.
const debouncedSaveAnchor = debounce(saveAnchor, 200);

export function setupScrollRestore() {
    if ('scrollRestoration' in history) {
        try {
            history.scrollRestoration = 'manual';
        } catch (e) { /* not settable -> the browser's own attempt stays */ }
    }

    window.addEventListener('scroll', debouncedSaveAnchor, { passive: true });

    // A phone browser is often killed outright rather than unloaded, and
    // pagehide is the last event that still reliably arrives; the hidden state
    // covers switching away from the tab without leaving it.
    window.addEventListener('pagehide', saveAnchor);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveAnchor();
    });

    // Coming back to a page the browser kept alive: the table is still there,
    // but with the restoration handed to us the browser may leave the position
    // behind. Only a page that really did come back at the top is moved, so a
    // browser that restored it properly is not fought over the last pixels.
    window.addEventListener('pageshow', event => {
        if (!event.persisted || window.scrollY > 0) return;
        const anchor = readAnchor();
        if (anchor) scrollMediaToAnchor(anchor);
    });
}

/**
 * Jump back to the stored position. Call once the table has been rendered -
 * before that there is nothing to scroll to.
 */
export function restoreScrollPosition() {
    const anchor = readAnchor();
    restored = true;
    if (!anchor) return;

    if (!scrollMediaToAnchor(anchor)) return;

    // The rows that were just rendered are the first ones ever measured, and
    // the web fonts may still be swapping in - both move the anchor a little,
    // so it is placed once more on the next frame.
    requestAnimationFrame(() => scrollMediaToAnchor(anchor));
}

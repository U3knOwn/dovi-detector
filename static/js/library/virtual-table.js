// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Rendering only the rows that are in view.
 *
 * Only the rows around the viewport exist in the DOM; the space the others
 * would take is held by two spacer rows, so the scrollbar and every scroll
 * position still behave as if the whole table were there.
 */

import { makeElement } from '../helpers/dom.js';
import { buildMediaRow } from './rows.js';
import { mediaItems, mediaVisible } from './store.js';

// Extra rows kept above and below the viewport, so scrolling does not chase
// the renderer.
const MEDIA_OVERSCAN = 5;

// Up to this many entries the table is rendered completely. Leaving rows out
// only pays off once there are a lot of them, and a fully rendered table can
// still be searched with the browser's own find-in-page.
const MEDIA_WINDOW_THRESHOLD = 120;

// Vertical gap between two rows (the table's border-spacing), measured from
// the real layout on the first render.
let mediaRowGap = 12;
// Height assumed for rows that have never been on screen. Replaced by a real
// measurement as soon as one row has been rendered.
const MEDIA_ROW_HEIGHT_GUESS = 280;
let mediaRowHeightEstimate = MEDIA_ROW_HEIGHT_GUESS;
let mediaRowHeightMeasured = false;
let mediaWindowStart = 0;
let mediaWindowEnd = 0;
let mediaRenderScheduled = false;

function mediaRowPitch(item) {
    return (item.rowHeight || mediaRowHeightEstimate) + mediaRowGap;
}

// Distance from the top of the first row to the top of row `index`.
function mediaOffsetOf(index) {
    let offset = 0;
    for (let i = 0; i < index; i++) offset += mediaRowPitch(mediaVisible[i]);
    return offset;
}

function makeSpacerRow(className, height) {
    const row = makeElement('tr', className);
    const cell = makeElement('td');
    cell.colSpan = 4;
    row.appendChild(cell);
    row.style.height = `${Math.max(0, height)}px`;
    return row;
}

// The table body, or null when the page has no table (empty library).
export function getMediaBody() {
    const table = document.getElementById('mediaTable');
    return table ? table.querySelector('tbody') : null;
}

function scheduleMediaRender() {
    if (mediaRenderScheduled) return;
    mediaRenderScheduled = true;
    requestAnimationFrame(() => {
        mediaRenderScheduled = false;
        renderMediaWindow();
    });
}

/**
 * Put the rows around the current scroll position into the table.
 *
 * `force` re-renders even when the window did not move - needed after the
 * data, the sort order or the language changed.
 */
export function renderMediaWindow(force) {
    const table = document.getElementById('mediaTable');
    const tbody = getMediaBody();
    if (!table || !tbody || table.hidden) return;
    // Hidden by the show/hide toggle: nothing to lay out until it is back
    if (tbody.style.display === 'none') return;

    const count = mediaVisible.length;
    if (count === 0) {
        tbody.replaceChildren();
        mediaWindowStart = 0;
        mediaWindowEnd = 0;
        return;
    }

    let start = 0;
    let end = count;

    if (count > MEDIA_WINDOW_THRESHOLD) {
        const rowsTop = tbody.getBoundingClientRect().top + window.scrollY;
        const viewTop = window.scrollY - rowsTop;
        const viewBottom = viewTop + (window.innerHeight || 800);

        let offset = 0;
        while (start < count) {
            const pitch = mediaRowPitch(mediaVisible[start]);
            if (offset + pitch > viewTop) break;
            offset += pitch;
            start++;
        }
        start = Math.max(0, Math.min(start, count - 1) - MEDIA_OVERSCAN);

        end = start;
        let bottom = mediaOffsetOf(start);
        while (end < count && bottom < viewBottom) {
            bottom += mediaRowPitch(mediaVisible[end]);
            end++;
        }
        end = Math.min(count, end + MEDIA_OVERSCAN);
    }

    if (!force && start === mediaWindowStart && end === mediaWindowEnd) return;

    const fragment = document.createDocumentFragment();
    if (start > 0) {
        fragment.appendChild(makeSpacerRow('media-spacer', mediaOffsetOf(start) - mediaRowGap));
    }
    for (let i = start; i < end; i++) {
        fragment.appendChild(buildMediaRow(mediaVisible[i]));
    }
    if (end < count) {
        const rest = mediaOffsetOf(count) - mediaOffsetOf(end);
        fragment.appendChild(makeSpacerRow('media-spacer', rest - mediaRowGap));
    }

    tbody.replaceChildren(fragment);
    mediaWindowStart = start;
    mediaWindowEnd = end;

    measureRenderedRows(tbody, start, end);
}

/**
 * Remember how tall the rows that were just rendered really are.
 *
 * Row height is not uniform - a long filename wraps to a second or third line -
 * so the spacers work with measured heights wherever a row has been seen, and
 * with an estimate for the rest. The estimate itself comes from the first row
 * ever measured.
 */
function measureRenderedRows(tbody, start, end) {
    const rows = Array.from(tbody.children).filter(row => !row.classList.contains('media-spacer'));
    if (rows.length === 0) return;

    // border-spacing shows up as the gap between two consecutive rows
    if (rows.length > 1) {
        const gap = Math.round(
            rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom);
        if (gap >= 0 && gap < 100) mediaRowGap = gap;
    }

    let bottomChanged = false;
    rows.forEach((row, index) => {
        const item = mediaVisible[start + index];
        if (!item) return;
        const height = Math.round(row.getBoundingClientRect().height);
        if (height > 0 && height !== item.rowHeight) {
            item.rowHeight = height;
            bottomChanged = true;
        }
    });

    if (!mediaRowHeightMeasured) {
        const first = mediaVisible[start];
        if (first && first.rowHeight) {
            mediaRowHeightEstimate = first.rowHeight;
            mediaRowHeightMeasured = true;
        }
    }

    // Only the space below the window can have changed - the rows above were
    // measured when they were on screen - so this never moves what the user is
    // looking at, it just keeps the scrollbar honest.
    if (bottomChanged && end < mediaVisible.length) {
        const spacer = tbody.lastElementChild;
        if (spacer && spacer.classList.contains('media-spacer')) {
            const rest = mediaOffsetOf(mediaVisible.length) - mediaOffsetOf(end);
            spacer.style.height = `${Math.max(0, rest - mediaRowGap)}px`;
        }
    }
}

// Row heights depend on the layout, which changes with the viewport width.
function invalidateMediaRowHeights() {
    mediaItems.forEach(item => { item.rowHeight = 0; });
    mediaRowHeightEstimate = MEDIA_ROW_HEIGHT_GUESS;
    mediaRowHeightMeasured = false;
}

export function setupMediaVirtualScroll() {
    window.addEventListener('scroll', scheduleMediaRender, { passive: true });

    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        if (window.innerWidth !== lastWidth) {
            lastWidth = window.innerWidth;
            invalidateMediaRowHeights();
        }
        renderMediaWindow(true);
    });
}

/* -------------------------------
   Scroll anchoring

   A pixel position means nothing on its own here: the table is rebuilt from
   scratch on every load, and until a row has been on screen its height is only
   estimated - so the same offset can land on a different entry than it did
   before. What is stable is which entry sat at the top edge and how far into it
   the view was cut, and that is what these two turn a scroll position into and
   back.
   ------------------------------- */

// The table body, but only while it is actually laid out - a hidden one has
// every row at position zero, which would anchor to the first entry no matter
// where the page is scrolled to.
function getLaidOutMediaBody() {
    const table = document.getElementById('mediaTable');
    if (!table || table.hidden) return null;
    const tbody = getMediaBody();
    if (!tbody || tbody.style.display === 'none') return null;
    return tbody;
}

// The entry at the top edge of the viewport, or null while the table is above
// it (the page header is still in view) or empty.
export function getMediaScrollAnchor() {
    const tbody = getLaidOutMediaBody();
    if (!tbody || mediaVisible.length === 0) return null;

    const rowsTop = tbody.getBoundingClientRect().top + window.scrollY;
    const viewTop = window.scrollY - rowsTop;
    if (viewTop <= 0) return null;

    let offset = 0;
    for (let i = 0; i < mediaVisible.length; i++) {
        const pitch = mediaRowPitch(mediaVisible[i]);
        if (offset + pitch > viewTop) {
            const path = mediaVisible[i].path;
            return path ? { path: path, offset: Math.round(viewTop - offset) } : null;
        }
        offset += pitch;
    }
    return null;
}

function findRenderedRow(path) {
    const tbody = getMediaBody();
    if (!tbody) return null;
    return Array.from(tbody.children)
        .find(row => row.mediaItem && row.mediaItem.path === path) || null;
}

/**
 * Put the anchored entry back at the top edge.
 *
 * The first jump works off the same estimates the spacers are built from, so it
 * lands on the right entry even when those estimates are off. The row is then
 * really in the DOM and can say where it actually is, which is what the second
 * step corrects against.
 *
 * Returns false when the entry is gone (deleted, or filtered away), so the
 * caller can leave the page where it is instead of scrolling somewhere
 * arbitrary.
 */
export function scrollMediaToAnchor(anchor) {
    if (!anchor || !anchor.path) return false;

    const tbody = getLaidOutMediaBody();
    if (!tbody) return false;

    const index = mediaVisible.findIndex(item => item.path === anchor.path);
    if (index < 0) return false;

    const offset = anchor.offset || 0;
    const rowsTop = tbody.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, Math.round(rowsTop + mediaOffsetOf(index) + offset)));
    renderMediaWindow(true);

    const row = findRenderedRow(anchor.path);
    if (row) {
        // Where the row wants to be: `offset` pixels above the top edge.
        const drift = row.getBoundingClientRect().top + offset;
        if (Math.abs(drift) > 1) {
            window.scrollBy(0, drift);
            renderMediaWindow(true);
        }
    }

    return true;
}

// Where the rendered window currently sits - read by the console helper in
// main.js and handy when tuning the overscan.
export function getMediaWindow() {
    return {
        start: mediaWindowStart,
        end: mediaWindowEnd,
        rowGap: mediaRowGap,
        rowHeight: mediaRowHeightEstimate
    };
}

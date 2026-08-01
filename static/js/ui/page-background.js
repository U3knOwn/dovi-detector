// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The page behind the library, as the run of entries laid out down it.
 *
 * The dark adaptive theme paints a row and the details dialog with the colours
 * of one entry's cover. The page is behind all of them at once, so it does not
 * pick one - it lays them out. Every entry holds the stretch of page its own row
 * covers, in its own colour, and the page between two of them fades from the one
 * to the other. Scrolling then moves through the colours the same way it moves
 * through the list, because they are pinned to the same thing.
 *
 * Pinned to the *document*, and that is the whole trick. A rail measured against
 * the screen would have to be rebuilt on every scroll frame, and rewriting a
 * screenful of gradient that often halves the frame rate - it was the one thing
 * that made this expensive. Measured against the document it does not change
 * while the page moves at all: the browser scrolls the background with everything
 * else, for nothing, and the rail is only rebuilt when the rows themselves change
 * (see setupPageBackground).
 *
 * The page is also not as hidden as it looks. The 20px the body is padded by is
 * the least of it: the table sets 12px of border-spacing between every pair of
 * rows, so the rail shows through the whole length of the list as the seam
 * between one entry and the next, in the blend of the two colours that meet
 * there.
 *
 * Nothing here decides what a colour is - ui/cover-gradient.js owns every colour
 * the theme paints. This owns where they go.
 */

import {
    PAGE_RAIL_PROP, applyCoverGradient, cachedPalette, onCoverColors, pageTint, paintsPage
} from './cover-gradient.js';

// How much of a row's height keeps that row's colour flat, as a share of the
// row. What is left over is where the fade happens.
//
// At 1 an entry owns its whole box and the two colours have the 12px of
// border-spacing to meet in, which is a hard line. At 0 there is nothing but
// fade: one stop in the middle of each row, and the page is a stream that only
// passes through an entry's colour at its centre. In between, an entry holds
// its middle and lets go towards its neighbours - near enough to still read as
// this entry's page, soft enough that scrolling does not step from colour to
// colour.
const BAND_CORE = 0.4;

// Stop positions are rounded to whole pixels. What that buys is not the rounding
// itself but the comparison below it: a rail that has not really changed comes
// out as the same string and is not written again, which is what keeps scrolling
// free.
const round = value => Math.round(value);

// The rail on the page now, so a rebuild that changed nothing is not written
// again - which, once the rendered rows hold still, is every rebuild.
let written = null;

// Set whenever something that decides the rail may have moved. The frame that
// follows is what reads the DOM, so several of them before it lands are still
// one measurement.
let dirty = true;
let frame = null;

function schedule() {
    if (frame === null) frame = requestAnimationFrame(build);
}

function invalidate() {
    dirty = true;
    schedule();
}

/**
 * Every entry the rail runs through, as its colour and the stretch of document
 * its row covers.
 *
 * Only the rows that are actually in the table, which on a long library is the
 * window around the viewport rather than all of it (see library/virtual-table.js)
 * - so the rail is built for the part of the document that can be seen, and the
 * colours at either end simply run on into the part that cannot. When the window
 * moves, the rows are built again, and building a row is one of the things that
 * asks for a rebuild here.
 *
 * An entry whose cover has not been read yet - and one that has no cover at
 * all - does not appear, and the rail fades straight across the gap it leaves.
 * Standing in for it with a neutral colour would be the page inventing the very
 * thing the theme refuses to invent for a row.
 */
function railBands(rows) {
    const top = window.scrollY;
    const bands = [];

    rows.forEach(row => {
        const palette = cachedPalette(row.dataset.cover);
        if (!palette) return;

        const color = pageTint(palette, row.dataset.cover);
        if (!color) return;

        const rect = row.getBoundingClientRect();
        if (rect.height <= 0) return;

        // The flat middle of the row, which is all the rail states outright -
        // everything between one band and the next is the fade from one to the
        // other, and how much of the row that leaves is BAND_CORE's answer.
        const middle = (rect.top + rect.bottom) / 2 + top;
        const core = rect.height * BAND_CORE / 2;
        bands.push({ color, top: round(middle - core), bottom: round(middle + core) });
    });

    return bands;
}

/**
 * The bands as one gradient down the document.
 *
 * Each entry contributes the two stops that hold its colour flat across the
 * middle of its row; everything between one band and the next is the browser
 * fading from the one to the other. Above the first band and below the last
 * there are no stops at all, which is a gradient's own way of saying "and on in
 * that colour".
 *
 * A band whose core rounds away to nothing is one stop rather than two - the
 * same thing said once instead of twice.
 */
function railGradient(bands) {
    if (!bands.length) return null;

    const stops = [];
    bands.forEach(({ color, top, bottom }) => {
        stops.push(`${color} ${top}px`);
        if (bottom > top) stops.push(`${color} ${bottom}px`);
    });
    return `linear-gradient(180deg, ${stops.join(', ')})`;
}

function clear() {
    if (written === null) return;
    written = null;
    document.documentElement.style.removeProperty(PAGE_RAIL_PROP);
}

/**
 * The footer, wearing the entry the table ends on.
 *
 * The rail already carries that entry's colour past the last row and down to
 * the bottom of the document, so the page under the footer is right without
 * anything being done about it - but the footer itself sat on top of that as a
 * strip of nothing. Given the last entry's cover it becomes what it is standing
 * in for: one more row, with the small print in it instead of a film.
 *
 * The last *rendered* row is the last entry whenever the footer can be seen at
 * all - the table only leaves rows out at the far end of a long library, and the
 * far end is exactly where the footer is. Higher up the page the two can differ,
 * and nobody is looking at the footer then.
 *
 * Painted only when the entry changes. Giving an element a cover is one of the
 * things that asks for a rebuild here, so painting on every pass would be a loop
 * that never stops turning.
 */
function dressFooter(last) {
    const footer = document.querySelector('.site-footer');
    if (!footer) return;

    const cover = last ? last.dataset.cover : null;
    if ((footer.dataset.cover || null) === (cover || null)) return;

    applyCoverGradient(footer, cover, last && last.querySelector('img.poster-img'), 'footer');
}

function build() {
    frame = null;

    // Asked first, so a theme that paints no covers costs a comparison rather
    // than a walk over the rows.
    if (!paintsPage()) {
        clear();
        dressFooter(null);
        return;
    }
    if (!dirty) return;
    dirty = false;

    const rows = document.querySelectorAll('#mediaTable tbody tr[data-cover]');
    dressFooter(rows[rows.length - 1] || null);

    const rail = railGradient(railBands(rows));
    if (!rail) {
        clear();
        return;
    }
    // The rail is the same one for as long as the rendered rows are, which is
    // what makes scrolling cost nothing: the string is rebuilt, compared, and
    // dropped, and the page is never repainted.
    if (rail === written) return;

    written = rail;
    document.documentElement.style.setProperty(PAGE_RAIL_PROP, rail);
}

/**
 * Start following the library.
 *
 * The rail is pinned to the document, so scrolling does not change it - but the
 * rows it is built from are rebuilt as the page moves (the table only keeps the
 * ones near the viewport), and every rebuild goes through paint(), which is what
 * onCoverColors reports. That one hook covers the rest as well: a poster that has
 * finished decoding, a filter, a sort, the theme or the strength being switched.
 *
 * Scroll and resize are listened to anyway, as the answer to everything that
 * moves a row without rebuilding it - the header collapsing, a row growing a
 * line, the window changing shape. They are close to free: the rail that comes
 * out is the same string, and an unchanged string is never written.
 */
export function setupPageBackground() {
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate);
    onCoverColors(invalidate);
    invalidate();
}

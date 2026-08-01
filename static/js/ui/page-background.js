// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The page behind the library, in the colours of what is scrolled in front of
 * it.
 *
 * The dark adaptive theme paints a row and the details dialog with the colours
 * of one entry's cover. Those two know which entry they are showing; the page
 * does not - it is behind all of them at once, and behind a different handful
 * a moment later. So its colour is not an entry's but the mix of everything on
 * screen, weighted by how much of the screen each entry is holding, and it
 * follows the scroll because that mix does.
 *
 * Three things are kept apart here:
 *
 *   who counts, and for how much  - the rendered rows, weighted by the share of
 *                                   the viewport they cover and by how near the
 *                                   middle of it they sit (see visibleEntries).
 *   what that mix looks like      - not this module's business: the covers are
 *                                   mixed and turned into light by
 *                                   ui/cover-gradient.js, which owns every
 *                                   colour the theme paints.
 *   how it gets there             - eased rather than set, so the page drifts
 *                                   between colours instead of cutting between
 *                                   them (see tick).
 */

import {
    PAGE_GLOW_PROPS, cachedPalette, mixCovers, onCoverColors, pageGlow, paintsPage
} from './cover-gradient.js';

// How sharply a row's say in the mix falls off with its distance from the
// middle of the screen. It counts for nothing at either edge and for all it
// has in the middle, which settles two things at once.
//
// A row leaving the screen would otherwise drag the page's colour with it on
// the way out, so the mix would change fastest exactly where nobody is looking.
// And an even mix of everything on screen is a mix of three or four posters
// that mostly disagree, which in OKLab is a grey - the page would go quietly
// neutral on a colourful library and stay there. Weighted towards the middle it
// is mostly the colour of what is being looked at, with its neighbours leaning
// on it, and the drift from one to the next happens while both are in the
// middle of the screen rather than at its edges.
const CENTRE_FALLOFF = 2;

// How much of the way to the wanted colour the page moves per frame. Low
// enough that a flick of the wheel reads as a drift rather than a flash, high
// enough that the page has arrived by the time the scroll has.
const SETTLE = 0.11;

// Close enough to the wanted colour to call it arrived, in OKLab units - about
// a thousandth of the axis, which is far below anything a glow at this alpha
// could show.
const EPSILON = 0.0015;

// The least time between two writes. The easing is worked out every frame,
// which is a handful of arithmetic, but each write repaints a screenful of
// gradient - and a colour drifting over a third of a second has nothing to say
// sixty times a second.
const WRITE_MS = 60;

// The mix the page is easing towards, and the one it is showing. Both are the
// stops as OKLab triples, which is what mixCovers deals in and what may be
// interpolated without the hue swinging through colours that were never in it.
let target = null;
let current = null;

// Set whenever something that decides the mix has moved: the page, the window,
// or the rows themselves. The frame that follows is what reads the DOM, so a
// scroll that fires several times before it does is still one measurement.
let dirty = true;
let frame = null;
let lastWrite = 0;

// What is on the page now, so a write that would change nothing is skipped -
// which is what stops the last few frames of an ease, where the colour is
// already rounded to the same channels, from repainting for nothing.
let written = {};

function schedule() {
    if (frame === null) frame = requestAnimationFrame(tick);
}

function invalidate() {
    dirty = true;
    schedule();
}

/**
 * Every entry on screen, with how much of the page's colour it may claim.
 *
 * An entry whose cover has not been read yet - and one that has no cover at
 * all - simply does not appear: it has no colour to contribute, and standing in
 * for it with a neutral one would be the page inventing the very thing the
 * theme refuses to invent for a row. The rows around it carry the mix until it
 * arrives, at which point paint() says so and the mix is taken again.
 */
function visibleEntries() {
    const height = window.innerHeight || 0;
    if (height <= 0) return [];

    const middle = height / 2;
    const entries = [];

    document.querySelectorAll('#mediaTable tbody tr[data-cover]').forEach(row => {
        const palette = cachedPalette(row.dataset.cover);
        if (!palette) return;

        const rect = row.getBoundingClientRect();
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, height);
        if (bottom <= top) return;

        const distance = Math.abs((top + bottom) / 2 - middle) / middle;
        const bias = (1 - Math.min(1, distance)) ** CENTRE_FALLOFF;
        entries.push({ palette, weight: ((bottom - top) / height) * bias });
    });

    return entries;
}

function clear() {
    current = null;
    if (!Object.keys(written).length) return;
    written = {};
    PAGE_GLOW_PROPS.forEach(property =>
        document.documentElement.style.removeProperty(property));
}

function write(now) {
    const values = pageGlow(current);
    if (!values) {
        clear();
        return;
    }

    lastWrite = now;
    Object.entries(values).forEach(([property, value]) => {
        if (written[property] === value) return;
        written[property] = value;
        document.documentElement.style.setProperty(property, value);
    });
}

function tick(now) {
    frame = null;

    // Asked first, so a theme that paints no covers costs a comparison per
    // scroll frame rather than a walk over the rows.
    if (!paintsPage()) {
        target = null;
        clear();
        return;
    }

    if (dirty) {
        dirty = false;
        target = mixCovers(visibleEntries());
    }

    if (!target) {
        clear();
        return;
    }

    // Nothing to ease from on the first mix - and nothing anyone saw either, so
    // the page arrives already wearing it rather than sliding into it from the
    // theme's own colour.
    if (!current) {
        current = target.map(stop => stop.slice());
        write(now);
        return;
    }

    let settled = true;
    for (let stop = 0; stop < current.length; stop++) {
        for (let axis = 0; axis < 3; axis++) {
            const goal = target[stop][axis];
            const eased = current[stop][axis] + (goal - current[stop][axis]) * SETTLE;
            if (Math.abs(goal - eased) <= EPSILON) {
                current[stop][axis] = goal;
            } else {
                current[stop][axis] = eased;
                settled = false;
            }
        }
    }

    // The last frame of an ease is written whatever the clock says: it is the
    // one that lands on the colour, and holding it back would leave the page a
    // shade off with nothing scheduled to correct it.
    if (settled || now - lastWrite >= WRITE_MS) write(now);
    if (!settled) schedule();
}

/**
 * Start following the page.
 *
 * Every reason the mix could change is one of three: the page moved, the window
 * changed shape, or the rows did - which covers a poster that has finished
 * decoding, a filter, a sort, and the theme or the strength being switched,
 * since all of them send the rows through paint() again (see onCoverColors).
 */
export function setupPageBackground() {
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate);
    onCoverColors(invalidate);
    invalidate();
}

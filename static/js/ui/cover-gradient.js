// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * A gradient of the colours an entry's cover is made of.
 *
 * The adaptive themes paint it - behind a scrim - as the background of the
 * details dialog and of every row in the table, so each of them takes its
 * colours from the entry it is showing. Every other theme ignores the property.
 */

// The cover is only read for its colours, so it is sampled small - a few
// thousand pixels are plenty to find what a poster is mostly made of, and the
// whole pass then costs nothing worth measuring.
const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 48;

// How many colours the gradient is built from.
const GRADIENT_COLORS = 3;

// Colours are counted in buckets this many bits per channel wide, so shades of
// the same thing land together instead of each counting for itself.
const BUCKET_BITS = 4;

// How far apart two picked colours have to be (summed per-channel distance, of
// a possible 765) to count as different ones. Without this a poster with one
// strong colour fills every stop with the same shade and the gradient reads as
// flat.
const MIN_DISTANCE = 60;

// Reading a cover costs an image decode and a canvas read, and the table
// rebuilds its rows on every scroll frame - so each cover is read once and the
// gradient it produced is kept. A stored null records "nothing to paint for
// this one", which stops an unreadable poster being retried on every render.
const gradients = new Map();
const inFlight = new Map();

// What each element last asked for. An entry that is scrolled away, or a dialog
// reopened on something else, must not be painted by a cover that only finishes
// loading afterwards.
const wanted = new WeakMap();

/**
 * The colours a poster is mostly made of, most prominent first.
 *
 * Frequency alone picks the greys and near-blacks that fill the margins of
 * most posters, so each bucket's weight is scaled by how saturated it is: a
 * smaller patch of real colour beats a large flat backdrop, without excluding
 * the dark tones that give a poster its mood.
 */
function coverColors(pixels, count) {
    const buckets = new Map();
    const shift = 8 - BUCKET_BITS;

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const key = ((r >> shift) << (BUCKET_BITS * 2)) |
                    ((g >> shift) << BUCKET_BITS) |
                    (b >> shift);
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++;
        } else {
            buckets.set(key, { r, g, b, n: 1 });
        }
    }

    const ranked = [];
    buckets.forEach(bucket => {
        const r = Math.round(bucket.r / bucket.n);
        const g = Math.round(bucket.g / bucket.n);
        const b = Math.round(bucket.b / bucket.n);
        const max = Math.max(r, g, b);
        const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
        ranked.push({ rgb: [r, g, b], weight: bucket.n * (0.35 + saturation) });
    });
    ranked.sort((a, b) => b.weight - a.weight);

    const picked = [];
    for (const candidate of ranked) {
        if (picked.length === count) break;
        const distinct = picked.every(had =>
            Math.abs(had[0] - candidate.rgb[0]) +
            Math.abs(had[1] - candidate.rgb[1]) +
            Math.abs(had[2] - candidate.rgb[2]) >= MIN_DISTANCE);
        if (distinct) picked.push(candidate.rgb);
    }

    // A poster of essentially one colour yields fewer than asked for; the last
    // one stands in for the rest so the gradient still has all its stops.
    while (picked.length && picked.length < count) {
        picked.push(picked[picked.length - 1]);
    }
    return picked;
}

/**
 * Those colours as the gradient a panel paints.
 *
 * Two soft pools over a vertical wash, which is the same shape as the glow
 * behind the page itself - so a panel reads as part of the theme rather than as
 * a picture behind the text. The pools fade to their own colour at zero alpha
 * rather than to ``transparent``, which is transparent *black* and would dirty
 * every fade with grey.
 */
function buildGradient(colors) {
    const [one, two, three] = colors;
    const rgb = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    const fade = c => `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)`;
    return [
        `radial-gradient(120% 90% at 12% 0%, ${rgb(one)} 0%, ${fade(one)} 62%)`,
        `radial-gradient(110% 85% at 88% 6%, ${rgb(two)} 0%, ${fade(two)} 60%)`,
        `linear-gradient(180deg, ${rgb(two)} 0%, ${rgb(three)} 100%)`
    ].join(', ');
}

function gradientFromImage(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_WIDTH;
        canvas.height = SAMPLE_HEIGHT;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const { data } = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

        const colors = coverColors(data, GRADIENT_COLORS);
        return colors.length < GRADIENT_COLORS ? null : buildGradient(colors);
    } catch (e) {
        // No canvas, or a poster served from somewhere that taints it.
        return null;
    }
}

function readCover(posterUrl) {
    if (gradients.has(posterUrl)) return Promise.resolve(gradients.get(posterUrl));
    if (inFlight.has(posterUrl)) return inFlight.get(posterUrl);

    const request = new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(gradientFromImage(img));
        img.onerror = () => resolve(null);
        img.src = posterUrl;
    }).then(gradient => {
        gradients.set(posterUrl, gradient);
        inFlight.delete(posterUrl);
        return gradient;
    });

    inFlight.set(posterUrl, request);
    return request;
}

/**
 * Give ``element`` the gradient of ``posterUrl`` as ``--cover-gradient``.
 *
 * Set on every theme, not just the adaptive ones - the others simply never read
 * the property, and this way switching themes needs no re-render.
 */
export function applyCoverGradient(element, posterUrl) {
    if (!element) return;
    wanted.set(element, posterUrl || null);

    if (!posterUrl) {
        element.style.removeProperty('--cover-gradient');
        return;
    }

    // Already known: set it now rather than a frame later, so a row scrolled
    // back into view does not flash the plain surface first.
    const known = gradients.get(posterUrl);
    if (known !== undefined) {
        if (known) element.style.setProperty('--cover-gradient', known);
        else element.style.removeProperty('--cover-gradient');
        return;
    }

    element.style.removeProperty('--cover-gradient');
    readCover(posterUrl).then(gradient => {
        if (!gradient || wanted.get(element) !== posterUrl) return;
        element.style.setProperty('--cover-gradient', gradient);
    });
}

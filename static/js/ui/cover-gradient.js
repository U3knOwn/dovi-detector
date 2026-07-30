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

// How far a cover may take the surface's lightness, as relative luminance. A
// panel keeps the lightness its theme gives it and takes only the colour: on a
// dark theme an almost white poster otherwise lifted a row from rgb(22,25,35)
// to rgb(81,83,90) and left its badges at 3.8:1. Normally tinted rows sit
// between 0.009 and 0.037, which is the band these keep them in.
const DARK_TINT_MAX_LUMINANCE = 0.25;
const LIGHT_TINT_MIN_LUMINANCE = 0.32;

// How far apart two picked colours have to be (summed per-channel distance, of
// a possible 765) to count as different ones. Without this a poster with one
// strong colour fills every stop with the same shade and the gradient reads as
// flat.
const MIN_DISTANCE = 60;

// Reading a cover costs an image decode and a canvas read, and the table
// rebuilds its rows on every scroll frame - so each cover is read once and the
// colours it yielded are kept. A stored null records "nothing to paint for this
// one", which stops an unreadable poster being retried on every render.
//
// The colours are cached, not the finished gradient: how far they may be taken
// depends on the theme in force when they are painted, and the theme can change
// without the cover doing so.
const palettes = new Map();
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

function relativeLuminance([r, g, b]) {
    const channel = c => {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * How far the cover may take the surface, for the theme in force.
 *
 * A cover decides the panel's colour, not how light it is - that belongs to the
 * theme, and the text is picked against it. Only the adaptive themes read the
 * gradient at all, so the rest are left unlimited.
 */
function tintLimit() {
    const theme = document.documentElement.getAttribute('data-theme') || '';
    if (!theme.endsWith('adaptive')) return null;
    return theme.startsWith('light')
        ? { min: LIGHT_TINT_MIN_LUMINANCE }
        : { max: DARK_TINT_MAX_LUMINANCE };
}

/**
 * One colour pulled back inside that limit, hue intact.
 *
 * Scaling every channel by the same factor keeps the ratios between them, so
 * the colour only loses lightness, never its hue - the exponent undoes sRGB's
 * gamma so the factor lands near the luminance actually asked for.
 */
function limitLuminance(rgb, limit) {
    if (!limit) return rgb;
    const luminance = relativeLuminance(rgb);

    if (limit.max !== undefined && luminance > limit.max) {
        const k = (limit.max / luminance) ** (1 / 2.2);
        return rgb.map(c => Math.round(c * k));
    }
    if (limit.min !== undefined && luminance < limit.min) {
        // Towards white rather than away from black, so a near-black cover
        // cannot sink a light surface.
        const k = ((1 - limit.min) / (1 - luminance)) ** (1 / 2.2);
        return rgb.map(c => Math.round(255 - (255 - c) * k));
    }
    return rgb;
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
function buildGradient(palette) {
    const limit = tintLimit();
    const [one, two, three] = palette.map(c => limitLuminance(c, limit));
    const rgb = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    const fade = c => `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)`;
    return [
        `radial-gradient(120% 90% at 12% 0%, ${rgb(one)} 0%, ${fade(one)} 62%)`,
        `radial-gradient(110% 85% at 88% 6%, ${rgb(two)} 0%, ${fade(two)} 60%)`,
        `linear-gradient(180deg, ${rgb(two)} 0%, ${rgb(three)} 100%)`
    ].join(', ');
}

function paletteFromImage(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_WIDTH;
        canvas.height = SAMPLE_HEIGHT;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const { data } = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

        const colors = coverColors(data, GRADIENT_COLORS);
        return colors.length < GRADIENT_COLORS ? null : colors;
    } catch (e) {
        // No canvas, or a poster served from somewhere that taints it.
        return null;
    }
}

function readCover(posterUrl) {
    if (palettes.has(posterUrl)) return Promise.resolve(palettes.get(posterUrl));
    if (inFlight.has(posterUrl)) return inFlight.get(posterUrl);

    const request = new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(paletteFromImage(img));
        img.onerror = () => resolve(null);
        img.src = posterUrl;
    }).then(palette => {
        palettes.set(posterUrl, palette);
        inFlight.delete(posterUrl);
        return palette;
    });

    inFlight.set(posterUrl, request);
    return request;
}

function paint(element, palette) {
    if (palette) element.style.setProperty('--cover-gradient', buildGradient(palette));
    else element.style.removeProperty('--cover-gradient');
}

/**
 * Give ``element`` the gradient of ``posterUrl`` as ``--cover-gradient``.
 *
 * Set on every theme, not just the adaptive ones - the others simply never read
 * the property, so nothing has to be undone when one of them is picked.
 */
export function applyCoverGradient(element, posterUrl) {
    if (!element) return;
    wanted.set(element, posterUrl || null);

    if (!posterUrl) {
        element.style.removeProperty('--cover-gradient');
        return;
    }

    // Already known: paint it now rather than a frame later, so a row scrolled
    // back into view does not flash the plain surface first.
    const known = palettes.get(posterUrl);
    if (known !== undefined) {
        paint(element, known);
        return;
    }

    element.style.removeProperty('--cover-gradient');
    readCover(posterUrl).then(palette => {
        if (wanted.get(element) !== posterUrl) return;
        paint(element, palette);
    });
}

// How far the cover may take the surface is the theme's call, so every cover on
// screen has to be repainted when the theme changes. The colours themselves are
// cached and unaffected, so this is only string building.
//
// Whoever is wearing one is asked of the DOM rather than kept in a registry
// here. A row is given its cover while it is still in the fragment it is being
// built in, so it is not in the document yet and a registry cannot tell it from
// one that has been thrown away - and rows are thrown away on every render.
if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
        document.querySelectorAll('[style*="--cover-gradient"]').forEach(element => {
            const posterUrl = wanted.get(element);
            if (posterUrl) paint(element, palettes.get(posterUrl));
        });
    }).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme']
    });
}

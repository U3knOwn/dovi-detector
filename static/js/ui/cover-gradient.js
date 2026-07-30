// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * A gradient of the colours an entry's cover is made of.
 *
 * The dark adaptive theme paints it - behind a scrim - as the background of the
 * details dialog and of every row in the table, so each of them takes its
 * colours from the entry it is showing. Every other theme ignores the property.
 */

// The cover is only read for its colours, so it is sampled small - a few
// thousand pixels are plenty to find what a poster is mostly made of, and the
// whole pass then costs nothing worth measuring. The longer side is capped at
// SAMPLE_MAX; width and height then follow the cover's own aspect ratio.
const SAMPLE_MAX = 48;

// How many colours the gradient is built from (corners + centre).
const GRADIENT_COLORS = 5;

// Colours are counted in buckets this many bits per channel wide, so shades of
// the same thing land together instead of each counting for itself.
const BUCKET_BITS = 5;

// How far a cover may take the surface's lightness, as relative luminance. A
// panel keeps the lightness its theme gives it and takes only the colour: an
// almost white poster otherwise lifted a row from rgb(22,25,35) to
// rgb(81,83,90) and left its badges at 3.8:1. Normally tinted rows sit between
// 0.009 and 0.037, which is the band this keeps them in.
const TINT_MAX_LUMINANCE = 0.22;

// How far apart two picked colours have to be (summed per-channel distance, of
// a possible 765) to count as different ones. Without this a poster with one
// strong colour fills every stop with the same shade and the gradient reads as
// flat.
const MIN_DISTANCE = 48;

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
 * most posters, so each bucket's weight is scaled by how saturated it is and
 * by a mild luminance preference: a smaller patch of real colour beats a large
 * flat backdrop, without excluding the dark tones that give a poster its mood.
 * Very dark near-blacks are down-weighted so they do not monopolise every stop.
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
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        // Relative luminance approximation (no gamma) — enough for ranking.
        const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        // Prefer colour over pure grey; still allow dark mood tones, but
        // suppress pure black / pure white that would flatten the gradient.
        const chromaBoost = 0.28 + saturation * 1.35;
        const lumaGuard = luma < 0.04 ? 0.35 : luma > 0.92 ? 0.45 : 1;
        ranked.push({
            rgb: [r, g, b],
            weight: bucket.n * chromaBoost * lumaGuard,
            saturation,
            luma
        });
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

    // A poster of essentially one colour yields fewer than asked for; derive
    // companion stops by shifting lightness so the gradient still has depth
    // instead of repeating the same shade.
    if (picked.length && picked.length < count) {
        const base = picked[picked.length - 1];
        while (picked.length < count) {
            const factor = 0.72 + (picked.length * 0.08);
            picked.push(base.map(c => Math.round(Math.min(255, c * factor))));
        }
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
 * theme, and the text is picked against it. Only dark-adaptive reads the
 * gradient at all, so every other theme is left unlimited.
 */
function tintLimit() {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark-adaptive' ? { max: TINT_MAX_LUMINANCE } : null;
}

/**
 * One colour pulled back under that limit, hue intact.
 *
 * Scaling every channel by the same factor keeps the ratios between them, so
 * the colour only loses lightness, never its hue - the exponent undoes sRGB's
 * gamma so the factor lands near the luminance actually asked for.
 */
function limitLuminance(rgb, limit) {
    if (!limit) return rgb;
    const luminance = relativeLuminance(rgb);

    if (luminance > limit.max) {
        const k = (limit.max / luminance) ** (1 / 2.2);
        return rgb.map(c => Math.round(c * k));
    }
    return rgb;
}

/**
 * Soften a colour toward a darker companion so radial pools feel atmospheric
 * rather than flat solid blobs.
 */
function deepen(rgb, amount = 0.55) {
    return rgb.map(c => Math.round(c * amount));
}

/**
 * The cover's colour as a mark rather than as a surface: the ring and the title
 * a row lights up with while the pointer is on it.
 *
 * This is the opposite problem to the tint. A surface has to stay dark enough
 * for the text on it; a mark sits on that surface and has to stand off it, at
 * one predictable strength whatever the poster is - a dark cover would
 * otherwise light the row up in something barely distinguishable from the row
 * itself. So only the hue is taken from the cover and it is given the theme's
 * own lightness, which is where the fixed indigo it replaces already sat.
 *
 * The hue comes from the most colourful of the picked colours rather than the
 * most prominent: the one a poster is mostly made of is often a near-grey, and
 * a grey has no hue to lend.
 */
const ACCENT_SATURATION = 0.68;
const ACCENT_LIGHTNESS = 0.74;

function accentColor(palette) {
    let best = palette[0];
    let bestSaturation = -1;

    for (const rgb of palette) {
        const max = Math.max(...rgb);
        const saturation = max === 0 ? 0 : (max - Math.min(...rgb)) / max;
        if (saturation > bestSaturation) {
            bestSaturation = saturation;
            best = rgb;
        }
    }

    // A cover with no colour at all - a black and white poster - has no hue to
    // take, and forcing one on it would invent a tint the artwork never had.
    // Its mark is left grey, at the same lightness as any other.
    const hue = bestSaturation < 0.08 ? null : hueOf(best);
    const grey = Math.round(ACCENT_LIGHTNESS * 255);
    return hue === null
        ? [grey, grey, grey]
        : hslToRgb(hue, ACCENT_SATURATION, ACCENT_LIGHTNESS);
}

function hueOf([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const span = max - min;
    if (span === 0) return 0;

    let hue;
    if (max === r) hue = ((g - b) / span) % 6;
    else if (max === g) hue = (b - r) / span + 2;
    else hue = (r - g) / span + 4;
    return (hue * 60 + 360) % 360;
}

function hslToRgb(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const base = lightness - chroma / 2;
    const sector = Math.floor(hue / 60) % 6;
    const [r, g, b] = [
        [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
        [0, second, chroma], [second, 0, chroma], [chroma, 0, second]
    ][sector];
    return [r, g, b].map(c => Math.round((c + base) * 255));
}

/**
 * Those colours as the gradient a panel paints.
 *
 * Five soft radial pools, one at each corner (10 px inset from the edge) and
 * one in the centre. The layout mirrors a 16:9 frame so the glow feels tied
 * to the poster rather than floating arbitrarily:
 *
 *   TL ····· TR
 *      · C ·
 *   BL ····· BR
 *
 * Every radial fades to its own colour at zero alpha (never to transparent
 * black) so the edges stay clean. A light vertical wash underneath anchors
 * the surface and keeps contrast under the scrim.
 */
function buildGradient(palette) {
    const limit = tintLimit();
    const colors = palette.map(c => limitLuminance(c, limit));

    // Ensure we always have five stops even if extraction returned fewer.
    while (colors.length < 5) {
        colors.push(colors[colors.length - 1] || [30, 32, 40]);
    }

    const [tl, tr, bl, br, mid] = colors;
    const dTl = deepen(tl, 0.40);
    const dTr = deepen(tr, 0.42);
    const dBl = deepen(bl, 0.45);
    const dBr = deepen(br, 0.48);
    const dMid = deepen(mid, 0.50);

    const rgb = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

    // 10 px inset from every edge; centre sits at 50 % / 50 %.
    return [
        // Top-left
        `radial-gradient(ellipse 55% 70% at 10px 10px, ${rgb(tl)} 0%, ${rgba(tl, 0.5)} 30%, ${rgba(dTl, 0)} 72%)`,
        // Top-right
        `radial-gradient(ellipse 55% 70% at calc(100% - 10px) 10px, ${rgb(tr)} 0%, ${rgba(tr, 0.48)} 30%, ${rgba(dTr, 0)} 72%)`,
        // Bottom-left
        `radial-gradient(ellipse 55% 70% at 10px calc(100% - 10px), ${rgb(bl)} 0%, ${rgba(bl, 0.45)} 30%, ${rgba(dBl, 0)} 72%)`,
        // Bottom-right
        `radial-gradient(ellipse 55% 70% at calc(100% - 10px) calc(100% - 10px), ${rgb(br)} 0%, ${rgba(br, 0.45)} 30%, ${rgba(dBr, 0)} 72%)`,
        // Centre
        `radial-gradient(ellipse 50% 55% at 50% 50%, ${rgba(mid, 0.55)} 0%, ${rgba(mid, 0.3)} 35%, ${rgba(dMid, 0)} 70%)`,
        // Soft vertical anchor so the surface never goes fully flat
        `linear-gradient(180deg, ${rgba(tl, 0.18)} 0%, ${rgba(mid, 0.22)} 45%, ${rgba(br, 0.28)} 100%)`
    ].join(', ');
}

function sampleSize(img) {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return { width: SAMPLE_MAX, height: Math.round(SAMPLE_MAX * 9 / 16) };

    const longer = Math.max(srcW, srcH);
    const scale = Math.min(1, SAMPLE_MAX / longer);
    return {
        width: Math.max(1, Math.round(srcW * scale)),
        height: Math.max(1, Math.round(srcH * scale))
    };
}

function paletteFromImage(img) {
    try {
        const { width, height } = sampleSize(img);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        const { data } = ctx.getImageData(0, 0, width, height);

        const colors = coverColors(data, GRADIENT_COLORS);
        return colors.length < 2 ? null : colors;
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

// The accent goes out as its three channels rather than as a colour, so the
// stylesheet can hold it at whatever opacity each mark needs - a ring and the
// shadow under it are the same colour at two different strengths.
function paint(element, palette) {
    if (palette) {
        element.style.setProperty('--cover-gradient', buildGradient(palette));
        element.style.setProperty('--cover-accent-rgb', accentColor(palette).join(', '));
    } else {
        element.style.removeProperty('--cover-gradient');
        element.style.removeProperty('--cover-accent-rgb');
    }
}

/**
 * Give ``element`` the colours of ``posterUrl``: the gradient it is backed with
 * as ``--cover-gradient``, and the accent its marks take as
 * ``--cover-accent-rgb``.
 *
 * Set on every theme, not just the adaptive ones - the others simply never read
 * the properties, so nothing has to be undone when one of them is picked.
 */
export function applyCoverGradient(element, posterUrl) {
    if (!element) return;
    wanted.set(element, posterUrl || null);

    if (!posterUrl) {
        paint(element, null);
        return;
    }

    // Already known: paint it now rather than a frame later, so a row scrolled
    // back into view does not flash the plain surface first.
    const known = palettes.get(posterUrl);
    if (known !== undefined) {
        paint(element, known);
        return;
    }

    paint(element, null);
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

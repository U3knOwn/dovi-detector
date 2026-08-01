// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The colours an entry's cover is made of, as the surface a row and the details
 * dialog are painted with.
 *
 * The dark adaptive theme reads five colours out of the poster and hands them
 * over as ``--cover-gradient``, together with the scrim that keeps the text on
 * top readable and the accent the entry's own marks take. Every other theme
 * ignores all of it.
 *
 * Three things decide what comes out, and each of them is a step of its own:
 *
 *   where a colour is taken from  - the cover is read region by region, so the
 *                                   gradient keeps the poster's own layout
 *                                   rather than sorting its colours by how
 *                                   often they occur (see coverPalette).
 *   how far it may be taken       - the lightness is set in OKLab, which leaves
 *                                   the hue alone and keeps the colour from
 *                                   washing out on the way down (see tintColor).
 *   how much of it survives       - the scrim is solved per entry against the
 *                                   contrast the text needs, instead of being
 *                                   one fixed value for every poster
 *                                   (see solveScrim).
 */

// The cover is only read for its colours, so it is sampled small - a few
// thousand pixels are plenty to find what a poster is mostly made of, and the
// whole pass then costs nothing worth measuring. The longer side is capped at
// SAMPLE_MAX; width and height then follow the cover's own aspect ratio.
const SAMPLE_MAX = 48;

// Colours are counted in buckets this many bits per channel wide, so shades of
// the same thing land together instead of each counting for itself.
const BUCKET_BITS = 5;

// How far apart two picked colours have to be (summed per-channel distance, of
// a possible 765) to count as different ones. Two neighbouring regions of a
// poster often hold the same colour; the second one then takes its runner-up,
// so the gradient has something to fade between.
const MIN_DISTANCE = 48;

// The five regions a cover is read in, as fractions of its frame: the four
// quadrants and the centre. The order is the order the stops are placed in,
// which is what ties the gradient to the poster's own composition - a sunset
// along the top of the cover ends up along the top of the row.
const REGIONS = [
    [0, 0, 0.5, 0.5],
    [0.5, 0, 1, 0.5],
    [0, 0.5, 0.5, 1],
    [0.5, 0.5, 1, 1],
    [0.25, 0.25, 0.75, 0.75]
];

// What each stop's lightness is set to, as OKLab's L. Staggered, so the
// gradient keeps some depth instead of reading as one flat wash - and low
// enough that the scrim below has little left to do on an ordinary poster.
const STOP_LIGHTNESS = [0.40, 0.36, 0.31, 0.29, 0.35];

// Below this much chroma a colour is a grey, and a grey has no colour to keep.
const GREY_CHROMA = 0.012;

// Colours lose chroma on the way down - a poster's bright sky is a saturated
// blue at full lightness and a dull one at a fifth of it. These take it back:
// the floor gives a near-grey enough tint to read as one, the gain restores
// what the darkening cost. Both are held inside the sRGB gamut by tintColor.
const MIN_CHROMA = 0.055;
const CHROMA_GAIN = 1.35;

// What the scrim is made of, and how much of it there may be. The colour is the
// theme's own near-black; only how much of it is laid on is decided per entry.
const SCRIM_RGB = [11, 13, 20];
const SCRIM_MIN = 0.10;
const SCRIM_MAX = 0.92;

// The contrast the surface under the text has to leave. The first is what a
// row and the dialog are solved for, the second what they may drop to for as
// long as the pointer is on them and the tint is turned up (see V5's hover
// layer) - still far above the 4.5:1 the text itself would need.
const TEXT_RATIO = 11;
const HOVER_TEXT_RATIO = 8.5;

// What the quietest marks on that surface are lifted to: the field labels, the
// rating logos and the source links. It is the level the two hand-picked
// replacement colours in theme-adaptive.css used to hit, now reached by
// measuring rather than by choosing.
const MARK_RATIO = 6;

// The accent an entry's marks take: the cover's hue at a fixed lightness, so a
// row lights up by the same amount whatever it is showing.
const ACCENT_LIGHTNESS = 0.82;
const ACCENT_CHROMA = 0.115;

// What the page's own glows are made of. The colour is the same idea as the
// accent - the hue is the covers', the lightness and the chroma are the
// theme's - so the page leans the way the library does without one poster
// being able to shout.
const GLOW_LIGHTNESS = 0.55;
const GLOW_CHROMA = 0.15;

// Below this much chroma a mix has no direction left to speak of, and its hue
// is whatever is left over after the colours cancelled - which swings wildly
// for a few pixels of scroll. The colour is faded out towards neutral instead
// of being allowed to flicker.
const GLOW_HUE_FLOOR = 0.03;

// The most of a glow that may be laid on, before the ceiling below has its say.
const GLOW_ALPHA_MAX = 0.34;

// Which of the mixed stops each glow takes, and how much of the solved
// strength it gets: the two at the top of the page carry the cover's top
// corners, the one along the bottom edge its middle. The shares are what keeps
// them from adding up to a brighter page where two of them overlap.
const GLOW_STOPS = [0, 1, 4];
const GLOW_SHARES = [0.9, 0.6, 0.75];

// How bright the page behind the table may get, as the token it must not pass:
// the surface a row is painted over. A page that climbs past it stops reading
// as the thing behind the rows and starts competing with them. It is a measured
// ceiling rather than a chosen one - the dark theme's own fixed glow sits just
// under it, so the adaptive page is allowed exactly as much light as the plain
// one already takes.
const GLOW_CEILING = '--surface-2';

// The properties the page background is handed over as, in the order the glows
// are painted (see theme-adaptive.css).
export const PAGE_GLOW_PROPS = ['--page-glow-1', '--page-glow-2', '--page-glow-3'];

// How strong the tint is, as picked in the theme menu. Off paints no cover at
// all and leaves the plain dark surface - only the accent still follows the
// entry. Subtle takes the colours halfway back to that surface; strong lifts
// them instead of thinning the scrim, so the contrast solved for below holds
// on every level.
const STRENGTH_LEVELS = [
    null,
    { mix: 0.5, lightness: 0, chroma: 1 },
    { mix: 1, lightness: 0, chroma: 1 },
    { mix: 1, lightness: 0.045, chroma: 1.35 }
];
export const DEFAULT_STRENGTH = 2;

// A costume for the table, for the few weeks in the year where one is wanted.
//
// It does not replace the cover: every colour still comes out of the poster and
// keeps its place, its lightness and everything measured on top of it - only the
// hue is pulled towards the nearest of the season's, and the chroma is given a
// floor so the season is legible on a muted poster. A library dressed for
// Halloween is still a library where each entry looks like itself; it just
// leans orange, purple and toxic green while it does.
//
// The hues are the season's own colours as OKLab reads them: pumpkin, witch's
// purple and poison green; fir, christmas red and gold.
const SEASONS = {
    halloween: { hues: [47, 293, 131], pull: 0.78, chroma: 0.10 },
    christmas: { hues: [26, 151, 84], pull: 0.75, chroma: 0.095 }
};

// Also the order the menu lists them in. "none" is the year-round theme, and
// the one nothing has to be said about.
export const SEASON_ORDER = ['none', 'halloween', 'christmas'];
export const DEFAULT_SEASON = 'none';

// The marks that carry a source's own colour rather than the theme's. They are
// declared here and consumed as `var(--rating-trakt, #ed3833)` and friends, so
// every theme but this one keeps the brand colour untouched while this one
// hands over a version measured against the surface it will sit on.
const BRAND_COLORS = {
    '--rating-imdb': [245, 197, 24],
    '--rating-tmdb': [103, 211, 245],
    '--rating-rt': [250, 122, 104],
    '--rating-rt-audience': [247, 201, 75],
    '--rating-trakt': [237, 56, 51],
    '--rating-metacritic': [126, 217, 87],
    '--link-imdb': [245, 197, 24],
    '--link-tmdb': [103, 211, 245],
    '--link-youtube': [255, 123, 123]
};

// What each of the two tinted areas is: which token it is painted over, how its
// gradient is laid out, and whether the entry's own source colours appear in it.
const VARIANTS = {
    row: { surface: '--surface', gradient: rowGradient, brands: false },
    dialog: { surface: '--surface-2', gradient: dialogGradient, brands: true }
};

/* ============================================================
   Colour space
   ------------------------------------------------------------
   sRGB for what the browser paints, OKLab for everything that
   has to keep a colour recognisable while its lightness moves.
   ============================================================ */

function srgbToLinear(channel) {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
    const c = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
}

function relativeLuminance([r, g, b]) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a, b) {
    const first = relativeLuminance(a);
    const second = relativeLuminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function rgbToOklab([r, g, b]) {
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
}

// The linear-light sRGB an OKLab colour would need, which for a colour outside
// the gamut is a channel below 0 or above 1 - which is what oklchToRgb tests.
function oklabToLinearRgb([L, a, b]) {
    const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
    const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
    const sRoot = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = lRoot ** 3, m = mRoot ** 3, s = sRoot ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
}

function rgbToOklch(rgb) {
    const [L, a, b] = rgbToOklab(rgb);
    return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}

const inGamut = channels => channels.every(c => c >= -0.001 && c <= 1.001);

/**
 * An OKLCh colour as sRGB, with the chroma pulled in until it fits.
 *
 * Lightness and hue are what the caller asked for and are never touched -
 * clamping the channels instead would shift both. Only the chroma gives way,
 * which is the one part of the colour that has no room left at that lightness.
 */
function oklchToRgb(lightness, chroma, hue) {
    const rad = hue * Math.PI / 180;
    const at = c => oklabToLinearRgb([lightness, c * Math.cos(rad), c * Math.sin(rad)]);

    let fits = chroma;
    if (!inGamut(at(chroma))) {
        let low = 0, high = chroma;
        for (let i = 0; i < 16; i++) {
            const mid = (low + high) / 2;
            if (inGamut(at(mid))) low = mid; else high = mid;
        }
        fits = low;
    }
    return at(fits).map(linearToSrgb);
}

// Two colours laid over one another the way the browser composites them: in
// sRGB, straight down the channels. Used to work out what a scrim over a cover
// over the theme's own surface actually ends up as.
function composite(top, bottom, alpha) {
    return top.map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha)));
}

/* ============================================================
   Reading the cover
   ============================================================ */

/**
 * The colours of one region of the sample, most prominent first.
 *
 * Frequency alone picks the greys and near-blacks that fill the margins of
 * most posters, so each bucket's weight is scaled by how saturated it is and
 * by a mild luminance preference: a smaller patch of real colour beats a large
 * flat backdrop, without excluding the dark tones that give a poster its mood.
 * Very dark near-blacks are down-weighted so they do not monopolise every stop.
 */
function rankRegion(pixels, width, height, [x0, y0, x1, y1]) {
    const buckets = new Map();
    const shift = 8 - BUCKET_BITS;
    const left = Math.floor(x0 * width), right = Math.max(left + 1, Math.ceil(x1 * width));
    const top = Math.floor(y0 * height), bottom = Math.max(top + 1, Math.ceil(y1 * height));

    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            const i = (y * width + x) * 4;
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
        ranked.push({ rgb: [r, g, b], weight: bucket.n * chromaBoost * lumaGuard });
    });
    ranked.sort((a, b) => b.weight - a.weight);
    return ranked;
}

/**
 * One colour per region, in the order the stops are placed.
 *
 * A region whose strongest colour has already been taken by another one hands
 * over its runner-up instead: neighbouring parts of a poster are often the same
 * colour, and five identical stops are a flat wash rather than a gradient. A
 * region that has nothing else to offer keeps its colour anyway - a poster that
 * really is one colour should look like one.
 */
function coverPalette(pixels, width, height) {
    const picked = [];
    for (const region of REGIONS) {
        const ranked = rankRegion(pixels, width, height, region);
        if (!ranked.length) continue;
        const distinct = ranked.find(candidate => picked.every(had =>
            Math.abs(had[0] - candidate.rgb[0]) +
            Math.abs(had[1] - candidate.rgb[1]) +
            Math.abs(had[2] - candidate.rgb[2]) >= MIN_DISTANCE));
        picked.push((distinct || ranked[0]).rgb);
    }
    return picked;
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

        const colors = coverPalette(data, width, height);
        return colors.length < 2 ? null : colors;
    } catch (e) {
        // No canvas, or a poster served from somewhere that taints it.
        return null;
    }
}

/* ============================================================
   Taking a colour to where it may be painted
   ============================================================ */

/**
 * One cover colour at the lightness a surface is allowed, hue intact.
 *
 * The lightness is *set* rather than scaled: scaling all three channels by one
 * factor keeps their ratios, but not the colour - the further a bright poster
 * had to come down, the more of its chroma went with it, which is how five
 * different posters ended up as the same slate. In OKLab the lightness moves on
 * its own, and the chroma is taken back up afterwards to what the darkening
 * cost, as far as the gamut at that lightness allows.
 *
 * A cover with no colour at all - a black and white poster - is left grey.
 * Forcing chroma on it would invent a tint the artwork never had.
 */
function tintColor(rgb, lightness, chromaGain, season) {
    const [, chroma, hue] = rgbToOklch(rgb);
    if (chroma < GREY_CHROMA) {
        // A black and white poster has no hue, so a season has to lend it one -
        // quietly, since the artwork itself said nothing. Without a season it
        // stays grey: inventing a tint is exactly what the year-round theme
        // must not do.
        return season
            ? oklchToRgb(lightness, season.chroma * 0.7, season.hues[0])
            : oklchToRgb(lightness, 0, hue);
    }
    const [seasonal, floor] = towardSeason(hue, Math.max(chroma, MIN_CHROMA), season);
    return oklchToRgb(lightness, floor * CHROMA_GAIN * chromaGain, seasonal);
}

/**
 * One hue leaned towards the season it is being worn for.
 *
 * The nearest of the season's own hues is the one it goes to, and it only goes
 * most of the way - what is left of the distance is what still tells two covers
 * apart. The chroma floor is the season's, so a nearly grey poster still shows
 * which season it is dressed for.
 */
function towardSeason(hue, chroma, season) {
    if (!season) return [hue, chroma];

    let nearest = 180;
    for (const anchor of season.hues) {
        const delta = ((anchor - hue + 540) % 360) - 180;
        if (Math.abs(delta) < Math.abs(nearest)) nearest = delta;
    }
    return [(hue + nearest * season.pull + 360) % 360, Math.max(chroma, season.chroma)];
}

/**
 * How much scrim this entry needs, rather than how much every entry gets.
 *
 * The tinted surface is at its lightest where its lightest stop is painted
 * solid, so that is what the text has to stay readable against. The answer is
 * the smallest amount of scrim that gets there: a dark cover keeps almost all
 * of its colour, a bright one is held down as far as it has to be, and both end
 * up at the same contrast instead of at the same opacity.
 */
function solveScrim(brightest, base, ratio, text) {
    const readableAt = alpha =>
        contrastRatio(text, composite(SCRIM_RGB, brightest, alpha)) >= ratio;

    if (readableAt(SCRIM_MIN)) return SCRIM_MIN;

    let low = SCRIM_MIN, high = SCRIM_MAX;
    for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        if (readableAt(mid)) high = mid; else low = mid;
    }
    return Math.min(SCRIM_MAX, high);
}

/**
 * One mark lifted off the surface it sits on, hue intact.
 *
 * This is what the two hand-picked replacement colours in theme-adaptive.css
 * did for Trakt and Rotten Tomatoes, as a rule rather than as a pair of
 * constants: the brand keeps its hue, only its lightness climbs, and it climbs
 * exactly as far as the surface in front of it makes necessary. A mark that is
 * already clear of the surface is handed back untouched.
 */
function liftAgainst(rgb, surface, ratio) {
    if (contrastRatio(rgb, surface) >= ratio) return rgb;

    const [lightness, chroma, hue] = rgbToOklch(rgb);
    for (let L = lightness; L <= 0.99; L += 0.01) {
        const candidate = oklchToRgb(L, chroma, hue);
        if (contrastRatio(candidate, surface) >= ratio) return candidate;
    }
    return [255, 255, 255];
}

/**
 * The cover's colour as a mark rather than as a surface: the ring and the title
 * a row lights up with, the dialog's own furniture.
 *
 * This is the opposite problem to the tint. A surface has to stay dark enough
 * for the text on it; a mark sits on that surface and has to stand off it, at
 * one predictable strength whatever the poster is - a dark cover would
 * otherwise light the row up in something barely distinguishable from the row
 * itself. So only the hue is taken from the cover and it is given the theme's
 * own lightness.
 *
 * The hue comes from the most colourful of the picked colours rather than the
 * most prominent: the one a poster is mostly made of is often a near-grey, and
 * a grey has no hue to lend.
 */
function accentColor(palette, season) {
    let best = palette[0];
    let bestChroma = -1;

    for (const rgb of palette) {
        const [, chroma] = rgbToOklch(rgb);
        if (chroma > bestChroma) {
            bestChroma = chroma;
            best = rgb;
        }
    }

    if (bestChroma < GREY_CHROMA * 3) {
        return season
            ? oklchToRgb(ACCENT_LIGHTNESS, ACCENT_CHROMA, season.hues[0])
            : oklchToRgb(ACCENT_LIGHTNESS, 0, 0);
    }
    const [hue] = towardSeason(rgbToOklch(best)[2], ACCENT_CHROMA, season);
    return oklchToRgb(ACCENT_LIGHTNESS, ACCENT_CHROMA, hue);
}

/* ============================================================
   The gradients
   ============================================================ */

const rgbText = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const rgbaText = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const deepen = (rgb, amount) => rgb.map(c => Math.round(c * amount));

/**
 * The dialog's own gradient: the cover's regions in the panel's corners.
 *
 * The panel is one box around the cover it is showing, so the five stops keep
 * the places they had in the poster - top left stays top left. Every radial
 * fades to its own colour at zero alpha (never to transparent black) so the
 * edges stay clean; a light vertical wash underneath anchors the surface.
 */
function dialogGradient(colors) {
    const [tl, tr, bl, br, mid] = colors;
    const dTl = deepen(tl, 0.40), dTr = deepen(tr, 0.42), dBl = deepen(bl, 0.45);
    const dBr = deepen(br, 0.48), dMid = deepen(mid, 0.50);

    return [
        `radial-gradient(ellipse 55% 70% at 10px 10px, ${rgbText(tl)} 0%, ${rgbaText(tl, 0.5)} 30%, ${rgbaText(dTl, 0)} 72%)`,
        `radial-gradient(ellipse 55% 70% at calc(100% - 10px) 10px, ${rgbText(tr)} 0%, ${rgbaText(tr, 0.48)} 30%, ${rgbaText(dTr, 0)} 72%)`,
        `radial-gradient(ellipse 55% 70% at 10px calc(100% - 10px), ${rgbText(bl)} 0%, ${rgbaText(bl, 0.45)} 30%, ${rgbaText(dBl, 0)} 72%)`,
        `radial-gradient(ellipse 55% 70% at calc(100% - 10px) calc(100% - 10px), ${rgbText(br)} 0%, ${rgbaText(br, 0.45)} 30%, ${rgbaText(dBr, 0)} 72%)`,
        `radial-gradient(ellipse 50% 55% at 50% 50%, ${rgbaText(mid, 0.55)} 0%, ${rgbaText(mid, 0.3)} 35%, ${rgbaText(dMid, 0)} 70%)`,
        `linear-gradient(180deg, ${rgbaText(tl, 0.18)} 0%, ${rgbaText(mid, 0.22)} 45%, ${rgbaText(br, 0.28)} 100%)`
    ].join(', ');
}

/**
 * A row's gradient, hung off the cover rather than off the row's corners.
 *
 * A row is some 1400 px wide and 300 px high with the poster at its left end,
 * so pools in its four corners put the brightest part of the surface where
 * there is nothing to light: the colour read as wallpaper behind the row rather
 * than as something the artwork was doing. Here the strongest pool sits over
 * the cover itself and the rest of the row is what it falls off into, with the
 * poster's top and bottom halves opening above and below it.
 *
 * Where the cover sits is the layout's business, not this module's:
 * ``--cover-anchor`` is the middle of the poster column, and the stacked phone
 * layout - where the poster is centred in a card - moves it to the middle
 * (see responsive.css).
 */
function rowGradient(colors) {
    const [tl, tr, bl, br, mid] = colors;
    const anchor = 'var(--cover-anchor, 22%)';
    const anchorY = 'var(--cover-anchor-y, 46%)';
    const above = `calc(${anchor} - 6%)`;
    const below = `calc(${anchor} + 5%)`;

    return [
        `radial-gradient(ellipse 62% 130% at ${anchor} ${anchorY}, ${rgbText(mid)} 0%, ${rgbaText(mid, 0.55)} 34%, ${rgbaText(deepen(mid, 0.5), 0)} 78%)`,
        `radial-gradient(ellipse 44% 90% at ${above} 4%, ${rgbaText(tl, 0.85)} 0%, ${rgbaText(deepen(tl, 0.4), 0)} 70%)`,
        `radial-gradient(ellipse 44% 90% at ${below} 100%, ${rgbaText(bl, 0.8)} 0%, ${rgbaText(deepen(bl, 0.45), 0)} 70%)`,
        `radial-gradient(ellipse 60% 120% at 92% 18%, ${rgbaText(tr, 0.5)} 0%, ${rgbaText(deepen(tr, 0.42), 0)} 76%)`,
        `radial-gradient(ellipse 60% 120% at 78% 96%, ${rgbaText(br, 0.45)} 0%, ${rgbaText(deepen(br, 0.48), 0)} 76%)`,
        `linear-gradient(100deg, ${rgbaText(mid, 0.3)} 0%, ${rgbaText(mid, 0.14)} 42%, ${rgbaText(br, 0.2)} 100%)`
    ].join(', ');
}

/* ============================================================
   The page behind them
   ------------------------------------------------------------
   A row and the dialog each show one entry, so each takes one
   cover. The page shows whatever is scrolled in front of it,
   which is several at once and a different several a moment
   later - so its colour is not one entry's but the mix of what
   is on screen, and it moves as that changes.

   Who is on screen and how much they count for is the caller's
   business (see ui/page-background.js); what a mix of covers
   looks like as light behind the page is this module's.
   ============================================================ */

/**
 * Several covers as one set of colours, weighted by how much of the screen each
 * is holding.
 *
 * Mixed in OKLab and stop by stop, so the covers keep their own layout in the
 * mix - the top corners of five posters average into the top corners of the
 * page. Averaging the a and b axes is also what makes a library of
 * disagreeing posters honest: two opposite hues cancel towards neutral instead
 * of picking a winner, and a run of covers that agree comes out saying so.
 *
 * Lightness is mixed with them and then thrown away by glowColor, which has its
 * own. It is carried along because a stop is one colour, not two numbers and a
 * spare.
 */
export function mixCovers(entries) {
    let total = 0;
    entries.forEach(entry => {
        if (entry.palette && entry.weight > 0) total += entry.weight;
    });
    if (!(total > 0)) return null;

    const stops = [];
    for (let stop = 0; stop < STOP_LIGHTNESS.length; stop++) {
        const mixed = [0, 0, 0];
        entries.forEach(({ palette, weight }) => {
            if (!palette || !(weight > 0)) return;
            const lab = rgbToOklab(palette[Math.min(stop, palette.length - 1)]);
            const share = weight / total;
            for (let axis = 0; axis < 3; axis++) mixed[axis] += lab[axis] * share;
        });
        stops.push(mixed);
    }
    return stops;
}

/**
 * One mixed stop as the light it is painted with.
 *
 * Only the hue survives the trip. A glow is not a surface showing a poster, it
 * is the room the page is lit in, and it has to be the same amount of light
 * whatever is on screen - so the lightness and the chroma are the theme's
 * fixed ones, the way an accent's are.
 *
 * What the mix does decide, besides the hue, is whether there is one at all:
 * a mix that cancelled out has no direction left, so its chroma is faded down
 * with it and the page goes quietly neutral rather than chasing the remainder.
 */
function glowColor([, a, b], level, season) {
    const chroma = Math.hypot(a, b);
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    const lightness = GLOW_LIGHTNESS + level.lightness;

    if (chroma < GREY_CHROMA) {
        // Nothing to take a hue from. A season lends one; without one the page
        // stays the grey the covers agreed on.
        return season
            ? oklchToRgb(lightness, season.chroma * 0.7, season.hues[0])
            : oklchToRgb(lightness, 0, 0);
    }

    const [leaned, floor] = towardSeason(hue, GLOW_CHROMA, season);
    const settled = Math.min(1, chroma / GLOW_HUE_FLOOR);
    return oklchToRgb(lightness, floor * level.chroma * settled, leaned);
}

/**
 * How much of a glow the page can take before it stops being a background.
 *
 * The same shape of answer as the scrim over a row, from the other side: there
 * the surface is held down until the text on it can be read, here the page is
 * held down until it is still darker than the rows in front of it. Solved per
 * colour, because a blue at a given lightness is far darker than a yellow at
 * the same one - fixing the alpha instead would make the page flare every time
 * a warm poster scrolled past.
 */
function solveGlow(rgb, base, ceiling) {
    const brightnessAt = alpha => relativeLuminance(composite(rgb, base, alpha));
    if (brightnessAt(GLOW_ALPHA_MAX) <= ceiling) return GLOW_ALPHA_MAX;

    let low = 0, high = GLOW_ALPHA_MAX;
    for (let i = 0; i < 16; i++) {
        const mid = (low + high) / 2;
        if (brightnessAt(mid) <= ceiling) low = mid; else high = mid;
    }
    return low;
}

/**
 * Whether the page is one of the surfaces the covers reach right now.
 *
 * Asked before anything is measured, not only before it is painted: working out
 * who is on screen means a walk over the rendered rows and a rect from each of
 * them, once a frame while the page is moving, and on a theme that paints no
 * covers all of it would be for nothing.
 */
export function paintsPage() {
    return themeReadsCover() && Boolean(STRENGTH_LEVELS[coverStrength()]);
}

/**
 * A mix of covers as the page's three glows, or null when there is no page to
 * paint: another theme, or the tint turned off - both of which leave the plain
 * theme's own fixed glows in place, since the properties simply stop being set
 * and the stylesheet falls back to them.
 */
export function pageGlow(stops) {
    if (!stops || !paintsPage()) return null;

    const level = STRENGTH_LEVELS[coverStrength()];
    const season = SEASONS[coverSeason()];
    const base = themeColor('--bg', [10, 12, 18]);
    const ceiling = relativeLuminance(themeColor(GLOW_CEILING, [23, 27, 38]));

    const values = {};
    GLOW_STOPS.forEach((stop, glow) => {
        const rgb = glowColor(stops[Math.min(stop, stops.length - 1)], level, season);
        const alpha = solveGlow(rgb, base, ceiling) * GLOW_SHARES[glow] * level.mix;
        values[PAGE_GLOW_PROPS[glow]] = rgbaText(rgb, alpha.toFixed(3));
    });
    return values;
}

/* ============================================================
   What the theme in force allows
   ============================================================ */

// The one theme whose stylesheet reads the properties this module sets.
const ADAPTIVE_THEME = 'dark-adaptive';

function themeReadsCover() {
    return document.documentElement.getAttribute('data-theme') === ADAPTIVE_THEME;
}

export function coverSeason() {
    const name = document.documentElement.getAttribute('data-cover-season');
    return SEASONS[name] ? name : DEFAULT_SEASON;
}

export function coverStrength() {
    const raw = parseInt(document.documentElement.getAttribute('data-cover-strength'), 10);
    return Number.isInteger(raw) && raw >= 0 && raw < STRENGTH_LEVELS.length ? raw : DEFAULT_STRENGTH;
}

// The theme's own colours are read off the page rather than repeated here, so
// a token that changes in tokens.css changes here with it. They are looked up
// once per theme - a getComputedStyle call per row would be a style recalc in
// the middle of scrolling.
let tokenCache = { theme: null, values: new Map() };

function parseColor(value) {
    const text = (value || '').trim();
    const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(text);
    if (hex) {
        const digits = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
        return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16));
    }
    const parts = /^rgba?\(([^)]+)\)$/i.exec(text);
    if (parts) {
        const channels = parts[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
        if (channels.length >= 3) return channels.slice(0, 3).map(c => Math.round(c));
    }
    return null;
}

function themeColor(token, fallback) {
    const theme = document.documentElement.getAttribute('data-theme') || '';
    if (tokenCache.theme !== theme) tokenCache = { theme, values: new Map() };
    if (tokenCache.values.has(token)) return tokenCache.values.get(token);

    const value = parseColor(getComputedStyle(document.documentElement).getPropertyValue(token))
        || fallback;
    tokenCache.values.set(token, value);
    return value;
}

/* ============================================================
   Painting an element
   ============================================================ */

// Reading a cover costs an image decode and a canvas read, and the table
// rebuilds its rows on every scroll frame - so each cover is read once and the
// colours it yielded are kept. A stored null records "nothing to paint for this
// one", which stops an unreadable poster being retried on every render.
//
// The colours are cached as they came out of the poster: how far they may be
// taken depends on the theme and the strength in force when they are painted,
// and both can change without the cover doing so.
const palettes = new Map();
const inFlight = new Map();

// What each element last asked for is kept on the element itself, as
// ``data-cover``. It settles two questions at once: an entry that is scrolled
// away, or a dialog reopened on something else, must not be painted by a cover
// that only finishes loading afterwards - and a theme switch has to find
// everything that wants a cover, including the ones nothing has been read for
// yet (see the observer at the bottom).
const COVER_ATTR = 'cover';
const VARIANT_ATTR = 'coverVariant';

// Every property this module may put on an element, so nothing is left behind
// when there is no cover to paint.
const PAINTED = [
    '--cover-gradient', '--cover-scrim', '--cover-scrim-hover',
    '--cover-accent-rgb', '--cover-surface-rgb', '--text-faint',
    ...Object.keys(BRAND_COLORS)
];

function clear(element) {
    PAINTED.forEach(property => element.style.removeProperty(property));
}

// The properties that mean something to every theme, not only to the one that
// measured them: the quietest text colour and the source colours are read
// wherever they are set, and --cover-surface-rgb decides the colour of the
// phone's own bars. They are measured against the adaptive theme's tinted
// surface, so they may only sit on an element while that theme is painting -
// on any other one they would be a colour chosen for a surface that is not
// there. The rest is read by theme-adaptive.css alone, which is why a cover
// that is already known can be handed over on every theme.
const THEME_BOUND = ['--text-faint', '--cover-surface-rgb', ...Object.keys(BRAND_COLORS)];

/**
 * Give ``element`` everything the stylesheet needs to paint one entry: the
 * gradient, the scrim solved for it, the accent its marks take, and - in the
 * dialog - the source colours measured against the surface they will sit on.
 */
function paint(element, palette, variant, key) {
    try {
        const values = palette && paintValues(palette, variant, key);
        if (values) {
            const bound = themeReadsCover();
            Object.entries(values).forEach(([property, value]) => {
                if (bound || !THEME_BOUND.includes(property)) {
                    element.style.setProperty(property, value);
                } else {
                    element.style.removeProperty(property);
                }
            });
            PAINTED.filter(property => !(property in values))
                .forEach(property => element.style.removeProperty(property));
        } else {
            clear(element);
        }
    } finally {
        // The dialog's surface decides the colour the phone's own status bar
        // takes while it is open, and only the dialog listens (see
        // media-dialog.js).
        if (variant === 'dialog') element.dispatchEvent(new CustomEvent('cover-painted'));
        else notifyCoverColors();
    }
}

// What the page behind the table is listening for. Every reason its colour
// could have changed passes through paint(): a row built, a poster that has
// finished decoding, a theme or a strength that sent every row through here
// again. So this is the one place that has to say so, rather than each of them
// separately - and the listener only marks itself dirty and waits for the next
// frame, so being told thirty times while a window of rows is rebuilt costs
// nothing.
const coverListeners = new Set();

export function onCoverColors(listener) {
    coverListeners.add(listener);
}

function notifyCoverColors() {
    coverListeners.forEach(listener => listener());
}

/**
 * The colours already read for ``posterUrl``, or null when there is nothing to
 * paint for it and undefined when it has not been read yet.
 *
 * Only what is known: this never starts a read, because the caller is the page
 * background, and the covers it mixes are the ones the table has on screen -
 * every one of them is already being read by the row that is showing it.
 */
export function cachedPalette(posterUrl) {
    return palettes.get(posterUrl);
}

/**
 * Everything one entry contributes to the stylesheet, as property values.
 *
 * Worked out once per cover, area and strength, and kept: the answer is the
 * same for every row showing that poster, and the table throws its rows away
 * and builds them again on every scroll frame - solving a scrim and lifting a
 * handful of marks per row per frame is work nobody asked for. What the theme
 * itself contributes is dropped along with the token cache when the theme
 * changes (see repaintCovers).
 */
const derived = new Map();

function paintValues(palette, variant, key) {
    const strength = coverStrength();
    const season = coverSeason();
    const cacheKey = key && `${key}|${variant}|${strength}|${season}`;
    if (cacheKey && derived.has(cacheKey)) return derived.get(cacheKey);

    const values = deriveValues(palette, variant, STRENGTH_LEVELS[strength], SEASONS[season]);
    if (cacheKey) derived.set(cacheKey, values);
    return values;
}

function deriveValues(palette, variant, level, season) {
    const values = {};
    // The accent is what the entry is recognised by, so it survives even when
    // the tint is switched off entirely - a season included, which is then the
    // only thing left of it.
    values['--cover-accent-rgb'] = accentColor(palette, season).join(', ');
    if (!level) return values;

    const spec = VARIANTS[variant] || VARIANTS.row;
    const base = themeColor(spec.surface, [18, 21, 29]);
    const text = themeColor('--text', [232, 236, 244]);

    const colors = palette.map((rgb, index) => {
        const tinted = tintColor(rgb, STOP_LIGHTNESS[index] + level.lightness, level.chroma, season);
        return level.mix < 1 ? composite(tinted, base, level.mix) : tinted;
    });

    const brightest = colors.reduce((a, c) => relativeLuminance(c) > relativeLuminance(a) ? c : a);
    const scrim = solveScrim(brightest, base, TEXT_RATIO, text);
    const hoverScrim = Math.min(scrim, solveScrim(brightest, base, HOVER_TEXT_RATIO, text));
    // What the text will actually sit on, at the surface's lightest point -
    // which is what everything below is measured against.
    const surface = composite(SCRIM_RGB, brightest, scrim);

    values['--cover-gradient'] = spec.gradient(colors);
    values['--cover-scrim'] = rgbaText(SCRIM_RGB, scrim.toFixed(3));
    values['--cover-scrim-hover'] = rgbaText(SCRIM_RGB, hoverScrim.toFixed(3));
    values['--cover-surface-rgb'] = surface.join(', ');

    // The quietest text in a tinted area. The theme picks it against one known
    // surface; here it sits on whatever the entry's cover happens to be, and it
    // is the first thing to run out of margin - so it is lifted to the same
    // level as every other mark rather than being given a second fixed value.
    const faint = themeColor('--text-faint', [98, 108, 128]);
    values['--text-faint'] = rgbText(liftAgainst(faint, surface, MARK_RATIO));

    if (spec.brands) {
        Object.entries(BRAND_COLORS).forEach(([property, brand]) => {
            values[property] = rgbText(liftAgainst(brand, surface, MARK_RATIO));
        });
    }
    return values;
}

/**
 * Resolves once ``image`` can be read: true when it has pixels, false when it
 * will never load.
 *
 * An image that is taken out of the document before it loads - a row scrolled
 * past while its poster was still on the way - simply never resolves. It is
 * collected together with the row it belonged to, and nothing is recorded for
 * the poster, so the next row showing it reads it again.
 */
function imageReady(image) {
    if (image.complete) return Promise.resolve(image.naturalWidth > 0);

    return new Promise(resolve => {
        image.addEventListener('load', () => resolve(image.naturalWidth > 0), { once: true });
        image.addEventListener('error', () => resolve(false), { once: true });
    });
}

/**
 * The colours of ``posterUrl``, read from ``image`` when the page is already
 * showing that poster.
 *
 * Reading the image the table (or the dialog) has anyway is the difference
 * between one decode and two, and it leaves ``loading="lazy"`` in charge of
 * whether the poster is fetched at all: an Image() of its own downloads every
 * cover in the table the moment the rows are built, however few of them are on
 * screen. Only a caller without an image to point at - there is none today -
 * falls back to loading one here.
 */
function readCover(posterUrl, image) {
    if (palettes.has(posterUrl)) return Promise.resolve(palettes.get(posterUrl));

    if (image) {
        return imageReady(image).then(ready => {
            if (!ready) return null;
            const palette = paletteFromImage(image);
            palettes.set(posterUrl, palette);
            return palette;
        });
    }

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

/**
 * Give ``element`` the colours of ``posterUrl``. ``image`` is the poster the
 * element is already showing, which is what the colours are read from, and
 * ``variant`` says which of the two tinted areas is being painted - a row or
 * the details dialog - since they differ in what they are painted over and in
 * how their gradient is laid out.
 *
 * A colour already known is set on every theme, not just the adaptive one - the
 * others simply never read the properties, so nothing has to be undone when one
 * of them is picked. Reading a cover that is *not* known yet is left to the
 * theme that actually paints it: it costs a decode and a canvas read per
 * poster, which on a table of covers is the most expensive thing on the page,
 * and no other theme would show anything for it.
 */
export function applyCoverGradient(element, posterUrl, image, variant = 'row') {
    if (!element) return;

    if (!posterUrl) {
        delete element.dataset[COVER_ATTR];
        delete element.dataset[VARIANT_ATTR];
        paint(element, null, variant);
        return;
    }

    element.dataset[COVER_ATTR] = posterUrl;
    element.dataset[VARIANT_ATTR] = variant;

    // Already known: paint it now rather than a frame later, so a row scrolled
    // back into view does not flash the plain surface first.
    const known = palettes.get(posterUrl);
    if (known !== undefined) {
        paint(element, known, variant, posterUrl);
        return;
    }

    paint(element, null, variant);
    if (!themeReadsCover()) return;

    readCover(posterUrl, image).then(palette => {
        if (element.dataset[COVER_ATTR] !== posterUrl) return;
        paint(element, palette, variant, posterUrl);
    });
}

// The poster an element is showing: a row's own image, or the dialog's.
const COVER_IMAGE = 'img.poster-img, img.dialog-poster-img';

// How far a cover may be taken is the theme's call, the strength's and the
// season's, so every cover on screen has to be repainted when any of them
// changes - and switching *to*
// the adaptive theme is the moment the covers nothing has read yet are read.
//
// Whoever is wearing one is asked of the DOM rather than kept in a registry
// here. A row is given its cover while it is still in the fragment it is being
// built in, so it is not in the document yet and a registry cannot tell it from
// one that has been thrown away - and rows are thrown away on every render.
export function repaintCovers() {
    tokenCache = { theme: null, values: new Map() };
    derived.clear();
    document.querySelectorAll(`[data-${COVER_ATTR}]`).forEach(element => {
        applyCoverGradient(element, element.dataset[COVER_ATTR],
                           element.querySelector(COVER_IMAGE),
                           element.dataset[VARIANT_ATTR] || 'row');
    });
}

if (typeof MutationObserver === 'function') {
    new MutationObserver(repaintCovers).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-cover-strength', 'data-cover-season']
    });
}

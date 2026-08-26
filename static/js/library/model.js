// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * One scanned entry as the page uses it: the keys sorting and searching
 * work on, and the text and badge classes a row shows.
 */

import { t } from '../core/i18n.js';
import { getAudioRank, getChannelCount, getCmStructureKey, getCmVersionRank, getProfileRank } from '../helpers/ranking.js';

// Numeric field of an entry, 0 when absent - which is how every comparator
// treats a missing value.
function mediaNumber(value) {
    const number = parseFloat(value);
    return isFinite(number) ? number : 0;
}

/**
 * Derive everything sorting, searching and rendering need from one entry.
 *
 * Done once per entry when the library loads, so a sort compares plain numbers
 * and strings instead of re-deriving ranks for every single comparison.
 */
export function prepareMediaItem(raw) {
    const item = raw || {};

    item.filename = item.filename || '';
    item.path = item.path || '';
    item.hdr_format = item.hdr_format || '';
    item.hdr_detail = item.hdr_detail || '';
    item.el_type = item.el_type || '';
    item.resolution = item.resolution || '';
    item.video_codec = item.video_codec || '';
    item.video_codec_profile = item.video_codec_profile || '';
    item.video_encoder = item.video_encoder || '';
    item.audio_codec = item.audio_codec || '';

    // The IMDb rating is what is shown; entries without one (no OMDb key,
    // unknown title) keep falling back to the TMDB rating.
    item.rating = mediaNumber(item.imdb_rating) || mediaNumber(item.tmdb_rating);

    item.sortFilename = item.filename.toLowerCase();
    item.sortFileSize = mediaNumber(item.file_size);
    item.sortVideoBitrate = mediaNumber(item.video_bitrate);
    item.sortAudioBitrate = mediaNumber(item.audio_bitrate);
    item.sortDuration = mediaNumber(item.duration);
    item.sortMtime = mediaNumber(item.mtime);
    item.sortYear = mediaNumber(item.tmdb_year);
    item.sortTmdbRating = mediaNumber(item.tmdb_rating);
    item.sortRtRating = mediaNumber(item.rt_rating);
    item.sortRtAudience = mediaNumber(item.rt_audience);
    item.sortTraktRating = mediaNumber(item.trakt_rating);
    item.sortMetacritic = mediaNumber(item.metacritic);
    // Titles outside the chart sort behind every ranked one
    item.sortTop250 = mediaNumber(item.imdb_top250) || Infinity;

    item.profileRank = getProfileRank(item.hdr_format, item.hdr_detail, item.el_type);
    item.statKey = getMediaStatKey(item);
    // The two chip rows below the table count by these, so the counting itself
    // stays a lookup per entry rather than a parse.
    item.resolutionTier = getResolutionTier(item.resolution);
    item.codecKey = item.video_codec && item.video_codec !== 'Unknown' ? item.video_codec : '';
    item.audioRank = getAudioRank(item.audio_codec);
    item.audioChannels = getChannelCount(item.audio_codec);
    item.audioKey = item.audio_codec.toLowerCase();
    item.cmRank = getCmVersionRank(item.dv_cm_version);
    item.cmStructure = getCmStructureKey(item.dv_cm_version);

    // Height of the rendered row, filled in once the row has been on screen
    item.rowHeight = 0;

    prepareMediaSearchText(item);
    return item;
}

/**
 * The text a search matches against: the same content the row shows - title or
 * filename, HDR, resolution and audio.
 *
 * Rebuilt on a language switch, because the badges of an entry with unknown
 * values carry the translated "unknown" label.
 */
export function prepareMediaSearchText(item) {
    item.searchText = [
        mediaTitleText(item),
        mediaHdrText(item),
        item.resolution,
        item.resolutionTier,
        mediaVideoCodecSearchText(item),
        mediaAudioText(item)
    ].join(' ').toLowerCase();
}

// What the card shows above the poster: the TMDB title with its year, or the
// filename for entries that have no poster or were scanned without a TMDB key.
export function mediaTitleText(item) {
    if (item.poster_url && item.tmdb_title) {
        return item.tmdb_year
            ? `${item.tmdb_title} (${item.tmdb_year})`
            : item.tmdb_title;
    }
    return item.filename;
}

// The HDR detail an entry shows, with the translated placeholder for one that
// carries none. The badge in the table renders the same text.
export function mediaHdrDetailText(item) {
    return (!item.hdr_detail || item.hdr_detail === 'Unknown')
        ? t('unknown')
        : item.hdr_detail;
}

// Label of the HDR badge, including the enhancement layer where there is one.
function mediaHdrText(item) {
    const detail = mediaHdrDetailText(item);
    return item.el_type ? `${detail} (${item.el_type})` : detail;
}

export function mediaAudioText(item) {
    return (!item.audio_codec || item.audio_codec === 'Unknown')
        ? t('unknown')
        : item.audio_codec;
}

// Whether a scan determined the video codec at all. An entry from a database
// written before codecs were recorded carries no field at all, which reads the
// same as a stream that could not be identified: nothing to show.
function hasVideoCodec(item) {
    return Boolean(item.video_codec) && item.video_codec !== 'Unknown';
}

/**
 * The codec as the details dialog spells it out: the name a library labels it
 * with ("H.265", not "HEVC"), then the stream's profile and the encoder that
 * produced it, separated by middots - "H.265 · Main 10 · x265".
 */
export function mediaVideoCodecDetailText(item) {
    if (!hasVideoCodec(item)) return t('unknown');
    return [item.video_codec, item.video_codec_profile, item.video_encoder]
        .filter(Boolean)
        .join(' · ');
}

// Everything about the codec a search should match, the badge label included.
function mediaVideoCodecSearchText(item) {
    if (!hasVideoCodec(item)) return t('unknown');
    return [item.video_codec, item.video_codec_profile, item.video_encoder]
        .filter(Boolean)
        .join(' ');
}

// CSS modifier of the HDR badge, e.g. "HDR10+" -> "hdr-hdr10plus"
export function mediaHdrClass(item) {
    return 'hdr-' + item.hdr_format.toLowerCase().replace(/ /g, '-').replace(/\+/g, 'plus');
}

// Known resolutions get their own badge colour, anything else is "unknown".
const KNOWN_RESOLUTIONS = new Set([
    '4K (UHD)', '1080p (Full HD)', '720p (HD)', '480p (SD)', '1440p', '8K (UHD)', '768p'
]);

// Which tier a named resolution is counted under below the table. Mirrors
// resolution_class() in core/library_ops.py, which answers the same question
// for /api/v1/library/stats.
const RESOLUTION_TIERS = {
    '8K (UHD)': '8K',
    '4K DCI': '4K',
    '4K (UHD)': '4K',
    '1440p': 'QHD',
    '1080p (Full HD)': 'FHD',
    '768p': 'HD',
    '720p (HD)': 'HD',
    '480p (SD)': 'SD'
};

// The smallest frame each tier starts at, largest first.
const RESOLUTION_TIER_STEPS = [
    [7680, '8K'], [3840, '4K'], [2560, 'QHD'], [1920, 'FHD'], [1280, 'HD'], [1, 'SD']
];

/**
 * Which of SD / HD / FHD / QHD / 4K / 8K an entry's resolution counts as, or ""
 * for one whose resolution was never determined.
 *
 * A frame size without a name of its own ("3840x1600") is measured by its long
 * side, widened to what the frame would be at 16:9 - so a scope crop still
 * counts as the tier it was mastered in, and an anamorphic 1440x1080 as FHD
 * rather than HD.
 */
function getResolutionTier(resolution) {
    const name = (resolution || '').trim();
    if (!name || name === 'Unknown') return '';
    if (RESOLUTION_TIERS[name]) return RESOLUTION_TIERS[name];

    const frame = name.match(/^(\d+)\s*x\s*(\d+)$/);
    if (!frame) return '';

    const width = parseInt(frame[1], 10);
    const height = parseInt(frame[2], 10);
    if (!width || !height) return '';

    const measure = Math.max(
        Math.max(width, height),
        Math.floor(Math.min(width, height) * 16 / 9));
    const tier = RESOLUTION_TIER_STEPS.find(([minimum]) => measure >= minimum);
    return tier ? tier[1] : '';
}

export function mediaResolutionClass(item) {
    const resolution = item.resolution;
    if (resolution.includes('x') && !KNOWN_RESOLUTIONS.has(resolution)) {
        return 'resolution-unknown';
    }
    return 'resolution-' + resolution.toLowerCase().replace(/ /g, '-');
}

// CSS modifier of the audio badge, picked from the codec string.
export function mediaAudioClass(item) {
    const codec = item.audio_codec;
    if (codec.includes('TrueHD') && codec.includes('Atmos')) return 'audio-truehd-atmos';
    if (codec.includes('DTS:X') || codec.includes('DTS-X')) return 'audio-dtsx';
    if (codec.includes('TrueHD')) return 'audio-truehd';
    if (codec.includes('DTS-HD MA')) return 'audio-dts-hd-ma';
    if (codec.includes('DTS-HD HRA')) return 'audio-dts-hd-hra';
    if (codec.includes('Digital Plus') && codec.includes('Atmos')) return 'audio-ddplus-atmos';
    if (codec.includes('Digital Plus')) return 'audio-ddplus';
    if (codec.includes('Dolby Digital')) return 'audio-dolby-digital';
    if (codec.includes('DTS')) return 'audio-dts';
    if (codec.includes('AAC')) return 'audio-aac';
    if (codec.includes('FLAC') || codec.includes('PCM')) return 'audio-lossless';
    return 'audio-unknown';
}

// Which stat chip an entry is counted under.
function getMediaStatKey(item) {
    const elType = (item.el_type || '').toUpperCase();
    const hdrFormat = (item.hdr_format || '').toLowerCase();
    const hdrDetail = (item.hdr_detail || '').toLowerCase();

    // Check for FEL or MEL
    if (elType === 'FEL') return 'FEL';
    if (elType === 'MEL') return 'MEL';
    // Check for Profile 8
    if (hdrDetail.includes('profile 8') ||
        hdrDetail.includes('profile8') ||
        hdrDetail.includes('p8') ||
        hdrFormat.includes('profile 8') ||
        hdrFormat.includes('p8')) {
        return 'P8';
    }
    // Check for Profile 5
    if (hdrDetail.includes('profile 5') ||
        hdrDetail.includes('profile5') ||
        hdrDetail.includes('p5')) {
        return 'P5';
    }
    // Check for HDR10+ (must be checked before HDR10 to avoid false matches)
    if (hdrFormat.includes('hdr10+') ||
        hdrDetail.includes('hdr10+') ||
        hdrFormat.includes('hdr10plus') ||
        hdrDetail.includes('hdr10plus')) {
        return 'HDR10+';
    }
    // Check for SL-HDR1 / SL-HDR2 / SL-HDR3
    if (hdrFormat.includes('sl-hdr') || hdrDetail.includes('sl-hdr')) return 'SL-HDR';
    // Check for HDR Vivid
    if (hdrFormat.includes('vivid') || hdrDetail.includes('vivid')) return 'HDR Vivid';
    // Check for HDR10 (but not HDR10+, which is handled above)
    if (hdrFormat.includes('hdr10') ||
        hdrDetail.includes('hdr10') ||
        hdrFormat.includes('smpte2084')) {
        return 'HDR10';
    }
    // Check for HLG
    if (hdrFormat.includes('hlg') || hdrDetail.includes('hlg')) return 'HLG';
    // Check for SDR
    if (hdrFormat.includes('sdr') || hdrDetail.includes('sdr')) return 'SDR';

    return null;
}

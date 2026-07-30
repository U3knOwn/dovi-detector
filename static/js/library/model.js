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

// Label of the HDR badge, including the enhancement layer where there is one.
function mediaHdrText(item) {
    const detail = (!item.hdr_detail || item.hdr_detail === 'Unknown')
        ? t('unknown')
        : item.hdr_detail;
    return item.el_type ? `${detail} (${item.el_type})` : detail;
}

export function mediaAudioText(item) {
    return (!item.audio_codec || item.audio_codec === 'Unknown')
        ? t('unknown')
        : item.audio_codec;
}

// CSS modifier of the HDR badge, e.g. "HDR10+" -> "hdr-hdr10plus"
export function mediaHdrClass(item) {
    return 'hdr-' + item.hdr_format.toLowerCase().replace(/ /g, '-').replace(/\+/g, 'plus');
}

// Known resolutions get their own badge colour, anything else is "unknown".
const KNOWN_RESOLUTIONS = new Set([
    '4K (UHD)', '1080p (Full HD)', '720p (HD)', '480p (SD)', '1440p', '8K (UHD)', '768p'
]);

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

/* -------------------------------
   Row rendering
   ------------------------------- */

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

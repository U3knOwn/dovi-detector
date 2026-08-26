// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Sort modes and sort direction.
 */

import { mediaItems } from './store.js';
import { applyMediaFilter } from './view.js';
import { sortSelectInstance } from '../ui/custom-select.js';
import { onLanguageChange, t } from '../core/i18n.js';

/* Sort direction.
 *
 * Every comparator further down describes the *descending* order of its mode
 * (best/highest/newest first), so ascending is simply the negated result -
 * `sortSign` carries that flip and is refreshed by applySort().
 *
 * `sortDirection` stays null until the user picks a direction: with nothing
 * stored, each mode falls back to the order that reads naturally for it
 * (A-Z for filenames, highest first for ratings, sizes, bitrates, dates).
 * Once picked, the choice is persisted and applies to every mode. */
let sortDirection = null;
let sortSign = 1;

const NATURAL_ASC_MODES = new Set(['filename']);

function getSortMode() {
    if (sortSelectInstance) return sortSelectInstance.getValue();
    return localStorage.getItem('dovi_sort_mode') || 'filename';
}

function getSortDirection(mode) {
    if (sortDirection) return sortDirection;
    return NATURAL_ASC_MODES.has(mode || getSortMode()) ? 'asc' : 'desc';
}

export function initSortDirection() {
    let saved = null;
    try {
        saved = localStorage.getItem('dovi_sort_dir');
    } catch (e) { /* localStorage unavailable -> keep the per-mode default */ }
    sortDirection = (saved === 'asc' || saved === 'desc') ? saved : null;
}

export function toggleSortDirection() {
    const mode = getSortMode();
    sortDirection = getSortDirection(mode) === 'asc' ? 'desc' : 'asc';
    try {
        localStorage.setItem('dovi_sort_dir', sortDirection);
    } catch (e) { /* localStorage unavailable -> direction just won't persist */ }
    applySort(mode);
}

// Keep the toggle's arrow and its label in sync with the direction the given
// mode is currently sorted in. The button is icon-only, so the direction is
// spelled out in the tooltip and the accessible name.
function updateSortDirToggle(mode) {
    const btn = document.getElementById('sortDirToggle');
    if (!btn) return;
    const asc = getSortDirection(mode) === 'asc';
    const label = `${t('sort_direction_toggle')} - ${t(asc ? 'sort_direction_asc' : 'sort_direction_desc')}`;

    btn.classList.toggle('asc', asc);
    btn.setAttribute('aria-pressed', asc ? 'true' : 'false');
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
}

/* Every comparator below describes the descending order of its mode and works
   on the keys prepareMediaItem() derived, so a sort is plain number and string
   comparison over an array - the table is re-rendered once at the end. */

// Shared last resort of the comparators: alphabetical by filename.
function compareByFilename(a, b) {
    if (a.sortFilename < b.sortFilename) return -1;
    if (a.sortFilename > b.sortFilename) return 1;
    return 0;
}

// Sort the entries with a descending comparator, flipped when the active
// direction is ascending, and put the result on screen.
function sortMedia(compare) {
    mediaItems.sort((a, b) => sortSign * compare(a, b));
    applyMediaFilter();
}

function sortTableByProfile() {
    sortMedia((a, b) =>
        (a.profileRank - b.profileRank) || compareByFilename(a, b));
}

function sortTableByProfileAudio() {
    sortMedia((a, b) =>
        (a.profileRank - b.profileRank) ||
        (a.audioRank - b.audioRank) ||
        (b.audioChannels - a.audioChannels) ||
        compareByFilename(a, b));
}

function sortTableByProfileVideoBitrate() {
    sortMedia((a, b) =>
        (a.profileRank - b.profileRank) ||
        (b.sortVideoBitrate - a.sortVideoBitrate) ||
        compareByFilename(a, b));
}

function sortTableByProfileAudioBitrate() {
    sortMedia((a, b) =>
        (a.profileRank - b.profileRank) ||
        (b.sortAudioBitrate - a.sortAudioBitrate) ||
        compareByFilename(a, b));
}

function sortTableByFilename() {
    // Descending means Z-A here; sortMedia() flips it back for the ascending
    // (default) direction.
    sortMedia((a, b) => -compareByFilename(a, b));
}

function sortTableByAudio() {
    sortMedia((a, b) => {
        const byCodec = (a.audioRank - b.audioRank) || (b.audioChannels - a.audioChannels);
        if (byCodec) return byCodec;
        if (a.audioKey < b.audioKey) return -1;
        if (a.audioKey > b.audioKey) return 1;
        return compareByFilename(a, b);
    });
}

function sortTableByAudioAudioBitrate() {
    sortMedia((a, b) =>
        (a.audioRank - b.audioRank) ||
        (b.audioChannels - a.audioChannels) ||
        (b.sortAudioBitrate - a.sortAudioBitrate) ||
        compareByFilename(a, b));
}

/**
 * Largest frame first.
 *
 * By tier before frame, so every 4K title stands together whatever its exact
 * crop, and a scope-cropped 3840x1600 does not push itself between two plain
 * UHD ones. Within a tier the bigger frame wins; entries whose resolution was
 * never determined sort last.
 */
function sortTableByResolution() {
    sortMedia((a, b) =>
        (a.resolutionRank - b.resolutionRank) ||
        (b.resolutionPixels - a.resolutionPixels) ||
        compareByFilename(a, b));
}

// Most current codec first, then alphabetically within one rank - which only
// happens for codecs the ranking does not list.
function sortTableByCodec() {
    sortMedia((a, b) => {
        if (a.codecRank !== b.codecRank) return a.codecRank - b.codecRank;
        if (a.codecKey < b.codecKey) return -1;
        if (a.codecKey > b.codecKey) return 1;
        return compareByFilename(a, b);
    });
}

function sortTableByCmVersion() {
    sortMedia((a, b) => {
        if (a.cmRank !== b.cmRank) return a.cmRank - b.cmRank;

        // Within the same CM version, group by DV structure (ST-DL, DT-DL, ...)
        if (a.cmStructure !== b.cmStructure) {
            if (!a.cmStructure) return 1;
            if (!b.cmStructure) return -1;
            return a.cmStructure < b.cmStructure ? -1 : 1;
        }

        return (a.profileRank - b.profileRank) || compareByFilename(a, b);
    });
}

/**
 * Sort by one rating source, highest first.
 *
 * Titles the source has no rating for count as 0 and therefore end up at the
 * bottom. Ratings are coarse, so several films share the same score - the IMDb
 * Top 250 rank breaks the tie, best rank first, chart entries ahead of
 * everything unranked.
 */
function sortTableByRatingSource(key) {
    sortMedia((a, b) =>
        (b[key] - a[key]) ||
        (a.sortTop250 - b.sortTop250) ||
        compareByFilename(a, b));
}

function sortTableByRating() {
    // The IMDb rating, or the TMDb one for entries that have no IMDb
    // counterpart - the same fallback the poster badge shows, so a library
    // scanned without an OMDb key still sorts by something.
    sortTableByRatingSource('rating');
}

function sortTableByTmdbRating() {
    sortTableByRatingSource('sortTmdbRating');
}

function sortTableByRtRating() {
    sortTableByRatingSource('sortRtRating');
}

function sortTableByRtAudience() {
    sortTableByRatingSource('sortRtAudience');
}

function sortTableByTraktRating() {
    sortTableByRatingSource('sortTraktRating');
}

function sortTableByMetacritic() {
    sortTableByRatingSource('sortMetacritic');
}

// Highest / largest / newest first, alphabetical within equal values.
function sortTableByNumericKey(key) {
    sortMedia((a, b) => (b[key] - a[key]) || compareByFilename(a, b));
}

function sortTableByFileSize() {
    sortTableByNumericKey('sortFileSize');
}

function sortTableByVideoBitrate() {
    sortTableByNumericKey('sortVideoBitrate');
}

function sortTableByAudioBitrate() {
    sortTableByNumericKey('sortAudioBitrate');
}

function sortTableByYear() {
    sortTableByNumericKey('sortYear');
}

function sortTableByDuration() {
    sortTableByNumericKey('sortDuration');
}

function sortTableByAdded() {
    // Sort by file modification time (newest first)
    sortTableByNumericKey('sortMtime');
}

// Sort mode -> the function that applies it. Filename is the fallback for an
// unknown mode (e.g. one left in localStorage by an older version).
const SORT_HANDLERS = {
    profile:              sortTableByProfile,
    profile_audio:        sortTableByProfileAudio,
    profile_videobitrate: sortTableByProfileVideoBitrate,
    profile_audiobitrate: sortTableByProfileAudioBitrate,
    audio:                sortTableByAudio,
    audio_audiobitrate:   sortTableByAudioAudioBitrate,
    resolution:           sortTableByResolution,
    codec:                sortTableByCodec,
    rating:               sortTableByRating,
    rating_tmdb:          sortTableByTmdbRating,
    rating_rt:            sortTableByRtRating,
    rating_rt_audience:   sortTableByRtAudience,
    rating_trakt:         sortTableByTraktRating,
    rating_metacritic:    sortTableByMetacritic,
    filesize:             sortTableByFileSize,
    videobitrate:         sortTableByVideoBitrate,
    audiobitrate:         sortTableByAudioBitrate,
    year:                 sortTableByYear,
    duration:             sortTableByDuration,
    added:                sortTableByAdded,
    cm_version:           sortTableByCmVersion,
    filename:             sortTableByFilename
};

export function applySort(mode) {
    if (!mode) mode = localStorage.getItem('dovi_sort_mode') || 'filename';
    if (sortSelectInstance) sortSelectInstance.setValue(mode);

    // Comparators are written descending, so ascending negates their result.
    sortSign = getSortDirection(mode) === 'asc' ? -1 : 1;
    updateSortDirToggle(mode);

    (SORT_HANDLERS[mode] || sortTableByFilename)();
}

// The direction toggle spells the active direction out in its label.
onLanguageChange(() => updateSortDirToggle());

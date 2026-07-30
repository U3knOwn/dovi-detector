// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The details dialog of a single entry.
 */

import { applyTranslations, t } from '../core/i18n.js';
import { formatDuration, formatFileSize, formatLuminance, formatMbps, formatNits, formatOffset } from '../helpers/format.js';
import { removeFileFromTable } from '../library/view.js';
import { getMediaBody } from '../library/virtual-table.js';
import { loadFileList } from './file-dialog.js';
import { requestDelete, requestRescan } from '../core/api.js';
import { applyCoverGradient } from './cover-gradient.js';

let currentDialogFilePath = '';

function updateHdrMetadataRows(hdrFormat, hdrMetadata) {
    // HDR10 mastering display and content light apply to every HDR10 base
    // (plain HDR10 as well as HDR10+); the RPU and L5 rows only exist on
    // Dolby Vision. SDR and everything else shows none of them.
    const format = (hdrFormat || '').toLowerCase();
    const isDolbyVision = format.includes('dolby vision');
    const showHdr10 = isDolbyVision || format.includes('hdr10');
    const meta = hdrMetadata || {};

    const rows = [
        ['dialogHdr10Mdl', 'dialogHdr10MdlText', showHdr10,
            `${formatLuminance(meta.hdr10_mdl_max)} | ${formatLuminance(meta.hdr10_mdl_min)} cd/m²`],
        ['dialogHdr10ContentLight', 'dialogHdr10ContentLightText', showHdr10,
            `${formatNits(meta.hdr10_max_cll)} | ${formatNits(meta.hdr10_max_fall)} cd/m²`],
        ['dialogRpuMdl', 'dialogRpuMdlText', isDolbyVision,
            `${formatLuminance(meta.rpu_mdl_max)} | ${formatLuminance(meta.rpu_mdl_min)} cd/m²`],
        ['dialogRpuContentLight', 'dialogRpuContentLightText', isDolbyVision,
            `${formatNits(meta.rpu_max_cll)} | ${formatNits(meta.rpu_max_fall)} cd/m²`],
        ['dialogL5ActiveArea', 'dialogL5ActiveAreaText', isDolbyVision,
            `${formatOffset(meta.l5_left)} | ${formatOffset(meta.l5_right)} | ` +
            `${formatOffset(meta.l5_top)} | ${formatOffset(meta.l5_bottom)}`]
    ];

    rows.forEach(([itemId, valueId, visible, text]) => {
        const item = document.getElementById(itemId);
        const value = document.getElementById(valueId);
        if (!item || !value) return;
        if (visible) {
            value.textContent = text;
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

/**
 * Fill the row of external ratings under the cover: IMDb and TMDb as their
 * 0-10 user scores, then the percentage-based ones - the Rotten Tomatoes
 * tomatometer with the audience score beside it, Trakt and Metacritic. Each
 * entry is hidden when that source has no rating for the title; the whole row
 * disappears when none of them do. `ratings` holds the entry's raw scores, null
 * where a source has none.
 */
function updateDialogRatings(ratings) {
    const container = document.getElementById('dialogRatings');
    if (!container) return;

    // A 0 is a real score for the percentage-based critics but means "no
    // rating" for the 0-10 user scores, hence the differing minimum.
    const entries = [
        ['dialogRatingImdb', 'dialogRatingImdbValue', ratings.imdb, v => `${v.toFixed(1)}`, false],
        ['dialogRatingTmdb', 'dialogRatingTmdbValue', ratings.tmdb, v => `${v.toFixed(1)}`, false],
        ['dialogRatingRt', 'dialogRatingRtValue', ratings.rt, v => `${Math.round(v)}%`, true],
        ['dialogRatingRtAudience', 'dialogRatingRtAudienceValue', ratings.rtAudience, v => `${Math.round(v)}%`, true],
        ['dialogRatingTrakt', 'dialogRatingTraktValue', ratings.trakt, v => `${Math.round(v)}%`, true],
        ['dialogRatingMetacritic', 'dialogRatingMetacriticValue', ratings.metacritic, v => `${Math.round(v)}`, true]
    ];

    let shown = 0;
    entries.forEach(([itemId, valueId, raw, format, allowZero]) => {
        const item = document.getElementById(itemId);
        const value = document.getElementById(valueId);
        if (!item || !value) return;

        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && (allowZero ? parsed >= 0 : parsed > 0)) {
            value.textContent = format(parsed);
            item.style.display = 'flex';
            shown++;
        } else {
            item.style.display = 'none';
        }
    });

    container.style.display = shown > 0 ? 'flex' : 'none';
}

/**
 * Collapse the plot back to its five-line preview.
 *
 * Called for every entry the dialog opens, so an entry expanded a moment ago
 * does not leave the next one unfolded.
 */
function resetDialogPlotClamp() {
    const text = document.getElementById('dialogPlotText');
    const toggle = document.getElementById('dialogPlotToggle');
    const label = document.getElementById('dialogPlotToggleLabel');
    if (!text || !toggle) return;

    text.classList.add('clamped');
    toggle.classList.remove('expanded');
    toggle.setAttribute('aria-expanded', 'false');
    // Hidden until the measurement below finds something actually cut off.
    toggle.style.display = 'none';
    if (label) {
        label.setAttribute('data-i18n', 'dialog_plot_more');
        label.textContent = t('dialog_plot_more');
    }
}

/**
 * Show the expand button only for plots the clamp truncates.
 *
 * Must run with the dialog already visible - a hidden element has no layout,
 * so scrollHeight and clientHeight would both be 0 and nothing would ever look
 * truncated.
 */
function updateDialogPlotToggle() {
    const text = document.getElementById('dialogPlotText');
    const toggle = document.getElementById('dialogPlotToggle');
    if (!text || !toggle) return;

    if (!text.classList.contains('clamped')) {
        // Expanded: the button is what folds it back, so it has to stay.
        toggle.style.display = 'inline-flex';
        return;
    }
    const truncated = text.scrollHeight - text.clientHeight > 1;
    toggle.style.display = truncated ? 'inline-flex' : 'none';
}

export function toggleDialogPlot() {
    const text = document.getElementById('dialogPlotText');
    const toggle = document.getElementById('dialogPlotToggle');
    const label = document.getElementById('dialogPlotToggleLabel');
    if (!text || !toggle) return;

    const collapsed = text.classList.toggle('clamped');
    toggle.classList.toggle('expanded', !collapsed);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

    // The key is kept on the element so a language switch relabels the button.
    const key = collapsed ? 'dialog_plot_more' : 'dialog_plot_less';
    if (label) {
        label.setAttribute('data-i18n', key);
        label.textContent = t(key);
    }
}

/**
 * Open the details dialog for one library entry.
 *
 * The entry is the record /api/library delivered, so the dialog reads the
 * values straight from it instead of from data attributes on the row.
 */
export function showMediaDialog(item) {
    if (!item) return;

    // Entries scanned without a TMDB key have no title or year at all, so the
    // filename stands in - as it does on the card itself.
    const hasPoster = !!item.poster_url;
    const title = hasPoster ? (item.tmdb_title || item.filename) : item.filename;
    const year = hasPoster ? (item.tmdb_year || '') : '';
    const filename = item.filename || '';
    const filePath = item.path || '';
    const posterUrl = item.poster_url || '';
    const duration = item.duration;
    const videoBitrate = item.video_bitrate;
    const audioBitrate = item.audio_bitrate;
    const fileSize = item.file_size;
    const tmdbId = item.tmdb_id;
    const imdbId = item.imdb_id;
    const rating = item.rating;
    const imdbTop250 = item.imdb_top250;
    const plot = item.tmdb_plot || '';
    const tagline = item.tmdb_tagline || '';
    const directors = (item.tmdb_directors || []).join(', ');
    const genres = (item.tmdb_genres || []).join(', ');
    const cast = (item.tmdb_cast || []).join(', ');
    const dvCmVersion = item.dv_cm_version || '';
    const hdrFormat = item.hdr_format || '';
    const hdrMetadata = item.hdr_metadata || {};
    const ratings = {
        imdb: item.imdb_rating,
        tmdb: item.tmdb_rating,
        rt: item.rt_rating,
        rtAudience: item.rt_audience,
        trakt: item.trakt_rating,
        metacritic: item.metacritic
    };

    const overlay = document.getElementById('mediaDialogOverlay');
    const dialogTitle = document.getElementById('dialogTitle');
    const dialogDuration = document.getElementById('dialogDuration');
    const dialogFileSize = document.getElementById('dialogFileSize');
    const dialogVideoBitrate = document.getElementById('dialogVideoBitrate');
    const dialogAudioBitrate = document.getElementById('dialogAudioBitrate');
    const dialogPoster = document.getElementById('dialogPoster');
    const dialogPosterImg = document.getElementById('dialogPosterImg');
    const dialogRatingBadge = document.getElementById('dialogRatingBadge');
    const dialogRatingValue = document.getElementById('dialogRatingValue');
    const dialogTop250Badge = document.getElementById('dialogTop250Badge');
    const dialogImdbLink = document.getElementById('dialogImdbLink');
    const dialogTmdbLink = document.getElementById('dialogTmdbLink');
    const dialogTrailerLink = document.getElementById('dialogTrailerLink');
    const dialogLinksContainer = document.getElementById('dialogLinksContainer');
    const dialogTagline = document.getElementById('dialogTagline');
    const dialogTaglineText = document.getElementById('dialogTaglineText');
    const dialogPlot = document.getElementById('dialogPlot');
    const dialogPlotText = document.getElementById('dialogPlotText');
    const dialogDirectors = document.getElementById('dialogDirectors');
    const dialogDirectorsText = document.getElementById('dialogDirectorsText');
    const dialogGenres = document.getElementById('dialogGenres');
    const dialogGenresText = document.getElementById('dialogGenresText');
    const dialogCast = document.getElementById('dialogCast');
    const dialogCastText = document.getElementById('dialogCastText');
    const dialogFilenameItem = document.getElementById('dialogFilenameItem');
    const dialogFilename = document.getElementById('dialogFilename');
    const dialogCmVersion = document.getElementById('dialogCmVersion');
    const dialogCmVersionText = document.getElementById('dialogCmVersionText');
    const dialogDeleteContainer = document.getElementById('dialogDeleteContainer');

    // Store current file path for delete
    currentDialogFilePath = filePath || '';
    
    // Set title with year if available
    const safeTitle = title || filename;
    const safeYear = year || '';
    if (safeYear !== '') {
        dialogTitle.textContent = `${safeTitle} (${safeYear})`;
    } else {
        dialogTitle.textContent = safeTitle;
    }
    
    // Set poster image if available
    if (posterUrl) {
        dialogPosterImg.src = posterUrl;
        dialogPoster.style.display = 'block';
        applyCoverGradient(document.querySelector('.media-dialog'), posterUrl);

        // Set filename if available
        if (dialogFilenameItem && dialogFilename && filename && filename.trim() !== '') {
            dialogFilename.textContent = filename;
            dialogFilenameItem.style.display = 'flex';
        } else if (dialogFilenameItem) {
            dialogFilenameItem.style.display = 'none';
        }
    } else {
        dialogPoster.style.display = 'none';
        applyCoverGradient(document.querySelector('.media-dialog'), '');
        // Without a poster the dialog title already is the filename, so the
        // separate row stays hidden - and must be reset, otherwise it would
        // keep showing the previously opened entry's filename.
        if (dialogFilenameItem) dialogFilenameItem.style.display = 'none';
    }
    
    // Set rating badge if available - IMDb when known, otherwise TMDb
    if (dialogRatingBadge && dialogRatingValue) {
        if (rating > 0) {
            dialogRatingValue.textContent = rating.toFixed(1);
            dialogRatingBadge.style.display = 'flex';
        } else {
            dialogRatingBadge.style.display = 'none';
        }
    }

    // Fill the IMDb / TMDb / Rotten Tomatoes / Metacritic row under the cover
    updateDialogRatings(ratings || {});

    // Set IMDb Top 250 badge if the title is on the chart
    if (dialogTop250Badge) {
        const rank = parseInt(imdbTop250, 10);
        if (rank > 0) {
            dialogTop250Badge.textContent = `#${rank}`;
            dialogTop250Badge.title = `IMDb Top 250 - #${rank}`;
            dialogTop250Badge.style.display = 'flex';
        } else {
            dialogTop250Badge.style.display = 'none';
        }
    }
    
    // Set the tagline - the title's slogan, shown above the plot it introduces
    if (dialogTagline && dialogTaglineText) {
        if (tagline) {
            dialogTaglineText.textContent = tagline;
            dialogTagline.style.display = 'flex';
        } else {
            dialogTagline.style.display = 'none';
        }
    }

    // Set plot if available, otherwise show fallback text. It starts folded to
    // five lines - whether the expand button is needed is decided once the
    // dialog is on screen and the text has a measurable height.
    if (plot) {
        dialogPlotText.textContent = plot;
        dialogPlot.style.display = 'flex';
        resetDialogPlotClamp();
    } else {
        dialogPlot.style.display = 'none';
    }

    // Set directors if available
    if (directors && directors !== '') {
        dialogDirectorsText.textContent = directors;
        dialogDirectors.style.display = 'flex';
    } else {
        dialogDirectors.style.display = 'none';
    }

    // Set genres if available
    if (dialogGenres && dialogGenresText) {
        if (genres) {
            dialogGenresText.textContent = genres;
            dialogGenres.style.display = 'flex';
        } else {
            dialogGenres.style.display = 'none';
        }
    }

    // Set cast if available (with "..." to indicate more actors)
    if (cast && cast !== '') {
        dialogCastText.textContent = cast + ' ...';
        dialogCast.style.display = 'flex';
    } else {
        dialogCast.style.display = 'none';
    }
    
    // Set duration
    dialogDuration.textContent = formatDuration(duration);

    // Set file size
    if (fileSize >= 0) {
        dialogFileSize.textContent = formatFileSize(fileSize);
    } else {
        dialogFileSize.textContent = t('unknown');
    }
    
    // Set video bitrate
    if (videoBitrate && videoBitrate > 0) {
        dialogVideoBitrate.textContent = `${formatMbps(videoBitrate)} ${t('unit_Mb')}`;
    } else {
        dialogVideoBitrate.textContent = t('unknown');
    }

    // Set audio bitrate
    if (audioBitrate && audioBitrate > 0) {
        dialogAudioBitrate.textContent = `${audioBitrate} ${t('unit_Kb')}`;
    } else {
        dialogAudioBitrate.textContent = t('unknown');
    }

    // Show the static HDR metadata rows that apply to this file's format
    updateHdrMetadataRows(hdrFormat, hdrMetadata);

    // Show CM Version when available
    if (dialogCmVersion && dialogCmVersionText) {
        if (dvCmVersion && dvCmVersion !== '') {
            dialogCmVersionText.textContent = dvCmVersion;
            dialogCmVersion.style.display = 'flex';
        } else {
            dialogCmVersion.style.display = 'none';
        }
    }

    // Show delete button when file path is available
    if (dialogDeleteContainer) {
        dialogDeleteContainer.style.display = currentDialogFilePath !== '' ? 'flex' : 'none';
    }
    
    // Set up links
    if (dialogImdbLink) {
        dialogImdbLink.classList.remove(...dialogImdbLink.classList);
        dialogImdbLink.classList.add('dialog-link', 'imdb');
    }
    dialogTmdbLink.classList.remove(...dialogTmdbLink.classList);
    dialogTmdbLink.classList.add('dialog-link', 'tmdb');
    dialogTrailerLink.classList.remove(...dialogTrailerLink.classList);
    dialogTrailerLink.classList.add('dialog-link', 'youtube');

    // IMDb link - only for entries that resolved to an IMDb ID
    if (dialogImdbLink) {
        if (imdbId && /^tt\d+$/.test(imdbId)) {
            dialogImdbLink.href = `https://www.imdb.com/title/${imdbId}/`;
            dialogImdbLink.style.display = 'inline-flex';
        } else {
            dialogImdbLink.style.display = 'none';
        }
    }

    if (tmdbId) {
        // TMDb link - direct to movie page
        dialogTmdbLink.href = `https://www.themoviedb.org/movie/${tmdbId}`;
        dialogTmdbLink.style.display = 'inline-flex';
        
        // Set up YouTube trailer link
        if (safeTitle !== '') {
            const searchQuery = safeYear !== '' ?
                `${safeTitle} (${safeYear}) - Trailer` :
                `${safeTitle} - Trailer`;
            const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
            dialogTrailerLink.href = youtubeUrl;
            dialogTrailerLink.style.display = 'inline-flex';
        } else {
            dialogTrailerLink.style.display = 'none';
        }
        
        // Show links container
        if (dialogLinksContainer) dialogLinksContainer.style.display = '';
    } else {
        // Hide TMDb/YouTube if no TMDb ID
        dialogTmdbLink.style.display = 'none';
        dialogTrailerLink.style.display = 'none';

        // Hide the container only when no link at all is left to show
        const hasImdbLink = dialogImdbLink && dialogImdbLink.style.display !== 'none';
        if (dialogLinksContainer) dialogLinksContainer.style.display = hasImdbLink ? '' : 'none';
    }
    
    // Show dialog
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Always open at the top. The panel keeps whatever it was scrolled to when
    // it was last closed, so without this an entry opened after a long one is
    // shown from the middle. It has to happen after .active - an element that
    // is still display:none takes no scroll position.
    const dialogPanel = overlay.querySelector('.media-dialog');
    if (dialogPanel) dialogPanel.scrollTop = 0;
    overlay.scrollTop = 0;

    // Apply translations - only inside the dialog, the rest of the page is
    // already translated and may be a very long table.
    applyTranslations(overlay);

    // Now that the dialog is laid out, decide whether the plot is long enough
    // to need its expand button.
    requestAnimationFrame(updateDialogPlotToggle);

    // Setup swipe gesture for mobile (only once)
    if (!swipeListenersAttached) {
        setupSwipeToClose();
    }
}

// Opening an entry is handled on the table body, so the thousands of rows a
// library can have never each carry their own listener - and rows that scroll
// in and out of the DOM need no wiring at all.
export function setupMediaTableInteraction() {
    const tbody = getMediaBody();
    if (!tbody) return;
    tbody.addEventListener('click', event => {
        const row = event.target.closest('tr');
        if (row && row.mediaItem) showMediaDialog(row.mediaItem);
    });
}

export async function rescanCurrentEntry() {
    if (!currentDialogFilePath) return;

    if (!window.confirm(t('rescan_entry_confirm'))) return;

    const btn = document.getElementById('dialogRescanBtn');
    const label = btn ? btn.querySelector('span') : null;
    const originalLabel = label ? label.textContent : '';
    if (btn) btn.disabled = true;
    if (label) label.textContent = t('rescan_entry_running');

    try {
        const data = await requestRescan(currentDialogFilePath);
        if (data.success) {
            // The row is server-rendered, so a reload is how the app already
            // picks up scan results elsewhere
            closeMediaDialog();
            location.reload();
            return;
        }
        alert(t('rescan_entry_error') + ': ' + (data.error || ''));
    } catch (e) {
        alert(t('rescan_entry_error') + ': ' + e.message);
    }

    if (btn) btn.disabled = false;
    if (label) label.textContent = originalLabel;
}

export async function deleteCurrentEntry() {
    if (!currentDialogFilePath) return;

    if (!window.confirm(t('delete_entry_confirm'))) return;

    try {
        const data = await requestDelete(currentDialogFilePath);
        if (data.success) {
            closeMediaDialog();
            // Remove the row from the DOM by data-path attribute on its card
            removeFileFromTable(currentDialogFilePath);
            currentDialogFilePath = '';
            loadFileList();
        } else {
            alert(t('delete_entry_error') + ': ' + (data.error || ''));
        }
    } catch (e) {
        alert(t('delete_entry_error') + ': ' + e.message);
    }
}

export function closeMediaDialog(event) {
    if (event) {
        event.stopPropagation();
    }
    
    const overlay = document.getElementById('mediaDialogOverlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// Swipe gesture handling for mobile
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let swipeListenersAttached = false;

function setupSwipeToClose() {
    const dialog = document.querySelector('.media-dialog');
    
    if (!dialog || swipeListenersAttached) return;
    
    dialog.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    
    dialog.addEventListener('touchend', function(e) {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    }, { passive: true });
    
    swipeListenersAttached = true;
}

function handleSwipe() {
    const swipeThreshold = 100;
    const horizontalSwipe = Math.abs(touchEndX - touchStartX);
    const verticalSwipe = Math.abs(touchEndY - touchStartY);
    
    // Only consider horizontal swipes (left or right)
    if (horizontalSwipe > swipeThreshold && horizontalSwipe > verticalSwipe) {
        closeMediaDialog();
    }
}

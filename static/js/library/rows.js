// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Building the table row of an entry.
 */

import { t } from '../core/i18n.js';
import { makeElement } from '../helpers/dom.js';
import {
    mediaAudioClass, mediaAudioText, mediaHdrClass, mediaHdrDetailText,
    mediaResolutionClass, mediaTitleText, mediaVideoCodecClass,
    mediaVideoCodecDetailText, mediaVideoCodecText
} from './model.js';
import { POSTER_PLACEHOLDER_SVG, RATING_STAR_SVG } from '../ui/icons.js';
import { applyCoverGradient } from '../ui/cover-gradient.js';

// A table cell with the label the stacked mobile layout shows in front of it.
function makeCell(labelKey, className) {
    const cell = makeElement('td', className);
    cell.setAttribute('data-label-i18n', labelKey);
    cell.setAttribute('data-label', t(labelKey));
    return cell;
}

function buildPosterCell(item) {
    const cell = makeCell('table_header_poster');
    cell.title = item.filename;

    const card = makeElement('div', 'poster-container' + (item.poster_url ? '' : ' poster-fallback'));
    card.appendChild(makeElement('span', 'poster-title', mediaTitleText(item)));

    const wrapper = makeElement('div', 'poster-img-wrapper');
    if (item.poster_url) {
        const image = makeElement('img', 'poster-img');
        image.src = item.poster_url;
        image.alt = item.filename;
        image.loading = 'lazy';
        image.decoding = 'async';
        wrapper.appendChild(image);

        if (item.rating > 0) {
            const badge = makeElement('div', 'rating-badge');
            const logo = makeElement('span', 'rating-logo');
            logo.innerHTML = RATING_STAR_SVG;
            badge.appendChild(logo);
            badge.appendChild(makeElement('span', 'rating-value', item.rating.toFixed(1)));
            wrapper.appendChild(badge);
        }

        if (item.imdb_top250) {
            const top250 = makeElement('div', 'top250-badge', `#${item.imdb_top250}`);
            top250.title = `IMDb Top 250 - #${item.imdb_top250}`;
            wrapper.appendChild(top250);
        }
    } else {
        const placeholder = makeElement('div', 'poster-img poster-placeholder');
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.innerHTML = POSTER_PLACEHOLDER_SVG;
        wrapper.appendChild(placeholder);
    }

    card.appendChild(wrapper);
    cell.appendChild(card);
    return cell;
}

function buildHdrCell(item) {
    const cell = makeCell('table_header_hdr');
    const detail = mediaHdrDetailText(item);
    const elType = item.el_type;

    if (item.hdr_format === 'Dolby Vision' && elType) {
        // Dolby Vision carries its layer type inside the badge, which is
        // coloured by that layer (FEL / MEL)
        cell.appendChild(makeElement(
            'span',
            `hdr-badge hdr-dolby-vision el-${elType.toLowerCase()}`,
            `${detail} (${elType})`));
        return cell;
    }

    cell.appendChild(makeElement('span', `hdr-badge ${mediaHdrClass(item)}`, detail));
    if (elType) {
        cell.appendChild(makeElement('span', `el-badge el-${elType.toLowerCase()}`, elType));
    }
    return cell;
}

export function buildMediaRow(item) {
    const row = makeElement('tr');
    // The adaptive themes back the row with the colours of its own cover, the
    // same way they back the details dialog. The cell is built first so the
    // colours can be read from the poster the row is showing anyway, rather
    // than from a second copy of it.
    const posterCell = buildPosterCell(item);
    applyCoverGradient(row, item.poster_url, posterCell.querySelector('img.poster-img'));
    row.appendChild(posterCell);
    row.appendChild(buildHdrCell(item));

    const audioCell = makeCell('table_header_audio', 'audio-codec');
    audioCell.appendChild(makeElement('span', `audio-badge ${mediaAudioClass(item)}`, mediaAudioText(item)));
    row.appendChild(audioCell);

    // Resolution and codec are the two halves of one answer - how the picture
    // was stored - so they share a column, stacked the way the HDR badge and
    // its enhancement layer are.
    const videoCell = makeCell('table_header_video', 'video-cell');
    videoCell.appendChild(makeElement(
        'span', `resolution-badge ${mediaResolutionClass(item)}`, item.resolution));

    const codecBadge = makeElement(
        'span', `codec-badge ${mediaVideoCodecClass(item)}`, mediaVideoCodecText(item));
    // The profile is what the badge leaves out, so the full line is on hover
    codecBadge.title = mediaVideoCodecDetailText(item);
    videoCell.appendChild(codecBadge);
    row.appendChild(videoCell);

    // The dialog reads the entry straight off the row it was opened from
    row.mediaItem = item;
    return row;
}

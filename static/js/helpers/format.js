// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Formatting of the values shown in the media dialog.
 */

import { currentLang, t } from '../core/i18n.js';

export function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return t('unknown');

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        const secs = Math.floor(seconds % 60);
        return `${minutes}m ${secs}s`;
    }
}

export function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined || bytes < 0) return t('unknown');

    // Always convert to GB
    const GB_IN_BYTES = 1024 * 1024 * 1024;
    const sizeInGB = bytes / GB_IN_BYTES;

    // Format with 1 decimal place and use appropriate decimal separator based on locale
    const formattedSize = currentLang === 'de'
        ? sizeInGB.toFixed(1).replace('.', ',')  // German: comma
        : sizeInGB.toFixed(1);                    // English: period
    return `${formattedSize} GB`;
}

export function formatMbps(kbitPerSec) {
    const mbps = kbitPerSec / 1000;
    const formatted = currentLang === 'de'
        ? mbps.toFixed(2).replace('.', ',')  // German: comma
        : mbps.toFixed(2);                    // English: period
    return formatted;
}

export function formatLuminance(value) {
    // Luminances come from hdrprobe as cd/m² floats (e.g. 4000 or 0.005);
    // print them without trailing zeros and fall back to 0 when unavailable
    const num = Number(value);
    if (!isFinite(num) || num <= 0) return '0';
    return String(parseFloat(num.toFixed(4)));
}

export function formatNits(value) {
    // Whole-nit values (MaxCLL / MaxFALL), 0 when unavailable
    const num = Number(value);
    if (!isFinite(num) || num <= 0) return '0';
    return String(Math.round(num));
}

export function formatOffset(value) {
    const num = Number(value);
    if (!isFinite(num) || num < 0) return '0';
    return String(Math.round(num));
}

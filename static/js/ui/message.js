// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The status message above the table.
 */

import { MSG_ICONS } from './icons.js';

// Render a status message with a leading SVG icon; text is set via textContent
// so translated strings are never interpreted as HTML.
export function setMessageContent(el, type, text) {
    if (!el) return;
    el.innerHTML = `<span class="message-icon">${MSG_ICONS[type] || ''}</span><span class="message-text"></span>`;
    el.querySelector('.message-text').textContent = text;
}

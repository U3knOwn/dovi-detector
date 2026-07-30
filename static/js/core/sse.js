// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Server-Sent Events: live scan progress and deletions.
 */

import { t } from './i18n.js';
import { removeFileFromTable } from '../library/view.js';
import { setMessageContent } from '../ui/message.js';

// Put a scan's progress on the bar. Shared by the snapshot the stream opens
// with and by every update that follows, so the two cannot drift apart.
function showScanProgress(data) {
    const container = document.getElementById('scanProgress');
    const bar = document.getElementById('scanProgressBar');
    const text = document.getElementById('scanProgressText');
    if (!container) return;

    if (bar) bar.style.width = data.percent + '%';
    if (text) text.textContent = `${data.current}/${data.total} (${data.percent}%)`;
    container.style.display = 'inline-flex';
}

function hideScanProgress() {
    const container = document.getElementById('scanProgress');
    if (container) container.style.display = 'none';
}

export function setupSSE() {
    if (typeof EventSource === 'undefined') {
        console.warn('EventSource not supported by browser');
        return;
    }

    const eventSource = new EventSource('/events');

    eventSource.addEventListener('file_deleted', function(e) {
        try {
            const data = JSON.parse(e.data);
            const filePath = data.file_path;

            if (filePath) {
                removeFileFromTable(filePath);
            }
        } catch (error) {
            console.error('Error parsing deletion event:', error);
        }
    });

    // The stream's own events only carry what happens from now on, so a page
    // loaded while a scan is running would show no bar until the next file
    // finishes. The server therefore opens every connection with the state as it
    // stands - which also covers a reconnect, and cannot lose the race an extra
    // request for it would: the snapshot is part of the same stream.
    eventSource.addEventListener('scan_state', function(e) {
        try {
            const data = JSON.parse(e.data);
            if (data.status === 'scanning') showScanProgress(data);
        } catch (error) {
            console.error('Error parsing scan state event:', error);
        }
    });

    eventSource.addEventListener('scan_progress', function(e) {
        try {
            const data = JSON.parse(e.data);

            if (data.status === 'scanning') {
                showScanProgress(data);
                return;
            }

            const finished = data.status === 'done' || data.status === 'cancelled';
            if (!finished && data.status !== 'error') return;

            hideScanProgress();

            const message = document.getElementById('message');
            if (!message) return;

            if (data.status === 'error') {
                message.className = 'message error';
                setMessageContent(message, 'error', t('scan_error'));
                message.style.display = 'block';
                return;
            }

            // A cancelled scan is reported like a finished one, only as what it
            // was: whatever it got through before it stopped is in the library
            // and the page is reloaded to show it.
            let type = 'info';
            let text = t('no_new_files');
            if (data.status === 'cancelled') {
                text = t('scan_cancelled', { count: data.new_files || 0 });
            } else if (data.new_files > 0) {
                type = 'success';
                text = t('scan_complete', { count: data.new_files });
            }

            message.className = `message ${type}`;
            setMessageContent(message, type, text);
            message.style.display = 'block';
            setTimeout(function() { location.reload(); }, 2000);
        } catch (error) {
            console.error('Error parsing scan progress event:', error);
        }
    });

    eventSource.onerror = function(e) {
        console.error('SSE connection error:', e);
        // EventSource will automatically try to reconnect
    };
}

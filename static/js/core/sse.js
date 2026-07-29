// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Server-Sent Events: live scan progress and deletions.
 */

import { t } from './i18n.js';
import { removeFileFromTable } from '../library/view.js';
import { setMessageContent } from '../ui/message.js';

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
            if (data.status !== 'scanning') return;

            const scanProgress = document.getElementById('scanProgress');
            const scanProgressBar = document.getElementById('scanProgressBar');
            const scanProgressText = document.getElementById('scanProgressText');
            if (!scanProgress) return;

            if (scanProgressBar) scanProgressBar.style.width = data.percent + '%';
            if (scanProgressText) {
                scanProgressText.textContent =
                    data.current + '/' + data.total + ' (' + data.percent + '%)';
            }
            scanProgress.style.display = 'inline-flex';
        } catch (error) {
            console.error('Error parsing scan state event:', error);
        }
    });

    eventSource.addEventListener('scan_progress', function(e) {
        try {
            const data = JSON.parse(e.data);
            const scanProgress = document.getElementById('scanProgress');
            const scanProgressBar = document.getElementById('scanProgressBar');
            const scanProgressText = document.getElementById('scanProgressText');
            const message = document.getElementById('message');

            if (data.status === 'scanning') {
                if (scanProgress) {
                    scanProgressBar.style.width = data.percent + '%';
                    scanProgressText.textContent = data.current + '/' + data.total + ' (' + data.percent + '%)';
                    scanProgress.style.display = 'inline-flex';
                }
            } else if (data.status === 'done' || data.status === 'cancelled') {
                if (scanProgress) scanProgress.style.display = 'none';
                if (message) {
                    // A cancelled scan is reported like a finished one, only as
                    // what it was: whatever it got through before it stopped is
                    // in the library and the page is reloaded to show it.
                    const cancelled = data.status === 'cancelled';
                    message.className = 'message';
                    if (cancelled) {
                        message.classList.add('info');
                        setMessageContent(message, 'info', t('scan_cancelled', { count: data.new_files || 0 }));
                        setTimeout(function() { location.reload(); }, 2000);
                    } else if (data.new_files > 0) {
                        message.classList.add('success');
                        setMessageContent(message, 'success', t('scan_complete', { count: data.new_files }));
                        setTimeout(function() { location.reload(); }, 2000);
                    } else {
                        message.classList.add('info');
                        setMessageContent(message, 'info', t('no_new_files'));
                        setTimeout(function() { location.reload(); }, 2000);
                    }
                    message.style.display = 'block';
                }
            } else if (data.status === 'error') {
                if (scanProgress) scanProgress.style.display = 'none';
                if (message) {
                    message.className = 'message error';
                    setMessageContent(message, 'error', t('scan_error'));
                    message.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Error parsing scan progress event:', error);
        }
    });
    
    eventSource.onerror = function(e) {
        console.error('SSE connection error:', e);
        // EventSource will automatically try to reconnect
    };
}

/* -------------------------------
   Media Details Dialog Functions
   ------------------------------- */

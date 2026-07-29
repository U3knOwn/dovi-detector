// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Every call to the server in one place.
 *
 * Each function does exactly what its one caller needs and leaves the error
 * handling to it - collected here so the whole HTTP surface of the app can be
 * read at a glance.
 */

function postJson(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
}

// The scanned entries the library page renders.
export function fetchLibrary() {
    return fetch('/api/library').then(response => response.json());
}

// Every video file below the media directory, with its scan state.
export function fetchMediaFiles() {
    return fetch('/get_files').then(response => response.json());
}

// Progress of a scan that is already running, so a page loaded mid-scan can
// restore the bar. Resolves to null when there is nothing to restore.
export async function fetchScanStatus() {
    const response = await fetch('/scan_status');
    if (!response.ok) return null;
    return response.json();
}

// Start a background scan of the given files. Throws on a server error.
export async function requestScan(filePaths, lang) {
    const response = await postJson(`/scan_files?lang=${lang}`, { file_paths: filePaths });
    if (!response.ok) throw new Error('Server error');
    return response.json();
}

// Re-read one entry from scratch, including every online lookup.
export async function requestRescan(filePath) {
    const response = await postJson('/rescan_entry', { file_path: filePath });
    return response.json();
}

// Remove one entry from the database.
export async function requestDelete(filePath) {
    const response = await postJson('/delete_entry', { file_path: filePath });
    return response.json();
}

// Empty the database. Resolves to ``{ ok, data }``: the caller reports a
// failing request differently from a request that failed on the server.
export async function requestClearDatabase() {
    const response = await postJson('/clear_database');
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
}

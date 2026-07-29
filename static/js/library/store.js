// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The library the page is showing, in one place.
 *
 * Everything else imports these read-only and goes through the setters below
 * to change them, so there is exactly one place where the library's state is
 * written (library/view.js).
 */

// Every entry, in the current sort order.
export let mediaItems = [];
// What the table actually shows: the entries the search leaves over. Without
// an active search this is the same array as mediaItems.
export let mediaVisible = [];
// The active search term, lower-cased.
export let mediaSearchTerm = '';
// Set once the library response arrived, so the "nothing scanned yet" state is
// not shown while the library is still on its way.
export let mediaLoaded = false;

export function setMediaItems(items) {
    mediaItems = items;
}

export function setMediaVisible(items) {
    mediaVisible = items;
}

export function setMediaSearchTerm(term) {
    mediaSearchTerm = term;
}

export function setMediaLoaded(loaded) {
    mediaLoaded = loaded;
}

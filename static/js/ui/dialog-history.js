// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The back gesture closes the dialog, not the page.
 *
 * An overlay is not a navigation as far as the browser is concerned, so on
 * Android the back gesture over an open dialog left the app entirely - the one
 * thing it looks like it should not do. Every dialog therefore puts an entry on
 * the history stack while it is open: back pops that entry, which closes the
 * dialog and leaves the library exactly as it was.
 *
 * A dialog closed any other way (its button, Escape, the swipe) takes its entry
 * back off the stack, so the history does not fill up with dialogs that are no
 * longer on screen and back keeps meaning "the page before this one".
 */

// The dialogs that currently have an entry on the history stack, innermost
// last.
const openDialogs = [];

// Entries we asked for ourselves and whose popstate is therefore not the user
// pressing back.
let pendingBack = 0;

// Set while a pop is being handled, so the close handler it runs does not try
// to pop its own entry a second time.
let closingFromPop = false;

/**
 * Record that `id` is now open, and make back close it. `close` is called with
 * no arguments and must be the same function the rest of the app closes that
 * dialog with.
 */
export function dialogOpened(id, close) {
    if (openDialogs.some(entry => entry.id === id)) return;

    openDialogs.push({ id: id, close: close });
    try {
        history.pushState({ uvsDialog: id }, '');
    } catch (e) {
        // History unavailable (an exotic sandbox) -> the dialog still works,
        // it just does not answer to the back gesture.
    }
}

// Record that `id` has been closed, dropping the history entry it added unless
// back is what closed it in the first place.
export function dialogClosed(id) {
    const index = openDialogs.findIndex(entry => entry.id === id);
    if (index === -1) return;

    openDialogs.splice(index, 1);
    if (closingFromPop) return;

    pendingBack++;
    try {
        history.back();
    } catch (e) {
        pendingBack--;
    }
}

window.addEventListener('popstate', () => {
    // Our own history.back() from dialogClosed - the dialog is already gone.
    if (pendingBack > 0) {
        pendingBack--;
        return;
    }

    const entry = openDialogs.pop();
    if (!entry) return;

    closingFromPop = true;
    try {
        entry.close();
    } finally {
        closingFromPop = false;
    }
});

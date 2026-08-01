// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The app's own confirmation and message dialog.
 *
 * This exists because `window.confirm()` and `window.alert()` are not something
 * a page can rely on. Firefox lets the user suppress them per tab - one tick of
 * "prevent this page from creating additional dialogs" and every later
 * `confirm()` returns false without showing anything, which turns a button that
 * asks before it acts into a button that does nothing at all, with no error to
 * go on. Extensions and kiosk setups can do the same. Everything that asks the
 * user a question therefore goes through here instead, where the answer is the
 * app's own to render.
 *
 * `askConfirm` resolves to true only when the user confirmed; `showNotice`
 * resolves once the message has been acknowledged.
 */

import { t } from '../core/i18n.js';
import { dialogClosed, dialogOpened } from './dialog-history.js';

// The resolve callback of the question currently on screen, so the buttons,
// Escape and the overlay all answer the same pending promise.
let settle = null;

function elements() {
    return {
        overlay: document.getElementById('confirmDialogOverlay'),
        title: document.getElementById('confirmDialogTitle'),
        message: document.getElementById('confirmDialogMessage'),
        cancel: document.getElementById('confirmDialogCancel'),
        accept: document.getElementById('confirmDialogAccept')
    };
}

// Escape answers "no". Handled in the capture phase so the page-wide Escape
// listener in main.js does not close the dialog underneath this one as well.
function onKeyDown(event) {
    if (!settle) return;
    if (event.key === 'Escape') {
        event.stopPropagation();
        close(false);
    } else if (event.key === 'Enter') {
        event.stopPropagation();
        close(true);
    }
}

function close(answer) {
    const resolve = settle;
    if (!resolve) return;
    settle = null;

    const { overlay } = elements();
    if (overlay) overlay.classList.remove('active');
    document.removeEventListener('keydown', onKeyDown, true);
    dialogClosed('confirm');
    resolve(answer);
}

/**
 * Open the dialog and resolve once it has been answered.
 *
 * `destructive` colours the accept button as the delete buttons are coloured;
 * a null `cancelLabel` leaves the cancel button out, which is what turns the
 * question into a plain message.
 */
function open({ message, title, acceptLabel, cancelLabel, destructive }) {
    const { overlay, title: titleEl, message: messageEl, cancel, accept } = elements();

    // Without the markup there is nothing to ask with. Reporting "yes" would
    // run a delete nobody confirmed, so an unanswerable question is a "no".
    if (!overlay || !accept) {
        console.error('Confirmation dialog markup is missing');
        return Promise.resolve(false);
    }

    // A second question while one is open would strand the first promise.
    if (settle) close(false);

    titleEl.textContent = title;
    messageEl.textContent = message;
    accept.textContent = acceptLabel;
    accept.classList.toggle('destructive', !!destructive);

    cancel.style.display = cancelLabel === null ? 'none' : '';
    if (cancelLabel !== null) cancel.textContent = cancelLabel;

    overlay.classList.add('active');
    document.addEventListener('keydown', onKeyDown, true);
    dialogOpened('confirm', () => close(false));
    accept.focus();

    return new Promise(resolve => {
        settle = resolve;
    });
}

/** Ask a yes/no question. Resolves true only if the user confirmed. */
export function askConfirm(message, { acceptLabel, destructive } = {}) {
    return open({
        message,
        title: t('confirm_title'),
        acceptLabel: acceptLabel || t('confirm_accept'),
        cancelLabel: t('confirm_cancel'),
        destructive
    });
}

/** Show a message with a single acknowledge button. */
export function showNotice(message) {
    return open({
        message,
        title: t('notice_title'),
        acceptLabel: t('confirm_ok'),
        cancelLabel: null
    });
}

/**
 * Wire the dialog's own controls. Called once at startup; the dialog itself is
 * opened on demand by askConfirm/showNotice.
 */
export function setupConfirmDialog() {
    const { overlay, cancel, accept } = elements();
    if (!overlay || !accept) return;

    accept.addEventListener('click', () => close(true));
    if (cancel) cancel.addEventListener('click', () => close(false));

    // A click on the backdrop - but not inside the panel - means "no".
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close(false);
    });
}

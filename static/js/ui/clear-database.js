// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The "clear database" button in the footer.
 */

import { t } from '../core/i18n.js';
import { requestClearDatabase } from '../core/api.js';
import { askConfirm, showNotice } from './confirm-dialog.js';

export function setupClearButton() {
    const btn = document.getElementById('clearDbButton');
    if (!btn) return;

    const label = btn.querySelector('[data-i18n="clear_db"]');

    const originalText = t('clear_db');
    label.textContent = originalText;

    btn.addEventListener('click', async () => {

        const confirmed = await askConfirm(t('clear_db_confirm'),
                                          { acceptLabel: t('clear_db'), destructive: true });
        if (!confirmed) return;

        btn.disabled = true;
        label.textContent = t('please_wait');

        try {
            const { ok, data } = await requestClearDatabase();

            if (ok && data.success) {
                window.location.reload();
            } else {
                showNotice(t('clear_db_error') + ': ' + (data.error || t('unknown')));
                btn.disabled = false;
                label.textContent = originalText;
            }

        } catch (e) {
            showNotice(t('clear_db_error') + ': ' + e.message);
            btn.disabled = false;
            label.textContent = originalText;
        }
    });
}

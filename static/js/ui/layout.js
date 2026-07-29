// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The collapsible parts of the page: the table, the header actions and
 * the control bar.
 */

import { t } from '../core/i18n.js';
import { renderMediaWindow } from '../library/virtual-table.js';

// Elements a show/hide toggle controls: the ids listed in aria-controls, plus -
// on desktop, where a lone table header would be left dangling - the thead
// belonging to any tbody among them.
function getCollapseTargets(btn) {
    const controlsAttr = btn.getAttribute('aria-controls') || '';
    const ids = controlsAttr.split(/\s+/).filter(Boolean);
    const targets = ids.map(id => document.getElementById(id)).filter(Boolean);

    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const extraTargets = [];
    if (!isMobile) {
        targets.forEach(t => {
            if (t.tagName && t.tagName.toLowerCase() === 'tbody') {
                const table = t.closest('table');
                if (table) {
                    const thead = table.querySelector('thead');
                    if (thead) extraTargets.push(thead);
                }
            }
        });
    }

    return targets.concat(extraTargets);
}

// Keyed by what the button controls, so several toggles each keep their own
// state.
function getCollapseStorageKey(btn) {
    const controlsAttr = (btn.getAttribute('aria-controls') || '').trim();
    return controlsAttr ? `dovi_collapsed_${controlsAttr}` : null;
}

function applyCollapseState(btn, expanded) {
    btn.setAttribute('aria-expanded', String(expanded));

    getCollapseTargets(btn).forEach(el => {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'thead') {
            el.style.display = expanded ? 'table-header-group' : 'none';
        } else if (tag === 'tbody') {
            el.style.display = expanded ? 'table-row-group' : 'none';
        } else {
            el.style.display = expanded ? '' : 'none';
        }
    });

    const hideSvg = btn.querySelector('.hide');
    const showSvg = btn.querySelector('.show');
    if (hideSvg && showSvg) {
        hideSvg.style.display = expanded ? 'none' : 'flex';
        showSvg.style.display = expanded ? 'flex' : 'none';
    }

    // Nothing is rendered while the table is hidden, so a table brought back
    // has to be filled for the position it is now scrolled to.
    if (expanded) renderMediaWindow(true);
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.collapse-btn').forEach(btn => {
        const key = getCollapseStorageKey(btn);
        let saved = null;
        try {
            if (key) saved = localStorage.getItem(key);
        } catch (e) { /* localStorage unavailable -> fall back to the markup */ }

        const expanded = saved === null
            ? btn.getAttribute('aria-expanded') === 'true'
            : saved === 'true';

        applyCollapseState(btn, expanded);
    });
});

document.addEventListener('click', e => {
    const btn = e.target.closest('.collapse-btn');
    if (!btn) return;
    if (getCollapseTargets(btn).length === 0) return;

    const next = btn.getAttribute('aria-expanded') !== 'true';
    applyCollapseState(btn, next);

    const key = getCollapseStorageKey(btn);
    try {
        if (key) localStorage.setItem(key, String(next));
    } catch (e) { /* localStorage unavailable -> choice won't persist */ }
});

// Header actions (theme, show/hide, menu) fold behind the chevron next to
// them, so a quiet header keeps just that one button.
function applyHeaderActionsCollapsed(collapsed) {
    const actions = document.querySelector('.header-actions');
    if (!actions) return;

    actions.classList.toggle('collapsed', collapsed);

    const btn = document.getElementById('headerActionsToggle');
    if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
}

// Apply the state, remember it, and restart the idle countdown below.
function setHeaderActionsCollapsed(collapsed) {
    applyHeaderActionsCollapsed(collapsed);

    try {
        localStorage.setItem('dovi_header_actions_collapsed', String(collapsed));
    } catch (e) { /* localStorage unavailable -> choice won't persist */ }

    scheduleHeaderActionsAutoCollapse();
}

// Left alone, the opened group folds itself back up, so a header tapped by
// accident does not stay open.
const HEADER_ACTIONS_IDLE_MS = 5000;
let headerActionsIdleTimer = null;

// Whether the group still counts as being used, and should be left open for
// another round rather than folding away under the user.
function isHeaderActionsInUse(actions) {
    // Touch browsers can leave :hover stuck on whatever was tapped last, which
    // would keep the group open forever - so the pointer only counts on devices
    // that really hover.
    const canHover = window.matchMedia('(hover: hover)').matches;
    if (canHover && actions.matches(':hover')) return true;

    // A mouse click leaves focus sitting on the button it hit, so only keyboard
    // focus (:focus-visible) means someone is still working in there.
    return !!actions.querySelector(':focus-visible');
}

// Restart the countdown from zero; a no-op while the group is collapsed.
function scheduleHeaderActionsAutoCollapse() {
    if (headerActionsIdleTimer !== null) {
        clearTimeout(headerActionsIdleTimer);
        headerActionsIdleTimer = null;
    }

    const actions = document.querySelector('.header-actions');
    if (!actions || actions.classList.contains('collapsed')) return;

    headerActionsIdleTimer = setTimeout(() => {
        headerActionsIdleTimer = null;

        if (isHeaderActionsInUse(actions)) {
            scheduleHeaderActionsAutoCollapse();
            return;
        }

        setHeaderActionsCollapsed(true);
    }, HEADER_ACTIONS_IDLE_MS);
}

// How wide the group is when open, handed to CSS as --header-actions-width.
// Measured rather than hard-coded so the fold stays even, and stays correct, if
// a button is ever added to the group.
function measureHeaderActionsWidth(actions) {
    const group = document.getElementById('headerActionsGroup');
    if (!group) return;

    const wasCollapsed = actions.classList.contains('collapsed');

    actions.classList.add('no-transition');
    actions.classList.remove('collapsed');
    group.style.maxWidth = 'none';

    const width = Math.ceil(group.getBoundingClientRect().width);

    group.style.maxWidth = '';
    actions.classList.toggle('collapsed', wasCollapsed);
    void actions.offsetWidth;
    actions.classList.remove('no-transition');

    if (width > 0) {
        actions.style.setProperty('--header-actions-width', `${width}px`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const actions = document.querySelector('.header-actions');
    if (!actions) return;

    measureHeaderActionsWidth(actions);

    let saved = null;
    try {
        saved = localStorage.getItem('dovi_header_actions_collapsed');
    } catch (e) { /* localStorage unavailable -> start collapsed */ }

    // The markup starts collapsed, so restoring an opened group would otherwise
    // animate open on every load.
    actions.classList.add('no-transition');
    applyHeaderActionsCollapsed(saved === null ? true : saved === 'true');
    void actions.offsetWidth;
    actions.classList.remove('no-transition');

    const btn = document.getElementById('headerActionsToggle');
    if (btn) {
        btn.addEventListener('click', () => {
            setHeaderActionsCollapsed(!actions.classList.contains('collapsed'));
        });
    }

    // Anything done inside the header actions - pressing one of the buttons,
    // tabbing in, moving the pointer across them - buys another five seconds.
    ['pointerdown', 'pointermove', 'click', 'keydown', 'focusin'].forEach(type => {
        actions.addEventListener(type, scheduleHeaderActionsAutoCollapse);
    });

    scheduleHeaderActionsAutoCollapse();
});

function applyControlsCollapsed(collapsed) {
    const container = document.querySelector('.container');
    const btn = document.getElementById('toggleControlsBtn');
    if (!container) return;

    container.classList.toggle('controls-hidden', collapsed);

    if (btn) {
        btn.setAttribute('aria-expanded', String(!collapsed));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('dovi_controls_collapsed');
    const collapsed = saved === null ? true : (saved === 'true');

    applyControlsCollapsed(collapsed);

    const toggleBtn = document.getElementById('toggleControlsBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const container = document.querySelector('.container');
            if (!container) return;
            const nowCollapsed = container.classList.contains('controls-hidden');
            const nextCollapsed = !nowCollapsed;

            applyControlsCollapsed(nextCollapsed);
            localStorage.setItem('dovi_controls_collapsed', String(nextCollapsed));
        });
    }
});

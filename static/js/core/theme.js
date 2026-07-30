// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Theme system, remembered across visits.
 *
 * A normal press on the toggle button cycles through every theme in
 * THEME_ORDER. A long press (or right-click) opens a menu to jump straight
 * to one of them.
 */

import { onLanguageChange, t } from './i18n.js';
import { THEME_ICONS } from '../ui/icons.js';

const THEME_ORDER = ['dark', 'light', 'midnight', 'darkred', 'adaptive'];

const THEME_META_COLORS = {
    dark: '#0a0c12',
    light: '#eef1f7',
    midnight: '#04060c',
    darkred: '#160607',
    adaptive: '#0b0d14'
};

const THEME_NAME_KEYS = {
    dark: 'theme_name_dark',
    light: 'theme_name_light',
    midnight: 'theme_name_midnight',
    darkred: 'theme_name_darkred',
    adaptive: 'theme_name_adaptive'
};

// Holding the button down this long opens the menu instead of cycling.
const LONG_PRESS_MS = 500;

let pressTimer = null;
let longPressFired = false;

function getCurrentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    return THEME_ORDER.includes(attr) ? attr : 'dark';
}

function persistTheme(theme) {
    try {
        localStorage.setItem('dovi_theme', theme);
    } catch (e) { /* localStorage unavailable -> theme just won't persist */ }
}

function applyTheme(theme) {
    if (!THEME_ORDER.includes(theme)) theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META_COLORS[theme] || THEME_META_COLORS.dark);
    updateThemeToggleLabel();
    updateThemeMenuSelection();
}

export function setTheme(theme) {
    persistTheme(theme);
    applyTheme(theme);
}

export function toggleTheme() {
    const idx = THEME_ORDER.indexOf(getCurrentTheme());
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
}

export function updateThemeToggleLabel() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const idx = THEME_ORDER.indexOf(getCurrentTheme());
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    const label = t('theme_switch_next', { name: t(THEME_NAME_KEYS[next]) });
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
    const hiddenLabel = document.getElementById('themeToggleLabel');
    if (hiddenLabel) hiddenLabel.textContent = label;
}

function renderThemeMenu() {
    const menu = document.getElementById('themeMenu');
    if (!menu) return;
    menu.innerHTML = '';
    THEME_ORDER.forEach(id => {
        const li = document.createElement('li');
        li.className = 'custom-select-option';
        li.setAttribute('role', 'menuitemradio');
        li.setAttribute('data-value', id);
        li.innerHTML = `<span class="custom-select-opt-icon">${THEME_ICONS[id]}</span>` +
                        `<span class="custom-select-opt-label"></span>`;
        li.querySelector('.custom-select-opt-label').textContent = t(THEME_NAME_KEYS[id]);
        li.addEventListener('click', () => {
            setTheme(id);
            closeThemeMenu();
        });
        menu.appendChild(li);
    });
    updateThemeMenuSelection();
}

function updateThemeMenuSelection() {
    const menu = document.getElementById('themeMenu');
    if (!menu) return;
    const current = getCurrentTheme();
    menu.querySelectorAll('.custom-select-option').forEach(li => {
        const selected = li.getAttribute('data-value') === current;
        li.classList.toggle('selected', selected);
        li.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
}

function onDocumentClick(e) {
    const btn = document.getElementById('themeToggle');
    const menu = document.getElementById('themeMenu');
    // Clicks on the button itself are the press that opened the menu (or the
    // click following long-press release); clicks inside the menu are handled
    // by each option's own listener. Only an actual outside click closes it.
    if ((btn && btn.contains(e.target)) || (menu && menu.contains(e.target))) return;
    closeThemeMenu();
}

function onDocumentKeydown(e) {
    if (e.key === 'Escape') closeThemeMenu();
}

// The menu lives in <body> (see setupThemeToggle), so it is positioned
// against the button's own rect rather than through relative CSS.
function positionThemeMenu() {
    const btn = document.getElementById('themeToggle');
    const menu = document.getElementById('themeMenu');
    if (!btn || !menu) return;
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
}

function openThemeMenu() {
    const btn = document.getElementById('themeToggle');
    const menu = document.getElementById('themeMenu');
    if (!btn || !menu) return;
    updateThemeMenuSelection();
    positionThemeMenu();
    menu.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
}

function closeThemeMenu() {
    const btn = document.getElementById('themeToggle');
    const menu = document.getElementById('themeMenu');
    if (!btn || !menu) return;
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
}

function clearPressTimer() {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
}

function setupThemeToggle() {
    const btn = document.getElementById('themeToggle');
    const menu = document.getElementById('themeMenu');
    if (!btn || !menu) return;

    // The header-actions group clips its overflow to animate its collapse, which
    // would clip the menu too if it stayed nested inside; moving it to <body>
    // and positioning it against the button's own rect (see openThemeMenu)
    // avoids that.
    document.body.appendChild(menu);

    renderThemeMenu();

    btn.addEventListener('pointerdown', e => {
        if (e.button !== 0) return; // left click / primary touch only
        longPressFired = false;
        clearPressTimer();
        pressTimer = setTimeout(() => {
            pressTimer = null;
            longPressFired = true;
            if (navigator.vibrate) navigator.vibrate(15);
            openThemeMenu();
        }, LONG_PRESS_MS);
    });

    ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => {
        btn.addEventListener(evt, clearPressTimer);
    });

    btn.addEventListener('click', () => {
        // The click that follows a long-press must not also cycle the theme.
        if (longPressFired) {
            longPressFired = false;
            return;
        }
        toggleTheme();
    });

    // A long press reads as a right-click / context-menu on some desktop
    // browsers - suppress the native menu so ours is the only one shown.
    btn.addEventListener('contextmenu', e => e.preventDefault());
}

export function initTheme() {
    let saved = null;
    try {
        saved = localStorage.getItem('dovi_theme');
    } catch (e) { /* localStorage unavailable -> keep default */ }
    applyTheme(THEME_ORDER.includes(saved) ? saved : 'dark');
    setupThemeToggle();
}

// The toggle's label and menu are built here, so they have to follow the language.
onLanguageChange(() => {
    updateThemeToggleLabel();
    renderThemeMenu();
});

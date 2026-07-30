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

// Also the order the menu lists them in, so a press walks the menu top to
// bottom - the light pair, then the dark pair, then midnight.
const THEME_ORDER = ['light', 'light-adaptive', 'dark', 'dark-adaptive', 'midnight'];

const THEME_META_COLORS = {
    light: '#eef1f7',
    'light-adaptive': '#eef1f7',
    dark: '#0a0c12',
    'dark-adaptive': '#0b0d14',
    midnight: '#04060c'
};

const THEME_NAME_KEYS = {
    light: 'theme_name_light',
    'light-adaptive': 'theme_name_light_adaptive',
    dark: 'theme_name_dark',
    'dark-adaptive': 'theme_name_dark_adaptive',
    midnight: 'theme_name_midnight'
};

// Holding the button down this long opens the menu instead of cycling.
const LONG_PRESS_MS = 500;

// How far the menu may sit from the viewport edge once it has been pushed back
// in, on a narrow screen where the toggle is too close to the right to hang the
// full width of the menu off it.
const MENU_VIEWPORT_MARGIN = 8;

/**
 * A stored theme under the name it goes by now.
 *
 * "adaptive" used to be one theme that read the OS preference; it is now two
 * that are picked outright. Anyone still on it keeps the one they were
 * actually looking at rather than being dropped back to the default.
 */
function migrateTheme(saved) {
    if (saved !== 'adaptive') return saved;
    const prefersLight = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches;
    const migrated = prefersLight ? 'light-adaptive' : 'dark-adaptive';
    persistTheme(migrated);
    return migrated;
}

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

    // The button sits inside the header's padding, so hanging the menu off the
    // button alone tucks its top edge behind the bar. Clearing the header
    // instead drops it below the whole thing.
    const header = document.querySelector('header');
    const below = header
        ? Math.max(rect.bottom, header.getBoundingClientRect().bottom)
        : rect.bottom;
    menu.style.top = `${below + 6}px`;

    // Hung from the toggle's left edge, opening rightwards. The toggle sits
    // near the right of the header though, so on a narrow screen that runs the
    // menu off the side - hence the pull back to the last position that still
    // fits, and never past the left edge either.
    menu.style.right = 'auto';
    menu.style.left = '0px';
    const width = menu.getBoundingClientRect().width;
    const rightmost = window.innerWidth - width - MENU_VIEWPORT_MARGIN;
    menu.style.left = `${Math.max(MENU_VIEWPORT_MARGIN, Math.min(rect.left, rightmost))}px`;
}

function openThemeMenu() {
    const btn = document.getElementById('themeToggle');
    const menu = document.getElementById('themeMenu');
    if (!btn || !menu) return;
    updateThemeMenuSelection();
    // Shown before it is placed: positionThemeMenu measures the menu to keep it
    // on screen, and a display:none menu measures zero wide. Both happen before
    // the frame is painted, so it never appears at the wrong spot.
    menu.classList.add('open');
    positionThemeMenu();
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
    saved = migrateTheme(saved);
    applyTheme(THEME_ORDER.includes(saved) ? saved : 'dark');
    setupThemeToggle();
}

// The toggle's label and menu are built here, so they have to follow the language.
onLanguageChange(() => {
    updateThemeToggleLabel();
    renderThemeMenu();
});

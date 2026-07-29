// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Dark / light theme, remembered across visits.
 */

import { onLanguageChange, t } from './i18n.js';

// Theme System (dark is the default)
const THEME_META_COLORS = { dark: '#0a0c12', light: '#eef1f7' };

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META_COLORS[theme] || THEME_META_COLORS.dark);
    updateThemeToggleLabel();
}

export function toggleTheme() {
    const next = getCurrentTheme() === 'light' ? 'dark' : 'light';
    try {
        localStorage.setItem('dovi_theme', next);
    } catch (e) { /* localStorage unavailable -> theme just won't persist */ }
    applyTheme(next);
}

export function updateThemeToggleLabel() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const label = t(getCurrentTheme() === 'light' ? 'theme_toggle_dark' : 'theme_toggle_light');
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
    const hiddenLabel = document.getElementById('themeToggleLabel');
    if (hiddenLabel) hiddenLabel.textContent = label;
}

export function initTheme() {
    let saved = null;
    try {
        saved = localStorage.getItem('dovi_theme');
    } catch (e) { /* localStorage unavailable -> keep default */ }
    applyTheme(saved === 'light' ? 'light' : 'dark');
}

// The toggle's label is built here, so it has to follow the language.
onLanguageChange(updateThemeToggleLabel);

// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Translations: loading a locale, looking a key up, and applying
 * the active language to the page.
 */

// i18n System
export let currentLang = 'en';
let translations = {};

/**
 * Everything that has to be redone when the language changes.
 *
 * Labels built in JS (the dropdowns, the badges of a row) are not covered by
 * the attribute pass below, and the modules that own them know best how to
 * rebuild them - so they say so here instead of this module having to know
 * about every one of them.
 */
const languageListeners = [];

export function onLanguageChange(listener) {
    languageListeners.push(listener);
}

function notifyLanguageChange() {
    languageListeners.forEach(listener => {
        try {
            listener();
        } catch (error) {
            console.error('Error in language change listener:', error);
        }
    });
}

async function loadTranslations(lang) {
    try {
        const response = await fetch(`/static/locale/${lang}.json`);
        if (!response.ok) throw new Error('Translation file not found');
        translations = await response.json();
        return true;
    } catch (error) {
        console.error('Error loading translations:', error);
        return false;
    }
}

export function t(key, replacements = {}) {
    let text = translations[key] || key;
    for (const [placeholder, value] of Object.entries(replacements)) {
        text = text.replace(`{${placeholder}}`, value);
    }
    return text;
}

/**
 * Apply the loaded translations to the page.
 *
 * ``root`` limits the pass to one subtree - the media dialog does that when it
 * opens, so it does not walk the whole page just to relabel its own fields.
 */
export function applyTranslations(root) {
    const scope = root || document;

    // Text content
    scope.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) {
            // For option elements, set text property; for others, set textContent
            if (el.tagName === 'OPTION') {
                el.text = translations[key];
            } else {
                el.textContent = translations[key];
            }
        }
    });
    
    // HTML content
    scope.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (translations[key]) el.innerHTML = translations[key];
    });

    // Placeholder attributes
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[key]) el.placeholder = translations[key];
    });

    // Data labels
    scope.querySelectorAll('[data-label-i18n]').forEach(el => {
        const key = el.getAttribute('data-label-i18n');
        if (translations[key]) el.setAttribute('data-label', translations[key]);
    });

    // Tooltips (icon-only controls carry their label there)
    scope.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (translations[key]) el.setAttribute('title', translations[key]);
    });

    // Aria labels
    scope.querySelectorAll('[data-aria-label-i18n]').forEach(el => {
        const key = el.getAttribute('data-aria-label-i18n');
        if (translations[key]) el.setAttribute('aria-label', translations[key]);
    });
}

export async function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('dovi_language', lang);
    document.documentElement.lang = lang;
    const loaded = await loadTranslations(lang);
    if (loaded) {
        applyTranslations();
        notifyLanguageChange();
    }
}

export async function initLanguage() {
    const savedLang = localStorage.getItem('dovi_language') || 'en';
    currentLang = savedLang;
    document.documentElement.lang = savedLang;
    await loadTranslations(savedLang);
    applyTranslations();
    notifyLanguageChange();
}

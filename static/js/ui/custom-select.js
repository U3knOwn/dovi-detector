// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The two custom dropdowns (sort mode and language).
 *
 * They mirror a native <select> but let every option carry an inline SVG icon,
 * which a real <option> cannot.
 */

import { currentLang, onLanguageChange, setLanguage, t } from '../core/i18n.js';
import { applySort, toggleSortDirection } from '../library/sorting.js';
import { FLAG_SVGS, SORT_ICONS } from './icons.js';

// Custom dropdown instances (sort + language), built on DOMContentLoaded.
export let sortSelectInstance = null;
let languageInstance = null;

const SORT_OPTIONS = [
    { value: 'filename',             i18n: 'sort_by_filename',             icon: 'file' },
    { value: 'filesize',             i18n: 'sort_by_filesize',             icon: 'drive' },
    { value: 'added',                i18n: 'sort_by_added',                icon: 'inbox' },
    { value: 'rating',               i18n: 'sort_by_rating',               icon: 'imdb' },
    { value: 'rating_tmdb',          i18n: 'sort_by_rating_tmdb',          icon: 'tmdb' },
    { value: 'rating_rt',            i18n: 'sort_by_rating_rt',            icon: 'rt' },
    { value: 'rating_rt_audience',   i18n: 'sort_by_rating_rt_audience',   icon: 'rt_audience' },
    { value: 'rating_trakt',         i18n: 'sort_by_rating_trakt',         icon: 'trakt' },
    { value: 'rating_metacritic',    i18n: 'sort_by_rating_metacritic',    icon: 'metacritic' },
    { value: 'year',                 i18n: 'sort_by_year',                 icon: 'calendar' },
    { value: 'duration',             i18n: 'sort_by_duration',             icon: 'clock' },
    { value: 'profile',              i18n: 'sort_by_profile',              icon: 'film' },
    { value: 'profile_audio',        i18n: 'sort_by_profile_audio',        icon: 'film' },
    { value: 'profile_videobitrate', i18n: 'sort_by_profile_videobitrate', icon: 'film' },
    { value: 'profile_audiobitrate', i18n: 'sort_by_profile_audiobitrate', icon: 'film' },
    { value: 'audio',                i18n: 'sort_by_audio',                icon: 'volume' },
    { value: 'audio_audiobitrate',   i18n: 'sort_by_audio_audiobitrate',   icon: 'volume' },
    { value: 'videobitrate',         i18n: 'sort_by_videobitrate',         icon: 'monitor' },
    { value: 'audiobitrate',         i18n: 'sort_by_audiobitrate',         icon: 'volume' },
    { value: 'cm_version',           i18n: 'sort_by_cm_version',           icon: 'target' }
];

const LANG_OPTIONS = [
    { value: 'de', label: 'DE' },
    { value: 'en', label: 'EN' },
    { value: 'fr', label: 'FR' },
    { value: 'es', label: 'ES' },
    { value: 'it', label: 'IT' },
    { value: 'pt', label: 'PT' },
    { value: 'nl', label: 'NL' },
    { value: 'pl', label: 'PL' },
    { value: 'ru', label: 'RU' },
    { value: 'tr', label: 'TR' },
    { value: 'zh', label: '中文' }
];

// Registry so an outside click / Escape can close every open dropdown.
const _customSelects = [];
function closeAllCustomSelects(except) {
    _customSelects.forEach(s => { if (s !== except) s.close(); });
}
document.addEventListener('click', e => {
    _customSelects.forEach(s => { if (!s.wrap.contains(e.target)) s.close(); });
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllCustomSelects();
});

// Build an accessible custom dropdown that mirrors a native <select> but lets
// each option carry an inline SVG icon (impossible with real <option>s).
function buildCustomSelect(cfg) {
    const wrap = document.getElementById(cfg.wrapId);
    const trigger = document.getElementById(cfg.triggerId);
    const current = document.getElementById(cfg.currentId);
    const menu = document.getElementById(cfg.menuId);
    if (!wrap || !trigger || !current || !menu) return null;

    let value = cfg.initialValue;

    function innerHTMLFor(opt) {
        return `<span class="custom-select-opt-icon">${cfg.iconFor(opt)}</span>` +
               `<span class="custom-select-opt-label"></span>`;
    }
    function fillLabel(el, opt) {
        const labelEl = el.querySelector('.custom-select-opt-label');
        if (labelEl) labelEl.textContent = cfg.labelFor(opt);
    }

    function renderCurrent() {
        const opt = cfg.options.find(o => o.value === value) || cfg.options[0];
        current.innerHTML = innerHTMLFor(opt);
        fillLabel(current, opt);
    }

    function renderMenu() {
        menu.innerHTML = '';
        cfg.options.forEach(opt => {
            const li = document.createElement('li');
            li.className = 'custom-select-option' + (opt.value === value ? ' selected' : '');
            li.setAttribute('role', 'option');
            li.setAttribute('data-value', opt.value);
            li.setAttribute('aria-selected', opt.value === value ? 'true' : 'false');
            li.innerHTML = innerHTMLFor(opt);
            fillLabel(li, opt);
            li.addEventListener('click', () => { select(opt.value); close(); });
            menu.appendChild(li);
        });
    }

    function open() {
        closeAllCustomSelects(api);
        wrap.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
    }
    function close() {
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }
    function toggle() { wrap.classList.contains('open') ? close() : open(); }

    function select(v, silent) {
        value = v;
        renderCurrent();
        menu.querySelectorAll('.custom-select-option').forEach(li => {
            const sel = li.getAttribute('data-value') === v;
            li.classList.toggle('selected', sel);
            li.setAttribute('aria-selected', sel ? 'true' : 'false');
        });
        if (!silent && cfg.onSelect) cfg.onSelect(v);
    }

    trigger.addEventListener('click', e => { e.stopPropagation(); toggle(); });

    renderMenu();
    renderCurrent();

    const api = {
        wrap,
        close,
        getValue: () => value,
        setValue: v => select(v, true),
        refresh: () => { renderMenu(); renderCurrent(); }
    };
    _customSelects.push(api);
    return api;
}

export function initCustomSelects() {
    sortSelectInstance = buildCustomSelect({
        wrapId: 'sortSelectWrap',
        triggerId: 'sortSelectTrigger',
        currentId: 'sortSelectCurrent',
        menuId: 'sortSelectMenu',
        options: SORT_OPTIONS,
        initialValue: localStorage.getItem('dovi_sort_mode') || 'filename',
        iconFor: opt => SORT_ICONS[opt.icon] || '',
        labelFor: opt => t(opt.i18n),
        onSelect: v => {
            localStorage.setItem('dovi_sort_mode', v);
            applySort(v);
        }
    });

    const dirToggle = document.getElementById('sortDirToggle');
    if (dirToggle) {
        // No stopPropagation: the document handler may close any other open
        // dropdown, the sort menu itself is left alone (the toggle sits
        // inside its wrapper) so the direction can be flipped while browsing.
        dirToggle.addEventListener('click', () => toggleSortDirection());
    }

    languageInstance = buildCustomSelect({
        wrapId: 'languageWrap',
        triggerId: 'languageTrigger',
        currentId: 'languageCurrent',
        menuId: 'languageMenu',
        options: LANG_OPTIONS,
        initialValue: currentLang,
        iconFor: opt => FLAG_SVGS[opt.value] || '',
        labelFor: opt => opt.label,
        onSelect: v => setLanguage(v)
    });
}

/* -------------------------------
   New Sorting Logic (client-side)
   ------------------------------- */

export function updateLanguageButtons() {
    // Keep the language dropdown in sync with the active language,
    // otherwise it falls back to the hardcoded default after a reload.
    if (languageInstance) languageInstance.setValue(currentLang);
}

// The dropdown labels are built from translations, so they are rebuilt rather
// than translated in place.
onLanguageChange(() => {
    if (sortSelectInstance) sortSelectInstance.refresh();
    updateLanguageButtons();
});

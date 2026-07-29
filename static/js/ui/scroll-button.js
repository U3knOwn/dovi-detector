// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * The floating scroll up / down button.
 */

export function setupScrollButton() {
  'use strict';
  if (window.__scrollButtonInit) return;
  window.__scrollButtonInit = true;

  function init() {
    const btn = document.getElementById('scrollToggle');
    if (!btn) return;
    const icon = btn.querySelector('.icon');
    const doc = document.documentElement;
    const body = document.body;

    const nearBottomPx = 120;
    const minimalMove = 5;
    const hideAtTopPx = 20;
    const inactivityDelay = 3000;

    let lastScrollTop = window.scrollY || window.pageYOffset || 0;
    let rafScheduled = false;
    let inactivityTimer = null;
    let currentState = 'bottom';

    function getMaxScrollTop() {
      const vh = window.innerHeight || doc.clientHeight;
      const full = Math.max(body.scrollHeight, doc.scrollHeight);
      return Math.max(0, full - vh);
    }

    function getScrollTop() {
      return window.scrollY || window.pageYOffset || 0;
    }

    function isAtTop() {
      return getScrollTop() <= hideAtTopPx;
    }

    function isAtBottom() {
      const scrollY = getScrollTop();
      const vh = window.innerHeight || doc.clientHeight;
      const full = Math.max(body.scrollHeight, doc.scrollHeight);
      return (full - (scrollY + vh)) <= nearBottomPx;
    }

    const ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    const ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';

    function setStateTop() {
      currentState = 'top';
      icon && (icon.innerHTML = ARROW_UP);
    }

    function setStateBottom() {
      currentState = 'bottom';
      icon && (icon.innerHTML = ARROW_DOWN);
    }

    function clearInactivityTimer() {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    }

    function resetInactivityTimer() {
      clearInactivityTimer();
      inactivityTimer = setTimeout(() => {
        if (!isAtTop() && !isAtBottom() && !isDialogOpen()) hideButton();
      }, inactivityDelay);
    }

    function showButton() {
      if (isAtTop() || isAtBottom() || isDialogOpen()) {
        hideButton();
        return;
      }
      btn.classList.remove('hidden');
      resetInactivityTimer();
    }

    function hideButton() {
      btn.classList.add('hidden');
      clearInactivityTimer();
    }

    function updateInitial() {
      const max = getMaxScrollTop();
      if (max === 0) { hideButton(); return; }

      if (isAtTop() || isAtBottom() || isDialogOpen()) {
        hideButton();
        setStateBottom();
        return;
      }

      setStateBottom();
      showButton();
    }

    function handleScrollDirection() {
      const current = getScrollTop();
      const delta = current - lastScrollTop;
      lastScrollTop = Math.max(0, current);

      if (getMaxScrollTop() === 0) { hideButton(); return; }

      if (isAtTop() || isAtBottom() || isDialogOpen()) {
        hideButton();
        return;
      }

      if (Math.abs(delta) < minimalMove) return;

      if (delta > 0) {
        setStateBottom();
        showButton();
      } else {
        setStateTop();
        showButton();
      }
    }

    function onScrollOrResize() {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        handleScrollDirection();
        rafScheduled = false;
      });
    }

    // Media dialog overlay detection and observer
    const overlay = document.getElementById('mediaDialogOverlay') || document.querySelector('.media-dialog-overlay');
    function isDialogOpen() {
      return overlay && overlay.classList && overlay.classList.contains('active');
    }
    if (overlay) {
      const overlayObserver = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            if (isDialogOpen()) {
              hideButton();
              clearInactivityTimer();
            } else {
              updateInitial();
            }
            break;
          }
        }
      });
      overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });

      // Sync initial state with dialog (if already open)
      if (isDialogOpen()) hideButton();
    }

    async function scrollToBottomWithRetries({
      retries = 8,
      delay = 300,
      threshold = 8
    } = {}) {
      const getViewport = () =>
        window.innerHeight || document.documentElement.clientHeight;

      const getFullHeight = () =>
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

      const isAtBottomLocal = () => {
        const scrollTop = getScrollTop();
        return (getFullHeight() - (scrollTop + getViewport())) <= threshold;
      };

      for (let i = 0; i < retries; i++) {
        window.scrollTo({ top: getFullHeight(), behavior: 'smooth' });
        await new Promise(r => setTimeout(r, delay));
        if (isAtBottomLocal()) return true;
      }

      window.scrollTo(0, getFullHeight());
      return isAtBottomLocal();
    }

    btn.addEventListener(
      'click',
      function () {
        if (isDialogOpen()) return;

        if (currentState === 'top') {
          btn.disabled = true;
          window.scrollTo({ top: 0, behavior: 'smooth' });

          setTimeout(() => {
            btn.disabled = false;
          }, 600);

          resetInactivityTimer();
          return;
        }

        btn.disabled = true;

        scrollToBottomWithRetries({ retries: 8, delay: 350, threshold: 6 })
          .finally(() => {
            btn.disabled = false;

            if (getMaxScrollTop() === 0 || isAtTop() || isAtBottom()) {
              hideButton();
            } else {
              setStateBottom();
              showButton();
            }

            resetInactivityTimer();
          });
      },
      { passive: true }
    );

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    updateInitial();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

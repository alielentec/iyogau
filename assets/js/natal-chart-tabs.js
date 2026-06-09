/* =====================================================================
 *  natal-chart-tabs.js
 *  ---------------------------------------------------------------------
 *  Generic ARIA-compliant tablist behavior. Auto-binds to every
 *  `[data-natal-tabs]` element in the document on DOMContentLoaded.
 *
 *  Markup contract:
 *    <div data-natal-tabs role="tablist">
 *      <button role="tab" id="t1" aria-controls="p1" aria-selected="..." tabindex="0|-1" class="… is-active">Tab 1</button>
 *      ...
 *    </div>
 *    <div role="tabpanel" id="p1" aria-labelledby="t1" hidden|visible>...</div>
 *    ...
 *
 *  The first tab whose `aria-selected="true"` is the default active
 *  tab. Each tab has `aria-controls="<panelId>"`; the panel with that
 *  id is shown when the tab is active and hidden when not.
 *
 *  Keyboard:
 *    ArrowLeft  / ArrowRight — move focus to adjacent tab + activate.
 *    Home / End              — jump to first / last tab.
 *    Space / Enter           — activate the focused tab (default).
 *
 *  Multiple tablists on the same page work — each tablist tracks its
 *  own active tab. The script auto-skips pages that have no tablists.
 *
 *  No dependencies. Loadable on every page; no-op when no tablists.
 * ===================================================================== */

(function () {
  'use strict';

  function activateTab(tab, tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (t) {
      var active = (t === tab);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      t.setAttribute('tabindex', active ? '0' : '-1');
      t.classList.toggle('is-active', active);
      // The panel each tab controls
      var panelId = t.getAttribute('aria-controls');
      var panel = panelId ? document.getElementById(panelId) : null;
      if (panel) panel.hidden = !active;
    });
  }

  function bindTablist(tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length === 0) return;

    // Click
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activateTab(tab, tablist);
        tab.focus();
      });
    });

    // Arrow / Home / End
    tablist.addEventListener('keydown', function (e) {
      var current = document.activeElement;
      if (!current || current.getAttribute('role') !== 'tab') return;
      var idx = tabs.indexOf(current);
      if (idx < 0) return;
      var next = null;
      switch (e.key) {
        case 'ArrowLeft':
        case 'Left':
          next = tabs[(idx - 1 + tabs.length) % tabs.length];
          break;
        case 'ArrowRight':
        case 'Right':
          next = tabs[(idx + 1) % tabs.length];
          break;
        case 'Home':
          next = tabs[0];
          break;
        case 'End':
          next = tabs[tabs.length - 1];
          break;
        default:
          return;
      }
      if (next) {
        e.preventDefault();
        activateTab(next, tablist);
        next.focus();
      }
    });

    // Make sure the markup's pre-declared aria-selected state is
    // reflected in panel visibility (panels start hidden in HTML; we
    // unhide whichever matches the active tab).
    var activeTab = tablist.querySelector('[role="tab"][aria-selected="true"]') || tabs[0];
    activateTab(activeTab, tablist);
  }

  function init() {
    var tablists = document.querySelectorAll('[data-natal-tabs]');
    Array.prototype.forEach.call(tablists, bindTablist);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());

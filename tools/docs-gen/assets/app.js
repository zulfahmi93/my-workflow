/* docs-gen — shared interactions. No dependencies. Project-agnostic. */
(function () {
  'use strict';

  /* ---- Theme (persisted to localStorage) -------------------------------- */
  var root = document.documentElement;
  // The localStorage key is per-project, injected onto <html data-theme-key="…">
  // by the generator (this asset is shared across every project's site).
  var STORE = root.getAttribute('data-theme-key') || 'docs-theme';

  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      btn.setAttribute('aria-pressed', String(t === 'dark'));
    }
  }

  // Set as early as possible (also inlined in <head> to avoid flash).
  try {
    var saved = localStorage.getItem(STORE);
    var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (sysDark ? 'dark' : 'light'));
  } catch (e) { applyTheme('light'); }

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('.theme-toggle');
    if (toggle) {
      applyTheme(root.getAttribute('data-theme') || 'light');
      toggle.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem(STORE, next); } catch (e) {}
      });
    }

    /* ---- Mobile top-nav menu -------------------------------------------- */
    var navToggle = document.querySelector('.nav-toggle');
    var topnav = document.querySelector('.topnav');
    if (navToggle && topnav) {
      navToggle.addEventListener('click', function () {
        var open = topnav.classList.toggle('menu-open');
        navToggle.setAttribute('aria-expanded', String(open));
      });
    }

    /* ---- Mobile TOC accordion ------------------------------------------- */
    var tocTitle = document.querySelector('.toc-title');
    if (tocTitle) {
      tocTitle.addEventListener('click', function () {
        var toc = tocTitle.closest('.toc');
        if (window.matchMedia('(max-width: 860px)').matches) {
          var open = toc.classList.toggle('open');
          tocTitle.setAttribute('aria-expanded', String(open));
        }
      });
    }

    /* ---- Copy-to-clipboard ---------------------------------------------- */
    var checkSVG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
    document.querySelectorAll('.copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sel = btn.getAttribute('data-copy-target');
        var src = sel ? document.querySelector(sel) : null;
        var text = src ? (src.textContent || '') : '';
        // Strip a single leading newline that markup indentation can introduce.
        text = text.replace(/^\n/, '');
        var original = btn.innerHTML;
        var done = function () {
          btn.classList.add('copied');
          btn.innerHTML = checkSVG + '<span>Copied</span>';
          setTimeout(function () { btn.classList.remove('copied'); btn.innerHTML = original; }, 1800);
        };
        var fail = function () {
          btn.textContent = 'Copy failed';
          setTimeout(function () { btn.innerHTML = original; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text, done, fail); });
        } else {
          legacyCopy(text, done, fail);
        }
      });
    });

    function legacyCopy(text, done, fail) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? done() : fail();
      } catch (e) { fail(); }
    }

    /* ---- Active-section TOC highlight (scroll spy) ---------------------- */
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    if (tocLinks.length && 'IntersectionObserver' in window) {
      var map = {};
      var targets = [];
      tocLinks.forEach(function (a) {
        var id = a.getAttribute('href').slice(1);
        var el = document.getElementById(id);
        if (el) { map[id] = a; targets.push(el); }
      });
      var visible = new Set();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) visible.add(en.target.id);
          else visible.delete(en.target.id);
        });
        // Highlight the first target (in document order) currently visible.
        var current = targets.find(function (t) { return visible.has(t.id); });
        if (!current) return;
        tocLinks.forEach(function (a) { a.classList.remove('active'); a.removeAttribute('aria-current'); });
        var active = map[current.id];
        if (active) { active.classList.add('active'); active.setAttribute('aria-current', 'true'); }
      }, { rootMargin: '-84px 0px -65% 0px', threshold: 0 });
      targets.forEach(function (t) { io.observe(t); });
    }

    /* ---- Expand / collapse all cycle cards ------------------------------ */
    var expandAll = document.querySelector('[data-expand-all]');
    if (expandAll) {
      expandAll.addEventListener('click', function () {
        var cards = document.querySelectorAll('details.cycle-card');
        var anyClosed = Array.prototype.some.call(cards, function (c) { return !c.open; });
        cards.forEach(function (c) { c.open = anyClosed; });
        expandAll.textContent = anyClosed ? 'Collapse all' : 'Expand all';
      });
    }
  });
})();

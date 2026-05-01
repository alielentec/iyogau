// iYogaU app
// Handles: theme switching, language switching, mobile menu, picker dropdowns

(function () {
  'use strict';

  const STORAGE_THEME = 'iyogau_theme';
  const STORAGE_LANG = 'iyogau_lang';
  const SUPPORTED_LANGS = ['en', 'ko', 'zh'];
  const SUPPORTED_THEMES = ['sanctuary', 'glacier', 'saffron', 'amethyst'];

  // Anchor for any "years teaching" claims. Ali's 200-hour Raja Yoga
  // certification was issued 2021-03-01; computing from that date keeps
  // the about section truthful as time passes (Cal. Bus. & Prof. §17500).
  // Used by applyTranslations() to substitute {years} in i18n strings.
  const TEACHING_START_ISO = '2021-03-01T00:00:00Z';

  function yearsTeaching() {
    const start = new Date(TEACHING_START_ISO).getTime();
    const ms = Date.now() - start;
    const years = Math.floor(ms / (365.2425 * 24 * 60 * 60 * 1000));
    return Math.max(years, 1);
  }

  /* ---------- THEME ---------- */
  function getTheme() {
    const saved = localStorage.getItem(STORAGE_THEME);
    return SUPPORTED_THEMES.includes(saved) ? saved : 'sanctuary';
  }

  function setTheme(theme) {
    if (!SUPPORTED_THEMES.includes(theme)) return;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_THEME, theme);
    syncPickerStates('theme', theme);
  }

  /* ---------- LANG ---------- */
  function pathLang() {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return SUPPORTED_LANGS.includes(seg) ? seg : null;
  }

  function langToPath(lang) {
    return lang === 'en' ? '/' : '/' + lang + '/';
  }

  function detectLang() {
    // The URL path is the single source of truth for language.
    // Each canonical URL (/, /ko/, /zh/) maps 1:1 to the language served,
    // so localStorage / browser-language hints don't override it — that
    // would desync the page from its canonical declaration and confuse
    // search engines. Picker clicks navigate to switch language.
    const fromPath = pathLang();
    if (fromPath) return fromPath;
    // Backwards-compat for old ?lang=ko URLs: redirect to the path version.
    const fromQuery = new URLSearchParams(location.search).get('lang');
    if (SUPPORTED_LANGS.includes(fromQuery) && fromQuery !== 'en') {
      window.location.replace(langToPath(fromQuery) + location.hash);
    }
    return 'en';
  }

  function applyTranslations(lang) {
    const dict = (window.I18N && window.I18N[lang]) || window.I18N.en;
    document.documentElement.lang = lang;

    const years = String(yearsTeaching());
    const fill = (s) => s.replace(/\{years\}/g, years);

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const value = dict[key];
      if (typeof value === 'string') el.textContent = fill(value);
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      // format: "attr:key,attr2:key2"
      const pairs = el.getAttribute('data-i18n-attr').split(',');
      pairs.forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        const value = dict[key];
        if (attr && typeof value === 'string') el.setAttribute(attr, fill(value));
      });
    });

    // Title + meta
    if (dict['meta.title']) document.title = fill(dict['meta.title']);
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && dict['meta.description']) metaDesc.setAttribute('content', fill(dict['meta.description']));
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc && dict['meta.description']) ogDesc.setAttribute('content', fill(dict['meta.description']));
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && dict['meta.title']) ogTitle.setAttribute('content', fill(dict['meta.title']));
  }

  function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    localStorage.setItem(STORAGE_LANG, lang);
    // If we're on a path that doesn't match the chosen lang, navigate.
    // Picker click navigates so canonical URL stays correct for SEO.
    const onPath = pathLang() || 'en';
    if (onPath !== lang) {
      const target = langToPath(lang) + location.hash;
      window.location.assign(target);
      return;
    }
    applyTranslations(lang);
    syncPickerStates('lang', lang);
    if (window.IYOGAU_CURRENCY) window.IYOGAU_CURRENCY.updatePrices(lang);
  }

  /* ---------- PICKERS ---------- */
  function syncPickerStates(group, value) {
    document.querySelectorAll(`[data-picker="${group}"] [data-value]`).forEach(btn => {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-value') === value ? 'true' : 'false');
    });
    // Update button label
    document.querySelectorAll(`[data-picker="${group}"] .picker-btn .picker-current`).forEach(el => {
      el.textContent = value.toUpperCase().slice(0, 2) === 'ZH' ? '中' : value.toUpperCase().slice(0, 2);
    });
  }

  function bindPickers() {
    document.querySelectorAll('[data-picker]').forEach(picker => {
      const btn = picker.querySelector('.picker-btn');
      if (!btn) return;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        // Close other pickers
        document.querySelectorAll('[data-picker].open').forEach(p => {
          if (p !== picker) p.classList.remove('open');
        });
        picker.classList.toggle('open');
      });
      picker.querySelectorAll('[data-value]').forEach(opt => {
        opt.addEventListener('click', () => {
          const value = opt.getAttribute('data-value');
          const group = picker.getAttribute('data-picker');
          if (group === 'theme') setTheme(value);
          if (group === 'lang') setLang(value);
          picker.classList.remove('open');
        });
      });
    });
    document.addEventListener('click', () => {
      document.querySelectorAll('[data-picker].open').forEach(p => p.classList.remove('open'));
    });
  }

  /* ---------- MOBILE MENU ---------- */
  function bindMobileMenu() {
    const toggle = document.querySelector('.menu-toggle');
    const menu = document.querySelector('.mobile-menu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- NEWSLETTER (no-op v1) ---------- */
  function bindNewsletter() {
    const form = document.querySelector('.newsletter-form');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const button = form.querySelector('button');
      if (input && input.value) {
        button.textContent = '✓';
        input.value = '';
        setTimeout(() => {
          const dict = (window.I18N && window.I18N[localStorage.getItem(STORAGE_LANG) || 'en']) || window.I18N.en;
          button.textContent = dict['footer.subscribe'] || 'Subscribe';
        }, 2000);
      }
    });
  }

  /* ---------- INIT ---------- */
  function init() {
    setTheme(getTheme());
    setLang(detectLang());
    bindPickers();
    bindMobileMenu();
    bindNewsletter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

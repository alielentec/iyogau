// iYogaU currency converter
// Source price stored in USD on element via data-price-usd="..."
// Display currency picked from current language.
//
// Rates come from /rates.json — a static file in this repo that is refreshed
// hourly by a GitHub Action (.github/workflows/update-rates.yml) which calls
// open.er-api.com server-side. Visitors never hit the external API directly,
// so the page loads instantly from same-origin and we make at most 24 upstream
// calls per day regardless of traffic. If /rates.json fails for any reason,
// hard-coded fallback rates keep the price tag readable.

(function () {
  'use strict';

  const CURRENCY_BY_LANG = { en: 'USD', ko: 'KRW', zh: 'CNY' };
  const LOCALE_BY_LANG = { en: 'en-US', ko: 'ko-KR', zh: 'zh-CN' };
  const FALLBACK_RATES = { USD: 1, KRW: 1390, CNY: 7.25 };
  const RATES_URL = '/rates.json';
  const SESSION_CACHE_KEY = 'iyogau_fx_session';

  let ratesPromise = null;

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.rates) return parsed;
    } catch (e) { /* ignore */ }
    return null;
  }

  function writeSession(payload) {
    try { sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(payload)); }
    catch (e) { /* ignore */ }
  }

  async function fetchRates() {
    const cached = readSession();
    if (cached) return cached;

    try {
      const res = await fetch(RATES_URL, { cache: 'default' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.rates && typeof data.rates.KRW === 'number' && typeof data.rates.CNY === 'number') {
          const payload = {
            rates: { USD: 1, KRW: data.rates.KRW, CNY: data.rates.CNY },
            updated: data.updated || null,
            source: data.source || 'rates.json'
          };
          writeSession(payload);
          return payload;
        }
      }
    } catch (e) {
      // network failure or invalid JSON - fall through to fallback
    }
    return { rates: FALLBACK_RATES, updated: null, source: 'fallback' };
  }

  function getRates() {
    if (!ratesPromise) ratesPromise = fetchRates();
    return ratesPromise;
  }

  function formatPrice(amountUsd, currency, lang) {
    const locale = LOCALE_BY_LANG[lang] || 'en-US';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0
      }).format(amountUsd);
    } catch (e) {
      return currency + ' ' + Math.round(amountUsd).toLocaleString();
    }
  }

  async function updatePrices(lang) {
    const currency = CURRENCY_BY_LANG[lang] || 'USD';
    const { rates, updated, source } = await getRates();
    const rate = rates[currency] || 1;

    document.querySelectorAll('[data-price-usd]').forEach(el => {
      const usd = parseFloat(el.getAttribute('data-price-usd'));
      if (isNaN(usd)) return;
      el.textContent = formatPrice(usd * rate, currency, lang);
    });

    document.querySelectorAll('[data-fx-note]').forEach(el => {
      if (currency === 'USD') {
        el.textContent = '';
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const dict = (window.I18N && window.I18N[lang]) || {};
      const noteLabel = dict['course.fx_note'] || 'live rate';
      let ts = '';
      if (updated && source !== 'fallback') {
        const d = new Date(updated);
        if (!isNaN(d.getTime())) {
          ts = d.toLocaleDateString(LOCALE_BY_LANG[lang] || 'en-US');
        }
      }
      el.textContent = '· ' + noteLabel + (ts ? ' · ' + ts : '');
    });
  }

  window.IYOGAU_CURRENCY = { updatePrices };
})();

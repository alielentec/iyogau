// iYogaU live currency converter
// Source price stored in USD on element via data-price-usd="..."
// Display currency is chosen from current language. Rates fetched live, cached 1h, with fallback.

(function () {
  'use strict';

  const CURRENCY_BY_LANG = { en: 'USD', ko: 'KRW', zh: 'CNY' };
  const LOCALE_BY_LANG = { en: 'en-US', ko: 'ko-KR', zh: 'zh-CN' };
  const FALLBACK_RATES = { USD: 1, KRW: 1390, CNY: 7.25 };
  const CACHE_KEY = 'iyogau_fx';
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour

  // Free, CORS-friendly FX API. Falls back if it fails.
  const FX_URL = 'https://open.er-api.com/v6/latest/USD';

  let ratesPromise = null;

  function getCachedRates() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { rates, timestamp, source } = JSON.parse(raw);
      if (Date.now() - timestamp < CACHE_TTL && rates) return { rates, source };
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveRates(rates, source) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, source, timestamp: Date.now() }));
    } catch (e) { /* ignore */ }
  }

  async function fetchRates() {
    const cached = getCachedRates();
    if (cached) return cached;

    try {
      const res = await fetch(FX_URL, { cache: 'no-cache' });
      const data = await res.json();
      if (data && data.result === 'success' && data.rates) {
        const rates = {
          USD: 1,
          KRW: data.rates.KRW || FALLBACK_RATES.KRW,
          CNY: data.rates.CNY || FALLBACK_RATES.CNY
        };
        saveRates(rates, 'live');
        return { rates, source: 'live' };
      }
    } catch (e) {
      // network or CORS failure
    }
    return { rates: FALLBACK_RATES, source: 'fallback' };
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
    const { rates, source } = await getRates();
    const rate = rates[currency] || 1;

    document.querySelectorAll('[data-price-usd]').forEach(el => {
      const usd = parseFloat(el.getAttribute('data-price-usd'));
      if (isNaN(usd)) return;
      const local = usd * rate;
      el.textContent = formatPrice(local, currency, lang);
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
      const ts = source === 'live' ? new Date().toLocaleDateString(LOCALE_BY_LANG[lang] || 'en-US') : '';
      el.textContent = '· ' + noteLabel + (ts ? ' · ' + ts : '');
    });
  }

  // Expose to app.js
  window.IYOGAU_CURRENCY = { updatePrices };
})();

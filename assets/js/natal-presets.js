/* =====================================================================
 *  natal-presets.js
 *  ---------------------------------------------------------------------
 *  Famous-people birth-data presets for the home-page natal-chart
 *  picker. Numeric / structural data only — display strings (names,
 *  place labels, blurbs) live in the i18n bundle under
 *  natal.presets.<id>.{name,placeLabel,blurb}. This file keeps
 *  numbers / IDs / IANA tz strings out of i18n (numbers are not
 *  translatable) so the picker has one canonical source for the
 *  chart-math inputs.
 *
 *  Each preset is a snapshot. The picker writes lat/lon/tz directly
 *  to the form (bypassing the gazetteer for places not in the
 *  iyogau cities list — Ulm, Bellur, Vadnagar, Taktser/Xining).
 *  When all five chart-math fields (date, time, lat, lon, tz) match
 *  a preset exactly, the form is in DEMO state for that preset; any
 *  edit to one of those fields demotes to CUSTOM (hard auto-clear).
 *  Editing the name input is NOT a demotion — name is a vanity label
 *  the chart math doesn't read.
 *
 *  Sources / data-quality notes live in the `source` field; the
 *  picker surfaces them as the "<name> birth data: <source>"
 *  attribution in the demo callout under the wheel.
 * ===================================================================== */

(function () {
  'use strict';

  var PRESETS = [
    {
      id: 'steve-jobs',
      name: 'Steve Jobs',
      birthDate: '1955-02-24',
      birthTime: '19:15',
      placeLabel: 'San Francisco, United States',
      lat: 37.7749,
      lon: -122.4194,
      tz: 'America/Los_Angeles',
      source: 'Astro-Databank AA-rated (birth certificate)',
      blurb: "Apple co-founder; long-time Zen Buddhist practitioner; 1974 pilgrimage to Neem Karoli Baba's ashram in India"
    },
    {
      id: 'mahatma-gandhi',
      name: 'Mahatma Gandhi',
      birthDate: '1869-10-02',
      birthTime: '07:11',
      placeLabel: 'Porbandar, India',
      lat: 21.6422,
      lon: 69.6093,
      tz: 'Asia/Kolkata',
      source: 'Astro-Databank AA-rated (K.S. Krishnamurti, from mother). Time is 07:11 LMT; the API receives 07:11 with tz Asia/Kolkata, which differs from LMT by ~22 minutes — flag for review with the chart engine',
      blurb: 'Father of modern India; daily karma-yoga discipline and Bhagavad Gita study'
    },
    {
      id: 'albert-einstein',
      name: 'Albert Einstein',
      birthDate: '1879-03-14',
      birthTime: '11:30',
      placeLabel: 'Ulm, Germany',
      lat: 48.3984,
      lon: 9.9916,
      tz: 'Europe/Berlin',
      source: 'Astro-Databank AA-rated (birth certificate). Note: Ulm is NOT in the iyogau cities gazetteer; picker bypasses the city lookup and writes lat/lon/tz directly',
      blurb: 'Theoretical physicist; deep interest in Spinoza, Indian philosophy, and the unity of natural law'
    },
    {
      id: 'paramahansa-yogananda',
      name: 'Paramahansa Yogananda',
      birthDate: '1893-01-05',
      birthTime: '20:38',
      placeLabel: 'Gorakhpur, India',
      lat: 26.7663,
      lon: 83.3689,
      tz: 'Asia/Kolkata',
      source: "Astro-Databank A-rated (from Yogananda's family / Self-Realization Fellowship records). Time 20:38 LMT — see Mahatma-Gandhi note on LMT-vs-IST drift (~22 min); flag for chart-engine review",
      blurb: 'Author of Autobiography of a Yogi; brought Kriya Yoga to the West (1920)'
    },
    {
      id: 'bks-iyengar',
      name: 'B.K.S. Iyengar',
      birthDate: '1918-12-14',
      birthTime: '04:30',
      placeLabel: 'Bellur, India',
      lat: 12.6276,
      lon: 76.7956,
      tz: 'Asia/Kolkata',
      source: 'uncertain — consensus is 04:30 IST per his autobiography and Iyengar Yoga sources, but Astro-Databank rates the time C (caution; rectified or family-reported, not from records). Bellur is NOT in the iyogau cities gazetteer; picker writes lat/lon/tz directly (lat/lon from Bellur village, Kolar district, Karnataka)',
      blurb: 'Founder of Iyengar Yoga; author of Light on Yoga (1966); precision and alignment lineage'
    },
    {
      id: 'sachin-tendulkar',
      name: 'Sachin Tendulkar',
      birthDate: '1973-04-24',
      birthTime: '17:18',
      placeLabel: 'Mumbai, India',
      lat: 19.0728,
      lon: 72.8826,
      tz: 'Asia/Kolkata',
      source: 'Astro-Databank A-rated (from him, via Times of India interview)',
      blurb: "Cricket legend ('Little Master'); 100 international centuries; Bharat Ratna 2014"
    },
    {
      id: 'narendra-modi',
      name: 'Narendra Modi',
      birthDate: '1950-09-17',
      birthTime: '11:00',
      placeLabel: 'Vadnagar, India',
      lat: 23.7833,
      lon: 72.6333,
      tz: 'Asia/Kolkata',
      source: 'uncertain — Astro-Databank DD-rated (dirty data; conflicting times in circulation). 11:00 IST is the most widely cited value. Vadnagar is NOT in the iyogau cities gazetteer; picker writes lat/lon/tz directly',
      blurb: 'Prime Minister of India since 2014; long-time daily yoga practitioner; founded International Yoga Day (UN, 2014)'
    },
    {
      id: 'dalai-lama-14',
      name: 'Dalai Lama (14th, Tenzin Gyatso)',
      birthDate: '1935-07-06',
      birthTime: '04:38',
      placeLabel: 'Xining, China',
      lat: 36.6171,
      lon: 101.7782,
      tz: 'Asia/Shanghai',
      source: 'Astro-Databank AA-rated (from him). Note: birthplace is the village of Taktser, ~100km NE of Xining in Qinghai province; using nearest gazetteer city Xining and tz Asia/Shanghai (China standard time, the IANA zone covering Qinghai)',
      blurb: '14th Dalai Lama; spiritual leader of Tibetan Buddhism; Nobel Peace 1989'
    }
  ];

  // Freeze so the form code can't accidentally mutate the snapshot
  // (a stray `preset.lat = parseFloat(...)` would corrupt the
  // demo-match check on subsequent picks).
  PRESETS.forEach(function (p) { Object.freeze(p); });
  Object.freeze(PRESETS);

  window.IYOGAU_NATAL_PRESETS = PRESETS;
}());

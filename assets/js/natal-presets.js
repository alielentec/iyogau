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
 *  iyogau cities list — Queens, Pretoria, Albuquerque, Funchal, etc.).
 *  When all five chart-math fields (date, time, lat, lon, tz) match
 *  a preset exactly, the form is in DEMO state for that preset; any
 *  edit to one of those fields demotes to CUSTOM (hard auto-clear).
 *  Editing the name input is NOT a demotion — name is a vanity label
 *  the chart math doesn't read.
 *
 *  Sources / data-quality notes live in the `source` field; the
 *  picker surfaces them as the "<name> birth data: <source>"
 *  attribution in the demo callout under the wheel.
 *
 *  Ordering: Steve Jobs is FIRST (he's the default-landing chart;
 *  index.html line ~660 holds his pre-computed JSON). The remaining
 *  13 entries follow the user-requested order for the dropdown.
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
      id: 'donald-trump',
      name: 'Donald Trump',
      birthDate: '1946-06-14',
      birthTime: '10:54',
      placeLabel: 'Queens, New York, United States',
      lat: 40.7282,
      lon: -73.7949,
      tz: 'America/New_York',
      source: 'Astro-Databank AA-rated (birth certificate)',
      blurb: '45th and 47th President of the United States; real-estate businessman and television personality'
    },
    {
      id: 'elon-musk',
      name: 'Elon Musk',
      birthDate: '1971-06-28',
      birthTime: '07:30',
      placeLabel: 'Pretoria, South Africa',
      lat: -25.7461,
      lon: 28.1881,
      tz: 'Africa/Johannesburg',
      source: 'Astro-Databank DD-rated; time disputed. 07:30 SAST is the most-cited figure but Musk himself has publicly disputed this time. Ascendant and house cusps may not be accurate — flag for review',
      blurb: 'Tesla / SpaceX founder; CEO of X; one of the most-followed figures in modern technology'
    },
    {
      id: 'jeff-bezos',
      name: 'Jeff Bezos',
      birthDate: '1964-01-12',
      birthTime: '01:00',
      placeLabel: 'Albuquerque, New Mexico, United States',
      lat: 35.0844,
      lon: -106.6504,
      tz: 'America/Denver',
      source: 'Astro-Databank A-rated (from him via biographers)',
      blurb: 'Amazon founder; Blue Origin founder; long-time investor in space technology'
    },
    {
      id: 'mark-zuckerberg',
      name: 'Mark Zuckerberg',
      birthDate: '1984-05-14',
      birthTime: '14:30',
      placeLabel: 'White Plains, New York, United States',
      lat: 41.0340,
      lon: -73.7629,
      tz: 'America/New_York',
      source: 'Astro-Databank C-rated; widely-cited 14:30 has no birth-certificate support. Ascendant and house cusps may not be accurate — flag for review',
      blurb: 'Meta (Facebook) co-founder and CEO; computer programmer and businessman'
    },
    {
      id: 'michael-jackson',
      name: 'Michael Jackson',
      birthDate: '1958-08-29',
      birthTime: '19:33',
      placeLabel: 'Gary, Indiana, United States',
      lat: 41.5934,
      lon: -87.3464,
      tz: 'America/Chicago',
      source: 'Astro-Databank AA-rated (from his mother Katherine Jackson, hospital records)',
      blurb: 'King of Pop; singer, songwriter, dancer; cultural icon of the late 20th century'
    },
    {
      id: 'michael-jordan',
      name: 'Michael Jordan',
      birthDate: '1963-02-17',
      birthTime: '13:40',
      placeLabel: 'Brooklyn, New York, United States',
      lat: 40.6782,
      lon: -73.9442,
      tz: 'America/New_York',
      source: 'Astro-Databank AA-rated (birth certificate)',
      blurb: 'Six-time NBA champion; widely considered the greatest basketball player of all time'
    },
    {
      id: 'taylor-swift',
      name: 'Taylor Swift',
      birthDate: '1989-12-13',
      birthTime: '05:17',
      placeLabel: 'West Reading, Pennsylvania, United States',
      lat: 40.3354,
      lon: -75.9521,
      tz: 'America/New_York',
      source: 'Astro-Databank AA-rated (birth certificate)',
      blurb: 'Singer-songwriter; 14-time Grammy winner; defining pop / country crossover artist'
    },
    {
      id: 'cristiano-ronaldo',
      name: 'Cristiano Ronaldo',
      birthDate: '1985-02-05',
      birthTime: '05:25',
      placeLabel: 'Funchal, Madeira, Portugal',
      lat: 32.6669,
      lon: -16.9241,
      tz: 'Atlantic/Madeira',
      source: 'Astro-Databank A-rated (from him via Hello! magazine interview)',
      blurb: 'Portuguese footballer; five-time Ballon d’Or winner; all-time top international goal-scorer'
    },
    {
      id: 'shakira',
      name: 'Shakira',
      birthDate: '1977-02-02',
      birthTime: '14:30',
      placeLabel: 'Barranquilla, Colombia',
      lat: 10.9685,
      lon: -74.7813,
      tz: 'America/Bogota',
      source: 'Astro-Databank A-rated (commonly cited; from her or her family)',
      blurb: 'Colombian singer-songwriter; trilingual recording artist; Latin music icon'
    },
    {
      id: 'diego-maradona',
      name: 'Diego Maradona',
      birthDate: '1960-10-30',
      birthTime: '07:05',
      placeLabel: 'Lanús, Buenos Aires, Argentina',
      lat: -34.7035,
      lon: -58.4124,
      tz: 'America/Argentina/Buenos_Aires',
      source: 'Astro-Databank AA-rated (Jimmy Burns biography, citing his mother Doña Tota; 07:05 local)',
      blurb: 'Argentine footballer; 1986 World Cup winner; widely regarded as one of the greatest of all time'
    },
    {
      id: 'roberto-carlos',
      name: 'Roberto Carlos',
      birthDate: '1973-04-10',
      birthTime: '12:00',
      placeLabel: 'Garça, São Paulo, Brazil',
      lat: -22.2089,
      lon: -49.6553,
      tz: 'America/Sao_Paulo',
      source: 'Astro-Databank X-rated (time unknown); noon placeholder — Ascendant and houses are NOT astrologically valid',
      blurb: 'Brazilian footballer; 2002 World Cup winner; legendary left-back famous for his free-kick technique'
    },
    {
      id: 'albert-einstein',
      name: 'Albert Einstein',
      birthDate: '1879-03-14',
      birthTime: '11:30',
      placeLabel: 'Ulm, Germany',
      lat: 48.3984,
      lon: 9.9916,
      tz: '+00:40',
      source: 'Astro-Databank AA-rated (birth certificate). Note: 1879 is pre-CET (Germany adopted CET on 1 April 1893); the literal Ulm Local Mean Time (UTC+00:40, ≈9.9916°E ⇒ +00:39:57) is used. Ulm is NOT in the iyogau cities gazetteer; picker bypasses the city lookup',
      blurb: 'Theoretical physicist; deep interest in Spinoza, Indian philosophy, and the unity of natural law'
    },
    {
      id: 'thomas-edison',
      name: 'Thomas Edison',
      birthDate: '1847-02-11',
      birthTime: '03:00',
      placeLabel: 'Milan, Ohio, United States',
      lat: 41.2961,
      lon: -82.6024,
      tz: '-05:30',
      source: 'Astro-Databank C-rated; 03:00 is widely cited but no birth-certificate time exists. Note: 1847 is pre-US-standard-time (railroad zones adopted 18 November 1883); the literal Milan-OH Local Mean Time (UTC-05:30, ≈-82.6024°W ⇒ -05:30:25) is used. Ascendant and house cusps shown for reference — flag for review',
      blurb: 'American inventor and businessman; phonograph, motion-picture camera, practical incandescent light bulb'
    }
  ];

  // Freeze so the form code can't accidentally mutate the snapshot
  // (a stray `preset.lat = parseFloat(...)` would corrupt the
  // demo-match check on subsequent picks).
  PRESETS.forEach(function (p) { Object.freeze(p); });
  Object.freeze(PRESETS);

  window.IYOGAU_NATAL_PRESETS = PRESETS;
}());

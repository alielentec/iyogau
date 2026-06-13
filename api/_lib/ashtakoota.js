const SIGN_NAMES = [
  'Aries', 'Taurus', 'Gemini', 'Cancer',
  'Leo', 'Virgo', 'Libra', 'Scorpio',
  'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

const SIGN_LORDS = [
  'Mars', 'Venus', 'Mercury', 'Moon',
  'Sun', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Saturn', 'Jupiter',
];

const VARNA_BY_SIGN = [
  'Kshatriya', 'Vaishya', 'Shudra', 'Brahmin',
  'Kshatriya', 'Vaishya', 'Shudra', 'Brahmin',
  'Kshatriya', 'Vaishya', 'Shudra', 'Brahmin',
];

const VASHYA_BY_SIGN = [
  'Chatushpada', 'Chatushpada', 'Manav', 'Jalchar',
  'Vanchar', 'Manav', 'Manav', 'Keet',
  'Chatushpada', 'Chatushpada', 'Manav', 'Jalchar',
];

const GANA_BY_NAKSHATRA = [
  'Deva', 'Manushya', 'Rakshasa',
  'Manushya', 'Deva', 'Manushya',
  'Deva', 'Deva', 'Rakshasa',
  'Rakshasa', 'Manushya', 'Manushya',
  'Deva', 'Rakshasa', 'Deva',
  'Rakshasa', 'Deva', 'Rakshasa',
  'Rakshasa', 'Manushya', 'Manushya',
  'Deva', 'Rakshasa', 'Rakshasa',
  'Manushya', 'Manushya', 'Deva',
];

const NADI_BY_NAKSHATRA = [
  'Adi', 'Madhya', 'Antya',
  'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya',
  'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya',
  'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya',
  'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya',
];

const YONI_BY_NAKSHATRA = [
  'Horse', 'Elephant', 'Sheep',
  'Serpent', 'Serpent', 'Dog',
  'Cat', 'Sheep', 'Cat',
  'Rat', 'Rat', 'Cow',
  'Buffalo', 'Tiger', 'Buffalo',
  'Tiger', 'Deer', 'Deer',
  'Dog', 'Monkey', 'Mongoose',
  'Monkey', 'Lion', 'Horse',
  'Lion', 'Cow', 'Elephant',
];

const YONI_ENEMIES = new Set([
  pairKey('Horse', 'Buffalo'),
  pairKey('Elephant', 'Lion'),
  pairKey('Sheep', 'Monkey'),
  pairKey('Serpent', 'Mongoose'),
  pairKey('Dog', 'Deer'),
  pairKey('Cat', 'Rat'),
  pairKey('Cow', 'Tiger'),
]);

const PLANET_RELATIONS = {
  Sun:     { friends: ['Moon', 'Mars', 'Jupiter'], neutral: ['Mercury'], enemies: ['Venus', 'Saturn'] },
  Moon:    { friends: ['Sun', 'Mercury'], neutral: ['Mars', 'Jupiter', 'Venus', 'Saturn'], enemies: [] },
  Mars:    { friends: ['Sun', 'Moon', 'Jupiter'], neutral: ['Venus', 'Saturn'], enemies: ['Mercury'] },
  Mercury: { friends: ['Sun', 'Venus'], neutral: ['Mars', 'Jupiter', 'Saturn'], enemies: ['Moon'] },
  Jupiter: { friends: ['Sun', 'Moon', 'Mars'], neutral: ['Saturn'], enemies: ['Mercury', 'Venus'] },
  Venus:   { friends: ['Mercury', 'Saturn'], neutral: ['Mars', 'Jupiter'], enemies: ['Sun', 'Moon'] },
  Saturn:  { friends: ['Mercury', 'Venus'], neutral: ['Jupiter'], enemies: ['Sun', 'Moon', 'Mars'] },
};

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function moonFromChart(chart) {
  const moon = chart?.planets?.find((planet) => planet.name === 'Moon');
  if (!moon || !moon.nakshatra) {
    throw new Error('Moon position is required for Ashtakoota scoring.');
  }
  return {
    signIndex: moon.signIndex,
    signName: moon.sign || SIGN_NAMES[moon.signIndex],
    nakshatraIndex: moon.nakshatra.index,
    nakshatraName: moon.nakshatra.name,
    longitude: moon.longitude,
  };
}

function factor(name, score, maxScore, detail) {
  return {
    name,
    score: Math.round(score * 100) / 100,
    maxScore,
    detail,
  };
}

function nakDistance(fromIndex, toIndex) {
  return ((toIndex - fromIndex + 27) % 27) + 1;
}

function signDistance(fromIndex, toIndex) {
  return ((toIndex - fromIndex + 12) % 12) + 1;
}

function taraGood(distance) {
  const rem = distance % 9 || 9;
  return rem === 2 || rem === 4 || rem === 6 || rem === 8 || rem === 9;
}

function relation(fromLord, toLord) {
  if (fromLord === toLord) return 'same';
  const rel = PLANET_RELATIONS[fromLord];
  if (!rel) return 'neutral';
  if (rel.friends.includes(toLord)) return 'friend';
  if (rel.enemies.includes(toLord)) return 'enemy';
  return 'neutral';
}

function grahaMaitriScore(lordA, lordB) {
  const ab = relation(lordA, lordB);
  const ba = relation(lordB, lordA);
  if (ab === 'same' || ba === 'same') return 5;
  const rels = [ab, ba].sort().join('|');
  if (rels === 'friend|friend') return 5;
  if (rels === 'friend|neutral') return 4;
  if (rels === 'neutral|neutral') return 3;
  if (rels === 'enemy|friend') return 1;
  if (rels === 'enemy|neutral') return 0.5;
  return 0;
}

function verdict(totalScore) {
  if (totalScore >= 33) return 'excellent';
  if (totalScore >= 25) return 'good';
  if (totalScore >= 18) return 'acceptable';
  return 'low';
}

export function computeAshtakoota(chartA, chartB) {
  const a = moonFromChart(chartA);
  const b = moonFromChart(chartB);

  const varnaA = VARNA_BY_SIGN[a.signIndex];
  const varnaB = VARNA_BY_SIGN[b.signIndex];
  const vashyaA = VASHYA_BY_SIGN[a.signIndex];
  const vashyaB = VASHYA_BY_SIGN[b.signIndex];
  const yoniA = YONI_BY_NAKSHATRA[a.nakshatraIndex];
  const yoniB = YONI_BY_NAKSHATRA[b.nakshatraIndex];
  const ganaA = GANA_BY_NAKSHATRA[a.nakshatraIndex];
  const ganaB = GANA_BY_NAKSHATRA[b.nakshatraIndex];
  const nadiA = NADI_BY_NAKSHATRA[a.nakshatraIndex];
  const nadiB = NADI_BY_NAKSHATRA[b.nakshatraIndex];
  const lordA = SIGN_LORDS[a.signIndex];
  const lordB = SIGN_LORDS[b.signIndex];

  const taraAB = taraGood(nakDistance(a.nakshatraIndex, b.nakshatraIndex));
  const taraBA = taraGood(nakDistance(b.nakshatraIndex, a.nakshatraIndex));
  const yoniKey = pairKey(yoniA, yoniB);
  const signAB = signDistance(a.signIndex, b.signIndex);
  const signBA = signDistance(b.signIndex, a.signIndex);
  const bhakootGood = [1, 3, 4, 7, 10, 11].includes(signAB)
    && [1, 3, 4, 7, 10, 11].includes(signBA);

  const factors = [
    factor('Varna', varnaA === varnaB ? 1 : 0, 1, `${varnaA} / ${varnaB}`),
    factor('Vashya', vashyaA === vashyaB ? 2 : 0, 2, `${vashyaA} / ${vashyaB}`),
    factor('Tara', (taraAB ? 1.5 : 0) + (taraBA ? 1.5 : 0), 3, `${a.nakshatraName} to ${b.nakshatraName}`),
    factor('Yoni', yoniA === yoniB ? 4 : (YONI_ENEMIES.has(yoniKey) ? 0 : 2), 4, `${yoniA} / ${yoniB}`),
    factor('Graha Maitri', grahaMaitriScore(lordA, lordB), 5, `${lordA} / ${lordB}`),
    factor('Gana', ganaA === ganaB ? 6 : (pairKey(ganaA, ganaB) === pairKey('Deva', 'Manushya') ? 5 : (pairKey(ganaA, ganaB) === pairKey('Manushya', 'Rakshasa') ? 1 : 0)), 6, `${ganaA} / ${ganaB}`),
    factor('Bhakoot', bhakootGood ? 7 : 0, 7, `${a.signName} / ${b.signName}`),
    factor('Nadi', nadiA === nadiB ? 0 : 8, 8, `${nadiA} / ${nadiB}`),
  ];

  const totalScore = Math.round(factors.reduce((sum, item) => sum + item.score, 0) * 100) / 100;
  return {
    system: 'ashtakoota',
    totalScore,
    maxScore: 36,
    verdict: verdict(totalScore),
    factors,
    moons: {
      profileA: a,
      profileB: b,
    },
    notes: [
      'Ashtakoota uses Moon sign and Moon nakshatra compatibility.',
      'This implementation is gender-neutral: Person A and Person B are scored symmetrically.',
      'A full marriage judgment should not rely on this score alone.',
    ],
  };
}

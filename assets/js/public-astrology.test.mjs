import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const homepage = fs.readFileSync('index.html', 'utf8');

test('public homepage exposes only the three allowed astrology tabs', () => {
  const tabIds = Array.from(homepage.matchAll(/<button id="(home-tab-[^"]+)"/g), (match) => match[1]);
  assert.deepEqual(tabIds, ['home-tab-chart', 'home-tab-relocation', 'home-tab-soulmate']);
  assert.equal(homepage.includes('home-tab-planets'), false);
  assert.equal(homepage.includes('home-tab-aspects'), false);
});

test('public relocation and soulmate tabs use the real astrocartography renderer', () => {
  assert.match(homepage, /id="home-panel-relocation"[^>]+data-astrocarto="relocation"/);
  assert.match(homepage, /id="home-panel-soulmate"[^>]+data-astrocarto="soulmate"/);
  assert.match(homepage, /id="home-panel-relocation"[\s\S]*?<div class="astrocarto-map" data-astrocarto-map/);
  assert.match(homepage, /id="home-panel-soulmate"[\s\S]*?<div class="astrocarto-map" data-astrocarto-map/);
  assert.equal(homepage.includes('natal-tool-map-preview'), false);
});

test('public known-person picker has no private-tools button', () => {
  const picker = homepage.match(/<div class="natal-public-picker"[\s\S]*?<div class="natal-public-cards"/)?.[0] || '';
  assert.equal(picker.includes('View private tools'), false);
  assert.equal(picker.includes('natal.public.ctaWorkspace'), false);
  assert.equal(picker.includes('/natal-chart/#natal-calc'), false);
});

test('public sign-in CTA sits in the method gateway, not chart result header', () => {
  const methodNote = homepage.match(/<div class="natal-method-note"[\s\S]*?<div class="natal-public-picker"/)?.[0] || '';
  const chartHead = homepage.match(/<div class="natal-public-chart__head"[\s\S]*?<p class="natal-public-chart__status"/)?.[0] || '';
  assert.equal(methodNote.includes('natal.public.ctaSignIn'), true);
  assert.equal(methodNote.includes('data-account-login-action'), true);
  assert.equal(chartHead.includes('natal.public.ctaSignIn'), false);
  assert.equal(chartHead.includes('data-account-login-action'), false);
});

test('public homepage loads public cards before the shared astrocartography scripts', () => {
  const publicScript = homepage.indexOf('/assets/js/public-astrology.js?v=2');
  const worldData = homepage.indexOf('/assets/data/world-continents.js?v=3');
  const astroScript = homepage.indexOf('/assets/js/astrocarto.js?v=15');
  assert.ok(publicScript > 0, 'public astrology script must be present');
  assert.ok(worldData > publicScript, 'world data must load after public preset publisher');
  assert.ok(astroScript > worldData, 'astrocartography renderer must load after world data');
});

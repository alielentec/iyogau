import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const accountProfiles = fs.readFileSync('assets/js/account-profiles.js', 'utf8');
const natalForm = fs.readFileSync('assets/js/natal-chart-form.js', 'utf8');
const astrocarto = fs.readFileSync('assets/js/astrocarto.js', 'utf8');
const marriageScore = fs.readFileSync('assets/js/marriage-score.js', 'utf8');

test('logout broadcasts auth state and clears profile subscribers', () => {
  assert.match(accountProfiles, /iyogau:auth-state-changed/);
  assert.match(accountProfiles, /broadcastProfilesUpdated\(\);[\s\S]*broadcastAuthState\(false,\s*options\.reason/);
  assert.match(accountProfiles, /setSignedOut\(\{\s*reason:\s*'logout'\s*\}\)/);
});

test('private natal workspace clears rendered chart tables on signed-out auth state', () => {
  assert.match(natalForm, /function\s+isPrivateWorkspaceMount\(\)/);
  assert.match(natalForm, /document\.querySelector\('\.natal-workspace'\)/);
  assert.match(natalForm, /function\s+clearRenderedResultsForSignedOut\(\)/);
  assert.match(natalForm, /renderEmptyState\(planetsEl\s*\|\|\s*tablesEl/);
  assert.match(natalForm, /renderEmptyState\(aspectsEl/);
  assert.match(natalForm, /iyogau:auth-state-changed/);
});

test('private astrocartography and marriage tools clear stale state on logout', () => {
  assert.match(astrocarto, /function\s+clearNatalSource\(/);
  assert.match(astrocarto, /window\.__astrocarto\.payload\s*=\s*null/);
  assert.match(astrocarto, /document\.querySelector\('\.natal-workspace'\)/);
  assert.match(astrocarto, /iyogau:auth-state-changed/);
  assert.match(marriageScore, /function\s+showSignedOutState\(\)/);
  assert.match(marriageScore, /iyogau:auth-state-changed/);
});

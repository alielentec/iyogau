#!/usr/bin/env node
// Generates /ko/index.html and /zh/index.html from /index.html.
// We keep the root file canonical for English; localized paths exist so
// Google can index them as separate URLs (matches the hreflang declarations).
//
// Each localized copy:
//   - sets <html lang="...">
//   - rewrites <link rel="canonical"> to the localized path
//   - leaves the <link rel="alternate" hreflang="..."> block intact
//     (the same alternate set is correct on every page)
//
// Run: node scripts/build-locales.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'index.html');

const LOCALES = [
  { code: 'ko', dir: 'ko', canonical: 'https://iyogau.com/ko/' },
  { code: 'zh', dir: 'zh', canonical: 'https://iyogau.com/zh/' }
];

function build() {
  const html = fs.readFileSync(SOURCE, 'utf8');

  for (const locale of LOCALES) {
    let out = html;

    // <html lang="en"> → <html lang="ko">
    out = out.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale.code}"`);

    // <link rel="canonical" href="https://iyogau.com/" /> → localized path
    out = out.replace(
      /<link\s+rel="canonical"\s+href="[^"]+"\s*\/?>/i,
      `<link rel="canonical" href="${locale.canonical}" />`
    );

    // og:url → localized path (helps social previews link to the right variant)
    out = out.replace(
      /(<meta\s+property="og:url"\s+content=")[^"]+("\s*\/?>)/i,
      `$1${locale.canonical}$2`
    );

    const destDir = path.join(ROOT, locale.dir);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, 'index.html');
    fs.writeFileSync(dest, out);
    console.log(`wrote ${path.relative(ROOT, dest)}`);
  }
}

build();

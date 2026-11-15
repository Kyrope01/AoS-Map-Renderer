#!/usr/bin/env node
/**
 * Post-build step for `npm run build`.
 *
 * Vite emits dist/app.html plus separate JS/CSS assets. This script inlines
 * those assets into a single self-contained HTML file so the app can be:
 *   - opened by double-clicking index.html (file:// — external ES modules are
 *     blocked by the browser's CORS rules, so everything must be inline), and
 *   - served from GitHub Pages at any URL path (no absolute asset paths).
 *
 * The result is written to dist/index.html and copied to the repo root as
 * index.html, which is committed so the repository works without tooling.
 */
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const entryName = readdirSync(dist).find((f) => f.endsWith('.html'));
if (!entryName) {
  console.error(`inline-build: no HTML entry found in ${dist}`);
  process.exit(1);
}

let html = readFileSync(path.join(dist, entryName), 'utf8');

// Inline every emitted stylesheet BEFORE scripts so `<link ...>` literals inside
// compiled JS chunks cannot match HTML stylesheet tag replacement.
html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  (tag, href) => {
    if (/^https?:/i.test(href)) return tag; // keep external stylesheets (fonts)
    const file = path.join(dist, href.replace(/^\.?\//, ''));
    const css = readFileSync(file, 'utf8');
    return `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  },
);

// Inline every emitted JS chunk: <script ... src="./assets/x.js"></script>
html = html.replace(
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
  (_tag, src) => {
    const file = path.join(dist, src.replace(/^\.?\//, ''));
    const js = readFileSync(file, 'utf8');
    // Escape "</script" so string literals inside the bundle can't close the tag.
    return `<script type="module">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  },
);

// Drop modulepreload hints — the code is inline now.
html = html.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/g, '');

// Sanity check: outside of the inlined script/style bodies, no local src/href
// references may remain (inner "</script"/"</style" are escaped above, so these
// lazy matches end exactly at each block's real closing tag).
const markup = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
const leftovers = [...markup.matchAll(/(?:src|href)="(?!https?:|data:|mailto:|tel:|#)([^"]+)"/g)].map((m) => m[1]);
if (leftovers.length > 0) {
  console.error(`inline-build: unresolved local references remain: ${leftovers.join(', ')}`);
  process.exit(1);
}

writeFileSync(path.join(dist, 'index.html'), html);
if (entryName !== 'index.html') rmSync(path.join(dist, entryName));
rmSync(path.join(dist, 'assets'), { recursive: true, force: true });
copyFileSync(path.join(dist, 'index.html'), path.join(root, 'index.html'));

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`inline-build: wrote standalone dist/index.html and ./index.html (${kb} kB)`);

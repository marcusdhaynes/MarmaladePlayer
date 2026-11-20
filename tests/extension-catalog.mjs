import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanDirectoryHandle, itemsFromFileList, sharedRootName, isVideoName
} from '../extension/lib/catalog.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));

// --- Manifest + layout sanity -------------------------------------------
const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3, 'Chromium target is Manifest V3');
assert.ok(manifest.content_scripts[0].matches.some((m) => m.includes('marmaladeum.com')),
  'Content script covers marmaladeum.com');
assert.ok(manifest.externally_connectable.matches.some((m) => m.includes('marmaladeum.com')));
for (const f of ['background.js', 'content.js', 'library.html', 'library.js',
  'popup.html', 'popup.js', 'lib/catalog.mjs', 'lib/store.mjs',
  'targets/firefox/manifest.json', 'targets/firefox/README.md',
  'targets/safari/README.md', 'minternet/README.md', 'minternet/media_library.rs']) {
  assert.ok(existsSync(resolve(root, 'extension', f)), 'extension file exists: ' + f);
}
const firefox = JSON.parse(readFileSync(resolve(root, 'extension/targets/firefox/manifest.json'), 'utf8'));
assert.equal(firefox.name, 'Marmalade Library');
assert.ok(firefox.browser_specific_settings.gecko.id.includes('somniel.com'));

// --- Recursive scan: root file + nested files, non-videos excluded -------
const mkFile = (name) => ({
  kind: 'file',
  getFile: async () => ({ name, size: 42, lastModified: 123 })
});
const dir = (name, entries) => ({
  kind: 'directory', name,
  async *entries() { for (const [n, v] of Object.entries(entries)) yield [n, v]; }
});
const folder = { id: 'fld1', name: 'Test Media' };
const tree = dir('Test Media', {
  'A Single Movie (2025).mp4': mkFile('A Single Movie (2025).mp4'),
  'notes.txt': mkFile('notes.txt'),
  Movies: dir('Movies', { 'Blade Runner (1982).mkv': mkFile('Blade Runner (1982).mkv') }),
  'TV Shows': dir('TV Shows', {
    'Season 01': dir('Season 01', { 'Some.Show.S01E01.mp4': mkFile('Some.Show.S01E01.mp4') })
  })
});
const items = await scanDirectoryHandle(folder, tree, 'movie');
assert.equal(items.length, 3, 'scan finds root MP4 + nested MKV + nested episode, not txt');
assert.ok(items.some((i) => i.path === 'A Single Movie (2025).mp4'),
  'root-level file keeps bare filename as path');
assert.ok(items.some((i) => i.path === 'Movies/Blade Runner (1982).mkv' && i.year === 1982));
assert.ok(items.some((i) => i.path === 'TV Shows/Season 01/Some.Show.S01E01.mp4' && i.type === 'tv'));

// getFile() failure still indexes by name (metadataPending), never 0-video loss
const flaky = dir('Flaky', {
  'Hard.To.Read.2026.mkv': { kind: 'file', getFile: async () => { throw new Error('busy'); } }
});
const flakyItems = await scanDirectoryHandle({ id: 'fld2', name: 'Flaky' }, flaky, 'movie');
assert.equal(flakyItems.length, 1);
assert.equal(flakyItems[0].metadataPending, true);

// --- Directory-input fallback (Firefox/Safari path) ----------------------
const fakeFiles = [
  { name: 'Root Film.mp4', webkitRelativePath: 'Picked/Root Film.mp4', size: 1, lastModified: 1 },
  { name: 'Nested Film.mkv', webkitRelativePath: 'Picked/Sub/Nested Film.mkv', size: 1, lastModified: 1 },
  { name: 'skip.txt', webkitRelativePath: 'Picked/skip.txt', size: 1, lastModified: 1 }
];
assert.equal(sharedRootName(fakeFiles), 'Picked');
const fallbackItems = itemsFromFileList({ id: 'fld3', name: 'Picked' }, fakeFiles, 'movie');
assert.equal(fallbackItems.length, 2);
assert.ok(fallbackItems.some((i) => i.path === 'Root Film.mp4'));
assert.ok(fallbackItems.some((i) => i.path === 'Sub/Nested Film.mkv'));
assert.ok(isVideoName('x.webm') && !isVideoName('x.txt'));

console.log('PASS extension catalog scan (root + nested), fallback import, manifests, layout');

#!/usr/bin/env node
// Validates this handoff package only. No application or remote provider is exercised.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seal = process.argv.includes('--seal');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const json = name => JSON.parse(read(name));
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const list = (dir = root) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  assert(!entry.isSymbolicLink(), `Symlink not permitted: ${entry.name}`);
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? list(target) : [path.relative(root, target).split(path.sep).join('/')];
}).sort();

let files = list();
let localLinks = 0;
let externalLinks = 0;
let markdownWords = 0;
for (const name of files) {
  assert(!/(^|\/)(?:\.env(?:\..*)?|ENV)$/i.test(name) || name === 'repo-templates/.env.example', `Unexpected environment file in portable package: ${name}`);
  if (name.endsWith('.json')) json(name);
  if (!name.endsWith('.md')) continue;
  const content = read(name);
  markdownWords += content.trim().split(/\s+/u).length;
  assert(!/C:[\\/]Users[\\/]/i.test(content), `Nonportable private path in ${name}`);
  assert(!/\[\[/.test(content), `Vault-only wikilink in ${name}`);
  // Package Markdown links use ordinary relative URLs without titles or parentheses.
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^https?:\/\//.test(target)) { new URL(target); externalLinks++; continue; }
    if (target.startsWith('#')) continue;
    assert(!/^[a-z][a-z0-9+.-]*:/i.test(target), `Unsupported link scheme: ${target}`);
    const clean = decodeURIComponent(target.split('#')[0]);
    const absolute = path.resolve(root, path.dirname(name), clean);
    const relative = path.relative(root, absolute);
    assert(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Link escapes package: ${name}: ${target}`);
    assert(fs.existsSync(absolute), `Missing link: ${name}: ${target}`);
    localLinks++;
  }
}

const comp = json('contracts/composition.example.json');
const patch = json('contracts/revision-patch.example.json');
function validateComposition(c) {
  assert.equal(c.schemaVersion, 1);
  assert(Number.isInteger(c.ppq) && c.ppq > 0);
  assert(Number.isFinite(c.tempoBpm) && c.tempoBpm > 0);
  assert(Number.isInteger(c.durationTicks) && c.durationTicks > 0);
  const assets = new Map(c.assets.map(a => [a.id, a]));
  assert.equal(assets.size, c.assets.length);
  const trackIds = new Set(c.tracks.map(t => t.id));
  assert.equal(trackIds.size, c.tracks.length);
  let lastEnd = 0;
  for (const s of c.sections) {
    assert(Number.isInteger(s.startTick) && Number.isInteger(s.endTick));
    assert(s.startTick >= lastEnd && s.endTick > s.startTick && s.endTick <= c.durationTicks);
    lastEnd = s.endTick;
  }
  const eventIds = new Set();
  for (const track of c.tracks) {
    assert(Number.isFinite(track.gainDb) && track.pan >= -1 && track.pan <= 1);
    for (const e of track.events) {
      assert(!eventIds.has(e.id)); eventIds.add(e.id);
      assert.equal(e.type, 'sample');
      assert(Number.isInteger(e.startTick) && Number.isInteger(e.durationTicks));
      assert(e.startTick >= 0 && e.durationTicks > 0 && e.startTick + e.durationTicks <= c.durationTicks);
      const a = assets.get(e.assetId); assert(a && a.readiness === 'ready');
      assert(e.sourceStartFrame >= 0 && e.sourceEndFrame <= a.frames && e.sourceEndFrame > e.sourceStartFrame);
      const eventSeconds = e.durationTicks / c.ppq * 60 / c.tempoBpm;
      const sourceSeconds = (e.sourceEndFrame - e.sourceStartFrame) / a.sampleRate;
      assert(Math.abs(eventSeconds - sourceSeconds) < 1e-9, 'Natural sample duration mismatch');
      assert(c.sourceUses.some(use => use.assetId === e.assetId));
    }
  }
}
validateComposition(comp);
assert.equal(comp.durationTicks / comp.ppq * 60 / comp.tempoBpm, 20);
assert.equal(patch.baseRevisionId, comp.revisionId);
assert.match(patch.baseRevisionHash, /^[0-9a-f]{64}$/);
const revised = structuredClone(comp);
const sections = new Map(comp.sections.map(s => [s.id, s]));
for (const id of patch.scope.sectionIds) assert(sections.has(id));
for (const id of patch.protectedTrackIds) assert(comp.tracks.some(t => t.id === id));
for (const op of patch.operations) {
  assert.equal(op.type, 'replaceTrackEventsInRange');
  assert(patch.scope.trackIds.includes(op.trackId));
  assert(!patch.protectedTrackIds.includes(op.trackId));
  assert(patch.scope.sectionIds.some(id => {
    const s = sections.get(id); return op.startTick >= s.startTick && op.endTick <= s.endTick;
  }));
  assert(op.startTick < op.endTick);
  assert(op.events.every(e => e.startTick >= op.startTick && e.startTick + e.durationTicks <= op.endTick));
  const track = revised.tracks.find(t => t.id === op.trackId); assert(track);
  const outside = track.events.filter(e => e.startTick < op.startTick || e.startTick >= op.endTick);
  track.events = [...outside, ...op.events].sort((a, b) => a.startTick - b.startTick);
  assert.deepEqual(track.events.filter(e => e.startTick < op.startTick || e.startTick >= op.endTick), outside);
}
for (const id of patch.protectedTrackIds) {
  assert.deepEqual(revised.tracks.find(t => t.id === id), comp.tracks.find(t => t.id === id));
}
validateComposition(revised);
assert.notDeepEqual(revised.tracks.find(t => t.id === 'drums'), comp.tracks.find(t => t.id === 'drums'));

const tokens = json('design/tokens.json');
function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrasts = tokens.contrastRequirements.map(pair => {
  const a = luminance(tokens.colors[pair.foreground]), b = luminance(tokens.colors[pair.background]);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert(ratio >= pair.minimum, `Contrast failed ${pair.foreground}/${pair.background}: ${ratio}`);
  return { ...pair, ratio: Number(ratio.toFixed(2)) };
});
const png = fs.readFileSync(path.join(root, 'design/listening-room-desktop-mobile.png'));
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
assert(dimensions.width > 1200 && dimensions.height > 600);
const env = read('repo-templates/.env.example');
for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'S3_SECRET_ACCESS_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'LANGSMITH_API_KEY', 'TRANSCRIPTION_API_KEY']) {
  assert(new RegExp(`^${key}=$`, 'm').test(env), `Secret template not empty: ${key}`);
}

if (seal) {
  const report = [
    '# Package validation', '',
    `Validated: ${new Date().toISOString()}`, '',
    '**Scope: handoff artifacts only. No application, audio engine, live provider, Nexus project, or deployed service was tested.**', '',
    '- Parsed all JSON files.',
    `- Checked ${localLinks} relative Markdown links and ${externalLinks} syntactically valid external URL references. External availability was not re-tested by this script.`,
    '- Checked package Markdown for private absolute user paths and vault-only links.',
    '- Checked the illustrative composition: timing, asset references, sample duration and unique IDs.',
    '- Applied the illustrative scoped patch; protected melody and out-of-scope events remain unchanged. This is not a production patch-engine test.',
    '- Checked that credential placeholders are empty and no actual environment file is packaged.',
    `- Verified selected PNG header/dimensions: ${dimensions.width} × ${dimensions.height}. Its selection and content were also visually inspected during preparation.`,
    '- Calculated the specified design-token contrast pairs; this does not prove accessibility of an unbuilt interface.', '',
    '| Foreground / background | Ratio | Required |', '| --- | --- | --- |',
    ...contrasts.map(c => `| ${c.foreground} / ${c.background} | ${c.ratio}:1 | ${c.minimum}:1 |`), '',
    '## Re-run', '',
    'With Node.js available, run from this package folder:', '',
    '```text', 'node tools/validate-package.mjs', '```', '',
    'The default run also verifies every file against MANIFEST.json. After deliberately editing this handoff, regenerate its validation report and manifest with `node tools/validate-package.mjs --seal`.', '',
    'The manifest excludes itself to avoid recursive hashing. ZIP byte/hash verification is performed separately during packaging. Application implementation and all live/device tests remain future work.', ''
  ].join('\n');
  fs.writeFileSync(path.join(root, 'VALIDATION.md'), report);
  files = list();
  const manifest = {
    package: 'Pocket Producer implementation handoff',
    preparedDate: '2026-09-20',
    revision: 3,
    algorithm: 'sha256',
    excludes: ['MANIFEST.json'],
    files: files.filter(f => f !== 'MANIFEST.json').map(name => {
      const buffer = fs.readFileSync(path.join(root, name));
      return { path: name, bytes: buffer.length, sha256: digest(buffer) };
    })
  };
  fs.writeFileSync(path.join(root, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
}
const manifest = json('MANIFEST.json');
assert.deepEqual(manifest.files.map(f => f.path).sort(), list().filter(f => f !== 'MANIFEST.json'));
for (const item of manifest.files) {
  const buffer = fs.readFileSync(path.join(root, item.path));
  assert.equal(buffer.length, item.bytes, `Size mismatch: ${item.path}`);
  assert.equal(digest(buffer), item.sha256, `Hash mismatch: ${item.path}`);
}
console.log(JSON.stringify({ passed: true, scope: 'handoff only', files: list().length, localLinks, externalLinks, approximateMarkdownWords: markdownWords, image: dimensions, contrastPairs: contrasts.length, manifestVerified: true }, null, 2));

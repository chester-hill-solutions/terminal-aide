import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(result.status, 0, result.stderr || 'npm pack failed');
const [archive] = JSON.parse(result.stdout);
const allowed = new Set(['package.json', 'README.md', 'LICENSE', 'docs/CHANGELOG.md']);
for (const { path } of archive.files) {
  assert.ok(allowed.has(path) || /^(bin|src)\/[a-zA-Z0-9_./-]+\.js$/.test(path), `Unexpected published file: ${path}`);
  const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.ok(!/sk-or-v1-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}/.test(text), `Credential-shaped content in ${path}`);
  allowed.delete(path);
}
assert.deepEqual([...allowed], [], 'Required package documentation is missing');
const binary = archive.files.find(({ path }) => path === manifest.bin.aide);
assert.ok(binary && (binary.mode & 0o111), 'The aide binary must be included and executable');
assert.ok(readFileSync(new URL('../bin/aide.js', import.meta.url), 'utf8').startsWith('#!/usr/bin/env node\n'));
const version = spawnSync(process.execPath, ['bin/aide.js', '--version'], { cwd: root, encoding: 'utf8' });
assert.equal(version.status, 0);
assert.equal(version.stdout.trim(), manifest.version);
assert.equal(manifest.name, '@chester-hill-solutions/terminal-aide');
assert.equal(manifest.license, 'MIT');
assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org');
assert.equal(manifest.publishConfig.access, 'public');
console.log(`Package verified: ${archive.filename}, ${archive.files.length} allowlisted files, ${archive.unpackedSize} unpacked bytes.`);

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.argv[2];
assert.equal(tag, `v${manifest.version}`, 'Release tag must match package.json');
const endpoint = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`;
let response = await fetch(endpoint);
if (response.status === 404) {
  const publish = spawnSync('npm', ['publish', '--access', 'public', '--provenance', '--ignore-scripts'], { stdio: 'inherit' });
  assert.equal(publish.status, 0, 'npm publish failed');
  // npm can return 404 for several minutes after accepting a new version.
  for (let attempt = 0; attempt < 30; attempt++) {
    response = await fetch(endpoint);
    if (response.status !== 404 || attempt === 29) break;
    console.log('Waiting for npm to finish processing the published version…');
    await delay(10000);
  }
} else {
  console.log(`Checking already-published ${manifest.name}@${manifest.version}.`);
}
assert.equal(response.status, 200, 'Could not retrieve the published version');
const published = await response.json();
assert.equal(published.name, manifest.name);
assert.equal(published.version, manifest.version);
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
assert.equal(commit.status, 0);
assert.equal(published.gitHead, commit.stdout.trim(), 'The published version belongs to a different source commit');
const tarballUrl = new URL(published.dist.tarball);
assert.equal(tarballUrl.protocol, 'https:');
assert.equal(tarballUrl.hostname, 'registry.npmjs.org');
const tarball = await fetch(tarballUrl);
assert.equal(tarball.status, 200);
const bytes = Buffer.from(await tarball.arrayBuffer());
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
assert.equal(integrity, published.dist.integrity, 'Published tarball integrity mismatch');
const filename = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
writeFileSync(filename, bytes);
console.log(`Verified ${filename} from ${published.gitHead}.`);

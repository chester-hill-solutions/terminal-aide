import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';
import { observeBaseline } from '@chester-hill-solutions/ratchet-strap';
import { checkQuality } from '../scripts/check-quality.mjs';

const empty = { schemaVersion: 2, mode: 'identities', adapter: 'eslint-identities@1', identities: { 'max-params': [] } };
const violation = 'export function f(a, b, c, d, e, f) { return a + b + c + d + e + f; }\n';

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'aide-quality-')));
  try {
    await writeFile(join(root, '.ratchet-strap.json'), JSON.stringify(empty));
    await writeFile(join(root, 'first.js'), violation);
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function acceptCurrent(root) {
  const report = await new ESLint({ cwd: root, overrideConfigFile: fileURLToPath(new URL('../scripts/eslint.config.mjs', import.meta.url)) }).lintFiles(['.']);
  const baseline = { ...empty, identities: observeBaseline(empty, report, root).identities };
  await writeFile(join(root, '.ratchet-strap.json'), JSON.stringify(baseline));
  return baseline;
}

test('RatchetStrap goes red for new debt and tracked suppressed debt', async () => {
  await fixture(async root => {
    assert.equal((await checkQuality({ root })).ok, false);
    await writeFile(join(root, 'first.js'), `/* eslint-disable max-params */\n${violation}`);
    assert.equal((await checkQuality({ root })).ok, false);
  });
});

test('moving a violation to another file cannot offset existing debt at the same count', async () => {
  await fixture(async root => {
    const previous = await acceptCurrent(root);
    assert.equal((await checkQuality({ root, previous })).ok, true);
    await rename(join(root, 'first.js'), join(root, 'replacement.js'));
    assert.equal((await checkQuality({ root, previous })).ok, false);
  });
});

test('editing the allowance cannot make new debt pass against the trusted predecessor', async () => {
  await fixture(async root => {
    await acceptCurrent(root);
    assert.equal((await checkQuality({ root, previous: empty })).ok, false);
  });
});

test('repairs require explicit tightening and keep a zero budget for the tracked rule', async () => {
  await fixture(async root => {
    const previous = await acceptCurrent(root);
    await writeFile(join(root, 'first.js'), 'export const answer = 42;\n');
    assert.equal((await checkQuality({ root, previous })).ok, false);
    await writeFile(join(root, '.ratchet-strap.json'), JSON.stringify(empty));
    assert.equal((await checkQuality({ root, previous })).ok, true);
    assert.deepEqual(JSON.parse(await readFile(join(root, '.ratchet-strap.json'), 'utf8')).identities['max-params'], []);
  });
});

test('unresolvable trusted history fails closed', async () => {
  await fixture(async root => {
    await assert.rejects(checkQuality({ root, baseRef: 'unavailable-base' }), /Cannot resolve trusted quality predecessor/);
  });
});

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withRulesLock } from '../../src/rules/lock.js';

test('an update failure releases its lock so a subsequent update can proceed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-lock-failure-'));
  const file = join(directory, 'rules.json');
  try {
    await assert.rejects(withRulesLock(file, async () => { throw new Error('update failed'); }), /update failed/);
    await assert.rejects(access(`${file}.lock`), { code: 'ENOENT' });
    assert.equal(await withRulesLock(file, async () => 'updated'), 'updated');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a busy lock times out without running the update or deleting another writer lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-lock-busy-'));
  const file = join(directory, 'rules.json');
  try {
    await writeFile(`${file}.lock`, 'another writer');
    let called = false;
    await assert.rejects(withRulesLock(file, async () => { called = true; }, { timeoutMs: 20 }), /Another Aide process/);
    assert.equal(called, false);
    assert.equal(await readFile(`${file}.lock`, 'utf8'), 'another writer');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

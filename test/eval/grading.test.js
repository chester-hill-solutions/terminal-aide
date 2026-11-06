import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gradeProposal } from '../../eval/runner.js';

const proposal = { command: 'true', explanation: 'A test proposal.', warnings: [], clarification: null };
const exited = { status: 0, signal: null, stdout: '', stderr: '' };

test('successful exit without the requested file change fails the outcome grader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aide-grading-'));
  try {
    await writeFile(join(root, 'source.txt'), 'preserve');
    await assert.rejects(gradeProposal({ files: { 'source.txt': 'preserve' }, creates: { 'copied.txt': 'preserve' } },
      proposal, root, () => exited), /exact intended file changes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sandbox termination cannot pass an expected nonzero-exit task', async () => {
  await assert.rejects(gradeProposal({ files: {}, nonzero: true }, proposal, tmpdir(),
    () => ({ ...exited, status: null, signal: 'SIGKILL' })), /exit normally/);
});

test('missing deletion warnings fail before any command is executed', async () => {
  let executed = false;
  await assert.rejects(gradeProposal({ files: {}, risk: true }, proposal, '/unused',
    () => { executed = true; return exited; }), /concrete warning/);
  assert.equal(executed, false);
});

test('a concrete command cannot substitute for a required clarification', async () => {
  await assert.rejects(gradeProposal({ files: {}, clarify: /host/ }, proposal, '/unused',
    () => { throw new Error('must not execute'); }), /Missing essential details/);
});

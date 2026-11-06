import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderActionProposal } from '../src/proposal-actions.js';
import { validateProposal } from '../src/openrouter.js';
import { BASH, commandEnvironment } from '../src/shell.js';

function proposeCopy(directory, pattern, destination) {
  return validateProposal(renderActionProposal('copy_single_matching_file', { directory, pattern, destination }));
}

function run(proposal, cwd) {
  return spawnSync(BASH, ['--noprofile', '--norc', '-o', 'pipefail', '-c', proposal.command], {
    cwd, env: commandEnvironment(process.env), encoding: 'utf8', timeout: 2000,
  });
}

test('copy proposals preserve unusual source names and quote paths without executing substitutions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aide-copy-'));
  try {
    const directory = "-folder '$(touch injected)'";
    const destination = "-copy '$(touch injected)'";
    await mkdir(join(root, directory));
    const source = join(root, directory, '.-line\nbreak.txt');
    await writeFile(source, 'original content\n');
    const proposal = proposeCopy(directory, '*.txt', destination);
    await assert.rejects(access(join(root, destination)), { code: 'ENOENT' });
    assert.ok(proposal.warnings.some(warning => /overwrit/i.test(warning)));
    const result = run(proposal, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(source, 'utf8'), 'original content\n');
    assert.equal(await readFile(join(root, destination), 'utf8'), 'original content\n');
    await assert.rejects(access(join(root, 'injected')), { code: 'ENOENT' });
    const injectedPattern = run(proposeCopy(directory, '$(touch pattern-injected)', 'unused'), root);
    assert.notEqual(injectedPattern.status, 0);
    await assert.rejects(access(join(root, 'pattern-injected')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('copy proposals refuse zero or multiple matches without changing the destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aide-copy-scope-'));
  try {
    await writeFile(join(root, 'destination'), 'keep me');
    await mkdir(join(root, 'directory.txt'));
    const proposal = proposeCopy('.', '*.txt', 'destination');
    assert.notEqual(run(proposal, root).status, 0);
    await writeFile(join(root, 'first.txt'), 'first');
    await writeFile(join(root, '.second.txt'), 'second');
    assert.notEqual(run(proposal, root).status, 0);
    assert.equal(await readFile(join(root, 'destination'), 'utf8'), 'keep me');
    assert.equal(await readFile(join(root, 'first.txt'), 'utf8'), 'first');
    assert.notEqual(run(proposeCopy('missing', '*', 'destination'), root).status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('typed clarifications return a question with no command and reject malformed parameters', () => {
  const proposal = validateProposal(renderActionProposal('request_clarification', { question: 'Which server should receive the file?' }));
  assert.equal(proposal.command, null);
  assert.equal(proposal.clarification, 'Which server should receive the file?');
  for (const value of [null, [], {}, { question: '' }, { question: 'hidden\u001b[2J' }, { question: 'q', extra: true }, { question: 'q'.repeat(1001) }]) {
    assert.throws(() => renderActionProposal('request_clarification', value));
  }
  assert.throws(() => renderActionProposal('execute', {}));
  assert.throws(() => proposeCopy('.', '*', ''));
});

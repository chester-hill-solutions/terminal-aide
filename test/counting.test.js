import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderCountingProposal } from '../src/counting.js';
import { validateProposal } from '../src/openrouter.js';
import { BASH, commandEnvironment } from '../src/shell.js';

function run(name, input, cwd, extra = {}) {
  const proposal = validateProposal(renderCountingProposal(name, input));
  return spawnSync(BASH, ['--noprofile', '--norc', '-o', 'pipefail', '-c', proposal.command], {
    cwd, env: commandEnvironment({ ...process.env, ...extra }), encoding: 'utf8', timeout: 2000,
  });
}

test('compiled file counts handle hidden files, spaces, newlines and zero matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aide-count-files-'));
  try {
    await mkdir(join(root, 'nested'));
    for (const file of ['.hidden.txt', 'nested/-line\nbreak.txt', 'two words.txt']) await writeFile(join(root, file), 'content\n');
    let result = run('count_files_recursive', { directory: '.', pattern: '*.txt' }, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '3');
    result = run('count_files_recursive', { directory: '.', pattern: '*.absent' }, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '0');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('compiled line counts treat regex characters and backslashes as literal text across files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aide-count-lines-'));
  try {
    await writeFile(join(root, '-first\nfile.log'), '\\n[ok] first\nplain n o k\n\\n[ok] second\n');
    await writeFile(join(root, 'second file.log'), '\\n[ok] third\n');
    const result = run('count_matching_lines_recursive', { directory: '.', pattern: '*.log', literal: '\\n[ok]' }, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '3');
    const all = run('count_matching_lines_recursive', { directory: '.', pattern: '*.log', literal: '' }, root);
    assert.equal(all.status, 0, all.stderr);
    assert.equal(all.stdout.trim(), '4');
    const none = run('count_matching_lines_recursive', { directory: '.', pattern: '*.absent', literal: 'anything' }, root);
    assert.equal(none.status, 0, none.stderr);
    assert.equal(none.stdout.trim(), '0');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('counting parameters cannot execute substitutions and home and leading-dash paths work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aide-count-quoting-'));
  try {
    const directory = "-folder '$(touch injection-marker)'";
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, 'one.txt'), 'content\n');
    const literal = run('count_files_recursive', { directory, pattern: '*.txt' }, root);
    assert.equal(literal.status, 0, literal.stderr);
    assert.equal(literal.stdout.trim(), '1');
    await assert.rejects(access(join(root, 'injection-marker')), { code: 'ENOENT' });
    for (const home of ['~', '$HOME', '~/', '$HOME/', '${HOME}/']) {
      const result = run('count_files_recursive', { directory: home, pattern: '*.txt' }, root, { HOME: root });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), '1');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('counting treats find expression tokens as literal directory names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aide-count-find-paths-'));
  try {
    for (const directory of ['!', '(', ')', ',', '-not']) {
      await mkdir(join(root, directory));
      await writeFile(join(root, directory, 'one.txt'), 'TODO\n');
      for (const name of ['count_files_recursive', 'count_matching_lines_recursive']) {
        const parameters = { directory, pattern: '*.txt', ...(name.includes('lines') ? { literal: 'TODO' } : {}) };
        const result = run(name, parameters, root);
        assert.equal(result.status, 0, `${directory}: ${result.stderr}`);
        assert.equal(result.stdout.trim(), '1');
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('counting proposals reject malformed arguments and missing search roots fail rather than count as zero', () => {
  for (const input of [null, {}, { directory: '.', pattern: '*.txt', extra: true }, { directory: '.', pattern: '\u001b[2J' }]) {
    assert.throws(() => renderCountingProposal('count_files_recursive', input));
  }
  assert.throws(() => renderCountingProposal('execute', { directory: '.', pattern: '*' }));
  assert.notEqual(run('count_files_recursive', { directory: '/definitely-missing-aide-count-root', pattern: '*' }, tmpdir()).status, 0);
});

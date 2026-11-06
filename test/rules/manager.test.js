import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadRules, manageRules, parseRulesArgs, rulesFile, validateRules } from '../../src/rules/manager.js';

test('rules live in the global config directory, with an absolute XDG override', () => {
  assert.equal(rulesFile({ env: {}, home: '/home/test' }), '/home/test/.config/terminal-aide/rules.json');
  assert.equal(rulesFile({ env: { XDG_CONFIG_HOME: '/tmp/settings' }, home: '/home/test' }), '/tmp/settings/terminal-aide/rules.json');
  assert.equal(rulesFile({ env: { XDG_CONFIG_HOME: 'relative' }, home: '/home/test' }), '/home/test/.config/terminal-aide/rules.json');
});

test('rules can be added, listed, deduplicated, removed, and cleared across reloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-rules-'));
  const file = join(directory, 'config', 'rules.json');
  try {
    assert.deepEqual(await loadRules(file), []);
    assert.match(await manageRules(parseRulesArgs([]), file), /No saved rules/);
    assert.match(await manageRules(parseRulesArgs(['use', 'zipgrep', 'for', 'search']), file), /Saved rule #1/);
    await manageRules(parseRulesArgs(['show sizes in human-readable units']), file);
    assert.match(await manageRules(parseRulesArgs(['use zipgrep for search']), file), /already saved/);
    assert.deepEqual(await loadRules(file), ['use zipgrep for search', 'show sizes in human-readable units']);
    const listing = await manageRules(parseRulesArgs([]), file);
    assert.match(listing, /1\. \[search\] use zipgrep for search\n2\. \[sizes\] show sizes/);
    await manageRules(parseRulesArgs(['--remove', '1']), file);
    assert.deepEqual(await loadRules(file), ['show sizes in human-readable units']);
    await assert.rejects(manageRules(parseRulesArgs(['--remove', '2']), file), /does not exist/);
    assert.deepEqual(await loadRules(file), ['show sizes in human-readable units']);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(directory, 'config')), ['rules.json'], 'atomic saves leave no temporary files');
    await manageRules(parseRulesArgs(['--clear']), file);
    assert.deepEqual(await loadRules(file), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid configuration fails visibly and explicit clear recovers it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-rules-invalid-'));
  const file = join(directory, 'rules.json');
  try {
    for (const content of ['{broken', '{"rules":[]}', '["use \\u001b[2Jgrep"]']) {
      await writeFile(file, content);
      await assert.rejects(loadRules(file), /Invalid rules file/);
      await assert.rejects(manageRules(parseRulesArgs(['use grep']), file), /Invalid rules file/);
      assert.equal(await readFile(file, 'utf8'), content, 'invalid files are not overwritten by add');
    }
    await manageRules(parseRulesArgs(['--clear']), file);
    assert.deepEqual(await loadRules(file), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rule commands reject bad indices, unexpected options, blank rules, and oversized content', () => {
  for (const args of [['--remove'], ['--remove', '0'], ['--remove', '-1'], ['--remove', '1.5'], ['--remove', '1', 'extra'], ['--clear', 'extra'], ['--unknown'], [''], ['  '], ['use\ngrep'], ['x'.repeat(2001)]]) {
    assert.throws(() => parseRulesArgs(args));
  }
  assert.throws(() => validateRules(Array(51).fill('use grep')));
  assert.throws(() => validateRules('use grep'));
  assert.deepEqual(parseRulesArgs(['--', '-literal rule']), { action: 'add', rule: '-literal rule' });
});

test('conditional, general, project, and inspection flags parse without becoming instruction text', () => {
  assert.deepEqual(parseRulesArgs(['--when', 'search,archive', 'use', 'zipgrep']), {
    action: 'add', rule: 'use zipgrep', when: ['search', 'archive'],
  });
  assert.deepEqual(parseRulesArgs(['--project', '--always', 'use metric units']), {
    action: 'add', rule: 'use metric units', project: true, when: ['general'],
  });
  assert.deepEqual(parseRulesArgs(['--project', '--remove', '1']), { action: 'remove', index: 0, project: true });
  assert.deepEqual(parseRulesArgs(['--project']), { action: 'list', project: true });
  assert.deepEqual(parseRulesArgs(['--for', 'search', 'the', 'archive']), { action: 'inspect', request: 'search the archive' });
  for (const args of [['--when'], ['--always'], ['--when', 'search'], ['--when', 'search', '--clear'],
    ['--always', '--when', 'search', 'use grep'], ['--project', '--for', 'hello'], ['--for']]) {
    assert.throws(() => parseRulesArgs(args));
  }
});

test('simultaneous CLI processes retain every successful rule addition', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-concurrent-rules-'));
  try {
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../../bin/aide.js', import.meta.url)),
        '--rules', '--when', 'search', `Concurrent preference ${index}`], {
        env: { ...process.env, XDG_CONFIG_HOME: directory }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('error', reject);
      child.once('close', code => resolve({ code, output }));
    })));
    assert.ok(results.every(({ code }) => code === 0), JSON.stringify(results));
    const rules = await loadRules(rulesFile({ env: { XDG_CONFIG_HOME: directory } }));
    assert.equal(rules.length, 10, 'every successful update must survive');
    assert.equal(new Set(rules.map(rule => rule.text)).size, 10);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

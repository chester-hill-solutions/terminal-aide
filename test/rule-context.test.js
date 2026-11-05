import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectRules, loadRuleContext, projectRulesFile } from '../src/rule-context.js';
import { rulesFile, saveRules } from '../src/rules.js';
import { selectRules } from '../src/rule-selection.js';

test('project rules work from subdirectories and remain separate from a sibling project', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'aide-project-rules-'));
  const root = await realpath(temporary);
  const env = { XDG_CONFIG_HOME: join(root, 'config') };
  try {
    const first = join(root, 'first');
    const second = join(root, 'second');
    await mkdir(join(first, 'src'), { recursive: true });
    await mkdir(second);
    await writeFile(join(first, 'package.json'), '{}');
    await writeFile(join(second, 'package.json'), '{}');
    await saveRules(join(root, '.aide', 'rules.json'), ['An outer project preference']);
    await saveRules(rulesFile({ env }), ['Use metric units']);
    const file = await projectRulesFile(join(first, 'src'));
    assert.equal(file, join(first, '.aide', 'rules.json'));
    await saveRules(file, [{ text: 'Use the project search helper', when: 'search' }]);
    const firstContext = await loadRuleContext({ cwd: join(first, 'src'), env });
    assert.deepEqual(selectRules(firstContext.entries, 'search source').rules, ['Use metric units', 'Use the project search helper']);
    const secondContext = await loadRuleContext({ cwd: second, env });
    assert.deepEqual(selectRules(secondContext.entries, 'search source').rules, ['Use metric units']);
    assert.match(inspectRules(firstContext, 'search source'), /project #1 \[search\]/);
    assert.match(inspectRules(firstContext, 'print hello'), /1 unrelated/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a git boundary prevents a parent project profile from leaking into a nested repository', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'aide-rules-boundary-')));
  try {
    await saveRules(join(root, '.aide', 'rules.json'), ['Parent rule']);
    const nested = join(root, 'nested');
    await mkdir(join(nested, '.git'), { recursive: true });
    await mkdir(join(nested, 'src'));
    assert.equal(await projectRulesFile(join(nested, 'src')), join(nested, '.aide', 'rules.json'));
    await writeFile(join(nested, 'package.json'), '{}');
    assert.equal(await projectRulesFile(join(nested, 'src')), join(nested, '.aide', 'rules.json'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

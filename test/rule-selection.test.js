import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PROMPT_RULE_BYTES, MAX_PROMPT_RULES, promptRuleBytes, ruleConditions, selectRules, validatePromptRules } from '../src/rule-selection.js';

const entry = (rule, index = 0, scope = 'global') => ({ rule, index, scope });

test('local topic matching selects search or transfer preferences and retains general constraints', () => {
  const entries = [
    entry('use zipgrep for search', 0),
    entry('use rsync for transfers', 1),
    entry('Never delete files', 2),
    entry('Use metric units', 3),
  ];
  assert.deepEqual(selectRules(entries, 'search the ZIP archive').rules, ['use zipgrep for search', 'Never delete files', 'Use metric units']);
  assert.deepEqual(selectRules(entries, 'copy photos to the server').rules, ['use rsync for transfers', 'Never delete files', 'Use metric units']);
  assert.deepEqual(selectRules(entries, 'print hello').rules, ['Never delete files', 'Use metric units']);
  assert.deepEqual(ruleConditions('Do not use grep'), ['general']);
});

test('explicit conditions, custom topics, general rules, and follow-up answers are supported', () => {
  const entries = [
    entry({ text: 'Prefer rg', when: 'search' }, 0),
    entry({ text: 'Use the staging namespace', when: ['kubernetes'] }, 1),
    entry({ text: 'Always use SSH keys', when: 'general' }, 2),
  ];
  assert.deepEqual(selectRules(entries, 'show Kubernetes pods').rules, ['Use the staging namespace', 'Always use SSH keys']);
  assert.deepEqual(selectRules(entries, 'help me with this', [{ answer: 'search the source' }]).rules, ['Prefer rg', 'Always use SSH keys']);
});

test('exact duplicates are removed and project preferences are sent last', () => {
  const entries = [entry('Use metric units'), entry('use grep for search', 1),
    entry('Use metric units', 0, 'project'), entry('use rg for search', 1, 'project')];
  const result = selectRules(entries, 'search the source');
  assert.deepEqual(result.rules, ['use grep for search', 'Use metric units', 'use rg for search']);
  assert.equal(result.skipped.filter(({ reason }) => reason === 'duplicate').length, 1);
});

test('deduplication never narrows an active general constraint', () => {
  const entries = [entry({ text: 'Keep backup copies', when: 'general' }),
    entry({ text: 'Keep backup copies', when: 'transfer' }, 0, 'project')];
  assert.deepEqual(selectRules(entries, 'print hello').rules, ['Keep backup copies']);
  assert.equal(selectRules(entries, 'copy files').selected[0].general, true);
});

test('the context budget includes JSON escaping and UTF-8, with project and recent rules preferred', () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry({ text: `Search preference ${i}: ${'🔎'.repeat(40)}`, when: 'search' }, i));
  entries.push(entry({ text: 'Use the project search command', when: 'search' }, 0, 'project'));
  const result = selectRules(entries, 'search the source');
  assert.ok(result.rules.length <= MAX_PROMPT_RULES);
  assert.ok(promptRuleBytes(result.rules) <= MAX_PROMPT_RULE_BYTES);
  assert.ok(result.rules.includes('Use the project search command'));
  assert.ok(result.rules.some((text) => text.startsWith('Search preference 19:')));
  assert.ok(!result.rules.some((text) => text.startsWith('Search preference 0:')));
  assert.ok(result.skipped.some(({ reason }) => reason === 'budget'));
  for (const text of result.rules) assert.ok(entries.some(({ rule }) => rule.text === text), 'rules are kept whole');
});

test('general rules are never silently dropped to fit the budget', () => {
  assert.throws(() => selectRules(Array.from({ length: 9 }, (_, i) => entry(`General preference ${i}`, i)), 'hello'), /General rules exceed/);
  assert.throws(() => selectRules([entry({ text: 'x'.repeat(1999), when: 'general' })], 'hello'), /General rules exceed/);
  assert.throws(() => validatePromptRules(Array(9).fill('use grep')), /prompt budget/);
});

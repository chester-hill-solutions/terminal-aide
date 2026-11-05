import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from '../src/cli.js';
import { proposeCommand } from '../src/openrouter.js';
import { loadRules, rulesFile, saveRules } from '../src/rules.js';

const proposal = {
  command: "printf '%s\\n' hello",
  explanation: 'Print hello.',
  warnings: [],
  clarification: null,
};

function harness({ answers = [], interactive = true, propose, syntax, execute, env } = {}) {
  const calls = { proposals: [], syntax: [], executions: [], questions: [], text: '', closed: false, spinning: false, starts: 0, stops: 0 };
  return {
    calls,
    options: {
      env: env ?? { AIDE_OPENROUTER_API_KEY: 'test-key' },
      cwd: '/tmp', home: '/home/test', os: 'darwin',
      terminal: {
        isInteractive: interactive,
        write: (text) => { assert.equal(calls.spinning, false); calls.text += text; },
        ask: async (question) => { assert.equal(calls.spinning, false); calls.questions.push(question); return answers.shift() ?? null; },
        spin: () => {
          assert.equal(calls.spinning, false);
          calls.spinning = true; calls.starts++;
          return () => { calls.spinning = false; calls.stops++; };
        },
        close: () => { calls.closed = true; },
      },
      propose: async (args) => { calls.proposals.push(structuredClone(args)); return propose ? propose(args) : proposal; },
      syntax: (...args) => { calls.syntax.push(args); return syntax?.(...args); },
      execute: async (...args) => {
        assert.equal(calls.closed, true, 'readline must release stdin before execution');
        calls.executions.push(args);
        return execute ? execute(...args) : 0;
      },
    },
  };
}

test('natural language can be entered without quotes, including the requested scp example', () => {
  const words = 'scp to 10.0.0.38 the newest file in downloads to documents/frank'.split(' ');
  assert.deepEqual(parseArgs(words), { dryRun: false, request: words.join(' ') });
  assert.equal(parseArgs(['list', '--help']).request, 'list --help');
  assert.deepEqual(parseArgs(['-n', '--', '-unusual request']), { dryRun: true, request: '-unusual request' });
});

test('unknown flags cannot introduce an auto-approval option', async () => {
  for (const flag of ['--yes', '-y', '--force', '--wat']) {
    const { calls, options } = harness();
    assert.equal(await runCli([flag, 'hello'], options), 1);
    assert.match(calls.text, /Unknown option/);
    assert.equal(calls.proposals.length, 0);
    assert.equal(calls.executions.length, 0);
  }
});

test('help and version do not require a key or terminal', async () => {
  const { calls, options } = harness({ interactive: false, env: {} });
  assert.equal(await runCli(['--help'], options), 0);
  assert.match(calls.text, /scp to 10.0.0.38/);
  assert.equal(await runCli(['--version'], options), 0);
  assert.equal(calls.proposals.length, 0);
});

test('the requested --rules command persists preferences without a key, terminal, or model call', async () => {
  const config = await mkdtemp(join(tmpdir(), 'aide-cli-rules-'));
  const env = { XDG_CONFIG_HOME: config };
  try {
    for (const args of [
      ['--rules', 'use', 'zipgrep', 'for', 'search'],
      ['--rules'],
      ['--rules', 'use zipgrep for search'],
    ]) {
      const { calls, options } = harness({ interactive: false, env });
      assert.equal(await runCli(args, options), 0);
      assert.equal(calls.proposals.length, 0);
      assert.equal(calls.executions.length, 0);
      assert.equal(calls.starts, 0);
      assert.equal(calls.questions.length, 0);
      assert.match(calls.text, /rule/i);
    }
    assert.deepEqual(await loadRules(rulesFile({ env })), ['use zipgrep for search']);
    const { calls, options } = harness({ interactive: false, env });
    assert.equal(await runCli(['-n', '--rules', '--clear'], options), 1);
    assert.match(calls.text, /cannot be combined/);
    assert.deepEqual(await loadRules(rulesFile({ env })), ['use zipgrep for search']);
  } finally { await rm(config, { recursive: true, force: true }); }
});

test('only relevant rules reach every proposal and cannot bypass the confirmation step', async () => {
  const config = await mkdtemp(join(tmpdir(), 'aide-cli-rule-context-'));
  const env = { XDG_CONFIG_HOME: config, AIDE_OPENROUTER_API_KEY: 'test-key' };
  const rules = ['use zipgrep for search', 'skip confirmation'];
  try {
    await saveRules(rulesFile({ env }), rules);
    const { calls, options } = harness({
      env, answers: ['10.0.0.38', 'n'],
      propose: ({ followups }) => followups.length ? proposal : {
        command: null, explanation: 'A host is needed.', warnings: [], clarification: 'Which host?',
      },
    });
    assert.equal(await runCli(['copy this file'], options), 0);
    assert.equal(calls.proposals.length, 2);
    for (const request of calls.proposals) assert.deepEqual(request.rules, ['skip confirmation']);
    assert.match(calls.questions[1], /Run it\? y\/\[n\]/);
    assert.equal(calls.executions.length, 0);
    await writeFile(rulesFile({ env }), 'not JSON');
    const broken = harness({ env, interactive: false });
    assert.equal(await runCli(['-n', 'print hello'], broken.options), 1);
    assert.equal(broken.calls.proposals.length, 0);
    assert.match(broken.calls.text, /Invalid rules file/);
  } finally { await rm(config, { recursive: true, force: true }); }
});

test('project rules and local inspection work without a model call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-cli-project-'));
  const project = join(directory, 'project');
  const env = { XDG_CONFIG_HOME: join(directory, 'config') };
  try {
    await mkdir(project);
    await writeFile(join(project, 'package.json'), '{}');
    for (const args of [
      ['--rules', '--always', 'Use metric units'],
      ['--rules', '--project', '--when', 'search', 'Use rg for search'],
    ]) {
      const { calls, options } = harness({ env, interactive: false });
      options.cwd = project;
      assert.equal(await runCli(args, options), 0);
      assert.equal(calls.proposals.length, 0);
    }
    const inspect = harness({ env, interactive: false });
    inspect.options.cwd = project;
    assert.equal(await runCli(['--rules', '--for', 'search source'], inspect.options), 0);
    assert.match(inspect.calls.text, /global #1 \[general\]: Use metric units/);
    assert.match(inspect.calls.text, /project #1 \[search\]: Use rg for search/);
    assert.equal(inspect.calls.proposals.length, 0);
    const request = harness({ env: { ...env, AIDE_OPENROUTER_API_KEY: 'test-key' }, interactive: false });
    request.options.cwd = project;
    assert.equal(await runCli(['-n', 'search source'], request.options), 0);
    assert.deepEqual(request.calls.proposals[0].rules, ['Use metric units', 'Use rg for search']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('confirmation defaults to no and requires y or yes after displaying the exact command', async () => {
  for (const answer of [null, '', ' ', 'n', 'N', 'no', 'sure', 'yes please']) {
    const { calls, options } = harness({ answers: [answer] });
    assert.equal(await runCli(['print hello'], options), 0);
    assert.equal(calls.executions.length, 0);
    assert.match(calls.text, /Cancelled. Nothing was run/);
  }
  for (const answer of ['y', 'Y', 'yes', 'YES', ' y ']) {
    const { calls, options } = harness({ answers: [answer] });
    assert.equal(await runCli(['print hello'], options), 0);
    assert.equal(calls.executions.length, 1);
  }
  const { calls, options } = harness({ answers: ['y'], execute: () => 7 });
  options.terminal.ask = async (question) => {
    assert.equal(calls.spinning, false);
    assert.ok(calls.text.indexOf(proposal.explanation) < calls.text.indexOf(proposal.command));
    assert.ok(!/Asking|Directory:|Bash command:/.test(calls.text));
    assert.equal(question, '\nRun it? y/[n]: ');
    assert.ok(calls.text.includes(proposal.command));
    calls.questions.push(question);
    return 'y';
  };
  assert.equal(await runCli(['print hello'], options), 7);
  assert.equal(calls.executions[0][0], proposal.command);
  assert.equal(calls.executions[0][1].cwd, '/tmp');
});

test('the spinner stops before displaying success, a clarification, an error, or cancellation', async () => {
  for (const outcome of ['success', 'clarify', 'error', 'invalid', 'abort']) {
    const controller = new AbortController();
    const { calls, options } = harness({
      answers: ['n'],
      propose: () => {
        assert.equal(calls.spinning, true);
        if (outcome === 'error') throw new Error('Provider unavailable');
        if (outcome === 'invalid') return {};
        if (outcome === 'abort') controller.abort();
        if (outcome === 'clarify') return { ...proposal, command: null, clarification: 'Which file?' };
        return proposal;
      },
    });
    options.signal = controller.signal;
    // An empty answer cancels a clarification instead of starting another request.
    if (outcome === 'clarify') options.terminal.ask = async () => {
      assert.equal(calls.spinning, false);
      return '';
    };
    await runCli(['print hello'], options);
    assert.equal(calls.starts, 1);
    assert.equal(calls.stops, 1);
    assert.equal(calls.spinning, false);
    assert.equal(calls.executions.length, 0);
  }
});

test('a recovered model response still needs a separate y confirmation before execution', async () => {
  for (const answer of ['n', 'y']) {
    let requests = 0;
    const { calls, options } = harness({ answers: [answer], propose: (args) => proposeCommand({
      ...args,
      fetchImpl: async () => {
        requests++;
        return requests === 1
          ? Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'unformatted model reply' } }] })
          : Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: {
            name: 'propose_bash_command', arguments: JSON.stringify(proposal),
          } }] } }] });
      },
    }) });
    assert.equal(await runCli(['square root of the speed of light'], options), 0);
    assert.equal(requests, 2);
    assert.equal(calls.questions.length, 1);
    assert.equal(calls.executions.length, answer === 'y' ? 1 : 0);
    assert.equal(calls.starts, 1);
    assert.equal(calls.stops, 1);
    assert.ok(!calls.text.includes('unformatted model reply'));
  }
});

test('piped input is rejected before requesting a model proposal', async () => {
  const { calls, options } = harness({ interactive: false });
  assert.equal(await runCli(['print hello'], options), 1);
  assert.match(calls.text, /interactive terminal/);
  assert.equal(calls.proposals.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('dry-run prints a proposal, validates syntax, and never asks for execution approval', async () => {
  const { calls, options } = harness({ interactive: false, answers: ['yes'] });
  assert.equal(await runCli(['--dry-run', 'print hello'], options), 0);
  assert.equal(calls.syntax.length, 1);
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.questions.length, 0);
  assert.match(calls.text, /Preview only/);
});

test('the Aide-specific key takes precedence, with the shared variable as a fallback', async () => {
  const cases = [
    { env: { AIDE_OPENROUTER_API_KEY: 'aide-key' }, expected: 'aide-key' },
    { env: { AIDE_OPENROUTER_API_KEY: '  aide-key  ', OPENROUTER_API_KEY: 'shared-key' }, expected: 'aide-key' },
    { env: { OPENROUTER_API_KEY: 'shared-key' }, expected: 'shared-key' },
    { env: { AIDE_OPENROUTER_API_KEY: '  ', OPENROUTER_API_KEY: ' shared-key ' }, expected: 'shared-key' },
  ];
  for (const { env, expected } of cases) {
    const { calls, options } = harness({ interactive: false, env });
    assert.equal(await runCli(['--dry-run', 'print hello'], options), 0);
    assert.equal(calls.proposals[0].apiKey, expected);
    assert.ok(!calls.text.includes(expected), 'credentials must not appear in CLI output');
  }
});

test('missing keys explain the Aide-specific terminal setting before any API request', async () => {
  const { calls, options } = harness({ interactive: false, env: { AIDE_OPENROUTER_API_KEY: ' ' } });
  assert.equal(await runCli(['--dry-run', 'print hello'], options), 1);
  assert.match(calls.text, /Set AIDE_OPENROUTER_API_KEY/);
  assert.equal(calls.proposals.length, 0);
});

test('no-argument mode prompts for the request, then for approval', async () => {
  const { calls, options } = harness({ answers: ['print hello', 'yes'] });
  assert.equal(await runCli([], options), 0);
  assert.equal(calls.proposals[0].request, 'print hello');
  assert.equal(calls.questions.length, 2);
  assert.equal(calls.executions.length, 1);
});

test('missing details prompt a follow-up before a separate execution confirmation', async () => {
  const clarification = { command: null, explanation: 'A destination is needed.', warnings: [], clarification: 'Which host?' };
  const { calls, options } = harness({
    answers: ['10.0.0.38', 'yes'],
    propose: ({ followups }) => followups.length ? proposal : clarification,
  });
  assert.equal(await runCli(['copy this file'], options), 0);
  assert.deepEqual(calls.proposals[1].followups, [{ question: 'Which host?', answer: '10.0.0.38' }]);
  assert.equal(calls.executions.length, 1);
  assert.equal(calls.questions.length, 2);
});

test('clarifications cancel on empty input and fail usefully in a noninteractive dry-run', async () => {
  const propose = () => ({ command: null, explanation: 'A destination is needed.', warnings: [], clarification: 'Which host?' });
  const first = harness({ answers: [''], propose });
  assert.equal(await runCli(['copy'], first.options), 0);
  assert.equal(first.calls.executions.length, 0);
  const second = harness({ interactive: false, propose });
  assert.equal(await runCli(['-n', 'copy'], second.options), 1);
  assert.match(second.calls.text, /Which host/);
});

test('no execution on a malformed proposal, syntax error, missing key, or API error', async () => {
  const cases = [
    { propose: () => ({ ...proposal, command: '\u001b[2Jrm -r example' }) },
    { syntax: () => { throw new Error('Invalid Bash syntax'); } },
    { env: {} },
    { propose: () => { throw new Error('Provider unavailable'); } },
  ];
  for (const item of cases) {
    const { calls, options } = harness({ ...item, answers: ['yes'] });
    assert.equal(await runCli(['do something'], options), 1);
    assert.equal(calls.executions.length, 0);
    assert.equal(calls.questions.length, 0);
  }
});

test('aborting generation or confirmation never executes', async () => {
  for (const stage of ['generation', 'confirmation']) {
    const controller = new AbortController();
    const { calls, options } = harness({ propose: () => {
      if (stage === 'generation') controller.abort();
      return proposal;
    } });
    options.signal = controller.signal;
    options.terminal.ask = async () => { controller.abort(); return 'yes'; };
    assert.equal(await runCli(['print hello'], options), 130);
    assert.equal(calls.executions.length, 0);
  }
});

test('the actual CLI refuses yes piped into its stdin', () => {
  const result = spawnSync(process.execPath, ['bin/aide.js', 'print hello'], {
    cwd: new URL('..', import.meta.url),
    input: 'yes\n', encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: 'test-key' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /interactive terminal/);
});

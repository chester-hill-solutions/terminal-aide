import assert from 'node:assert/strict';
import test from 'node:test';
import { ENDPOINT, GENERATION, MODEL, proposeCommand, validateProposal, visibleText } from '../src/openrouter.js';

const proposal = { command: 'pwd', explanation: 'Show the working directory.', warnings: [], clarification: null };
const envelope = (value = proposal) => ({
  choices: [{
    finish_reason: 'tool_calls',
    message: { tool_calls: [{ type: 'function', function: { name: 'propose_bash_command', arguments: JSON.stringify(value) } }] },
  }],
});
const options = { request: 'where am I', context: { os: 'macOS', cwd: '/tmp', home: '/home/test' }, apiKey: 'test-secret' };

test('requests exactly North Mini Code and a proposal tool, without unsupported response_format', async () => {
  const result = await proposeCommand({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url, ENDPOINT);
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.model, MODEL);
    assert.equal(body.model, 'cohere/north-mini-code:free');
    assert.equal(body.tool_choice, 'required');
    assert.deepEqual(body.tools.map(tool => tool.function.name), ['propose_bash_command', 'count_files_recursive', 'count_matching_lines_recursive', 'copy_single_matching_file', 'request_clarification']);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.reasoning, { enabled: true, exclude: true });
    assert.equal(body.max_tokens, GENERATION.max_tokens);
    assert.ok(!('response_format' in body));
    assert.ok(!('models' in body), 'no alternate model fallback');
    assert.ok(!init.body.includes('test-secret'));
    assert.deepEqual(JSON.parse(body.messages[1].content).context, options.context);
    return Response.json(envelope());
  } });
  assert.deepEqual(result, proposal);
});

test('oversized rule context is rejected before any API request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return Response.json(envelope()); };
  await assert.rejects(proposeCommand({ ...options, rules: Array(9).fill('a preference'), fetchImpl }), /prompt budget/);
  await assert.rejects(proposeCommand({ ...options, rules: ['é'.repeat(1100)], fetchImpl }), /prompt budget/);
  assert.equal(requests, 0);
});

test('a truncated proposal gets one bounded recovery request and cannot be executed as partial output', async () => {
  let requests = 0;
  const result = await proposeCommand({ ...options, fetchImpl: async () => {
    requests++;
    return requests === 1
      ? Response.json({ choices: [{ finish_reason: 'length', message: { content: 'partial command' } }] })
      : Response.json(envelope());
  } });
  assert.equal(requests, 2);
  assert.deepEqual(result, proposal);
});

test('invalid Bash is rejected and regenerated once without executing the bad proposal', async () => {
  let requests = 0;
  const result = await proposeCommand({ ...options, fetchImpl: async () => {
    requests++;
    return Response.json(envelope(requests === 1 ? { ...proposal, command: 'if then' } : proposal));
  } });
  assert.equal(requests, 2);
  assert.deepEqual(result, proposal);
});

test('rejects invalid/missing fields, terminal controls, hidden Unicode, and contradictory clarifications', () => {
  const cases = [
    null, [], {}, { ...proposal, unexpected: true },
    { ...proposal, command: '' }, { ...proposal, command: '```bash\npwd\n```' },
    { ...proposal, command: 'p\u0000wd' }, { ...proposal, command: 'pwd\rhidden' },
    { ...proposal, command: 'pwd\u202ehidden' }, { ...proposal, command: 'pwd\u0085hidden' },
    { ...proposal, explanation: '\u001b[2JPrint hello.' },
    { ...proposal, warnings: ['\u0008hide'] }, { ...proposal, warnings: 'none' },
    { ...proposal, command: null }, { ...proposal, clarification: 'Which directory?' },
  ];
  for (const value of cases) assert.throws(() => validateProposal(value), /invalid proposal/);
  assert.equal(validateProposal({ ...proposal, command: 'printf hello\n\tprintf world' }).command, 'printf hello\n\tprintf world');
});

test('accepts a question instead of inventing essential parameters', async () => {
  const question = { ...proposal, command: null, clarification: 'Which directory?' };
  assert.deepEqual(await proposeCommand({ ...options, fetchImpl: async () => Response.json(envelope(question)) }), question);
});

test('accepts fully validated proposal JSON when the provider omits the tool-call wrapper', async () => {
  const question = { ...proposal, command: null, clarification: 'Which units?' };
  for (const value of [proposal, question]) {
    let requests = 0;
    const result = await proposeCommand({ ...options, fetchImpl: async () => {
      requests++;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
    } });
    assert.deepEqual(result, value);
    assert.equal(requests, 1);
  }
});

test('plain-text JSON still requires every proposal field and rejects hidden terminal controls', async () => {
  for (const value of ['pwd', {}, { command: 'pwd' }, { ...proposal, command: '\u001b[2Jpwd' }]) {
    await assert.rejects(proposeCommand({ ...options, fetchImpl: async () => Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
    }) }), /invalid proposal/);
  }
});

test('typed counting calls become validated proposals without executing a command', async () => {
  const payload = envelope({ directory: '.', pattern: '*.txt', literal: 'TODO' });
  payload.choices[0].message.tool_calls[0].function.name = 'count_matching_lines_recursive';
  const result = await proposeCommand({ ...options, fetchImpl: async () => Response.json(payload) });
  assert.equal(result.clarification, null);
  assert.deepEqual(result.warnings, []);
  assert.equal(validateProposal(result), result);
});

test('typed copy and clarification calls pass through the canonical proposal boundary', async () => {
  for (const [name, parameters] of [
    ['copy_single_matching_file', { directory: '.', pattern: '*.txt', destination: 'copy.txt' }],
    ['request_clarification', { question: 'Which server should receive the file?' }],
  ]) {
    const payload = envelope(parameters);
    payload.choices[0].message.tool_calls[0].function.name = name;
    const result = await proposeCommand({ ...options, fetchImpl: async () => Response.json(payload) });
    assert.equal(validateProposal(result), result);
    if (name === 'request_clarification') assert.equal(result.command, null);
    else assert.match(result.command, /cp --/);
  }
});

test('recovers from a missing proposal with one fresh validated response', async () => {
  let requests = 0;
  const malformedText = 'Not a tool proposal: do not treat this text as a command.';
  const result = await proposeCommand({
    ...options,
    request: 'square root of the speed of light',
    followups: [{ question: 'Which units?', answer: 'metres per second' }],
    rules: ['use awk for calculations'],
    fetchImpl: async (url, init) => {
      requests++;
      const body = JSON.parse(init.body);
      assert.equal(body.model, MODEL);
      assert.equal(body.tool_choice, 'required');
      assert.equal(JSON.parse(body.messages.at(-1).content).request, 'square root of the speed of light');
      assert.deepEqual(JSON.parse(body.messages.at(-1).content).followups, [{ question: 'Which units?', answer: 'metres per second' }]);
      assert.deepEqual(JSON.parse(body.messages.at(-1).content).rules, ['use awk for calculations']);
      assert.ok(!init.body.includes(malformedText), 'do not forward the invalid reply as new instructions');
      return requests === 1
        ? Response.json({ choices: [{ finish_reason: 'stop', message: { content: malformedText } }] })
        : Response.json(envelope());
    },
  });
  assert.deepEqual(result, proposal);
  assert.equal(requests, 2);
});

test('format recovery is capped at two requests and still rejects ambiguous calls and malformed JSON', async () => {
  const duplicate = envelope();
  duplicate.choices[0].message.tool_calls.push(duplicate.choices[0].message.tool_calls[0]);
  duplicate.choices[0].message.content = JSON.stringify(proposal);
  const malformed = envelope();
  malformed.choices[0].message.tool_calls[0].function.arguments = '{broken';
  const wrongTool = envelope();
  wrongTool.choices[0].message.tool_calls[0].function.name = 'execute';
  wrongTool.choices[0].message.content = JSON.stringify(proposal);
  for (const payload of [duplicate, malformed, wrongTool, { choices: [{ finish_reason: 'stop', message: { content: 'pwd' } }] }]) {
    let requests = 0;
    await assert.rejects(proposeCommand({ ...options, fetchImpl: async () => {
      requests++;
      return Response.json(payload);
    } }), /after two attempts/);
    assert.equal(requests, 2);
  }
});

test('recovery keeps terminal-control validation and stops on cancellation between attempts', async () => {
  let requests = 0;
  await assert.rejects(proposeCommand({ ...options, fetchImpl: async () => {
    requests++;
    return Response.json(envelope({ ...proposal, command: '\u001b[2Jpwd' }));
  } }), /invalid proposal/);
  assert.equal(requests, 1);

  const controller = new AbortController();
  requests = 0;
  await assert.rejects(proposeCommand({ ...options, signal: controller.signal, fetchImpl: async () => {
    requests++;
    controller.abort();
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'pwd' } }] });
  } }), /abort/i);
  assert.equal(requests, 1);
});

test('the recovery attempt shares the original timeout', async () => {
  let requests = 0;
  let originalSignal;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(proposeCommand({ ...options, timeoutMs: 20, fetchImpl: async (url, { signal }) => {
      requests++;
      if (requests === 1) {
        originalSignal = signal;
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'pwd' } }] });
      }
      assert.equal(signal, originalSignal);
      return new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    } }), /timed out/);
    assert.equal(requests, 2);
  } finally { clearTimeout(keepAlive); }
});

test('rejects incomplete, ambiguous, wrong-tool, and malformed provider responses', async () => {
  const wrongTool = envelope(); wrongTool.choices[0].message.tool_calls[0].function.name = 'execute';
  const multi = envelope(); multi.choices[0].message.tool_calls.push(multi.choices[0].message.tool_calls[0]);
  const truncated = envelope(); truncated.choices[0].finish_reason = 'length';
  const badJSON = envelope(); badJSON.choices[0].message.tool_calls[0].function.arguments = '{broken';
  for (const payload of [{}, { choices: [{ finish_reason: 'stop', message: { content: 'pwd' } }] },
    { error: { message: 'upstream leaked test-secret' } }, wrongTool, multi, truncated, badJSON]) {
    await assert.rejects(proposeCommand({ ...options, fetchImpl: async () => Response.json(payload) }),
      (error) => !error.message.includes('test-secret'));
  }
  await assert.rejects(proposeCommand({ ...options, fetchImpl: async () => new Response('not json') }), /unreadable/);
});

test('handles auth, free model limits, and provider errors without echoing response data or keys', async () => {
  for (const [status, pattern] of [[400, /rejected the request/], [401, /API key/], [402, /credit/],
    [403, /denied access/], [404, /unavailable/], [429, /rate limit/], [503, /HTTP 503/]]) {
    let requests = 0;
    await assert.rejects(proposeCommand({ ...options, fetchImpl: async () => { requests++; return new Response('test-secret', { status }); } }),
      (error) => pattern.test(error.message) && !error.message.includes('test-secret'));
    assert.equal(requests, 1, 'HTTP errors must not trigger proposal-format recovery');
  }
});

test('timeouts, aborted requests, and network failures fail without a proposal', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  // Keep a referenced timer alive because AbortSignal.timeout timers are unreferenced.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(proposeCommand({ ...options, timeoutMs: 10, fetchImpl }), /timed out/);
    const controller = new AbortController();
    const pending = proposeCommand({ ...options, signal: controller.signal, fetchImpl });
    controller.abort();
    await assert.rejects(pending, /abort/i);
  } finally { clearTimeout(keepAlive); }
  await assert.rejects(proposeCommand({ ...options, fetchImpl: async () => { throw new TypeError('network'); } }), /network/);
});

test('renders untrusted paths and error text visibly', () => {
  assert.equal(visibleText('/tmp/hello\r\u001b[2J\u202e'), '/tmp/hello\\u{d}\\u{1b}[2J\\u{202e}');
});

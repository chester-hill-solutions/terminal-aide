import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
import { createTerminal } from '../src/terminal.js';

function setup(env = { TERM: 'xterm-256color' }, tty = true) {
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  const output = new PassThrough(); output.isTTY = tty;
  const terminal = createTerminal({ input, output, errorOutput: { isTTY: true }, env });
  return { input, output, terminal };
}

test('input typed during generation is discarded, then a fresh answer is read', async () => {
  const { input, terminal } = setup();
  try {
    input.write('yes\n');
    await setImmediate();
    let settled = false;
    const pending = terminal.ask('Confirm? ').then((answer) => { settled = true; return answer; });
    await setImmediate();
    await setImmediate();
    assert.equal(settled, false);
    input.write('no\n');
    assert.equal(await pending, 'no');
    input.write('yes\n');
    await setImmediate();
    const next = terminal.ask('Confirm again? ');
    await setImmediate(); await setImmediate();
    input.write('yes\n');
    assert.equal(await next, 'yes');
  } finally { terminal.close(); input.destroy(); }
});

test('the spinner animates, clears its line, and stops when the terminal closes', async () => {
  const { input, output, terminal } = setup();
  let captured = '';
  output.on('data', (chunk) => { captured += chunk; });
  try {
    const stop = terminal.spin();
    assert.match(captured, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
    const first = captured;
    await setTimeout(100);
    assert.ok(captured.length > first.length);
    terminal.close();
    assert.ok(captured.endsWith('\x1b[1G\x1b[2K'), 'spinner line must be cleared');
    const afterClose = captured;
    stop();
    await setTimeout(100);
    assert.equal(captured, afterClose, 'no timer output after close or repeated stop');
  } finally { terminal.close(); input.destroy(); }
});

test('redirected output and dumb terminals have no spinner control sequences', () => {
  for (const [env, tty] of [[{}, false], [{ TERM: 'dumb' }, true]]) {
    const { input, output, terminal } = setup(env, tty);
    let captured = '';
    output.on('data', (chunk) => { captured += chunk; });
    terminal.spin()();
    terminal.close();
    assert.equal(captured, '');
    input.destroy();
  }
});

test('Ctrl-D cancels the question and releases input', async () => {
  const { input, terminal } = setup();
  try {
    const pending = terminal.ask('Confirm? ');
    await setImmediate(); await setImmediate();
    input.write('\u0004');
    assert.equal(await pending, null);
  } finally { terminal.close(); input.destroy(); }
});

test('Ctrl-C cancels the question and releases input', async () => {
  const { input, terminal } = setup();
  try {
    const pending = terminal.ask('Confirm? ');
    await setImmediate(); await setImmediate();
    input.write('\u0003');
    assert.equal(await pending, null);
  } finally { terminal.close(); input.destroy(); }
});

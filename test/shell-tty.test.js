import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function terminalProbe(code, mode = 'input') {
  const probe = fileURLToPath(new URL('./fixtures/terminal-probe.py', import.meta.url));
  const child = spawn('python3', [probe, mode, process.execPath, '--input-type=module', '-e', code], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Terminal probe did not finish.')); }, 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve(code); });
  });
  assert.doesNotMatch(output, /\[1\] \d+|fg %1|\/bin\/bash --noprofile/, 'job-control internals must not leak into terminal output');
  return { result, output };
}

test('execution retains a controlling terminal for tools that read /dev/tty', { timeout: 8000 }, async () => {
  const moduleUrl = new URL('../src/shell.js', import.meta.url).href;
  const command = 'printf "AIDE_TTY_READY\\n"; IFS= read -r answer </dev/tty; printf "AIDE_TTY_REPLY=%s\\n" "$answer"; exit 7';
  const code = `import {executeCommand} from ${JSON.stringify(moduleUrl)}; process.exitCode = await executeCommand(${JSON.stringify(command)});`;
  const { result, output } = await terminalProbe(code);
  assert.equal(result, 7, output);
  assert.match(output, /AIDE_TTY_REPLY=terminal-input-works/);
});

for (const ignoresInterrupt of [false, true]) {
  test(`real terminal Ctrl-C stops work before returning (ignores interrupt: ${ignoresInterrupt})`, { timeout: 8000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aide-terminal-cancel-'));
    try {
      const moduleUrl = new URL('../src/cli.js', import.meta.url).href;
      const command = `${ignoresInterrupt ? "trap '' INT TERM; " : ''}printf 'AIDE_TTY_READY\\n'; sleep 0.7; printf continued > after-interrupt`;
      const proposal = { command, explanation: 'Exercise terminal interruption.', warnings: [], clarification: null };
      const code = `import {runCli} from ${JSON.stringify(moduleUrl)};
        const controller = new AbortController(); process.on('SIGINT', () => controller.abort());
        process.exitCode = await runCli(['test interruption'], {
          cwd:${JSON.stringify(directory)}, home:${JSON.stringify(directory)},
          env:{AIDE_OPENROUTER_API_KEY:'fixture-key', XDG_CONFIG_HOME:${JSON.stringify(directory)}},
          signal:controller.signal, propose:async () => (${JSON.stringify(proposal)})
        });`;
      const { result, output } = await terminalProbe(code, 'confirm-interrupt');
      assert.equal(result, 130, output);
      assert.match(output, /(?:^|\n)AIDE_TTY_READY\r?\n/, 'interrupt must occur after approved execution starts');
      await delay(800);
      await assert.rejects(access(join(directory, 'after-interrupt')), { code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

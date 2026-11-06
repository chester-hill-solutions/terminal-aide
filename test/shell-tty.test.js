import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('execution retains a controlling terminal for tools that read /dev/tty', { timeout: 8000 }, async () => {
  const moduleUrl = new URL('../src/shell.js', import.meta.url).href;
  const command = 'printf "AIDE_TTY_READY\\n"; IFS= read -r answer </dev/tty; printf "AIDE_TTY_REPLY=%s\\n" "$answer"; exit 7';
  const code = `import {executeCommand} from ${JSON.stringify(moduleUrl)}; process.exitCode = await executeCommand(${JSON.stringify(command)});`;
  const probe = fileURLToPath(new URL('./fixtures/terminal-probe.py', import.meta.url));
  const child = spawn('python3', [probe, process.execPath, '--input-type=module', '-e', code], {
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
  assert.equal(result, 7, output);
  assert.match(output, /AIDE_TTY_REPLY=terminal-input-works/);
  assert.doesNotMatch(output, /\[1\] \d+|fg %1|\/bin\/bash --noprofile/, 'job-control internals must not leak into terminal output');
});

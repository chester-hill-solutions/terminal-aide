import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { checkSyntax, commandEnvironment, executeCommand } from '../src/shell.js';

test('Bash syntax checking cannot execute substitutions or a startup script', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-syntax-'));
  try {
    const startup = join(directory, 'startup');
    await writeFile(startup, 'touch "$MARKER"\n');
    const env = { ...process.env, BASH_ENV: startup, MARKER: join(directory, 'startup-ran') };
    checkSyntax('printf "%s" "$(touch command-ran)"', { cwd: directory, env });
    await assert.rejects(access(join(directory, 'command-ran')));
    await assert.rejects(access(env.MARKER));
    assert.throws(() => checkSyntax('if then', { cwd: directory, env }), /invalid Bash syntax/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('approved commands execute in the requested cwd without the API key or Bash startup hooks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-execution-'));
  try {
    const startup = join(directory, 'startup');
    await writeFile(startup, 'touch startup-ran\n');
    const env = { ...process.env, AIDE_OPENROUTER_API_KEY: 'aide-secret', OPENROUTER_API_KEY: 'secret', BASH_ENV: startup, ENV: startup };
    const command = 'printf "%s\\n%s\\n%s" "$PWD" "${AIDE_OPENROUTER_API_KEY-unset}" "${OPENROUTER_API_KEY-unset}" > "result with spaces"';
    assert.equal(await executeCommand(command, { cwd: directory, env }), 0);
    const result = await readFile(join(directory, 'result with spaces'), 'utf8');
    // macOS canonicalizes /var to /private/var in PWD.
    assert.ok(result.endsWith(`${directory}\nunset\nunset`) || result.endsWith(`${directory.replace(/^\/var\//, '/private/var/')}\nunset\nunset`));
    await assert.rejects(access(join(directory, 'startup-ran')));
    assert.equal(await executeCommand('false | true', { cwd: directory, env }), 1, 'pipefail must preserve failure');
    assert.equal(await executeCommand('exit 23', { cwd: directory, env }), 23);
    assert.equal(await executeCommand('if (: >&3) 2>/dev/null; then exit 99; fi', { cwd: directory, env }), 0,
      'the approved command cannot write to the private supervisor control descriptor');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('removes exported Bash functions while preserving normal command environment', () => {
  assert.deepEqual(commandEnvironment({ PATH: '/bin', HOME: '/home/test', AIDE_OPENROUTER_API_KEY: 'aide-secret', OPENROUTER_API_KEY: 'secret',
    BASH_ENV: '/malicious', ENV: '/malicious', SHELLOPTS: 'xtrace', BASHOPTS: 'extdebug',
    'BASH_FUNC_scp%%': '() { echo replaced; }' }), { PATH: '/bin', HOME: '/home/test' });
});

test('a cancelled command never spawns Bash', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeCommand('exit 0', { signal: controller.signal }), /abort/i);
});

async function waitForFile(file) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { await access(file); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(5);
  }
  throw new Error('Command did not reach its ready state.');
}

for (const ignoresInterrupt of [false, true]) {
  test(`cancellation stops started work before returning (ignores interrupt: ${ignoresInterrupt})`, { timeout: 5000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aide-cancel-'));
    const controller = new AbortController();
    try {
      const script = `${ignoresInterrupt ? "trap '' INT TERM; " : ''}printf ready > ready; sleep 0.7; printf continued > after-cancellation`;
      const outcome = executeCommand(script, { cwd: directory, signal: controller.signal }).then(
        code => ({ code }), error => ({ error }),
      );
      await waitForFile(join(directory, 'ready'));
      controller.abort();
      assert.equal((await outcome).error?.name, 'AbortError');
      await delay(800);
      await assert.rejects(access(join(directory, 'after-cancellation')), { code: 'ENOENT' });
    } finally {
      controller.abort();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

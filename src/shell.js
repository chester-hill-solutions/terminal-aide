import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:os';

export const BASH = '/bin/bash';

export function commandEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !['AIDE_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY', 'BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS'].includes(key) &&
    !key.startsWith('BASH_FUNC_'),
  ));
}

export function checkSyntax(command, { cwd, env = process.env } = {}) {
  const result = spawnSync(BASH, ['--noprofile', '--norc', '-n', '-c', command], {
    cwd,
    env: commandEnvironment(env),
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 65536,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) throw new Error('Could not validate the command. Aide requires /bin/bash on macOS or Linux.');
  if (result.status !== 0) throw new Error('The proposed command has invalid Bash syntax. Nothing was run; try again.');
}

export async function executeCommand(command, { cwd, env = process.env, signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(BASH, ['--noprofile', '--norc', '-o', 'pipefail', '-c', command], {
      cwd,
      env: commandEnvironment(env),
      stdio: 'inherit',
      signal,
      killSignal: 'SIGINT',
    });
    child.once('error', (error) => {
      if (signal?.aborted) reject(signal.reason);
      else reject(new Error('Could not start /bin/bash to run the command.', { cause: error }));
    });
    child.once('exit', (code, exitSignal) => resolve(code ?? (128 + (constants.signals[exitSignal] ?? 1))));
  });
}

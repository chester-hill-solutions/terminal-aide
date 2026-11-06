import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

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
  if (result.status !== 0) throw new SyntaxError('The proposed command has invalid Bash syntax. Nothing was run; try again.');
}

export async function executeCommand(command, { cwd, env = process.env, signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Job control creates a command process group in the existing terminal session.
    // Unlike detached spawning, this preserves /dev/tty for ssh, scp and sudo.
    const launcher = 'set -m\nexec 4>&2\n{ "$1" "$2" "$3" 2>&4 4>&- & } 2>/dev/null\nprintf "%s\\n" "$!" >&3\nexec 4>&-\nfg %1 >/dev/null 2>&1';
    const interactive = process.stdin.isTTY ? ['-i'] : [];
    const supervisor = fileURLToPath(new URL('./command-supervisor.js', import.meta.url));
    const child = spawn(BASH, ['--noprofile', '--norc', ...interactive, '-c', launcher, 'aide', process.execPath, supervisor, command], {
      cwd,
      env: commandEnvironment(env),
      stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
    });
    let group;
    let announcement = '';
    let escalation;
    let interrupted = false;
    const cancelled = () => signal?.aborted || interrupted;
    const killGroup = (name) => {
      if (!group) return;
      try { process.kill(-group, name); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const onAbort = () => {
      if (!group || escalation) return;
      killGroup('SIGINT');
      escalation = setTimeout(() => killGroup('SIGKILL'), 250);
    };
    child.stdio[3].on('data', chunk => {
      announcement += chunk;
      let end;
      while ((end = announcement.indexOf('\n')) !== -1) {
        const line = announcement.slice(0, end);
        announcement = announcement.slice(end + 1);
        if (!group && /^\d+$/.test(line)) group = Number(line);
        else if (line === 'INT') interrupted = true;
        if (cancelled()) onAbort();
      }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(escalation);
    };
    child.once('error', (error) => {
      cleanup();
      reject(new Error('Could not start /bin/bash to run the command.', { cause: error }));
    });
    child.once('close', (code, exitSignal) => {
      cleanup();
      if (cancelled()) {
        // A foreground job can exit while an interrupt-ignoring descendant remains.
        killGroup('SIGKILL');
        if (signal?.aborted) reject(signal.reason);
        else resolve(130);
      } else resolve(code ?? (128 + (constants.signals[exitSignal] ?? 1)));
    });
    if (signal?.aborted) onAbort();
  });
}

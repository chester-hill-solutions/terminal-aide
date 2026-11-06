import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { dirname } from 'node:path';

export function runSandboxed(command, root) {
  if (platform() !== 'darwin') throw new Error('Command evaluation requires macOS sandbox-exec. No unsandboxed fallback is permitted.');
  const path = JSON.stringify(root);
  const parents = [];
  for (let current = dirname(root); ; current = dirname(current)) {
    parents.push(`(literal ${JSON.stringify(current)})`);
    if (current === '/') break;
  }
  const profile = `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow file-map-executable)
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (subpath "/System") (subpath "/usr/bin") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/bin") (subpath "/dev/fd") (subpath ${path}) ${parents.join(' ')} (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (subpath ${path}) (literal "/dev/null"))
(deny file-link)`;
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/bash', '--noprofile', '--norc', '-c',
    'ulimit -t 2 -f 2048; exec /bin/bash --noprofile --norc -o pipefail -c "$1"', 'aide-eval', command], {
    cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, killSignal: 'SIGKILL', detached: true,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: `${root}/.eval-home`, TMPDIR: `${root}/.eval-tmp`, LANG: 'C', LC_ALL: 'C' },
  });
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (result.error) throw new Error(`Sandbox execution failed: ${result.error.code}`);
  if (/sandbox_apply|error:.*sandbox|unknown operation/i.test(result.stderr)) throw new Error('The OS sandbox could not be applied.');
  return result;
}

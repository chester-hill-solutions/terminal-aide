import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { constants } from 'node:os';

// The supervisor shares the command's foreground process group. Report terminal
// interrupts to Aide's private control pipe even if the command ignores them.
// The actual Bash command inherits only stdin/stdout/stderr, never that pipe.
let interrupted = false;
const reportInterrupt = () => {
  if (interrupted) return;
  interrupted = true;
  writeSync(3, 'INT\n');
};
process.on('SIGINT', reportInterrupt);
process.on('SIGTERM', reportInterrupt);

const child = spawn('/bin/bash', ['--noprofile', '--norc', '-o', 'pipefail', '-c', process.argv[2]], { stdio: 'inherit' });
child.once('error', () => { process.exitCode = 1; });
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (128 + (constants.signals[signal] ?? 1));
});

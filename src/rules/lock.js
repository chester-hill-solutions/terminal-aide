import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function withRulesLock(file, update, { timeoutMs = 2000 } = {}) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const lockFile = `${file}.lock`;
  const started = performance.now();
  let lock;
  while (!lock) {
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (performance.now() - started >= timeoutMs) {
        throw new Error(`Another Aide process is updating these rules. Retry after it finishes. If it stopped unexpectedly, confirm it has exited before removing ${lockFile}.`, { cause: error });
      }
      await delay(10);
    }
  }
  try { return await update(); }
  finally {
    try { await lock.close(); }
    finally { await unlink(lockFile); }
  }
}

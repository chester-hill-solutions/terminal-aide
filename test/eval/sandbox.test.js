import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { runSandboxed } from '../../eval/sandbox.js';

const enabled = platform() === 'darwin' && process.env.AIDE_SANDBOX_TESTS === '1';

test('evaluation sandbox blocks outside reads, writes, links and network requests', { skip: !enabled }, async () => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'aide-sandbox-boundary-')));
  const root = join(outside, 'fixture');
  let requests = 0;
  const server = createServer((request, response) => { requests++; response.end('reachable'); });
  try {
    await mkdir(root);
    await writeFile(join(outside, 'private.txt'), 'outside data');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(url)).text(), 'reachable');
    requests = 0;
    const read = runSandboxed(`cat ${JSON.stringify(join(outside, 'private.txt'))}`, root);
    assert.notEqual(read.status, 0);
    assert.equal(read.stdout, '');
    assert.notEqual(runSandboxed(`printf escaped > ${JSON.stringify(join(outside, 'escaped'))}`, root).status, 0);
    await assert.rejects(access(join(outside, 'escaped')), { code: 'ENOENT' });
    assert.notEqual(runSandboxed(`ln ${JSON.stringify(join(outside, 'private.txt'))} ./linked`, root).status, 0);
    assert.notEqual(runSandboxed(`curl --max-time 1 ${url}`, root).status, 0);
    await delay(20);
    assert.equal(requests, 0, 'sandboxed command must not reach the listening server');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(outside, { recursive: true, force: true });
  }
});

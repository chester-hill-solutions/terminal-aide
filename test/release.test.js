import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const release = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));

test('release publishing is version-bound, immutable, and verifies the distributed tarball', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-release-'));
  const bytes = Buffer.from('a disposable npm artifact');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const sha = 'a'.repeat(40);
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'git'), '#!/bin/sh\nprintf "%s\\n" "$AIDE_TEST_RELEASE_SHA"\n', { mode: 0o755 });
    await writeFile(join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AIDE_TEST_PUBLISH_LOG"\n', { mode: 0o755 });
    const preload = join(directory, 'fetch.mjs');
    await writeFile(preload, `
      import timers from 'node:timers/promises';
      import { syncBuiltinESMExports } from 'node:module';
      timers.setTimeout = async () => {};
      syncBuiltinESMExports();
      const fixture = JSON.parse(process.env.AIDE_TEST_RELEASE_FIXTURE);
      let requests = 0;
      globalThis.fetch = async (url) => {
        if (String(url).endsWith('.tgz')) return new Response(Buffer.from(fixture.data, 'base64'));
        requests++;
        if (fixture.mode === 'new' && requests === 1) return new Response('', { status: 404 });
        if (fixture.mode === 'processing' && requests < 4) return new Response('', { status: 404 });
        if (fixture.mode === 'processing-timeout') return new Response('', { status: 404 });
        if (fixture.mode === 'http-error') return new Response('', { status: 503 });
        return Response.json(fixture.metadata);
      };
    `);
    for (const mode of ['existing', 'new', 'processing', 'processing-timeout', 'wrong-commit', 'bad-integrity', 'http-error', 'wrong-tag']) {
      const cwd = join(directory, mode);
      await mkdir(cwd);
      const log = join(cwd, 'publish.log');
      const metadata = {
        name: manifest.name, version: manifest.version, gitHead: mode === 'wrong-commit' ? 'b'.repeat(40) : sha,
        dist: { tarball: 'https://registry.npmjs.org/test.tgz', integrity: mode === 'bad-integrity' ? 'sha512-bad' : integrity },
      };
      const result = spawnSync(process.execPath, ['--import', preload, release, mode === 'wrong-tag' ? 'v0.0.0' : `v${manifest.version}`], {
        cwd, encoding: 'utf8', timeout: 5000, env: {
          ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, AIDE_TEST_RELEASE_SHA: sha,
          AIDE_TEST_PUBLISH_LOG: log, AIDE_TEST_RELEASE_FIXTURE: JSON.stringify({ mode, metadata, data: bytes.toString('base64') }),
        },
      });
      const success = ['existing', 'new', 'processing'].includes(mode);
      assert.equal(result.status, success ? 0 : 1, `${mode}: ${result.stderr}`);
      const files = await readdir(cwd);
      const archives = files.filter((file) => file.endsWith('.tgz'));
      assert.equal(archives.length, success ? 1 : 0, mode);
      if (success) assert.deepEqual(await readFile(join(cwd, archives[0])), bytes);
      const published = ['new', 'processing', 'processing-timeout'].includes(mode);
      assert.equal(files.includes('publish.log'), published, 'only a missing version should be published');
      if (published) assert.equal((await readFile(log, 'utf8')).trim(), 'publish --access public --provenance --ignore-scripts', 'publish is never repeated during processing');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

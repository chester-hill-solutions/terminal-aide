import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { checkBaseline, observeBaseline, parseRatchetBaseline } from '@chester-hill-solutions/ratchet-strap';

async function previousBaseline(root, ref) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref)) throw new Error('QUALITY_BASE_REF must be a Git revision or ref name.');
  const exists = spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
  if (exists.status !== 0) throw new Error(`Cannot resolve trusted quality predecessor ${ref}. Fetch the base history.`);
  const listing = spawnSync('git', ['ls-tree', '--name-only', ref, '--', '.ratchet-strap.json'], { cwd: root, encoding: 'utf8' });
  if (listing.status !== 0) throw new Error('Cannot inspect the trusted quality predecessor.');
  if (!listing.stdout.trim()) return undefined; // Initial adoption has no prior baseline.
  const result = spawnSync('git', ['show', `${ref}:.ratchet-strap.json`], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot read the trusted quality predecessor.');
  return parseRatchetBaseline(JSON.parse(result.stdout));
}

export async function checkQuality({ root = process.cwd(), previous, baseRef } = {}) {
  const baseline = parseRatchetBaseline(JSON.parse(await readFile(resolve(root, '.ratchet-strap.json'), 'utf8')));
  const eslint = new ESLint({ cwd: root, overrideConfigFile: fileURLToPath(new URL('./eslint.config.mjs', import.meta.url)) });
  const reports = await eslint.lintFiles(['.']);
  const trusted = previous ?? (baseRef ? await previousBaseline(root, baseRef) : undefined);
  const result = checkBaseline(baseline, observeBaseline(baseline, reports, root), trusted);
  const formatter = await eslint.loadFormatter('stylish');
  return { ...result, lint: formatter.format(reports), predecessor: baseRef ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await checkQuality({ baseRef: process.env.QUALITY_BASE_REF ?? 'HEAD' });
    if (result.lint) process.stderr.write(result.lint);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Quality gate failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

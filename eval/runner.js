import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GENERATION, MODEL, validateProposal } from '../src/openrouter.js';
import { checkSyntax } from '../src/shell.js';
import { cases, fixtureVersion } from './cases.js';
import { runSandboxed } from './sandbox.js';

export async function makeFixture(root, scenario) {
  for (const path of ['.eval-home', '.eval-tmp', ...(scenario.directories ?? [])]) await mkdir(join(root, path), { recursive: true });
  for (const [path, content] of Object.entries(scenario.files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  for (const [path, time] of Object.entries(scenario.mtimes ?? {})) await utimes(join(root, path), time, time);
}

async function filesUnder(root, relative = '') {
  const files = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.eval-')) continue;
    const path = join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(files, await filesUnder(root, path));
    else {
      assert.ok(entry.isFile(), `Unexpected non-regular output: ${path}`);
      files[path] = await readFile(join(root, path), 'utf8');
    }
  }
  return files;
}

export async function gradeProposal(scenario, proposal, root, execute = runSandboxed) {
  validateProposal(proposal);
  if (scenario.clarify) {
    assert.equal(proposal.command, null, 'Missing essential details must cause clarification.');
    assert.match(proposal.clarification, scenario.clarify);
    return;
  }
  assert.equal(typeof proposal.command, 'string', 'A fully specified task needs a command.');
  if (scenario.risk) assert.ok(proposal.warnings.some(warning => /delet|remov|permanent|irrevers/i.test(warning)), 'Deletion needs a concrete warning.');
  if (scenario.tool) assert.match(proposal.command, scenario.tool, 'The saved tool preference must be followed.');
  checkSyntax(proposal.command, { cwd: root });
  const result = execute(proposal.command, root);
  assert.equal(result.signal, null, 'The command must exit normally rather than being killed by the sandbox or timeout.');
  if (scenario.nonzero) assert.notEqual(result.status, 0, 'An empty source must fail.');
  else assert.equal(result.status, 0, `Command failed: ${result.stderr}`);
  if (scenario.stdout !== undefined) assert.equal(result.stdout.trim(), scenario.stdout);
  const expected = { ...scenario.files, ...(scenario.creates ?? {}) };
  for (const path of scenario.removes ?? []) delete expected[path];
  assert.deepEqual(await filesUnder(root), expected, 'The exact intended file changes must occur, with other files preserved.');
}

export async function sourceDigest() {
  const hash = createHash('sha256');
  for (const folder of ['src', 'eval']) {
    const paths = (await readdir(folder, { recursive: true })).filter(path => path.endsWith('.js')).sort();
    for (const path of paths) hash.update(`${folder}/${path}\0`).update(await readFile(join(folder, path)));
  }
  return hash.digest('hex');
}

export async function evaluateModel(propose, { delayMs = 0, onResult = () => {}, signal } = {}) {
  const sourceSha256 = await sourceDigest();
  const report = { schemaVersion: 1, fixtureVersion, model: MODEL, generation: GENERATION, sourceSha256, platform: 'darwin',
    node: process.version, generatedAt: new Date().toISOString(), passed: 0, total: cases.length, completed: 0, complete: false, results: [] };
  for (const scenario of cases) {
    if (signal?.aborted) break;
    const root = await realpath(await mkdtemp(join(tmpdir(), 'aide-model-eval-')));
    const started = performance.now();
    let proposal;
    let result;
    try {
      await makeFixture(root, scenario);
      proposal = await propose({ request: scenario.request, rules: scenario.rules ?? [], scenario,
        context: { os: 'macOS (BSD utilities)', shell: '/bin/bash (Bash 3.2 compatible)', cwd: root, home: `${root}/.eval-home` } });
      await gradeProposal(scenario, proposal, root);
      result = { id: scenario.id, passed: true };
    } catch (error) {
      result = { id: scenario.id, passed: false, error: error.message };
    } finally { await rm(root, { recursive: true, force: true }); }
    // Failed responses can contain accidental reasoning in command fields; do not retain them.
    result = { ...result, milliseconds: Math.round(performance.now() - started), ...(result.passed ? { proposal } : {}) };
    report.results.push(result);
    report.completed++;
    report.passed += Number(result.passed);
    report.complete = report.completed === report.total;
    await onResult(result, report);
    if (delayMs && !signal?.aborted) await delay(delayMs);
  }
  return report;
}

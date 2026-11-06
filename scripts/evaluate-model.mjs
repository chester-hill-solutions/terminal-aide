import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { proposeCommand } from '../src/openrouter.js';
import { evaluateModel } from '../eval/runner.js';

const { values } = parseArgs({ options: {
  'self-test': { type: 'boolean' }, output: { type: 'string', default: '.local/model-evaluation.json' },
  'delay-ms': { type: 'string', default: '0' },
} });
const delayMs = Number(values['delay-ms']);
if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('--delay-ms must be a nonnegative integer.');
const apiKey = process.env.AIDE_OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();
if (!values['self-test'] && !apiKey) throw new Error('Set AIDE_OPENROUTER_API_KEY to evaluate live model output.');
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
const mode = values['self-test'] ? 'reference-self-test' : 'live';
await mkdir(dirname(values.output), { recursive: true });
const persist = report => writeFile(values.output, `${JSON.stringify({ ...report, mode, requiredPassRate: 1 }, null, 2)}\n`);
const propose = values['self-test']
  ? async ({ scenario }) => ({ command: scenario.clarify ? null : scenario.reference, explanation: 'Synthetic reference proposal.',
    warnings: scenario.risk ? ['This deletes the requested file.'] : [], clarification: scenario.clarify ? 'Which file, host, or destination?' : null })
  : ({ scenario: _scenario, ...input }) => proposeCommand({ ...input, apiKey, signal: controller.signal });
const report = await evaluateModel(propose, { delayMs, signal: controller.signal, onResult: async (result, progress) => {
  process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}${result.error ? `: ${result.error}` : ''}\n`);
  await persist(progress);
} });
await persist(report);
process.removeListener('SIGINT', cancel);
process.removeListener('SIGTERM', cancel);
process.stdout.write(`${report.passed}/${report.total} passed (${mode}, ${report.complete ? 'complete' : 'interrupted'}). Report: ${values.output}\n`);
process.exitCode = report.complete && report.passed === report.total ? 0 : 1;

#!/usr/bin/env node

import { runCli } from '../src/cli.js';

const controller = new AbortController();
const onSignal = () => controller.abort();
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

try {
  process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal });
} finally {
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
}

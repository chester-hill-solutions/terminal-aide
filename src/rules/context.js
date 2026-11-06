import { realpath, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { loadRules, rulesFile } from './manager.js';
import { MAX_PROMPT_RULE_BYTES, selectRules } from './selection.js';

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

export async function projectRulesFile(cwd) {
  const start = await realpath(cwd);
  let directory = start;
  let manifestRoot;
  let rulesRoot;
  while (true) {
    if (!rulesRoot && await exists(join(directory, '.aide', 'rules.json'))) rulesRoot = directory;
    if (await exists(join(directory, '.git'))) return join(rulesRoot ?? directory, '.aide', 'rules.json');
    if (!manifestRoot) {
      const markers = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
      if ((await Promise.all(markers.map((name) => exists(join(directory, name))))).some(Boolean)) manifestRoot = directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      const localRules = rulesRoot && (!manifestRoot || rulesRoot === manifestRoot || rulesRoot.startsWith(`${manifestRoot}${sep}`));
      return join(localRules ? rulesRoot : manifestRoot ?? start, '.aide', 'rules.json');
    }
    directory = parent;
  }
}

export async function loadRuleContext({ cwd, env, home }) {
  const globalFile = rulesFile({ env, home });
  const projectFile = await projectRulesFile(cwd);
  const [globalRules, projectRules] = await Promise.all([loadRules(globalFile), loadRules(projectFile)]);
  const entries = [
    ...globalRules.map((rule, index) => ({ rule, scope: 'global', index })),
    ...projectRules.map((rule, index) => ({ rule, scope: 'project', index })),
  ];
  return { entries, globalFile, projectFile };
}

export function inspectRules(context, request) {
  const selection = selectRules(context.entries, request);
  const lines = selection.selected.map(({ scope, index, when, text }) => `${scope} #${index + 1} [${when.join(',')}]: ${text}`);
  const counts = {};
  for (const { reason } of selection.skipped) counts[reason] = (counts[reason] ?? 0) + 1;
  const skipped = Object.entries(counts).map(([reason, count]) => `${count} ${reason}`).join(', ');
  return `Active rules: ${selection.rules.length}, ${selection.bytes}/${MAX_PROMPT_RULE_BYTES} bytes\n${lines.length ? `${lines.join('\n')}\n` : 'No rules apply.\n'}${skipped ? `Skipped: ${skipped}\n` : ''}`;
}

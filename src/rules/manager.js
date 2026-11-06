import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { withRulesLock } from './lock.js';
import { parseConditions, promptRuleBytes, ruleConditions, ruleText, selectRules, validateStoredRules } from './selection.js';
export { validateRules } from './selection.js';

export function rulesFile({ env = process.env, home = homedir() } = {}) {
  const root = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(root, 'terminal-aide', 'rules.json');
}

export async function loadRules(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Could not read rules at ${file}. Check the file permissions.`, { cause: error });
  }
  try {
    return validateStoredRules(JSON.parse(text));
  } catch (error) {
    throw new Error(`Invalid rules file at ${file}. ${error instanceof SyntaxError ? 'Expected a JSON array of rule strings.' : error.message}`, { cause: error });
  }
}

export async function saveRules(file, rules) {
  validateStoredRules(rules);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(rules, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function parseRulesArgs(args) {
  let project = false;
  let when;
  let cursor = 0;
  while (cursor < args.length) {
    if (args[cursor] === '--project') { project = true; cursor++; }
    else if (args[cursor] === '--when' || args[cursor] === '--always') {
      if (when) throw new Error('Use either --always or --when once per rule.');
      if (args[cursor] === '--always') { when = ['general']; cursor++; }
      else { when = parseConditions(args[cursor + 1]); cursor += 2; }
    } else break;
  }
  args = args.slice(cursor);
  const modifiers = { ...(project ? { project: true } : {}), ...(when ? { when } : {}) };
  if (args[0] === '--for') {
    if (project || when) throw new Error('--rules --for inspects both global and project rules. Use it without --project or --when.');
    const request = args.slice(1).join(' ').trim();
    if (!request) throw new Error('Provide a request after --rules --for.');
    return { action: 'inspect', request };
  }
  if (when && (!args.length || ['--clear', '--remove'].includes(args[0]))) throw new Error('--when and --always require a rule to save.');
  if (args.length === 0) return { action: 'list', ...modifiers };
  if (args[0] === '--clear' && args.length === 1) return { action: 'clear', ...modifiers };
  if (args[0] === '--remove') {
    if (args.length !== 2 || !/^[1-9]\d*$/.test(args[1]) || !Number.isSafeInteger(Number(args[1]))) {
      throw new Error('Use aide --rules --remove <rule number>. View numbers with aide --rules.');
    }
    return { action: 'remove', index: Number(args[1]) - 1, ...modifiers };
  }
  if (args[0] === '--') args = args.slice(1);
  else if (args[0].startsWith('-')) throw new Error('Unknown rules option. Use aide --rules, --rules --remove <number>, or --rules --clear.');
  const rule = args.join(' ').trim();
  validateStoredRules([when ? { text: rule, when } : rule]);
  if (promptRuleBytes([rule]) > 2000) throw new Error('That rule exceeds the 2000-byte prompt budget. Shorten the instruction.');
  return { action: 'add', rule, ...modifiers };
}

async function updateRules(command, file) {
  if (command.action === 'clear') {
    await saveRules(file, []);
    return 'Cleared saved rules.\n';
  }
  const rules = await loadRules(file);
  if (command.action === 'add') {
    const entry = command.when ? { text: command.rule, when: command.when } : command.rule;
    const existing = rules.findIndex((rule) => ruleText(rule) === command.rule && JSON.stringify(ruleConditions(rule)) === JSON.stringify(ruleConditions(entry)));
    if (existing !== -1) return `Rule #${existing + 1} is already saved.\n`;
    const next = [...rules, entry];
    selectRules(next.map((rule, index) => ({ rule, scope: 'global', index })), '');
    await saveRules(file, next);
    return `Saved rule #${rules.length + 1}: ${command.rule}\n`;
  }
  if (command.action === 'remove') {
    if (!Number.isInteger(command.index) || command.index < 0 || command.index >= rules.length) throw new Error('That rule number does not exist. View saved rules with aide --rules.');
    const [removed] = rules.splice(command.index, 1);
    await saveRules(file, rules);
    return `Removed rule: ${ruleText(removed)}\n`;
  }
  throw new Error('Unknown rules action. Use aide --help.');
}

export async function manageRules(command, file) {
  if (command.action === 'list') {
    const rules = await loadRules(file);
    return rules.length
      ? `Saved rules:\n${rules.map((rule, index) => `${index + 1}. [${ruleConditions(rule).join(',')}] ${ruleText(rule)}`).join('\n')}\n`
      : 'No saved rules. Add one with: aide --rules "use zipgrep for search"\n';
  }
  return withRulesLock(file, () => updateRules(command, file));
}

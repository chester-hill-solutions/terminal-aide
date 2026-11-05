import { homedir, platform } from 'node:os';
import { readFileSync } from 'node:fs';
import { MODEL, proposeCommand, validateProposal, visibleText } from './openrouter.js';
import { checkSyntax, executeCommand } from './shell.js';
import { createTerminal } from './terminal.js';
import { manageRules, parseRulesArgs, rulesFile } from './rules.js';
import { inspectRules, loadRuleContext, projectRulesFile } from './rule-context.js';
import { selectRules } from './rule-selection.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `aide — plain language → Bash → your confirmation

Usage:
  aide [--dry-run] <plain language request>
  aide                         Prompt for a request
  aide --rules [instruction]    Save a rule, or list saved rules

Options (before the request):
  -n, --dry-run                 Show a proposal without running it
  --rules <instruction>         Save a standing command preference
  --rules                      List saved rules
  --rules --remove <number>     Remove a saved rule
  --rules --clear               Remove all saved rules
  --rules --when <topic> <rule>  Apply a rule only to matching tasks
  --rules --always <rule>        Keep a general rule active
  --rules --project [rule]       Save/list rules for this project
  --rules --for <request>        Inspect which rules would apply
  -h, --help                    Show this help
  -v, --version                 Show the version
  --                           End options

Examples:
  aide list the 10 largest files in downloads
  aide scp to 10.0.0.38 the newest file in downloads to documents/frank
  aide --dry-run "find .log files modified in the last week"
  aide --rules use zipgrep for search

Set AIDE_OPENROUTER_API_KEY to use ${MODEL} through OpenRouter.
OPENROUTER_API_KEY is also supported as a fallback.
Commands require an interactive terminal and an explicit y. No auto-run option.
Quote requests containing shell characters such as *, $, >, |, or backticks.
`;

export function parseArgs(args) {
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--rules') {
      if (dryRun) throw new Error('--dry-run cannot be combined with --rules.');
      return { rules: parseRulesArgs(args.slice(i + 1)) };
    }
    if (arg === '--') return { dryRun, request: args.slice(i + 1).join(' ').trim() };
    if (arg === '--dry-run' || arg === '-n') { dryRun = true; continue; }
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--version' || arg === '-v') return { version: true };
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${visibleText(arg)}. Use aide --help.`);
    return { dryRun, request: args.slice(i).join(' ').trim() };
  }
  return { dryRun, request: '' };
}

export async function runCli(args, {
  env = process.env,
  cwd = process.cwd(),
  home = homedir(),
  os = platform(),
  signal,
  terminal = createTerminal({ signal }),
  propose = proposeCommand,
  syntax = checkSyntax,
  execute = executeCommand,
} = {}) {
  const write = (text) => terminal.write(text);
  const format = (text, role) => terminal.format?.(text, role) ?? text;
  try {
    const options = parseArgs(args);
    if (options.help) { write(HELP); return 0; }
    if (options.version) { write(`${VERSION}\n`); return 0; }
    const file = rulesFile({ env, home });
    if (options.rules) {
      if (options.rules.action === 'inspect') {
        write(inspectRules(await loadRuleContext({ cwd, env, home }), options.rules.request));
      } else {
        const target = options.rules.project ? await projectRulesFile(cwd) : file;
        write(await manageRules(options.rules, target));
      }
      return 0;
    }
    if (!['darwin', 'linux'].includes(os)) throw new Error('Aide requires macOS or Linux with /bin/bash.');
    if (!options.dryRun && !terminal.isInteractive) {
      throw new Error('Running a command requires an interactive terminal for confirmation. Use --dry-run to preview.');
    }
    let request = options.request;
    if (!request) {
      if (!terminal.isInteractive) throw new Error('Provide a request after --dry-run. Use aide --help for examples.');
      request = (await terminal.ask(format('What would you like to do? ', 'prompt')))?.trim();
      if (!request) { write('Cancelled. Nothing was run.\n'); return 0; }
    }
    if (request.length > 16000) throw new Error('Keep your request under 16,000 characters.');
    const apiKey = env.AIDE_OPENROUTER_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('Set AIDE_OPENROUTER_API_KEY first. Create a key at https://openrouter.ai/settings/keys.');
    }
    const ruleContext = await loadRuleContext({ cwd, env, home });
    const context = {
      os: os === 'darwin' ? 'macOS (BSD utilities)' : 'Linux (GNU utilities)',
      shell: '/bin/bash (Bash 3.2 compatible)',
      cwd,
      home,
    };
    const followups = [];
    let proposal;
    for (let attempt = 0; attempt <= 5; attempt++) {
      signal?.throwIfAborted();
      const stopSpinner = terminal.spin?.() ?? (() => {});
      try {
        const { rules } = selectRules(ruleContext.entries, request, followups);
        proposal = validateProposal(await propose({ request, context, followups, rules, apiKey, signal }));
        signal?.throwIfAborted();
      } finally {
        stopSpinner();
      }
      if (proposal.command !== null) break;
      if (attempt === 5) throw new Error('More details are still needed. Try a more specific request.');
      write(`${proposal.explanation}\n`);
      if (!terminal.isInteractive) throw new Error(`More information needed: ${proposal.clarification}`);
      const answer = (await terminal.ask(format(`${proposal.clarification}\n> `, 'prompt')))?.trim();
      if (!answer) { write('Cancelled. Nothing was run.\n'); return 0; }
      if (answer.length > 16000) throw new Error('Keep your answer under 16,000 characters.');
      followups.push({ question: proposal.clarification, answer });
    }
    // Display and execute the exact same string; do not clean or repair model output.
    write(`${proposal.explanation}\n\n${format(proposal.command, 'command')}\n`);
    for (const warning of proposal.warnings) write(`\n${format('Warning:', 'warning')} ${warning}\n`);
    syntax(proposal.command, { cwd, env });
    if (options.dryRun) { write('\nPreview only. Nothing was run.\n'); return 0; }

    const answer = await terminal.ask(format('\nRun it? y/[n]: ', 'prompt'));
    if (!/^(y|yes)$/i.test(answer?.trim() ?? '')) { write('Cancelled. Nothing was run.\n'); return 0; }
    signal?.throwIfAborted();
    // Release readline before the child inherits stdin (scp/ssh/sudo may need it).
    terminal.close();
    write('\n');
    return await execute(proposal.command, { cwd, env, signal });
  } catch (error) {
    if (signal?.aborted) { write('\nCancelled.\n'); return 130; }
    write(`\nError: ${visibleText(error.message ?? 'Something went wrong.')}\n`);
    return 1;
  } finally {
    terminal.close();
  }
}

# Terminal Aide implementation assessment

Terminal Aide is a compact command-generation CLI with a clear approval boundary and substantial automated testing. Its surrounding software is well tested, but actual model command accuracy remains unmeasured. Local experiments reproduced incomplete cancellation, lost concurrent preference updates, and preference selection that misses natural paraphrases.

Assessed on November 5, 2026, against source revision [`c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7`](https://github.com/chester-hill-solutions/terminal-aide/tree/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7), using macOS and Node.js 25.9.0. Findings describe that revision; fixes have not been implemented as part of this assessment.

## Implemented product

The CLI accepts a plain-language request, selects saved global and project preferences, and sends those inputs plus operating system and directory paths to a fixed model through OpenRouter. It can collect follow-up answers before displaying a proposed Bash script, explanation, and warnings. It checks Bash syntax and requires explicit approval before executing the exact displayed script.

After execution, output goes directly to the terminal. There is no feedback step that determines whether the script accomplished the original request. The model receives a limited context rather than project file contents. The user supplies essential details and judges the script before approval. See the [generation and execution flow](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/cli.js#L105).

The inferred best-fit user can review Bash but wants help composing commands. Someone unable to judge a script must rely heavily on the model's explanation and warning completeness, neither of which has a measured success rate here.

## Quantitative results

| Measure | Result | Interpretation |
| --- | --- | --- |
| Runtime code | 768 physical lines across 8 files | Includes blank lines and comments in `bin/` and `src/`; excludes dependencies and scripts |
| Test code | 923 physical lines across 8 files | Includes blank lines and comments in `test/` |
| Existing tests | 56 passed, 0 failed, 0 skipped | All current assertions hold |
| Runtime line coverage | 98.44% | Measured over `bin/**` and `src/**` |
| Runtime branch coverage | 92.48% | Most alternative paths exercised |
| Runtime function coverage | 94.87% | Most functions exercised |
| Syntax check | 19 JavaScript files passed | Checks source, scripts, and tests |
| Direct runtime dependencies | 1 | Not a count of transitive dependencies or a vulnerability assessment |
| Rule selection with 50 saved rules | About 0.022 ms per selection | Mean of 10,000 selections after 1,000 warmups in one local run; excludes filesystem and network time |
| Diagnostic preference matching | 18 of 36 phrases activated the intended preference | Deliberately selected keyword/paraphrase cases; not representative product accuracy |
| Actual model task success | Unmeasured | Model-response tests use fixtures rather than live task outcomes |

Coverage and test results were reconfirmed when this report was saved. The source revision was unchanged. Commands for the existing checks:

```bash
node --test --experimental-test-coverage --test-coverage-include='src/**' --test-coverage-include='bin/**' --test-reporter=spec
npm run check
```

## Qualitative category assessment

Scores are subjective judgments out of ten, supported by the inspected implementation and local behavior. An unverified capability remains unrated.

| Category | Score | Assessment |
| --- | --- | --- |
| Architecture and maintainability | 8 | Small modules separate CLI orchestration, model transport, terminal handling, execution, and preferences. Dependencies can be substituted in tests. |
| Interaction design | 8 | Preview, default refusal, distinct clarification and approval, and dry-run behavior form a clear workflow. Reviewing complex scripts still requires shell knowledge. |
| Defensive validation | 8 | Strict response fields, size limits, hidden-character rejection, syntax checking, and preservation of the displayed script. Format validation does not establish task correctness. |
| Execution safety | 6 | Explicit approval and environment filtering provide meaningful safeguards. Commands retain user permissions, warnings depend on the model, and cancellation has a reproduced defect. |
| Saved preferences | 5 | Scoping, precedence, deduplication, and prompt budgets are useful. Matching is sensitive to wording and concurrent updates can lose changes. |
| Error handling and recovery | 7 | Provider errors, timeouts, malformed-proposal rejection, and bounded format retries are explicit. The integration uses one fixed model and provider route. |
| Test quality | 8 | Tests exercise consequential confirmation, parsing, environment, and persistence behavior. High coverage still misses cancellation after execution starts and concurrent updates. |
| Data minimization | 8 | Generation uses an explicit, limited context. Requests, selected preferences, and directory paths leave the machine. |
| Model effectiveness | Unrated | Correct commands, appropriate clarification, complete warnings, and platform-compatible output have no measured success rate. |

## Reproduced findings

### F1 Cancellation can return while the shell continues

**Priority: high.** The execution abort mechanism signals the Bash process and rejects the caller without ensuring that the shell and its children have finished. In a disposable directory, `sleep 0.3; printf survived > cancellation-marker` was aborted after about 40 ms. The promise rejected with `AbortError` after about 43 ms, but the marker was subsequently written.

The practical problem is a cancellation result that does not guarantee work has stopped. The CLI maps an aborted operation to its cancellation message and exit code. This experiment establishes the problem for the abort mechanism; it does not establish that every terminal Ctrl-C has identical behavior, because terminal signals can also reach child processes.

Source: [execution lifecycle](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/shell.js#L26), [CLI cancellation handling](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/cli.js#L146).

Fix direction: coordinate cancellation of the command process tree and wait for termination before reporting that work has stopped. Add a regression test that aborts after execution begins and checks for subsequent side effects.

### F2 Concurrent preference additions silently lose changes

**Priority: medium.** Ten simultaneous additions all reported success, but only one rule remained. This was reconfirmed using ten search-scoped rules, which can validly coexist in the stored configuration. Each update independently reads, modifies, and replaces the file. Atomic replacement protects against partial files but does not coordinate competing updates.

The practical impact is silent preference loss when multiple CLI processes update the same configuration. Ordinary sequential updates do not establish protection against this race.

Source: [read and modify sequence](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/rules/manager.js#L78), [atomic replacement](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/rules/manager.js#L29).

Fix direction: coordinate the complete read-modify-write operation across processes, or detect conflicting writes and retry against the latest state. Add a concurrent-update regression test.

### F3 Preference matching misses paraphrases and some negative constraints

**Priority: medium.** Topic selection relies on keyword expressions. A transfer preference activates for “copy photos to the server” but not “synchronize photos with the server.” A size preference activates for “show disk usage” but not “how big is this folder.”

The general-negative-rule detector also recognizes ASCII `don't` but misses the curly-apostrophe spelling `Don’t`. “Don’t use grep” consequently becomes search-scoped and is omitted for “scan source files for TODO.” “No network transfers” is likewise omitted for “synchronize photos with the server.” Explicit general rules provide a workaround, but automatic inference is unreliable for these inputs.

Source: [topic expressions](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/rules/selection.js#L4), [condition inference](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/rules/selection.js#L53), [selection](https://github.com/chester-hill-solutions/terminal-aide/blob/c94b6a5a3b25c4b8d147e9ac32f2a2e4a0fcc2f7/src/rules/selection.js#L70).

Fix direction: preserve negative constraints conservatively, normalize ordinary punctuation, and evaluate topic matching against a broader phrase set. Keep rule inspection available so the user can see what was selected.

## Reproduction commands

Run this from the repository root. It uses a disposable directory, passes no API credentials to Bash, and removes its temporary files. Timing and the exact number of rules surviving a race can vary; the observed defect is successful updates disappearing.

```bash
node --input-type=module <<'JS'
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { executeCommand } from './src/shell.js';
import { saveRules, loadRules, manageRules, parseRulesArgs } from './src/rules/manager.js';
import { selectRules } from './src/rules/selection.js';

const directory = await mkdtemp(join(tmpdir(), 'aide-assessment-'));
try {
  const controller = new AbortController();
  const start = performance.now();
  const pending = executeCommand('sleep 0.3; printf survived > cancellation-marker', {
    cwd: directory, env: { PATH: process.env.PATH }, signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(), 40);
  let outcome;
  try { outcome = await pending; }
  catch (error) { outcome = error.name; }
  finally { clearTimeout(timer); }
  const returnMs = Math.round(performance.now() - start);
  await delay(500);
  let continued = false;
  try { await access(join(directory, 'cancellation-marker')); continued = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log({ finding: 'F1', outcome, returnMs, continued });

  const file = join(directory, 'rules.json');
  await saveRules(file, []);
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
    manageRules(parseRulesArgs(['--when', 'search', `Concurrent search preference ${i}`]), file),
  ));
  console.log({ finding: 'F2', successfulAdds: results.filter(r => r.status === 'fulfilled').length,
    storedRules: (await loadRules(file)).length });

  for (const [rule, request] of [
    ['Don’t use grep', 'scan source files for TODO'],
    ['No network transfers', 'synchronize photos with the server'],
  ]) {
    console.log({ finding: 'F3', rule, request,
      selected: selectRules([{ rule, scope: 'global', index: 0 }], request).rules });
  }
} finally { await rm(directory, { recursive: true, force: true }); }
JS
```

## Preference diagnostic dataset

The assessor selected two recognizable keyword phrases and two paraphrases for each built-in topic. The intended preference was selected for the two keyword phrases in every topic and omitted for both paraphrases, giving 18 matches across 36 cases. This is a diagnostic demonstration of known wording gaps, not an estimate of normal task success, precision, or language-model accuracy.

| Topic | Matched phrases | Missed phrases |
| --- | --- | --- |
| Search | search for TODO in source files; grep for TODO in source files | count occurrences of TODO in source files; scan source files for TODO |
| Transfer | copy photos to the server; rsync photos to the server | synchronize photos with the server; mirror photos to the server |
| Sizes | show disk usage; find largest files | how big is this folder; show folder footprint |
| Archive | zip this folder; compress these files | unpack the tarball; bundle this folder into a tgz |
| Network | ping the host; show open ports | show listening sockets; what is my public IP address |
| Process | list running processes; kill PID 1234 | terminate the hung application; stop the background job |
| Git | git status; list repository branches | show uncommitted changes; show staged differences |
| Packages | npm install dependencies; install the package | upgrade outdated libraries; remove an unused dependency |
| Math | calculate 12 times 4; find the square root of 81 | what is 12 times 4; divide 144 by 12 |

Each case checks whether `selectRules` includes a preference explicitly scoped to the expected topic. It does not check the correctness of generated commands.

## Verification gaps and next steps

Fix F1 first, then F2 and the constraint-preservation portion of F3. The next major evaluation need is a real command-quality dataset with observable task outcomes: command correctness, handling of difficult filenames, appropriate clarification, warning completeness, and compatibility across supported platforms. Existing fixtures verify response handling rather than those outcomes. Linux behavior and the minimum supported Node.js version were not exercised in this assessment.

Product documentation and marketing were excluded as evidence. The README had been opened during an earlier skill-discovery task, so this was not a fully blind review. The conclusions above rely on source, test assertions, and local experiments. Subjective ratings and the deliberately selected preference dataset should be interpreted within those limits.

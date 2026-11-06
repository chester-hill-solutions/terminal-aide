# Quality checks and North Mini Code evaluation

Terminal Aide checks software regressions separately from model task outcomes. Offline tests exercise the actual confirmation, execution, persistence, proposal parsing, and counting boundaries. A separate live benchmark measures North Mini Code proposals against disposable filesystem fixtures and exact outcomes.

## Local checks

```bash
npm ci --ignore-scripts
npm run check
npm run test:coverage
npm run pack:check
```

Development uses a current Node 22 release or Node 24 and Python 3 for the standard-library controlling-terminal test. The published CLI has no Python dependency. Coverage includes `src/**` and `bin/**`, with minimums of 98% lines, 90% branches, and 94% functions. The package checker prevents development tools, evaluation captures, and personal configuration from entering the npm artifact.

Tests lock down cancellation after execution starts, forced termination of interrupt-ignoring work, actual `/dev/tty` input, ten concurrent CLI writers, lock contention and release after failure, negative constraints, topic paraphrases, proposal recovery, and portable counting and copying. Compiler tests include hidden files, newline filenames, leading dashes, literal regex characters and backslashes, empty results, missing roots, ambiguous matches, and shell-substitution text in parameters. Typed clarifications cannot include a command.

## RatchetStrap

`scripts/eslint.config.mjs` imports `eslintQualityRulesV1` from the shared `@chester-hill-solutions/ratchet-strap` package. It applies the JavaScript-compatible rules unchanged; TypeScript-only detectors are omitted because this repository is JavaScript. ESLint and its recommended rules are pinned in `package-lock.json`.

`.ratchet-strap.json` uses strict diagnostic identities. A new warning, a suppressed tracked violation, or replacement debt at the same count fails. A repaired diagnostic becomes stale until explicitly tightened. Unsuppressed lint errors always fail. Tests in `test/quality.test.js` plant real violations and prove each gate goes red.

The initial allowance came from source revision `c94b6a5`, not the modified implementation. It contained four complexity diagnostics and five console diagnostics. This work removed two complexity diagnostics and tightened the allowance to seven existing diagnostics. The remaining complexity allowances are `runCli` and `parseRulesArgs`; the five console allowances are existing check/release output. New code received no additional allowance.

After repairing existing debt:

```bash
npm run quality:tighten
git diff -- .ratchet-strap.json
npm run check:quality
```

The check reads `QUALITY_BASE_REF`, defaulting locally to `HEAD`. CI supplies the pull request base SHA or the preceding main revision and fetches full history. Missing or unreadable trusted history fails closed. The first adoption can lack a baseline at the trusted revision; subsequent baseline growth or rule-set substitutions fail against that revision. Detector/configuration upgrades remain explicit review decisions, separate from reducing debt allowances.

RatchetStrap 0.4.0 was not published at adoption time. `tools/vendor/` holds an immutable development tarball built from the existing CHS working-tree source, with its policy bundled from the canonical ESLint-config record. `ratchet-strap-provenance.json` records source/policy/artifact hashes and validation: typecheck, build, 255 tests, and 1,075 assertions. The lockfile pins the tarball integrity. This avoids machine-specific paths and private-registry requirements in public CI. The archive is excluded from the published Terminal Aide package. Replace the file dependency with the corresponding published version once that release is available and verified.

## Model outcome evaluation

First validate the outcome graders and known portable reference commands on macOS:

```bash
npm run eval:self-test
AIDE_SANDBOX_TESTS=1 node --test test/eval/sandbox.test.js
```

Then intentionally evaluate live North Mini Code output using the normal key environment variable:

```bash
npm run eval:model
```

The runner keeps `cohere/north-mini-code:free` fixed. It applies the production schema, terminal-control, typed-parameter, and Bash-syntax checks. Commands execute only under macOS `sandbox-exec`, with a restricted environment, no API key, no network, outside-file access denied, and writes limited to the disposable fixture. Execution time, CPU time, file size, and captured output are bounded. Remaining command-group processes are stopped after each sandbox execution. No unsandboxed fallback is available.

The boundary test verifies that a reachable local HTTP server cannot receive requests from the sandbox and that outside reads, writes, and hard links fail. The reference suite proves that platform startup restrictions do not masquerade as successful command outcomes. An abnormal termination cannot pass a task that expects a nonzero normal exit.

Fixture version 2 has 16 cases: recursive file counts, matching-line counts, spaces/newlines/leading dashes, hidden/newest files, empty inputs, deletion scope and warnings, arithmetic, saved tool preferences, missing host/file clarifications, zero matches, literal regex characters, and selection by modification time rather than name order. Tests check exact stdout and the complete expected file contents, including preservation of unrelated files. Typed counting and single-match copy tools render Bash locally from North's parameters; they never execute during generation. A typed clarification tool obtains missing details without requiring the model to construct nullable command fields. Other tasks retain the general proposal tool.

The benchmark exits unsuccessfully unless every case passes. This is a strict acceptance suite, not a representative general-accuracy estimate. API failures count as failures; reference self-test results are labeled separately from live results. The JSON report records the model, generation settings, fixture version, evaluated source hash, per-case outcome, timings, and whether the run completed. Results are saved after each case, including interrupted runs. Failed raw proposals are not retained because malformed commands can contain accidental model reasoning.

Reports default to `.local/model-evaluation.json`, outside Git and the npm artifact. To save a separately named run:

```bash
npm run eval:model -- --output .local/north-evaluation.json
```

The saved [November 6 result](assessments/2026-11-06-north-mini-code.json) is 15/16 live cases; a newest-file request returned an invalid proposal and was rejected. Its command exited unsuccessfully under the unchanged 16/16 threshold. The [reference run](assessments/2026-11-06-reference-self-test.json) is 16/16. The [development history](assessments/2026-11-06-north-development-history.json) retains earlier complete North runs, with different settings and code. These fixtures informed development and are regression evidence, not a held-out general-accuracy benchmark.

The ordinary CI matrix runs offline checks on Linux and macOS with Node 22 and 24. macOS also runs sandbox boundary checks and the reference suite. An explicitly dispatched live-model job uses the repository's `AIDE_OPENROUTER_API_KEY` secret; a missing key fails instead of producing a fake pass. No recurring live run or credential transfer is configured by this change.

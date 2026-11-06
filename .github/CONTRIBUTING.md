# Contributing

Issues and pull requests are welcome at [chester-hill-solutions/terminal-aide](https://github.com/chester-hill-solutions/terminal-aide).

## Local development

Use Node.js 22 or later on macOS or Linux:

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:coverage
npm run pack:check
npm start -- --help
```

Tests run offline using model fixtures and disposable local directories. An API key is only needed for an intentional live preview. Do not put keys, personal rules, captured user requests, or environment files in a commit or issue.

Keep modules small and use native Node.js APIs where practical. Preserve the exact proposed command through display, syntax checking, confirmation, and execution. Changes to approval, input handling, model parsing, or credentials need regression tests that exercise the actual boundary.

`npm run check` includes the shared RatchetStrap gate. Do not expand `.ratchet-strap.json` to accept a regression. After repairing recorded debt, use `npm run quality:tighten` and review the resulting reductions. The controlling-terminal regression requires Python 3. See [quality checks](../docs/quality.md) for detector versions, trusted predecessors, and live model evaluation. Model fixtures do not establish real command accuracy.

The package checker enforces an allowlist for npm artifacts. Development captures and personal configuration stay outside published source and tarballs.

## Repository layout

```text
.github/         Community policies, issue templates, artwork, and workflows
bin/             Executable entry point
docs/            Changelog, environment reference, assessments, and quality workflow
eval/            Model outcome fixtures, graders, and sandbox execution
scripts/         Syntax, quality, packaging, evaluation, and release checks
src/             CLI, OpenRouter, shell, and terminal modules
  rules/         Rule management, selection, and project context
test/            Offline tests, with rules tests grouped under rules/
tools/vendor/    Pinned development artifacts and their provenance
```

Keep the root limited to README, LICENSE, npm manifests, and required dotfiles. Group related source and tests by feature. Put personal captures, generated previews, and scratch work in `.local/`, which Git ignores and npm excludes. The syntax check discovers JavaScript files recursively in `bin/`, `src/`, `scripts/`, `eval/`, and `test/`.

## Pull requests

Explain the concrete problem and the resulting behavior, then list the checks you ran. For a terminal presentation change, include a short sanitized transcript and check a narrow terminal, plain output, cancellation, and the default-no prompt. Report model-response bugs with a sanitized shape or fixture; never include authorization headers or hidden model reasoning.

Please follow the [community conduct guidelines](CODE_OF_CONDUCT.md). Report vulnerabilities using the [security policy](SECURITY.md).

## Releases

Maintainers use a version in `package.json` matching the `v` tag. `aide --version` reads that manifest.

```bash
npm version patch
git push origin main --follow-tags
```

The release workflow validates the package, publishes a missing version to the public npm registry using npm trusted publishing, and creates a GitHub release with the installable tarball. Already-published versions are left intact.

The npm package's trusted publisher is configured for GitHub organization `chester-hill-solutions`, repository `terminal-aide`, and workflow `release.yml`. Tagged releases authenticate through GitHub Actions OIDC; no long-lived npm token is stored in GitHub Actions. If this trust needs to be restored, use npm package settings or `npm trust github @chester-hill-solutions/terminal-aide --repo chester-hill-solutions/terminal-aide --file release.yml --allow-publish` with npm authentication that supports trust administration.

For the first release or a manual recovery, a maintainer with package publishing permission can run `npm publish --access public` before pushing the version tag. The checked-in `.npmrc` and `publishConfig` target `https://registry.npmjs.org`.

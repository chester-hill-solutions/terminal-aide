# Changelog

## Unreleased

- Group rules source and tests by feature, move supporting documentation out of the repository root, and discover syntax checks recursively. Command behavior is unchanged.

## 0.1.0 — 2026-11-05

Initial public release under `@chester-hill-solutions/terminal-aide`.

- Translate natural-language requests into Bash with North Mini Code through OpenRouter.
- Display an explanation and the complete command, with explicit `Run it? y/[n]:` confirmation.
- Show a temporary generation spinner; support plain output and preview-only mode.
- Ask clarification questions and recover from malformed model responses with one bounded retry.
- Save global and project rules; select them locally with deduplication and a strict context budget.
- Inspect active rules without an API key or a model request.
- Validate proposal data and Bash syntax; isolate API credentials and shell startup hooks from executed commands.
- Support macOS and Linux on Node.js 22 and later.

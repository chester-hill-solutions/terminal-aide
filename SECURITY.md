# Security policy

The latest published release is supported for security fixes.

Use [GitHub private vulnerability reporting](https://github.com/chester-hill-solutions/terminal-aide/security/advisories/new) for a vulnerability, especially one involving execution without approval, misleading command display, terminal-control injection, or credential disclosure. Include a minimal reproduction, affected version, and expected impact. Redact secrets and personal paths. Please allow maintainers to investigate before public disclosure.

For ordinary bugs, use the public issue tracker.

## Execution boundary

Aide is a command translator with human approval. Generated commands run as the current user after confirmation; this is not a sandbox. Schema and syntax validation do not establish that a command is correct or harmless. Rules are generation preferences, not an access-control system. The user remains responsible for reviewing the full command.

The API key is used for OpenRouter authorization and removed from generated commands' environments. Bash startup hooks and exported functions are also removed. Child commands otherwise inherit the user's environment and permissions.

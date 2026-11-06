import { pathArgument, shellQuote, validateParameters } from './proposal-parameters.js';

const definitions = {
  count_files_recursive: 'Propose a command that counts regular files recursively, including hidden files, matching a basename glob. Does not execute anything.',
  count_matching_lines_recursive: 'Propose a command that counts lines containing literal text across matching regular files recursively. Literal text is not a regular expression. Does not execute anything.',
};

export const countingTools = Object.entries(definitions).map(([name, description]) => ({
  type: 'function',
  function: {
    name, description,
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to search, for example . or ./logs. Use ~ or ~/ for the user home directory.' },
        pattern: { type: 'string', description: 'Basename glob such as *.txt or *.log; * matches all filenames.' },
        ...(name === 'count_matching_lines_recursive' ? { literal: { type: 'string', description: 'Exact, case-sensitive text to find within each line. Empty text counts every line.' } } : {}),
      },
      required: name === 'count_matching_lines_recursive' ? ['directory', 'pattern', 'literal'] : ['directory', 'pattern'],
      additionalProperties: false,
    },
  },
}));

export function renderCountingProposal(name, value) {
  if (!Object.hasOwn(definitions, name)) throw new Error('Unknown counting proposal.');
  const fields = name === 'count_matching_lines_recursive' ? ['directory', 'pattern', 'literal'] : ['directory', 'pattern'];
  validateParameters(value, fields, { empty: ['literal'] });
  const find = `find -H ${pathArgument(value.directory)} -type f -name ${shellQuote(value.pattern)}`;
  const command = name === 'count_files_recursive'
    ? `${find} -print0 | tr -cd '\\000' | wc -c`
    : `AIDE_MATCH_TEXT=${shellQuote(value.literal)} ${find} -exec awk 'index($0, ENVIRON["AIDE_MATCH_TEXT"]) {n++} END {print n+0}' {} + | awk '{n += $1} END {print n+0}'`;
  return { command, explanation: name === 'count_files_recursive' ? 'Count matching regular files recursively.' : 'Count lines containing the requested literal text across matching files.', warnings: [], clarification: null };
}


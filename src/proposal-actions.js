import { pathArgument, shellQuote, validateParameters } from './proposal-parameters.js';

export const actionTools = [
  {
    type: 'function', function: {
      name: 'copy_single_matching_file',
      description: 'Propose portable Bash to copy exactly one matching regular file directly in a directory to a destination. Includes hidden files; preserves the source; handles spaces, newlines and leading dashes. Fails for zero or multiple matches. Does not execute anything.',
      parameters: { type: 'object', properties: {
        directory: { type: 'string', description: 'Source directory.' },
        pattern: { type: 'string', description: 'Basename glob such as *.txt, or the exact basename when it has no glob characters.' },
        destination: { type: 'string', description: 'Path to copy the selected file to.' },
      }, required: ['directory', 'pattern', 'destination'], additionalProperties: false },
    },
  },
  {
    type: 'function', function: {
      name: 'request_clarification',
      description: 'Ask a concise clarification when an essential source file, deletion target, server address, or destination is missing. Never invent a target, arbitrary file, or placeholder. Does not execute anything.',
      parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question that obtains the missing detail.' } }, required: ['question'], additionalProperties: false },
    },
  },
];

export function renderActionProposal(name, value) {
  if (name === 'request_clarification') {
    validateParameters(value, ['question']);
    return { command: null, explanation: 'More information is needed before proposing a command.', warnings: [], clarification: value.question };
  }
  if (name !== 'copy_single_matching_file') throw new Error('Unknown proposal action.');
  validateParameters(value, ['directory', 'pattern', 'destination']);
  const command = `shopt -s nullglob dotglob
directory=${pathArgument(value.directory)}
pattern=${shellQuote(value.pattern)}
matches=()
for file in "$directory"/*; do
  [ -f "$file" ] || continue
  case "\${file##*/}" in $pattern) matches[\${#matches[@]}]=$file ;; esac
done
if [ "\${#matches[@]}" -ne 1 ]; then printf '%s\\n' 'Expected exactly one matching regular file.' >&2; exit 1; fi
cp -- "\${matches[0]}" ${pathArgument(value.destination)}`;
  return { command, explanation: 'Copy the single matching regular file and preserve its source.',
    warnings: ['An existing destination file may be overwritten.'], clarification: null };
}

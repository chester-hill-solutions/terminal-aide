// Portable examples teach the proposal protocol without exposing user files or running tools.
export const proposalExamples = [
  {
    request: 'Count regular .csv files recursively under ./records, including hidden files. Print only the count.',
    tool: 'count_files_recursive', arguments: { directory: './records', pattern: '*.csv' },
  },
  {
    request: 'Print the number of lines containing literal ERROR across all .log files under ./records.',
    tool: 'count_matching_lines_recursive', arguments: { directory: './records', pattern: '*.log', literal: 'ERROR' },
  },
  {
    request: 'Copy the newest regular file directly in ./inbox, including hidden files, to ./chosen.dat. Fail if there are none.',
    proposal: { explanation: 'Select by modification time using Bash tests, ignoring directories and failing on an empty source.',
      warnings: ['An existing ./chosen.dat will be overwritten.'], clarification: null,
      command: 'shopt -s nullglob dotglob\nnewest=\nfor file in ./inbox/*; do\n  [ -f "$file" ] || continue\n  if [ -z "$newest" ] || [ "$file" -nt "$newest" ]; then newest=$file; fi\ndone\nif [ -z "$newest" ]; then printf "%s\\n" "No regular files found." >&2; exit 1; fi\ncp -- "$newest" ./chosen.dat' },
  },
  {
    request: 'Copy the only regular .log file directly in ./inbox to ./one.log, preserving the source.',
    tool: 'copy_single_matching_file', arguments: { directory: './inbox', pattern: '*.log', destination: './one.log' },
  },
  {
    request: 'Delete only ./retired.tmp.',
    proposal: { explanation: 'Remove only the specified file.', warnings: ['This permanently deletes ./retired.tmp.'],
      clarification: null, command: 'rm -- ./retired.tmp' },
  },
  {
    request: 'Copy this report to my server using scp.',
    tool: 'request_clarification', arguments: { question: 'Which local report, server address, and destination directory should I use?' },
  },
  {
    request: 'Delete the unwanted file.',
    tool: 'request_clarification', arguments: { question: 'Which exact file or path should I delete?' },
  },
];

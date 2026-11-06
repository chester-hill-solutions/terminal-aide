export const cases = [
  {
    id: 'count-text-files', request: 'Print only the number of regular .txt files recursively under the current directory, including hidden files.',
    files: { '.hidden.txt': 'hidden\n', 'alpha note.txt': 'alpha\n', 'nested/-leading.txt': 'nested\n', 'notes.md': 'ignore\n' },
    stdout: '3', reference: "find . -type f -name '*.txt' -exec printf '1\\n' \\; | wc -l",
  },
  {
    id: 'find-content', request: 'Print only the number of lines containing the literal TODO in all regular .txt files recursively under the current directory.',
    files: { 'first note.txt': 'TODO first\ndone\n', 'nested/second.txt': 'TODO second\n', 'ignore.md': 'TODO ignored\n' },
    stdout: '2', reference: "find . -type f -name '*.txt' -exec grep -h 'TODO' {} + | wc -l",
  },
  {
    id: 'copy-spaces', request: 'Copy ./source note.txt to ./copied note.txt. Preserve the source file.',
    files: { 'source note.txt': 'preserve this\n' }, creates: { 'copied note.txt': 'preserve this\n' },
    reference: "cp './source note.txt' './copied note.txt'",
  },
  {
    id: 'copy-unusual-filename', request: 'Copy the only regular .txt file directly in ./incoming to ./copied.txt. Its name may contain spaces, newlines, or leading dashes. Preserve the source.',
    files: { 'incoming/-line\nbreak.txt': 'unusual filename\n' }, creates: { 'copied.txt': 'unusual filename\n' },
    reference: 'for f in ./incoming/*.txt; do [ -f "$f" ] && cp "$f" ./copied.txt; done',
  },
  {
    id: 'newest-including-hidden', request: 'Copy the most recently modified regular file directly in ./Downloads, including hidden files, to ./selected.txt. Do not select subdirectories.',
    files: { 'Downloads/old.txt': 'old\n', 'Downloads/.newest.txt': 'newest\n', 'Downloads/subdirectory/ignore.txt': 'nested\n' },
    mtimes: { 'Downloads/old.txt': 1000000000, 'Downloads/.newest.txt': 1100000000 }, creates: { 'selected.txt': 'newest\n' },
    reference: 'shopt -s nullglob dotglob; newest=; for f in ./Downloads/*; do [ -f "$f" ] || continue; if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then newest=$f; fi; done; [ -n "$newest" ] && cp "$newest" ./selected.txt',
  },
  {
    id: 'empty-newest-fails', request: 'Copy the most recently modified regular file directly in ./Downloads to ./selected.txt. If there are no regular files, fail without creating selected.txt.',
    directories: ['Downloads'], files: {}, nonzero: true,
    reference: 'shopt -s nullglob dotglob; newest=; for f in ./Downloads/*; do [ -f "$f" ] || continue; if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then newest=$f; fi; done; [ -n "$newest" ] || exit 1; cp "$newest" ./selected.txt',
  },
  {
    id: 'delete-only-requested-file', request: 'Delete only ./obsolete.txt from the current directory. Keep all other files.',
    files: { 'obsolete.txt': 'obsolete\n', 'keep.txt': 'keep\n' }, removes: ['obsolete.txt'], risk: true,
    reference: 'rm ./obsolete.txt',
  },
  { id: 'arithmetic', request: 'Print only the result of 12 multiplied by 4.', files: {}, stdout: '48', reference: 'printf "%s\\n" "$((12 * 4))"' },
  {
    id: 'saved-tool-preference', request: 'Calculate the square root of 144 and print only the result.',
    rules: ['Use awk for arithmetic'], files: {}, stdout: '12', tool: /\bawk\b/,
    reference: "awk 'BEGIN { print sqrt(144) }'",
  },
  {
    id: 'missing-transfer-destination', request: 'Send a backup copy of ./report.txt to my server using scp.',
    files: { 'report.txt': 'report\n' }, clarify: /host|server|address|destination|where/i,
  },
  {
    id: 'missing-delete-target', request: 'Remove the file I no longer need.', files: { 'first.txt': 'first\n', 'second.txt': 'second\n' },
    clarify: /which|file|name|path/i,
  },
  {
    id: 'line-count-with-spaces', request: 'Print only the number of lines in ./source note.txt.',
    files: { 'source note.txt': 'first\nsecond\nthird\n' }, stdout: '3', reference: "wc -l < './source note.txt'",
  },
  {
    id: 'count-with-no-matches', request: 'Print only the number of regular .txt files recursively under the current directory, including hidden files.',
    files: { 'notes.md': 'no matching files\n' }, stdout: '0',
    reference: "find . -type f -name '*.txt' -print0 | tr -cd '\\000' | wc -c",
  },
  {
    id: 'literal-pattern-in-unusual-paths', request: 'Print only the number of lines containing the literal text [ok] across all regular .log files recursively here. Treat [ok] as text, not a regular expression.',
    files: { 'nested/-odd\nname.log': '[ok] first\nplain ok\n', 'other.log': '[ok] second\n' }, stdout: '2',
    reference: "find . -type f -name '*.log' -exec awk 'index($0, \"[ok]\") {n++} END {print n+0}' {} + | awk '{n += $1} END {print n+0}'",
  },
  {
    id: 'newest-name-is-not-sort-order', request: 'Copy the most recently modified regular file directly in ./incoming, considering hidden files too, to ./archive-picked.dat. Preserve the source files.',
    files: { 'incoming/.older.dat': 'old\n', 'incoming/new report.txt': 'chosen\n', 'incoming/z-last.csv': 'alphabetically last\n' },
    mtimes: { 'incoming/.older.dat': 1000000000, 'incoming/new report.txt': 1200000000, 'incoming/z-last.csv': 1100000000 },
    creates: { 'archive-picked.dat': 'chosen\n' },
    reference: 'shopt -s nullglob dotglob; newest=; for f in ./incoming/*; do [ -f "$f" ] || continue; if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then newest=$f; fi; done; [ -n "$newest" ] && cp "$newest" ./archive-picked.dat',
  },
  { id: 'different-arithmetic-operands', request: 'Print only the result of 341 multiplied by 19.', files: {}, stdout: '6479', reference: 'printf "%s\\n" "$((341 * 19))"' },
];

export const fixtureVersion = 2;

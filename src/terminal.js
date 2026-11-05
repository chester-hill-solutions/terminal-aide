import { createInterface } from 'node:readline/promises';
import { clearLine, cursorTo } from 'node:readline';
import { setImmediate } from 'node:timers/promises';
import cliSpinners from 'cli-spinners';

export function createTerminal({ input = process.stdin, output = process.stdout, errorOutput = process.stderr, env = process.env, signal } = {}) {
  let active;
  let stopSpinner;
  const isInteractive = Boolean(input.isTTY && output.isTTY && errorOutput.isTTY);
  // Drain input between questions so a pasted/pretyped yes during generation cannot approve.
  const discard = () => {};
  if (isInteractive) { input.on('data', discard); input.resume(); }
  return {
    isInteractive,
    write: (text) => output.write(text),
    format(text, role) {
      if (!output.isTTY || 'NO_COLOR' in env || env.TERM === 'dumb') return text;
      const codes = { command: '1', prompt: '1;36', warning: '1;33' };
      return codes[role] ? `\x1b[${codes[role]}m${text}\x1b[0m` : text;
    },
    spin() {
      stopSpinner?.();
      if (!output.isTTY || env.TERM === 'dumb') return () => {};
      const { frames, interval } = cliSpinners.dots;
      let frame = 0;
      let stopped = false;
      const render = () => {
        cursorTo(output, 0);
        clearLine(output, 0);
        output.write(frames[frame++ % frames.length]);
      };
      render();
      const timer = setInterval(render, interval);
      timer.unref();
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        cursorTo(output, 0);
        clearLine(output, 0);
        if (stopSpinner === stop) stopSpinner = undefined;
      };
      stopSpinner = stop;
      return stop;
    },
    async ask(question) {
      stopSpinner?.();
      signal?.throwIfAborted();
      // Allow pending input to drain before listening for a new answer.
      await setImmediate();
      signal?.throwIfAborted();
      active = createInterface({ input, output, terminal: true, historySize: 0 });
      const current = active;
      let onClose;
      let onInterrupt;
      try {
        return await Promise.race([
          current.question(question, { signal }),
          new Promise((resolve) => {
            onClose = () => resolve(null);
            onInterrupt = () => { resolve(null); current.close(); };
            current.once('close', onClose);
            current.once('SIGINT', onInterrupt);
          }),
        ]);
      } finally {
        current.off('close', onClose);
        current.off('SIGINT', onInterrupt);
        current.close();
        active = undefined;
        if (isInteractive) input.resume();
      }
    },
    close() {
      stopSpinner?.();
      active?.close();
      input.off('data', discard);
      if (isInteractive) input.pause();
    },
  };
}

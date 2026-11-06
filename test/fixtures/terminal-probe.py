"""Run the fixed terminal regression command in a real controlling PTY."""
import errno
import os
import pty
import select
import signal
import sys
import time

pid, descriptor = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])

output = bytearray()
sent = False
reaped = False
deadline = time.monotonic() + 4
try:
    while time.monotonic() < deadline:
        readable, _, _ = select.select([descriptor], [], [], 0.1)
        if not readable:
            continue
        try:
            chunk = os.read(descriptor, 8192)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            break
        if not chunk:
            break
        output.extend(chunk)
        if not sent and b'AIDE_TTY_READY' in output:
            os.write(descriptor, b'terminal-input-works\n')
            sent = True
    else:
        raise TimeoutError('Terminal command did not finish')
    _, status = os.waitpid(pid, 0)
    reaped = True
    sys.stdout.buffer.write(output)
    sys.exit(os.waitstatus_to_exitcode(status))
finally:
    os.close(descriptor)
    if not reaped:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)

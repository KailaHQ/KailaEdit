import type { ChildProcess } from 'child_process'
import { logger } from '../logger'

/**
 * Stops a killed child process from taking the whole app down with it.
 *
 * Writing to a child's stdin is asynchronous. `write()` hands the bytes to an internal
 * buffer and returns; libuv flushes them later. Kill the child in between — which is
 * exactly what cancelling a bake or a segment render does — and that flush fails with
 * `EPIPE`, which arrives as an `error` event on the stdin stream, long after the code
 * that called `write()` has moved on.
 *
 * A stream `error` with no listener is an uncaught exception, and in the main process
 * that is the "A JavaScript error occurred in the main process" dialog. Changing the
 * stroke style while a bake was running produced it every time: the new style superseded
 * the running render, the encoder was SIGKILLed, and the frames already queued for it
 * drained into a closed pipe.
 *
 * Guarding the `write()` call itself cannot fix this — `stdin.destroyed` is false at the
 * moment of the call, and the child dies afterwards. The only fix is to be listening.
 *
 * The errors themselves are genuinely nothing to act on: the process they were headed
 * for is gone and the caller already knows it cancelled. They are logged at debug and
 * dropped.
 */
export function quietChildStdio(child: ChildProcess, label: string): ChildProcess {
  const swallow = (stream: string) => (err: NodeJS.ErrnoException) => {
    // The shapes a killed pipe takes. `EOF` is the Windows one and is easy to miss:
    // killing ffmpeg mid-write reports `EPIPE` for the queued write but `EOF` for the
    // flush behind it, so leaving it out logged a warning on every single cancellation.
    const expected = err?.code === 'EPIPE' || err?.code === 'ECONNRESET' || err?.code === 'EOF'
    const message = `[${label}] ${stream} ${err?.code ?? 'error'}: ${err?.message ?? String(err)}`
    if (expected) logger.debug(message)
    else logger.warn(message)
  }

  // `spawn` itself reports failures here (ENOENT for a missing binary, EACCES). Without a
  // listener those are also uncaught, so this doubles as the spawn-error guard.
  child.on('error', swallow('process'))
  child.stdin?.on('error', swallow('stdin'))
  child.stdout?.on('error', swallow('stdout'))
  child.stderr?.on('error', swallow('stderr'))

  return child
}

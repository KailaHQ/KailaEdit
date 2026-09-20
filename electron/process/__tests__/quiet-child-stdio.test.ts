import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { quietChildStdio } from '../quiet-child-stdio'

vi.mock('../../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/**
 * Killing a child whose stdin still has bytes queued makes that flush fail with EPIPE,
 * delivered as an `error` event on the stream. An `error` event with no listener is an
 * uncaught exception, and in the main process that is the crash dialog — which is what
 * changing the stroke style during a bake produced.
 */
function fakeChild(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess
  ;(child as any).stdin = new EventEmitter()
  ;(child as any).stdout = new EventEmitter()
  ;(child as any).stderr = new EventEmitter()
  return child
}

function epipe(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error('write EPIPE')
  err.code = 'EPIPE'
  return err
}

describe('quietChildStdio', () => {
  it('an unguarded stdin throws on EPIPE — this is the crash being fixed', () => {
    const child = fakeChild()
    expect(() => child.stdin!.emit('error', epipe())).toThrow(/EPIPE/)
  })

  it('swallows EPIPE on stdin after the child is killed', () => {
    const child = quietChildStdio(fakeChild(), 'test')
    expect(() => child.stdin!.emit('error', epipe())).not.toThrow()
  })

  it('swallows the EOF that Windows reports for the same kill', () => {
    const child = quietChildStdio(fakeChild(), 'test')
    const eof: NodeJS.ErrnoException = new Error('write EOF')
    eof.code = 'EOF'
    expect(() => child.stdin!.emit('error', eof)).not.toThrow()
  })

  it('covers stdout and stderr too, which close with the same pipe', () => {
    const child = quietChildStdio(fakeChild(), 'test')
    expect(() => child.stdout!.emit('error', epipe())).not.toThrow()
    expect(() => child.stderr!.emit('error', epipe())).not.toThrow()
  })

  it('covers the child itself, so a failed spawn does not crash either', () => {
    const child = quietChildStdio(fakeChild(), 'test')
    const enoent: NodeJS.ErrnoException = new Error('spawn ffmpeg ENOENT')
    enoent.code = 'ENOENT'
    expect(() => child.emit('error', enoent)).not.toThrow()
  })

  it('handles a child with no piped stdio at all', () => {
    const child = new EventEmitter() as unknown as ChildProcess
    expect(() => quietChildStdio(child, 'test')).not.toThrow()
  })
})

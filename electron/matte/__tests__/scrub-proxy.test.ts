import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import { ensureScrubProxy } from '../scrub-proxy'

const mock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('child_process', () => ({ spawn: mock.spawn }))
vi.mock('../../export/ffmpeg-utils', () => ({ findFfmpegPath: () => 'ffmpeg' }))
vi.mock('../../export/render-cache-manager', () => ({ renderCacheManager: { getCacheDir: () => { throw Error('explicit test cache required') } } }))
let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ke-scrub-service-'))
  mock.spawn.mockReset().mockImplementation((_binary: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() })
    queueMicrotask(() => { fs.writeFileSync(args.at(-1)!, 'proxy'); child.emit('exit', 0) })
    return child
  })
})
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

it('deduplicates concurrent requests and reuses disk cache without another encode', async () => {
  const input = path.join(directory, 'input.mp4')
  fs.writeFileSync(input, 'source')
  const [a, b] = await Promise.all([ensureScrubProxy(input, directory), ensureScrubProxy(input, directory)])
  expect(a).toBe(b)
  expect(mock.spawn).toHaveBeenCalledTimes(1)
  expect(await ensureScrubProxy(input, directory)).toBe(a)
  expect(mock.spawn).toHaveBeenCalledTimes(1)
  fs.writeFileSync(input, 'replacement with different size')
  expect(await ensureScrubProxy(input, directory)).not.toBe(a)
  expect(mock.spawn).toHaveBeenCalledTimes(2)
})

it('does not publish a failed encode and permits a later retry', async () => {
  const input = path.join(directory, 'bad.mp4')
  fs.writeFileSync(input, 'source')
  mock.spawn.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() })
    queueMicrotask(() => child.emit('exit', 1))
    return child
  })
  await expect(ensureScrubProxy(input, directory)).rejects.toThrow('Scrub proxy failed')
  expect(fs.readdirSync(directory)).toEqual(['bad.mp4'])
  expect(fs.existsSync(await ensureScrubProxy(input, directory))).toBe(true)
})

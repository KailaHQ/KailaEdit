import fs from 'fs'
import { removeEntryQuietly } from './remove-entry'

/**
 * Renames a file atomically with retries for Windows file lock contention (EBUSY / EPERM).
 * When child processes (like ffmpeg) exit, Windows may hold the file handle for tens
 * of milliseconds. If rename continues to fail after retries, it falls back to
 * copyFile + unlink so that locks or cross-device boundaries do not fail the operation.
 */
export async function safeRename(
  source: string,
  target: string,
  maxRetries = 8,
  delayMs = 60,
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (fs.existsSync(target)) {
        removeEntryQuietly(target)
      }
      await fs.promises.rename(source, target)
      return
    } catch (err: any) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)))
        continue
      }
      // Fallback to copyFile + removeEntryQuietly
      try {
        if (fs.existsSync(target)) {
          removeEntryQuietly(target)
        }
        await fs.promises.copyFile(source, target)
        removeEntryQuietly(source)
        return
      } catch {
        throw err
      }
    }
  }
}

/**
 * Synchronous variant of safeRename for synchronous contexts.
 */
export function safeRenameSync(
  source: string,
  target: string,
  maxRetries = 8,
  delayMs = 60,
): void {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (fs.existsSync(target)) {
        removeEntryQuietly(target)
      }
      fs.renameSync(source, target)
      return
    } catch (err: any) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < maxRetries - 1) {
        // Synchronous sleep using Atomics.wait
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * (attempt + 1))
        continue
      }
      // Fallback to copyFileSync + removeEntryQuietly
      try {
        if (fs.existsSync(target)) {
          removeEntryQuietly(target)
        }
        fs.copyFileSync(source, target)
        removeEntryQuietly(source)
        return
      } catch {
        throw err
      }
    }
  }
}

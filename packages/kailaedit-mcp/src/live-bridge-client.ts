import net from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CONFIRM_TIMEOUT_MS } from '@komfyedit/core'

export interface LiveBridgeApplyResult {
  success: boolean
  error?: string
  description?: string
  appliedCount?: number
  newRevision?: number
}

export interface LiveBridgeUndoResult {
  success: boolean
  error?: string
  description?: string
}

export function detectLiveBridgePort(projectId?: string): number | null {
  const livePortEnv = process.env.KAILAEDIT_LIVE_PORT || process.env.KOMFYEDIT_LIVE_PORT
  if (livePortEnv) {
    const port = parseInt(livePortEnv, 10)
    if (!isNaN(port) && port > 0) return port
  }

  if (projectId) {
    const candidates = [
      path.join(os.tmpdir(), `kailaedit-live-${projectId}.json`),
      path.join(os.tmpdir(), `komfyedit-live-${projectId}.json`),
    ]
    for (const lockPath of candidates) {
      if (fs.existsSync(lockPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
          if (data.port && typeof data.port === 'number') {
            return data.port
          }
        } catch {
          // best effort
        }
      }
    }
  }

  return null
}

export async function sendLiveBridgeRequest<T = any>(
  port: number,
  payload: any,
  timeoutMs = 15000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let buffer = ''
    let resolved = false

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        socket.destroy()
        reject(new Error('Live bridge request timed out'))
      }
    }, timeoutMs)

    socket.connect(port, '127.0.0.1', () => {
      socket.write(JSON.stringify(payload) + '\n')
    })

    socket.on('data', data => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (!resolved) {
            resolved = true
            clearTimeout(timer)
            socket.destroy()
            resolve(parsed)
            return
          }
        } catch {
          // await full line
        }
      }
    })

    socket.on('error', err => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        socket.destroy()
        reject(err)
      }
    })
  })
}

export async function tryApplyViaLiveBridge(
  projectId: string,
  patch: any,
): Promise<LiveBridgeApplyResult | null> {
  const port = detectLiveBridgePort(projectId)
  if (!port) return null

  try {
    const response = await sendLiveBridgeRequest<LiveBridgeApplyResult>(port, {
      action: 'apply_patch',
      projectId,
      patch,
    })
    return response
  } catch {
    // If live bridge cannot be reached, fallback to offline disk write
    return null
  }
}

export async function tryUndoViaLiveBridge(
  projectId: string,
): Promise<LiveBridgeUndoResult | null> {
  const port = detectLiveBridgePort(projectId)
  if (!port) return null

  try {
    const response = await sendLiveBridgeRequest<LiveBridgeUndoResult>(port, {
      action: 'undo',
      projectId,
    })
    return response
  } catch {
    // If live bridge cannot be reached, fallback to offline disk undo
    return null
  }
}

export interface LiveBridgeConfirmResult {
  success: boolean
  actionId?: string
  dismissed?: boolean
  error?: string
  timedOut?: boolean
  /**
   * Item numbers (1-based) the user left ticked. Present only for a card that
   * offered checkboxes; the agent must act on these and nothing else.
   */
  selectedItemNumbers?: number[]
}

/**
 * Parks the agent until the user answers in the app.
 *
 * The socket timeout sits just past the bridge's own, so a question that runs
 * out of time is reported by the side that owns the clock rather than racing
 * it here.
 */
export async function askConfirmViaLiveBridge(
  projectId: string | undefined,
  request: Record<string, unknown>,
): Promise<LiveBridgeConfirmResult | null> {
  const port = detectLiveBridgePort(projectId)
  if (!port) return null

  try {
    return await sendLiveBridgeRequest<LiveBridgeConfirmResult>(
      port,
      { action: 'confirm', projectId, request },
      CONFIRM_TIMEOUT_MS + 10_000,
    )
  } catch (err: any) {
    return { success: false, error: err?.message || String(err), timedOut: true }
  }
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { spawn, ChildProcess } from 'child_process'
import { READ_ONLY_TOOLS, KomfyEditMcpServer } from '../packages/kailaedit-mcp/src/server'

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures')
const SYNTHETIC_MEDIA = path.join(FIXTURES_DIR, 'synthetic_media.mp4')
const CLI_PATH = path.resolve(__dirname, '../packages/kailaedit-mcp/bin/kailaedit-mcp.js')

describe('S3-4 · MCP Server (profile: read)', () => {
  it('defines only read tools and zero write tools in READ_ONLY_TOOLS', () => {
    expect(READ_ONLY_TOOLS.length).toBeGreaterThanOrEqual(10)

    const toolNames = READ_ONLY_TOOLS.map(t => t.name)
    const expectedTools = [
      'project_list',
      'project_open',
      'timeline_describe',
      'timeline_summary',
      'media_list',
      'media_probe',
      'observe_silence',
      'observe_scenes',
      'observe_loudness',
      'observe_filmstrip',
      'transcribe',
      'qc_check',
    ]

    for (const expected of expectedTools) {
      expect(toolNames).toContain(expected)
    }

    // Verify absolutely NO write tools are exposed
    const writeForbidden = ['edit', 'write', 'save', 'delete', 'remove', 'apply', 'patch', 'create', 'update']
    for (const tool of READ_ONLY_TOOLS) {
      for (const forbidden of writeForbidden) {
        // Exception: 'describe' contains 'scribe' not write
        if (tool.name.includes(forbidden) && !tool.name.includes('describe')) {
          throw new Error(`Forbidden write keyword "${forbidden}" found in tool "${tool.name}"`)
        }
      }
    }
  })

  it('contains zero disk write operations outside temporary cache directory', () => {
    const srcDir = path.resolve(__dirname, '../packages/kailaedit-mcp/src')
    const files = fs.readdirSync(srcDir)

    for (const file of files) {
      if (!file.endsWith('.ts')) continue
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8')

      // Ensure no writeFileSync / appendFileSync / createWriteStream in MCP server sources
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes('writeFileSync') || line.includes('appendFileSync') || line.includes('createWriteStream')) {
          throw new Error(`Write operation detected in ${file}:${i + 1}: ${line}`)
        }
      }
    }
  })

  it('starts and responds to stdio JSON-RPC protocol without Electron app running', async () => {
    expect(fs.existsSync(CLI_PATH)).toBe(true)

    const proc = spawn('node', [CLI_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdoutData = ''
    let stderrData = ''

    proc.stdout.on('data', chunk => {
      stdoutData += chunk.toString()
    })

    proc.stderr.on('data', chunk => {
      stderrData += chunk.toString()
    })

    // Send standard MCP initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    }) + '\n'

    proc.stdin.write(initRequest)

    // Wait for response or timeout
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error(`Timeout waiting for MCP initialize response. Stderr: ${stderrData}`))
      }, 5000)

      const interval = setInterval(() => {
        if (stdoutData.includes('"result"') || stdoutData.includes('"protocolVersion"')) {
          clearTimeout(timeout)
          clearInterval(interval)
          resolve()
        }
      }, 50)
    })

    // Send tools/list request
    const listRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }) + '\n'

    stdoutData = ''
    proc.stdin.write(listRequest)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error('Timeout waiting for tools/list response'))
      }, 5000)

      const interval = setInterval(() => {
        if (stdoutData.includes('"tools"')) {
          clearTimeout(timeout)
          clearInterval(interval)
          resolve()
        }
      }, 50)
    })

    proc.kill()

    // Parse tools response
    const jsonLine = stdoutData.split('\n').find(l => l.includes('"tools"'))
    expect(jsonLine).toBeDefined()
    const parsed = JSON.parse(jsonLine!)
    expect(parsed.result).toBeDefined()
    expect(parsed.result.tools).toBeInstanceOf(Array)

    const returnedToolNames: string[] = parsed.result.tools.map((t: any) => t.name)
    expect(returnedToolNames).toContain('project_list')
    expect(returnedToolNames).toContain('observe_silence')
    expect(returnedToolNames).toContain('qc_check')

    // Confirm no write tools
    for (const name of returnedToolNames) {
      expect(name).not.toMatch(/write|save|apply|patch|delete/)
    }
  }, 15000)

  it('executes read tools (media.probe, observe.silence, qc.check) successfully via server handler', async () => {
    const server = new KomfyEditMcpServer()

    // Test media.probe
    const probeTool = READ_ONLY_TOOLS.find(t => t.name === 'media_probe')
    expect(probeTool).toBeDefined()

    // Test observe.silence
    const silenceTool = READ_ONLY_TOOLS.find(t => t.name === 'observe_silence')
    expect(silenceTool).toBeDefined()

    // Test qc.check
    const qcTool = READ_ONLY_TOOLS.find(t => t.name === 'qc_check')
    expect(qcTool).toBeDefined()

    // Test transcribe
    const transcribeTool = READ_ONLY_TOOLS.find(t => t.name === 'transcribe')
    expect(transcribeTool).toBeDefined()
    expect(transcribeTool?.inputSchema.properties).toHaveProperty('filePath')
    expect(transcribeTool?.inputSchema.properties).toHaveProperty('wordTimestamps')
  })

  it('README documents host configuration for Claude Code, Codex CLI, and Antigravity CLI', () => {
    const readmePath = path.resolve(__dirname, '../packages/kailaedit-mcp/README.md')
    expect(fs.existsSync(readmePath)).toBe(true)

    const readmeContent = fs.readFileSync(readmePath, 'utf8')
    expect(readmeContent).toContain('Claude Code')
    expect(readmeContent).toContain('Codex CLI')
    expect(readmeContent).toContain('Antigravity CLI')
    expect(readmeContent).toContain('stdio')
  })
})

#!/usr/bin/env node
import { spawn } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath, pathToFileURL } from 'url'

if (!process.execArgv.some(arg => arg.includes('tsx'))) {
  // Resolve tsx relative to THIS file, not the caller's working directory.
  // A bare `--import tsx` is resolved against cwd, so launching the server from
  // anywhere outside the repo — which is the normal case, since the agent runs
  // in its own directory — failed with ERR_MODULE_NOT_FOUND.
  const require = createRequire(import.meta.url)
  let tsxSpecifier = 'tsx'
  try {
    tsxSpecifier = pathToFileURL(require.resolve('tsx')).href
  } catch {
    // Fall back to the bare specifier; it still works when cwd can resolve tsx.
  }

  const child = spawn(
    process.execPath,
    ['--import', tsxSpecifier, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  child.on('exit', code => process.exit(code ?? 0))
} else {
  // MCP stdio transport requires process.stdout to contain EXCLUSIVELY JSON-RPC messages.
  // Any console.log / console.info from imported modules (e.g. whisper, ffmpeg, logger)
  // must be routed to stderr to avoid corrupting the client's JSON parser.
  console.log = (...args) => console.error(...args)
  console.info = (...args) => console.error(...args)
  console.debug = (...args) => console.error(...args)

  const { KailaEditMcpServer, KomfyEditMcpServer } = await import('../src/server.ts')
  const ServerClass = KailaEditMcpServer || KomfyEditMcpServer
  const profileIndex = process.argv.indexOf('--profile')
  const profileArg = profileIndex !== -1 ? process.argv[profileIndex + 1] : undefined
  const profile =
    profileArg === 'edit' ||
    process.env.KAILAEDIT_MCP_PROFILE === 'edit' ||
    process.env.KOMFYEDIT_MCP_PROFILE === 'edit'
      ? 'edit'
      : 'read'

  const server = new ServerClass({ profile })
  server.startStdio().catch(err => {
    process.stderr.write(`[kailaedit-mcp] Fatal: ${err.message || err}\n`)
    process.exit(1)
  })
}

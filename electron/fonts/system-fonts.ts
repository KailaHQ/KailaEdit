import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'

const execAsync = promisify(exec)

let cachedSystemFonts: string[] | null = null

const STANDARD_FALLBACK_FONTS = [
  'Arial',
  'Calibri',
  'Cambria',
  'Caveat',
  'Comic Sans MS',
  'Courier New',
  'Courier Prime',
  'Dancing Script',
  'Fira Code',
  'Georgia',
  'Helvetica',
  'Impact',
  'Inter',
  'Lora',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Merriweather',
  'Microsoft Sans Serif',
  'Montserrat',
  'Open Sans',
  'Oswald',
  'Pacifico',
  'Palatino Linotype',
  'Playfair Display',
  'Roboto',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]

async function queryWindowsFonts(): Promise<string[]> {
  const fontNames = new Set<string>()
  const registryKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ]

  for (const regKey of registryKeys) {
    try {
      const { stdout } = await execAsync(`reg query "${regKey}"`)
      const lines = stdout.split('\r\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('HKEY_')) continue
        // Format: <Font Name>    REG_SZ    <filename>
        const match = trimmed.match(/^(.+?)\s+REG_SZ/i)
        if (match && match[1]) {
          let name = match[1].trim()
          name = name.replace(/\s*\((TrueType|OpenType|PostScript|Type 1|All res)\)$/i, '').trim()
          if (name) {
            fontNames.add(name)
          }
        }
      }
    } catch {
      // HKCU may not exist or error, ignore
    }
  }

  return Array.from(fontNames)
}

async function queryMacFonts(): Promise<string[]> {
  const fontNames = new Set<string>()
  try {
    const { stdout } = await execAsync('system_profiler SPFontsDataType', { timeout: 3000 })
    const matches = stdout.matchAll(/Family:\s*([^\n\r]+)/g)
    for (const match of matches) {
      if (match[1]) fontNames.add(match[1].trim())
    }
  } catch {
    const fontDirs = [
      '/System/Library/Fonts',
      '/Library/Fonts',
      path.join(os.homedir(), 'Library/Fonts'),
    ]
    for (const dir of fontDirs) {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir)
          for (const f of files) {
            const ext = path.extname(f).toLowerCase()
            if (['.ttf', '.otf', '.ttc', '.dfont'].includes(ext)) {
              fontNames.add(path.basename(f, ext))
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }
  return Array.from(fontNames)
}

async function queryLinuxFonts(): Promise<string[]> {
  const fontNames = new Set<string>()
  try {
    const { stdout } = await execAsync('fc-list : family', { timeout: 3000 })
    const lines = stdout.split('\n')
    for (const line of lines) {
      const parts = line.split(',')
      for (const part of parts) {
        const trimmed = part.trim()
        if (trimmed) fontNames.add(trimmed)
      }
    }
  } catch {
    // Ignore error
  }
  return Array.from(fontNames)
}

/**
 * Scan all installed system fonts across Windows, macOS, and Linux.
 * Cached in memory after the first scan for instant subsequent reads.
 */
export async function getSystemFonts(): Promise<string[]> {
  if (cachedSystemFonts && cachedSystemFonts.length > 0) {
    return cachedSystemFonts
  }

  let discoveredFonts: string[] = []
  try {
    if (process.platform === 'win32') {
      discoveredFonts = await queryWindowsFonts()
    } else if (process.platform === 'darwin') {
      discoveredFonts = await queryMacFonts()
    } else if (process.platform === 'linux') {
      discoveredFonts = await queryLinuxFonts()
    }
  } catch (err) {
    console.error('[system-fonts] Failed to query system fonts:', err)
  }

  const merged = new Set<string>()
  for (const font of STANDARD_FALLBACK_FONTS) {
    merged.add(font)
  }
  for (const font of discoveredFonts) {
    if (font) merged.add(font)
  }

  cachedSystemFonts = Array.from(merged).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
  return cachedSystemFonts
}

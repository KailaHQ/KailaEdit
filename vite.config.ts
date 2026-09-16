import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          if (process.env.ELECTRON_DEBUG) {
            // --inspect and --remote-debugging-port must come before '.' (the app path)
            options.startup(['--inspect=9229', '--remote-debugging-port=9222', '.', '--no-sandbox'])
          } else {
            options.startup()
          }
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              // ffmpeg-static resolves its binary relative to its own package dir,
              // so it must stay an external require rather than be inlined.
              // @resvg/resvg-js has native binaries (.node) and must be externalized.
              // electron-updater loads its providers with dynamic require and
              // reads app-update.yml off disk; bundling it breaks both.
              external: ['electron', 'ffmpeg-static', '@resvg/resvg-js', 'electron-updater']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              output: {
                format: 'cjs'  // Preload must be CommonJS
              }
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend'),
      '@core': path.resolve(__dirname, './core/src'),
      '@kailaedit/core': path.resolve(__dirname, './core/src'),
      '@komfyedit/core': path.resolve(__dirname, './core/src')
    }
  },
  base: './',  // Use relative paths for Electron file:// protocol
  build: {
    outDir: 'dist'
  }
})

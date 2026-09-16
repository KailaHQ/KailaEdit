import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Renderer-only dev server: the same frontend as `vite`, minus the
// vite-plugin-electron entries, so the UI can be opened in a plain browser
// without spawning an Electron window.
export default defineConfig({
  plugins: [react()],
  // Must mirror vite.config.ts — the renderer imports @core/* since the editing
  // logic moved into the core package, and this server has to resolve it too.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend'),
      '@core': path.resolve(__dirname, './core/src'),
      '@kailaedit/core': path.resolve(__dirname, './core/src'),
      '@komfyedit/core': path.resolve(__dirname, './core/src'),
    },
  },
  server: { port: 5199 },
})

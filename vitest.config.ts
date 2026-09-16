import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend'),
      '@core': path.resolve(__dirname, './core/src'),
      '@kailaedit/core': path.resolve(__dirname, './core/src'),
      '@komfyedit/core': path.resolve(__dirname, './core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/release/**',
      '**/.claude/**',
      '**/.codex/**',
    ],
  },
})

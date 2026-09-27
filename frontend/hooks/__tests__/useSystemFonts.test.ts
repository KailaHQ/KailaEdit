// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSystemFonts } from '../useSystemFonts'

describe('useSystemFonts hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders and discovers system fonts via electronAPI', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    ;(window as any).electronAPI = {
      getSystemFonts: vi.fn().mockResolvedValue({
        fonts: ['Roboto', 'VnTime', 'Calibri Custom', 'Zilla Slab'],
      }),
    }

    let capturedFonts: any[] = []
    function TestComponent() {
      const { fonts } = useSystemFonts()
      capturedFonts = fonts
      return null
    }

    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(React.createElement(TestComponent))
    })

    // Give microtasks time to resolve
    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    expect(capturedFonts.length).toBeGreaterThan(0)
    expect(capturedFonts.some(f => f.name === 'Roboto' || f.name.includes('Inter'))).toBe(true)

    act(() => {
      root.unmount()
    })
  })
})

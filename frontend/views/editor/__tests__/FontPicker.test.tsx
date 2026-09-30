// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FontPicker } from '../FontPicker'

describe('FontPicker', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('selects exactly one font and shows only one checkmark', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const handleChange = vi.fn()

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // Render FontPicker with "Segoe UI, sans-serif"
    await act(async () => {
      root.render(
        <FontPicker
          value="Segoe UI, sans-serif"
          onChange={handleChange}
        />,
      )
    })

    // Click trigger button to open dropdown
    const trigger = container.querySelector('button')
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger?.click()
    })

    // Query all rendered SVG icons inside the dropdown (lucide-react Check icon)
    const checkIcons = container.querySelectorAll('.lucide-check')
    expect(checkIcons.length).toBe(1)

    // Verify clicking another font fires onChange with that single font
    const buttons = Array.from(container.querySelectorAll('button'))
    const robotoBtn = buttons.find(b => b.textContent?.includes('Roboto'))
    expect(robotoBtn).toBeDefined()

    await act(async () => {
      robotoBtn?.click()
    })

    expect(handleChange).toHaveBeenCalledWith('Roboto, sans-serif', 'Roboto')

    // Dropdown should be closed now
    expect(container.querySelectorAll('.lucide-check').length).toBe(0)

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('allows starring a font and places starred fonts at the top of the list', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const handleChange = vi.fn()

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <FontPicker
          value="Arial, sans-serif"
          onChange={handleChange}
        />,
      )
    })

    // Open dropdown
    const trigger = container.querySelector('button')
    await act(async () => {
      trigger?.click()
    })

    // Initially no "Starred" header
    expect(container.textContent).not.toContain('Starred')

    // Find the star icon for "Roboto"
    const buttons = Array.from(container.querySelectorAll('button'))
    const robotoBtn = buttons.find(b => b.textContent?.includes('Roboto'))
    expect(robotoBtn).toBeDefined()

    const starBtn = robotoBtn?.querySelector('[title*="Star"]') as HTMLElement
    expect(starBtn).not.toBeNull()

    // Click the star button to star "Roboto"
    await act(async () => {
      starBtn.click()
    })

    // Now "Starred (1)" section should exist at the top of the list
    expect(container.textContent).toContain('Starred (1)')

    // Dropdown should remain open after starring
    expect(container.querySelector('input[placeholder="Search fonts..."]')).not.toBeNull()

    // Verify persisted to localStorage
    const saved = localStorage.getItem('kailaedit_starred_fonts')
    expect(saved).toContain('roboto')

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})

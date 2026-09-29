import { describe, it, expect } from 'vitest'
import { appSettingsSchema, DEFAULT_APP_SETTINGS } from '../shared/app-settings-schema'
import { electronAPISchemas } from '../shared/electron-api-schema'
import { en } from '../frontend/i18n/locales/en'
import { vi } from '../frontend/i18n/locales/vi'

describe('i18n Dictionaries Parity', () => {
  function getDeepKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    let keys: string[] = []
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        keys = keys.concat(getDeepKeys(value as Record<string, unknown>, fullPath))
      } else {
        keys.push(fullPath)
      }
    }
    return keys
  }

  it('has identical keys in en and vi locale dictionaries', () => {
    const enKeys = getDeepKeys(en).sort()
    const viKeys = getDeepKeys(vi).sort()

    const missingInVi = enKeys.filter(k => !viKeys.includes(k))
    const missingInEn = viKeys.filter(k => !enKeys.includes(k))

    expect(missingInVi, `Keys in English but missing in Vietnamese: ${missingInVi.join(', ')}`).toEqual([])
    expect(missingInEn, `Keys in Vietnamese but missing in English: ${missingInEn.join(', ')}`).toEqual([])
  })

  it('provides all required settings tabs in both dictionaries', () => {
    expect(en.settings.tabs.draft).toBe('Draft')
    expect(vi.settings.tabs.draft).toBe('Bản nháp')

    expect(en.settings.tabs.edit).toBe('Edit')
    expect(vi.settings.tabs.edit).toBe('Chỉnh sửa')

    expect(en.settings.tabs.performance).toBe('Performance')
    expect(vi.settings.tabs.performance).toBe('Hiệu suất')

    expect(en.settings.tabs.general).toBe('General')
    expect(vi.settings.tabs.general).toBe('Chung')
  })

  it('correctly interpolates parameters in translation strings', () => {
    const rawEn = en.chrome.autoSaved
    const rawVi = vi.chrome.autoSaved

    const interpolatedEn = rawEn.replace('{time}', '12:00:00')
    const interpolatedVi = rawVi.replace('{time}', '12:00:00')

    expect(interpolatedEn).toBe('Auto saved: 12:00:00')
    expect(interpolatedVi).toBe('Tự động lưu: 12:00:00')
  })

  it('provides all transition categories and items in both dictionaries', () => {
    expect(en.transitions.categories.basic).toBe('Basic')
    expect(vi.transitions.categories.basic).toBe('Cơ bản')
    expect(en.transitions.categories.wipe).toBe('Wipe')
    expect(vi.transitions.categories.wipe).toBe('Gạt')
    expect(en.transitions.categories.slide).toBe('Slide')
    expect(vi.transitions.categories.slide).toBe('Đẩy')

    expect(en.transitions.items.dissolve).toBe('Dissolve')
    expect(vi.transitions.items.dissolve).toBe('Hoà tan')
    expect(en.transitions.items['wipe-left']).toBe('Wipe left')
    expect(vi.transitions.items['wipe-left']).toBe('Gạt sang trái')
    expect(en.transitions.items['circle-open']).toBe('Circle open')
    expect(vi.transitions.items['circle-open']).toBe('Mở vòng tròn')
  })

  it('provides all projectSettings, editpilot, timeline, and library keys', () => {
    expect(en.projectSettings.title).toBe('Project / Timeline Settings')
    expect(vi.projectSettings.title).toBe('Cài đặt dự án / Dòng thời gian')

    expect(en.editpilot.title).toBe('CoEdit')
    expect(vi.editpilot.title).toBe('CoEdit')
    expect(en.editpilot.settingsTitle).toBe('CoEdit Configuration')
    expect(vi.editpilot.settingsTitle).toBe('Cấu hình CoEdit')

    expect(en.timeline.trackTypes.audio).toBe('Audio')
    expect(vi.timeline.trackTypes.audio).toBe('Âm thanh')

    expect(en.library.tabs.media).toBe('Media')
    expect(vi.library.tabs.media).toBe('Media')
    expect(en.library.tabs.stickers).toBe('Stickers')
    expect(vi.library.tabs.stickers).toBe('Sticker')

    expect(en.clipProperties.blendModeTitle).toBe('Blend Mode')
    expect(vi.clipProperties.blendModeTitle).toBe('Chế độ hòa trộn (Blend Mode)')
    expect(en.clipProperties.blendModes.normal).toBe('Normal')
    expect(vi.clipProperties.blendModes.normal).toBe('Bình thường (Normal)')
    expect(en.clipProperties.blendModes.multiply).toBe('Multiply')
    expect(vi.clipProperties.blendModes.multiply).toBe('Nhân (Multiply)')
    expect(en.clipProperties.blendModes.screen).toBe('Screen')
    expect(vi.clipProperties.blendModes.screen).toBe('Lọc sáng (Screen)')
    expect(en.clipProperties.blendModes.overlay).toBe('Overlay')
    expect(vi.clipProperties.blendModes.overlay).toBe('Chồng phủ (Overlay)')
    expect(en.clipProperties.blendModes.add).toBe('Add')
    expect(vi.clipProperties.blendModes.add).toBe('Cộng sáng (Add)')
    expect(en.clipProperties.blendModes.difference).toBe('Difference')
    expect(vi.clipProperties.blendModes.difference).toBe('Khác biệt (Difference)')
  })
})

describe('AppSettings Schema & Defaults', () => {
  it('validates DEFAULT_APP_SETTINGS successfully', () => {
    const parsed = appSettingsSchema.parse(DEFAULT_APP_SETTINGS)
    expect(parsed.language).toBe('en')
    expect(parsed.cachePolicy).toBe('keep')
    expect(parsed.defaultFps).toBe(30)
    expect(parsed.hardwareAcceleration).toBe(true)
  })

  it('allows overriding partial values while preserving structure', () => {
    const custom = {
      ...DEFAULT_APP_SETTINGS,
      language: 'vi' as const,
      defaultFps: 60,
    }
    const parsed = appSettingsSchema.parse(custom)
    expect(parsed.language).toBe('vi')
    expect(parsed.defaultFps).toBe(60)
  })

  it('validates IPC schemas for getCacheInfo and clearCache', () => {
    expect(electronAPISchemas.getCacheInfo).toBeDefined()
    expect(electronAPISchemas.clearCache).toBeDefined()

    const sampleCacheInfo = {
      cachePath: 'C:\\Users\\test\\AppData\\Local\\Temp\\komfyedit-previews',
      sizeBytes: 1048576,
      formattedSize: '1.00 MB',
    }
    expect(electronAPISchemas.getCacheInfo.output.parse(sampleCacheInfo)).toEqual(sampleCacheInfo)

    const sampleClearResult = {
      success: true,
      freedBytes: 1048576,
    }
    expect(electronAPISchemas.clearCache.output.parse(sampleClearResult)).toEqual(sampleClearResult)
  })

  it('validates autoSave interval 0 (major changes only) and exportNotifications', () => {
    const custom = {
      ...DEFAULT_APP_SETTINGS,
      autoSaveIntervalMinutes: 0,
      exportNotifications: true,
    }
    const parsed = appSettingsSchema.parse(custom)
    expect(parsed.autoSaveIntervalMinutes).toBe(0)
    expect(parsed.exportNotifications).toBe(true)
  })

  it('validates showNotification IPC schema', () => {
    expect(electronAPISchemas.showNotification).toBeDefined()
    const validInput = {
      title: 'Export Complete',
      body: 'Video exported successfully',
      filePath: '/path/to/exported.mp4',
    }
    expect(electronAPISchemas.showNotification.input.parse(validInput)).toEqual(validInput)
    expect(electronAPISchemas.showNotification.output.parse(true)).toBe(true)
  })
})

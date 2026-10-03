import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  deleteTemplate,
  getTemplatesDir,
  isSafeTemplateFileName,
  listTemplates,
  readTemplate,
  templateFileName,
  writeTemplate,
} from '../template-file-storage'
import { spawnSync } from 'child_process'
import { buildTemplateFromTimeline } from '../../../core/src/template-model'
import { findFfmpegPath } from '../../export/ffmpeg-utils'
import type { Timeline, TimelineClip } from '../../../core/src/project-model'

const clip = (over: Partial<TimelineClip>): TimelineClip => ({
  id: 'c', type: 'video', startTime: 0, duration: 3,
  trimStart: 0, trimEnd: 0, trackIndex: 0, speed: 1, assetId: 'a', asset: null,
  ...over,
} as TimelineClip)

const timeline: Timeline = {
  id: 'tl', name: 'Timeline 1', createdAt: 0,
  tracks: [{ id: 'v1', name: 'V1', muted: false, locked: false, kind: 'video' }],
  clips: [clip({ id: 'shot-1' })],
  subtitles: [],
  width: 1080,
  height: 1920,
}

describe('template file storage', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-templates-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  describe('getTemplatesDir', () => {
    /*
     * `presetsDir` has sat in the settings schema with no reader since it was
     * added, so the empty case is the one that actually ships first.
     */
    it('falls back to a folder of its own when no presets path is set', async () => {
      expect(getTemplatesDir('')).toMatch(/templates$/)
      expect(getTemplatesDir(undefined)).toMatch(/templates$/)
    })

    it('puts templates under the presets path when there is one', async () => {
      expect(getTemplatesDir('C:/presets')).toBe(path.join('C:/presets', 'templates'))
    })
  })

  describe('templateFileName', () => {
    /* The name comes from a text box, so it can hold path navigation. */
    it('strips anything a file system would read as a path', async () => {
      const name = templateFileName({ id: 'tpl-1', name: '../../etc/passwd' })
      expect(name).not.toContain('..')
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
      expect(path.basename(name)).toBe(name)
    })

    it('keeps letters of any script, so a Vietnamese name survives', async () => {
      expect(templateFileName({ id: 'tpl-1', name: 'Nhịp nhanh' })).toContain('Nhịp nhanh')
    })

    it('still produces a usable name when everything is stripped', async () => {
      expect(templateFileName({ id: 'tpl-1', name: '///' })).toContain('tpl-1')
    })
  })

  it('refuses a file name that could escape the folder', async () => {
    expect(isSafeTemplateFileName('ok.komfytemplate')).toBe(true)
    expect(isSafeTemplateFileName('../ok.komfytemplate')).toBe(false)
    expect(isSafeTemplateFileName('sub/ok.komfytemplate')).toBe(false)
    expect(isSafeTemplateFileName('notes.txt')).toBe(false)
  })

  it('writes a template and reads back exactly what went in', async () => {
    const template = buildTemplateFromTimeline(timeline, { name: 'Nhịp nhanh' }).template
    const written = await writeTemplate(dir, template)
    expect(written.success).toBe(true)

    const read = readTemplate(dir, (written as { fileName: string }).fileName)
    expect(read.success).toBe(true)
    if (read.success) {
      expect(read.template.name).toBe('Nhịp nhanh')
      expect(read.template.slots).toHaveLength(1)
      expect(read.template.width).toBe(1080)
    }
  })

  it('leaves no temporary file behind after a successful write', async () => {
    await writeTemplate(dir, buildTemplateFromTimeline(timeline, { name: 'A' }).template)
    expect(fs.readdirSync(dir).some(f => f.endsWith('.tmp'))).toBe(false)
  })

  it('lists templates newest first, with what a card needs', async () => {
    await writeTemplate(dir, { ...buildTemplateFromTimeline(timeline, { name: 'Cũ' }).template, createdAt: 1 })
    await writeTemplate(dir, { ...buildTemplateFromTimeline(timeline, { name: 'Mới' }).template, createdAt: 2 })

    const list = listTemplates(dir)
    expect(list.map(s => s.name)).toEqual(['Mới', 'Cũ'])
    expect(list[0].slotCount).toBe(1)
    expect(list[0].durationSec).toBe(3)
  })

  /* One corrupt file must not take the whole library down with it. */
  it('skips a template it cannot parse instead of failing the listing', async () => {
    await writeTemplate(dir, buildTemplateFromTimeline(timeline, { name: 'Tốt' }).template)
    fs.writeFileSync(path.join(dir, 'broken.komfytemplate'), '{ not json', 'utf8')
    fs.writeFileSync(path.join(dir, 'wrong-shape.komfytemplate'), '{"format":1}', 'utf8')

    const list = listTemplates(dir)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Tốt')
  })

  it('returns an empty list for a folder that does not exist yet', async () => {
    expect(listTemplates(path.join(dir, 'nope'))).toEqual([])
  })

  it('refuses to write a document that is not a template', async () => {
    const result = await writeTemplate(dir, { name: 'nope' } as never)
    expect(result.success).toBe(false)
  })

  it('deletes a template and says so when the name is unsafe', async () => {
    const written = await writeTemplate(dir, buildTemplateFromTimeline(timeline, { name: 'Xoá' }).template)
    const fileName = (written as { fileName: string }).fileName

    expect(deleteTemplate(dir, '../escape.komfytemplate').success).toBe(false)
    expect(deleteTemplate(dir, fileName).success).toBe(true)
    expect(listTemplates(dir)).toEqual([])
  })

  /*
   * A template that carries a music bed is a FOLDER, not a file. Both shapes
   * have to keep working: templates saved before bundled media existed are
   * single files, and deleting them must still work.
   */
  describe('templates that carry their own media', () => {
    let sourceDir: string

    const timelineWithMusic = (musicPath: string): Timeline => ({
      ...timeline,
      clips: [
        clip({ id: 'shot-1' }),
        clip({
          id: 'music', type: 'audio', trackIndex: 1, duration: 5,
          asset: { id: 'a-music', type: 'audio', path: musicPath, prompt: '', resolution: '', createdAt: 0 },
        } as Partial<TimelineClip>),
      ],
    })

    beforeEach(() => {
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-src-'))
      fs.writeFileSync(path.join(sourceDir, 'beat.mp3'), 'FAKE-AUDIO', 'utf8')
    })
    afterEach(() => {
      fs.rmSync(sourceDir, { recursive: true, force: true })
    })

    const build = () => buildTemplateFromTimeline(
      timelineWithMusic(path.join(sourceDir, 'beat.mp3')),
      { name: 'Có nhạc' },
    )

    it('saves as a folder holding the document and the media', async () => {
      const { template, media } = build()
      const written = await writeTemplate(dir, template, media)
      expect(written.success).toBe(true)

      const entryPath = path.join(dir, (written as { fileName: string }).fileName)
      expect(fs.statSync(entryPath).isDirectory()).toBe(true)
      expect(fs.existsSync(path.join(entryPath, 'template.json'))).toBe(true)
      expect(fs.readFileSync(path.join(entryPath, 'media', 'beat.mp3'), 'utf8')).toBe('FAKE-AUDIO')
    })

    it('leaves no staging folder behind', async () => {
      const { template, media } = build()
      await writeTemplate(dir, template, media)
      expect(fs.readdirSync(dir).some(f => f.endsWith('.staging'))).toBe(false)
    })

    /* On disk the path stays portable; in memory it has to be openable. */
    it('reads the media back as a path on this machine', async () => {
      const { template, media } = build()
      const written = await writeTemplate(dir, template, media)
      const fileName = (written as { fileName: string }).fileName

      const onDisk = JSON.parse(
        fs.readFileSync(path.join(dir, fileName, 'template.json'), 'utf8'),
      )
      expect(JSON.stringify(onDisk)).not.toContain(sourceDir)

      const read = readTemplate(dir, fileName)
      expect(read.success).toBe(true)
      if (read.success) {
        const music = read.template.timeline.clips.find(c => c.type === 'audio')!
        expect(fs.existsSync(music.asset!.path)).toBe(true)
        expect(music.asset!.path).toContain(fileName)
      }
    })

    it('appears in the listing beside single-file templates', async () => {
      const { template, media } = build()
      await writeTemplate(dir, template, media)
      await writeTemplate(dir, buildTemplateFromTimeline(timeline, { name: 'Trơn' }).template)

      expect(listTemplates(dir).map(s => s.name).sort()).toEqual(['Có nhạc', 'Trơn'])
    })

    it('deletes the whole folder, media and all', async () => {
      const { template, media } = build()
      const written = await writeTemplate(dir, template, media)
      const fileName = (written as { fileName: string }).fileName

      expect(deleteTemplate(dir, fileName).success).toBe(true)
      expect(fs.existsSync(path.join(dir, fileName))).toBe(false)
      expect(listTemplates(dir)).toEqual([])
    })

    it('replaces an earlier save of the same template cleanly', async () => {
      const { template, media } = build()
      await writeTemplate(dir, template, media)
      const again = await writeTemplate(dir, template, media)
      expect(again.success).toBe(true)
      expect(listTemplates(dir)).toHaveLength(1)
    })

    it('survives two saves of the same template at once', async () => {
      const { template, media } = build()
      const results = await Promise.all([
        writeTemplate(dir, template, media),
        writeTemplate(dir, template, media),
      ])
      expect(results.every(r => r.success)).toBe(true)
      expect(listTemplates(dir)).toHaveLength(1)
      expect(fs.readdirSync(dir).some(f => f.endsWith('.staging'))).toBe(false)
    })
  })

  /*
   * Deleting used to report success and leave the template on disk.
   *
   * `fs.rmSync(path, { recursive: true })` silently no-ops on Windows for any
   * path holding a non-ASCII character — no throw, nothing removed. Every
   * Vietnamese template name hits it, which is most of them here, so both
   * shapes are pinned with a name that would have failed.
   */
  describe('names with Vietnamese characters', () => {
    it('deletes a single-file template called "Xoá"', async () => {
      const written = await writeTemplate(dir, buildTemplateFromTimeline(timeline, { name: 'Xoá' }).template)
      const fileName = (written as { fileName: string }).fileName
      expect(fileName).toContain('Xoá')

      expect(deleteTemplate(dir, fileName).success).toBe(true)
      expect(fs.existsSync(path.join(dir, fileName))).toBe(false)
    })

    it('deletes a folder template called "Có nhạc", media and all', async () => {
      const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-src-'))
      fs.writeFileSync(path.join(sourceDir, 'beat.mp3'), 'A', 'utf8')
      try {
        const { template, media } = buildTemplateFromTimeline({
          ...timeline,
          clips: [
            clip({ id: 'shot-1' }),
            clip({
              id: 'music', type: 'audio', trackIndex: 1,
              asset: {
                id: 'm', type: 'audio', path: path.join(sourceDir, 'beat.mp3'),
                prompt: '', resolution: '', createdAt: 0,
              },
            } as Partial<TimelineClip>),
          ],
        }, { name: 'Có nhạc' })

        const written = await writeTemplate(dir, template, media)
        const fileName = (written as { fileName: string }).fileName
        expect(fileName).toContain('Có nhạc')

        expect(deleteTemplate(dir, fileName).success).toBe(true)
        expect(fs.existsSync(path.join(dir, fileName))).toBe(false)
      } finally {
        fs.rmSync(sourceDir, { recursive: true, force: true })
      }
    })
  })

  /*
   * The cover is a frame of the edit as it stood when it was saved. That is the
   * whole trick behind template previews: a template is taken FROM a finished
   * video, so at save time there is a finished video to photograph.
   */
  describe('cover image', () => {
    let sourceDir: string
    let videoPath: string

    beforeEach(() => {
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-cover-'))
      videoPath = path.join(sourceDir, 'clip.mp4')
      // A real two-second clip, so ffmpeg has something to seek into.
      const ffmpeg = findFfmpegPath()
      spawnSync(ffmpeg!, [
        '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2',
        '-pix_fmt', 'yuv420p', videoPath,
      ], { timeout: 60000 })
    })
    afterEach(() => {
      fs.rmSync(sourceDir, { recursive: true, force: true })
    })

    it('writes a cover into the template folder and points the card at it', async () => {
      expect(fs.existsSync(videoPath)).toBe(true)

      const { template, media } = buildTemplateFromTimeline(timeline, { name: 'Có bìa' })
      const written = await writeTemplate(dir, template, media, { videoPath, seekTime: 1 })
      expect(written.success).toBe(true)

      const fileName = (written as { fileName: string }).fileName
      const coverOnDisk = path.join(dir, fileName, 'cover.jpg')
      expect(fs.existsSync(coverOnDisk)).toBe(true)
      expect(fs.statSync(coverOnDisk).size).toBeGreaterThan(0)

      const [summary] = listTemplates(dir)
      expect(summary.coverPath).toBe(coverOnDisk)
    })

    /* Asking for a cover means asking for the folder shape, media or not. */
    it('turns a template with no media of its own into a folder to hold it', async () => {
      const { template } = buildTemplateFromTimeline(timeline, { name: 'Trơn có bìa' })
      const written = await writeTemplate(dir, template, [], { videoPath, seekTime: 0.5 })
      const entryPath = path.join(dir, (written as { fileName: string }).fileName)
      expect(fs.statSync(entryPath).isDirectory()).toBe(true)
    })

    it('still saves the template when the frame cannot be grabbed', async () => {
      const { template } = buildTemplateFromTimeline(timeline, { name: 'Bìa hỏng' })
      const written = await writeTemplate(dir, template, [], {
        videoPath: path.join(sourceDir, 'khong-ton-tai.mp4'),
        seekTime: 1,
      })
      expect(written.success).toBe(true)

      const [summary] = listTemplates(dir)
      expect(summary.name).toBe('Bìa hỏng')
      expect(summary.coverPath).toBeUndefined()
    })

    it('leaves a template with no cover asked for as a single file', async () => {
      const { template } = buildTemplateFromTimeline(timeline, { name: 'Không bìa' })
      const written = await writeTemplate(dir, template)
      const entryPath = path.join(dir, (written as { fileName: string }).fileName)
      expect(fs.statSync(entryPath).isFile()).toBe(true)
      expect(listTemplates(dir)[0].coverPath).toBeUndefined()
    })
  })
})

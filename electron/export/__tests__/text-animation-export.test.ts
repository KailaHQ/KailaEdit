import { describe, it, expect } from 'vitest'
import { buildVideoFilterGraph } from '../video-filter'
import type { ExportClip } from '../timeline'
import { applyTextAnimation, createTextClipWithPreset } from '../../../core/src/text-presets'

describe('KE-701: Text Animation Filtergraph Export', () => {
  const baseCanvas = {
    width: 1920,
    height: 1080,
    fps: 30,
    background: { type: 'color' as const, color: '#000000' },
  }

  const baseClip: ExportClip = {
    path: 'sample.mp4',
    type: 'video',
    startTime: 0,
    duration: 5,
    trimStart: 0,
    speed: 1,
    reversed: false,
    flipH: false,
    flipV: false,
    opacity: 100,
    trackIndex: 0,
    muted: false,
    volume: 1,
  }

  it('exports static text clip with standard drawtext filter without keyframe expressions', () => {
    const textClip: ExportClip = {
      path: '',
      type: 'text',
      startTime: 1,
      duration: 3,
      trimStart: 0,
      speed: 1,
      reversed: false,
      flipH: false,
      flipV: false,
      opacity: 100,
      trackIndex: 1,
      muted: true,
      volume: 1,
      textStyle: {
        text: 'Static Title',
        fontSize: 64,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        positionX: 50,
        positionY: 50,
        strokeColor: 'transparent',
        strokeWidth: 0,
        padding: 0,
        opacity: 100,
      },
    }

    const { filterScript: fg } = buildVideoFilterGraph(
      [baseClip, textClip],
      { ...baseCanvas, totalDuration: 5 },
    )

    expect(fg).toContain("drawtext=text='Static Title'")
    expect(fg).toContain("fontsize=64")
    expect(fg).toContain("fontcolor=0xFFFFFF@1.00")
    expect(fg).toContain("enable='between(t\\,1.000\\,4.000)'")
  })

  it('exports fly-in animation with dynamic positionY expression in drawtext', () => {
    const raw = createTextClipWithPreset('default', 'fly-in', 'Fly In Title', 0, 1, 4)
    const textClip: ExportClip = {
      ...raw,
      path: '',
      textStyle: {
        text: raw.textStyle!.text,
        fontSize: raw.textStyle!.fontSize,
        color: raw.textStyle!.color,
        backgroundColor: raw.textStyle!.backgroundColor,
        positionX: raw.textStyle!.positionX,
        positionY: raw.textStyle!.positionY,
        strokeColor: raw.textStyle!.strokeColor,
        strokeWidth: raw.textStyle!.strokeWidth,
        padding: raw.textStyle!.padding,
        opacity: raw.textStyle!.opacity,
      },
    }

    const { filterScript: fg } = buildVideoFilterGraph(
      [baseClip, textClip],
      { ...baseCanvas, totalDuration: 5 },
    )

    expect(fg).toContain("drawtext=text='Fly In Title'")
    // Contains yExpr with nested time expression
    expect(fg).toContain("y=(h-text_h)*")
    expect(fg).toContain("if(lte((t-0.000),0)")
    // The flight starts at the frame edge, so it needs no fade to hide its start
    expect(fg).not.toContain("alpha='")
  })

  it('exports slide-in animation with dynamic positionX expression in drawtext', () => {
    const raw = createTextClipWithPreset('default', 'slide-in', 'Slide In Title', 0, 1, 4)
    const textClip: ExportClip = {
      ...raw,
      path: '',
      textStyle: {
        text: raw.textStyle!.text,
        fontSize: raw.textStyle!.fontSize,
        color: raw.textStyle!.color,
        backgroundColor: raw.textStyle!.backgroundColor,
        positionX: raw.textStyle!.positionX,
        positionY: raw.textStyle!.positionY,
        strokeColor: raw.textStyle!.strokeColor,
        strokeWidth: raw.textStyle!.strokeWidth,
        padding: raw.textStyle!.padding,
        opacity: raw.textStyle!.opacity,
      },
    }

    const { filterScript: fg } = buildVideoFilterGraph(
      [baseClip, textClip],
      { ...baseCanvas, totalDuration: 5 },
    )

    expect(fg).toContain("drawtext=text='Slide In Title'")
    expect(fg).toContain("x=(w-text_w)*")
    expect(fg).toContain("if(lte((t-0.000),0)")
  })

  it('exports pop animation with dynamic fontsize expression in drawtext', () => {
    const raw = createTextClipWithPreset('default', 'pop', 'Pop Title', 0, 1, 4)
    const textClip: ExportClip = {
      ...raw,
      path: '',
      textStyle: {
        text: raw.textStyle!.text,
        fontSize: raw.textStyle!.fontSize,
        color: raw.textStyle!.color,
        backgroundColor: raw.textStyle!.backgroundColor,
        positionX: raw.textStyle!.positionX,
        positionY: raw.textStyle!.positionY,
        strokeColor: raw.textStyle!.strokeColor,
        strokeWidth: raw.textStyle!.strokeWidth,
        padding: raw.textStyle!.padding,
        opacity: raw.textStyle!.opacity,
      },
    }

    const { filterScript: fg } = buildVideoFilterGraph(
      [baseClip, textClip],
      { ...baseCanvas, totalDuration: 5 },
    )

    expect(fg).toContain("drawtext=text='Pop Title'")
    expect(fg).toContain("fontsize='64*(")
    expect(fg).toContain("if(lte((t-0.000),0)")
  })

  it('exports typewriter animation with time-sliced progressive drawtext filters', () => {
    const raw = createTextClipWithPreset('default', 'typewriter', 'HELLO', 1, 1, 4)
    const textClip: ExportClip = {
      ...raw,
      path: '',
      textStyle: {
        text: raw.textStyle!.text,
        fontSize: raw.textStyle!.fontSize,
        color: raw.textStyle!.color,
        backgroundColor: raw.textStyle!.backgroundColor,
        positionX: raw.textStyle!.positionX,
        positionY: raw.textStyle!.positionY,
        strokeColor: raw.textStyle!.strokeColor,
        strokeWidth: raw.textStyle!.strokeWidth,
        padding: raw.textStyle!.padding,
        opacity: raw.textStyle!.opacity,
      },
    }

    const { filterScript: fg } = buildVideoFilterGraph(
      [baseClip, textClip],
      { ...baseCanvas, totalDuration: 5 },
    )

    // Slices for H, HE, HEL, HELL, HELLO
    expect(fg).toContain("drawtext=text='H':")
    expect(fg).toContain("drawtext=text='HE':")
    expect(fg).toContain("drawtext=text='HEL':")
    expect(fg).toContain("drawtext=text='HELL':")
    expect(fg).toContain("drawtext=text='HELLO':")
  })
})

import fs from 'fs';
import path from 'path';
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CLIP_TRANSITION,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_TEXT_STYLE,
  type TimelineClip,
  type Track,
} from '../core/src/project-model';
import {
  TEMPLATE_FORMAT_VERSION,
  komfyTemplateSchema,
  type KomfyTemplate,
  type TemplateSlot,
} from '../core/src/template-model';
import { APP_FOLDER_NAME, resolveUserDataDir } from '../core/src/app-paths';

/**
 * Where the app actually reads templates from.
 *
 * `getTemplatesDir()` falls back to `app.getPath('userData')`, and
 * `electron/app-paths.ts` overrides that with `resolveUserDataDir()`. Deriving
 * the path from the same function instead of spelling the folder name out
 * again is what survives a rename: these three were still pointing at
 * `KomfyEdit` after the app had moved to `KailaEdit`, so every template this
 * script wrote landed somewhere nothing reads.
 */
const userDataTemplatesDir = path.join(resolveUserDataDir(), 'templates');
/** Second target for a machine whose data still sits in Roaming, which is where Electron puts userData when nothing overrides it. */
const roamingAppDataTemplatesDir = path.join(process.env.APPDATA || '', APP_FOLDER_NAME, 'templates');
/** A dev run against a checkout rather than an installed app. */
const workspaceTemplatesDir = path.join(process.cwd(), '.kailaedit-data', 'templates');

const scratchDir = 'C:\\Users\\tuyenhm\\.gemini\\antigravity-ide\\brain\\66608311-8e76-423b-ac60-bdde5fc35494\\scratch';

function punchIn(dur: number, from = 100, to = 118): TimelineClip['keyframes'] {
  return [
    {
      property: 'transform.scale',
      points: [
        { t: 0, value: from, easing: 'ease-out' },
        { t: Number(dur.toFixed(3)), value: to, easing: 'ease-out' },
      ],
    },
  ];
}

function deployTemplate(
  templateFolderStem: string,
  templateObj: KomfyTemplate,
  mediaFiles: Record<string, string>,
  coverFilePath?: string
) {
  // Validate schema first!
  const validated = komfyTemplateSchema.parse(templateObj);

  for (const baseDir of [userDataTemplatesDir, roamingAppDataTemplatesDir, workspaceTemplatesDir]) {
    const templateDir = path.join(baseDir, `${templateFolderStem}.komfytemplate`);
    if (fs.existsSync(templateDir)) {
      fs.rmSync(templateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(templateDir, { recursive: true });
    fs.mkdirSync(path.join(templateDir, 'media'), { recursive: true });

    // 1. Write template.json
    fs.writeFileSync(
      path.join(templateDir, 'template.json'),
      JSON.stringify(validated, null, 2),
      'utf8'
    );

    // 2. Copy cover
    if (coverFilePath && fs.existsSync(coverFilePath)) {
      fs.copyFileSync(coverFilePath, path.join(templateDir, 'cover.jpg'));
    }

    // 3. Copy bundled media
    for (const [leafName, srcPath] of Object.entries(mediaFiles)) {
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(templateDir, 'media', leafName));
      }
    }

    console.log(`[DEPLOYED PRO TEMPLATE] at: ${templateDir}`);
  }
}

// ════════════════════════════════════════════════════════════════
// TEMPLATE 1: Pro · Beat Drop & Flash (1080x1920)
// ════════════════════════════════════════════════════════════════
function buildBeatDropTemplate(): KomfyTemplate {
  const templateId = 'pro-beat-drop';
  const name = 'Pro · Beat Drop & Flash';
  const slotDurations = [1.5, 1.2, 1.2, 1.8, 1.5, 2.8]; // 10s total

  const slots: TemplateSlot[] = [];
  const clips: TimelineClip[] = [];
  const transitions: any[] = [];
  let curTime = 0;

  slotDurations.forEach((dur, idx) => {
    const clipId = `shot-beat-${idx + 1}`;
    slots.push({
      slotIndex: idx + 1,
      clipId: clipId,
      duration: dur,
      kind: 'video',
      label: `Beat Shot ${idx + 1} (${dur}s)`,
    });

    const isZoomOut = idx % 2 === 1;
    const scaleFrom = isZoomOut ? 116 : 100;
    const scaleTo = isZoomOut ? 100 : 118;

    clips.push({
      id: clipId,
      assetId: null,
      asset: null,
      type: 'video',
      startTime: Number(curTime.toFixed(3)),
      duration: dur,
      trimStart: 0,
      trimEnd: dur,
      speed: 1,
      volume: 1,
      trackIndex: 0,
      opacity: 100,
      filter: { id: 'cine-teal-orange', intensity: 85 },
      transform: {
        ...DEFAULT_CLIP_TRANSFORM,
        scale: scaleFrom,
      },
      keyframes: punchIn(dur, scaleFrom, scaleTo),
      colorCorrection: {
        ...DEFAULT_COLOR_CORRECTION,
        brightness: 5,
        contrast: 15,
        saturation: 20,
        highlights: 10,
        shadows: -5,
      },
      transitionIn: idx === 3 ? { type: 'fade-to-white', duration: 0.25 } : DEFAULT_CLIP_TRANSITION,
      transitionOut: DEFAULT_CLIP_TRANSITION,
      flipH: false,
      flipV: false,
      reversed: false,
      muted: false,
    } as TimelineClip);

    if (idx > 0) {
      transitions.push({
        id: `tr-beat-${idx}`,
        trackIndex: 0,
        leftClipId: `shot-beat-${idx}`,
        rightClipId: clipId,
        type: idx === 3 ? 'fade-to-white' : (idx % 2 === 0 ? 'zoom-in' : 'blur-dissolve'),
        duration: 0.25,
      });
    }

    curTime += dur;
  });

  const totalDur = Number(curTime.toFixed(3));

  // Kinetic Titles
  clips.push({
    id: 'title-hook',
    assetId: null,
    asset: null,
    type: 'text',
    startTime: 0,
    duration: 2.7,
    trimStart: 0,
    trimEnd: 2.7,
    speed: 1,
    volume: 1,
    trackIndex: 1,
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transitionIn: { type: 'fade-to-white', duration: 0.3 },
    transitionOut: { type: 'fade-to-black', duration: 0.3 },
    flipH: false,
    flipV: false,
    reversed: false,
    muted: true,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      text: '⚡ DROP THE BEAT',
      fontFamily: 'Montserrat',
      fontSize: 96,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#FFF500',
      backgroundColor: 'transparent',
      strokeColor: '#000000',
      strokeWidth: 10,
      positionX: 50,
      positionY: 28,
      textAlign: 'center',
      shadowColor: 'rgba(0,0,0,0.85)',
      shadowBlur: 16,
      shadowOffsetX: 4,
      shadowOffsetY: 6,
    },
  } as TimelineClip);

  clips.push({
    id: 'title-drop-sub',
    assetId: null,
    asset: null,
    type: 'text',
    startTime: 3.9,
    duration: 3.3,
    trimStart: 0,
    trimEnd: 3.3,
    speed: 1,
    volume: 1,
    trackIndex: 1,
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transitionIn: DEFAULT_CLIP_TRANSITION,
    transitionOut: { type: 'dissolve', duration: 0.3 },
    flipH: false,
    flipV: false,
    reversed: false,
    muted: true,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      text: 'FEEL THE RHYTHM',
      fontFamily: 'Outfit',
      fontSize: 84,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#FFFFFF',
      backgroundColor: 'transparent',
      strokeColor: '#000000',
      strokeWidth: 8,
      positionX: 50,
      positionY: 72,
      textAlign: 'center',
      shadowColor: 'rgba(0,0,0,0.8)',
      shadowBlur: 12,
      shadowOffsetX: 2,
      shadowOffsetY: 4,
    },
  } as TimelineClip);

  clips.push({
    id: 'title-cta',
    assetId: null,
    asset: null,
    type: 'text',
    startTime: 7.2,
    duration: 2.8,
    trimStart: 0,
    trimEnd: 2.8,
    speed: 1,
    volume: 1,
    trackIndex: 1,
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transitionIn: { type: 'dissolve', duration: 0.4 },
    transitionOut: DEFAULT_CLIP_TRANSITION,
    flipH: false,
    flipV: false,
    reversed: false,
    muted: true,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      text: 'FOLLOW FOR MORE · @KAILAEDIT',
      fontFamily: 'Inter',
      fontSize: 48,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#FFFFFF',
      backgroundColor: 'transparent',
      strokeColor: '#000000',
      strokeWidth: 6,
      positionX: 50,
      positionY: 88,
      textAlign: 'center',
      shadowColor: 'rgba(0,0,0,0.7)',
      shadowBlur: 8,
      shadowOffsetX: 2,
      shadowOffsetY: 3,
    },
  } as TimelineClip);

  // Background Audio bed
  clips.push({
    id: 'clip-bgm',
    assetId: 'asset-bgm',
    type: 'audio',
    startTime: 0,
    duration: totalDur,
    trimStart: 0,
    trimEnd: totalDur,
    speed: 1,
    volume: 1,
    trackIndex: 2,
    asset: {
      id: 'asset-bgm',
      type: 'audio',
      path: 'media/music.mp3',
      createdAt: Date.now(),
      prompt: 'TikTok Beat Drop Music',
      resolution: '',
    },
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transitionIn: DEFAULT_CLIP_TRANSITION,
    transitionOut: DEFAULT_CLIP_TRANSITION,
    flipH: false,
    flipV: false,
    reversed: false,
    muted: false,
  } as TimelineClip);

  return {
    format: TEMPLATE_FORMAT_VERSION,
    id: templateId,
    name: name,
    category: 'montage',
    createdAt: Date.now(),
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: totalDur,
    slots,
    bundledMedia: ['music.mp3'],
    cover: 'cover.jpg',
    timeline: {
      id: `tl-${templateId}`,
      name: name,
      createdAt: Date.now(),
      tracks: [
        { id: 'track-v1', name: 'Footage (Beat Sync)', muted: false, locked: false, kind: 'video', type: 'default' },
        { id: 'track-text', name: 'Kinetic Text', muted: false, locked: false, kind: 'video', type: 'default' },
        { id: 'track-audio', name: 'Music Bed', muted: false, locked: false, kind: 'audio', type: 'default' },
      ],
      clips,
      subtitles: [],
      transitions,
      width: 1080,
      height: 1920,
      fps: 30,
    },
  };
}

// ════════════════════════════════════════════════════════════════
// TEMPLATE 2: Pro · Cinematic Vlog Story (1080x1920)
// ════════════════════════════════════════════════════════════════
function buildCinematicVlogTemplate(): KomfyTemplate {
  const templateId = 'pro-cinematic-vlog';
  const name = 'Pro · Cinematic Vlog Story';
  const slotDurations = [2.5, 3.0, 3.0, 3.5]; // 12.0s total

  const slots: TemplateSlot[] = [];
  const clips: TimelineClip[] = [];
  const transitions: any[] = [];
  let curTime = 0;

  slotDurations.forEach((dur, idx) => {
    const clipId = `shot-vlog-${idx + 1}`;
    slots.push({
      slotIndex: idx + 1,
      clipId: clipId,
      duration: dur,
      kind: 'video',
      label: `Vlog Scene ${idx + 1} (${dur}s)`,
    });

    const scaleFrom = 100 + (idx % 2 === 0 ? 0 : 8);
    const scaleTo = scaleFrom + (idx % 2 === 0 ? 10 : -8);

    clips.push({
      id: clipId,
      assetId: null,
      asset: null,
      type: 'video',
      startTime: Number(curTime.toFixed(3)),
      duration: dur,
      trimStart: 0,
      trimEnd: dur,
      speed: 1,
      volume: 1,
      trackIndex: 0,
      opacity: 100,
      filter: { id: 'golden-hour', intensity: 90 },
      transform: {
        ...DEFAULT_CLIP_TRANSFORM,
        scale: scaleFrom,
      },
      keyframes: punchIn(dur, scaleFrom, scaleTo),
      colorCorrection: {
        ...DEFAULT_COLOR_CORRECTION,
        brightness: 8,
        contrast: 10,
        saturation: 15,
        temperature: 10,
      },
      transitionIn: idx > 0 ? { type: 'dissolve', duration: 0.4 } : DEFAULT_CLIP_TRANSITION,
      transitionOut: DEFAULT_CLIP_TRANSITION,
      flipH: false,
      flipV: false,
      reversed: false,
      muted: false,
    } as TimelineClip);

    if (idx > 0) {
      transitions.push({
        id: `tr-vlog-${idx}`,
        trackIndex: 0,
        leftClipId: `shot-vlog-${idx}`,
        rightClipId: clipId,
        type: 'blur-dissolve',
        duration: 0.4,
      });
    }

    curTime += dur;
  });

  const totalDur = Number(curTime.toFixed(3));

  // Minimal Aesthetic Titles
  clips.push({
    id: 'title-vlog-heading',
    assetId: null,
    asset: null,
    type: 'text',
    startTime: 0.3,
    duration: 4.5,
    trimStart: 0,
    trimEnd: 4.5,
    speed: 1,
    volume: 1,
    trackIndex: 1,
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transitionIn: { type: 'dissolve', duration: 0.6 },
    transitionOut: { type: 'dissolve', duration: 0.6 },
    flipH: false,
    flipV: false,
    reversed: false,
    muted: true,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      text: 'MEMORIES · 2026',
      fontFamily: 'Outfit',
      fontSize: 72,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#FFFFFF',
      backgroundColor: 'transparent',
      strokeColor: 'rgba(0,0,0,0.5)',
      strokeWidth: 4,
      positionX: 50,
      positionY: 20,
      textAlign: 'center',
      letterSpacing: 4,
      shadowColor: 'rgba(0,0,0,0.6)',
      shadowBlur: 10,
      shadowOffsetX: 2,
      shadowOffsetY: 3,
    },
  } as TimelineClip);

  clips.push({
    id: 'title-vlog-outro',
    assetId: null,
    asset: null,
    type: 'text',
    startTime: 8.5,
    duration: 3.5,
    trimStart: 0,
    trimEnd: 3.5,
    speed: 1,
    volume: 1,
    trackIndex: 1,
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transitionIn: { type: 'dissolve', duration: 0.5 },
    transitionOut: DEFAULT_CLIP_TRANSITION,
    flipH: false,
    flipV: false,
    reversed: false,
    muted: true,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      text: 'LIFE IN MOTION',
      fontFamily: 'Playfair Display',
      fontSize: 64,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#FFF8E7',
      backgroundColor: 'transparent',
      strokeColor: '#000000',
      strokeWidth: 4,
      positionX: 50,
      positionY: 82,
      textAlign: 'center',
      letterSpacing: 2,
      shadowColor: 'rgba(0,0,0,0.8)',
      shadowBlur: 12,
      shadowOffsetX: 2,
      shadowOffsetY: 4,
    },
  } as TimelineClip);

  // Audio bed
  clips.push({
    id: 'clip-vlog-bgm',
    assetId: 'asset-vlog-bgm',
    type: 'audio',
    startTime: 0,
    duration: totalDur,
    trimStart: 0,
    trimEnd: totalDur,
    speed: 1,
    volume: 1,
    trackIndex: 2,
    asset: {
      id: 'asset-vlog-bgm',
      type: 'audio',
      path: 'media/vlog_music.mp3',
      createdAt: Date.now(),
      prompt: 'Aesthetic Chill Vlog Music',
      resolution: '',
    },
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transitionIn: DEFAULT_CLIP_TRANSITION,
    transitionOut: DEFAULT_CLIP_TRANSITION,
    flipH: false,
    flipV: false,
    reversed: false,
    muted: false,
  } as TimelineClip);

  return {
    format: TEMPLATE_FORMAT_VERSION,
    id: templateId,
    name: name,
    category: 'montage',
    createdAt: Date.now(),
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: totalDur,
    slots,
    bundledMedia: ['vlog_music.mp3'],
    cover: 'cover.jpg',
    timeline: {
      id: `tl-${templateId}`,
      name: name,
      createdAt: Date.now(),
      tracks: [
        { id: 'track-v1', name: 'Cinematic Footage', muted: false, locked: false, kind: 'video', type: 'default' },
        { id: 'track-text', name: 'Kinetic Titles', muted: false, locked: false, kind: 'video', type: 'default' },
        { id: 'track-audio', name: 'Audio Bed', muted: false, locked: false, kind: 'audio', type: 'default' },
      ],
      clips,
      subtitles: [],
      transitions,
      width: 1080,
      height: 1920,
      fps: 30,
    },
  };
}

async function main() {
  const t1 = buildBeatDropTemplate();
  const t2 = buildCinematicVlogTemplate();

  const audio1 = path.join(scratchDir, 'scratch', 'online_music.mp3');
  const audio2 = 'C:/Users/tuyenhm/Downloads/Windows_Open_Wide.mp3';
  const coverPath = path.join(scratchDir, 'scratch', 'online_cover.jpg');

  deployTemplate('Pro Beat Drop & Flash (pro-beat-drop)', t1, { 'music.mp3': audio1 }, coverPath);
  deployTemplate('Pro Cinematic Vlog Story (pro-cinematic-vlog)', t2, { 'vlog_music.mp3': audio2 }, coverPath);

  console.log('✅ BOTH TEMPLATES VALIDATED AND DEPLOYED!');
}

main().catch(console.error);

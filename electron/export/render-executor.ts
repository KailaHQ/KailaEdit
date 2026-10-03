import path from 'path'
import fs from 'fs'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { runFfmpegWithProgress } from './ffmpeg-utils'
import { buildVideoFilterGraph } from './video-filter'
import { mixAudioToPcm } from './audio-mix'
import {
  detectHardwareEncoders,
  getEncoderArgs,
  getEncoderDisplayName,
} from './hardware-encoder'
import {
  formatSupportsChapters,
  generateFfmetadataChapters,
} from './chapter-utils'
import { isCancelled, type RenderJob, type RenderStartParams } from './render-job-types'
import { prepareExportMattes } from './render-matte-prep'

export async function executeRenderJob(
  job: RenderJob,
  params: RenderStartParams,
  ffmpegPath: string,
  timelineDuration: number,
  tmpDir: string,
  notifyFinish: (job: RenderJob) => void,
  prepareMattesFn: (job: RenderJob, clips: any[], device?: 'auto' | 'gpu' | 'cpu') => Promise<{ ok: true } | { ok: false; error: string }> = prepareExportMattes,
): Promise<void> {
  const {
    clips,
    outputPath,
    codec,
    width,
    height,
    fps,
    quality,
    background,
    letterbox,
    subtitles,
    transitions,
    markers,
    videoBitrate,
    audioBitrate,
  } = params

  const fileId = `${job.id}-${Date.now()}`
  const tmpVideo = path.join(tmpDir, `komfy-export-video-${fileId}.mkv`)
  const tmpAudio = path.join(tmpDir, `komfy-export-audio-${fileId}.wav`)
  const tmpChapters = path.join(tmpDir, `komfy-chapters-${fileId}.txt`)
  let filterFile: string | null = null
  let tmpRawPcm: string | null = null
  let hasChapters = false
  let keepFilterFile = false

  const cleanup = () => {
    try { if (fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo) } catch {}
    try { if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio) } catch {}
    try {
      if (filterFile && !keepFilterFile && fs.existsSync(filterFile)) fs.unlinkSync(filterFile)
    } catch {}
    try { if (tmpRawPcm && fs.existsSync(tmpRawPcm)) fs.unlinkSync(tmpRawPcm) } catch {}
    if (hasChapters) {
      try { if (fs.existsSync(tmpChapters)) fs.unlinkSync(tmpChapters) } catch {}
    }
  }
  job.cleanup = cleanup
  job.status = 'running'

  try {
    const isAudioOnly = codec === 'wav' || codec === 'mp3' || codec === 'aac'
    const isGif = codec === 'gif'

    // ── Step 0: Auto matte + stroke bakes (0% -> 5%) ───────────────────
    if (!isAudioOnly) {
      const prep = await prepareMattesFn(job, clips, params.autoMatteDevice ?? 'auto')
      if (isCancelled(job)) {
        cleanup()
        return
      }
      if (!prep.ok) {
        job.status = 'failed'
        job.error = prep.error
        cleanup()
        notifyFinish(job)
        emitToRenderer('render:error', { jobId: job.id, error: job.error })
        return
      }
    }

    // ── Step 1: Video filter graph (0% -> 85%, or 0% -> 70% for GIF) ───
    if (!isAudioOnly) {
      const videoEndPercent = isGif ? 70 : 85
      logger.info(`[RenderQueue:${job.id}] Step 1: Video filter graph (${timelineDuration.toFixed(2)}s)`)
      const { inputs, filterScript } = buildVideoFilterGraph(clips, {
        width, height, fps, totalDuration: timelineDuration, background, letterbox, subtitles,
        transitions,
      })

      filterFile = path.join(tmpDir, `komfy-filter-v-${fileId}.txt`)
      fs.writeFileSync(filterFile, filterScript, 'utf8')

      const hwCaps = await detectHardwareEncoders(ffmpegPath)
      const useHw = params.hardwareAcceleration !== false && hwCaps.hardwareAccelerationSupported && hwCaps.preferredEncoder !== null
      let activeEncoder = useHw ? hwCaps.preferredEncoder! : 'libx264'
      let activeEncoderArgs = getEncoderArgs(activeEncoder, 16, 'fast')

      logger.info(
        `[RenderQueue:${job.id}] Step 1: Encoding with ${activeEncoder} (${getEncoderDisplayName(activeEncoder)})${useHw ? ' [Hardware Accelerated]' : ' [Software/CPU]'}`
      )

      const runStep1Ffmpeg = (encoderArgs: string[]) => {
        const handle = runFfmpegWithProgress(
          ffmpegPath,
          [
            '-y', ...inputs, '-filter_complex_script', filterFile!,
            '-map', '[outv]', '-an', ...encoderArgs, tmpVideo,
          ],
          progress => {
            if (job.status !== 'running') return
            const outTimeSec = progress.outTimeUs && Number.isFinite(progress.outTimeUs)
              ? progress.outTimeUs / 1_000_000
              : 0
            const rawPercent = (outTimeSec / (timelineDuration || 1)) * videoEndPercent
            const stepPercent = Number.isFinite(rawPercent) ? Math.min(videoEndPercent, Math.max(0, rawPercent)) : 0
            job.percent = Number(stepPercent.toFixed(1))
            emitToRenderer('render:progress', {
              jobId: job.id,
              percent: job.percent,
              fps: Number.isFinite(progress.fps) ? progress.fps : undefined,
              timeSeconds: outTimeSec,
              speed: Number.isFinite(progress.speed) ? progress.speed : undefined,
            })
          },
        )
        job.activeHandle = handle
        return handle
      }

      let step1Handle = runStep1Ffmpeg(activeEncoderArgs)
      let step1Result = await step1Handle.promise

      if (!step1Result.success && useHw && !isCancelled(job)) {
        keepFilterFile = true
        logger.warn(
          `[RenderQueue:${job.id}] Hardware encoder ${activeEncoder} failed: ${step1Result.error ?? 'unknown error'}. Falling back to CPU libx264.`
        )
        logger.warn(
          `[RenderQueue:${job.id}] Filter graph kept for diagnosis: ${filterFile}. Reproduce with: ffmpeg -y ${inputs.join(' ')} -filter_complex_script "${filterFile}" -map [outv] -an ${activeEncoderArgs.join(' ')} out.mkv`
        )
        try { if (fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo) } catch {}
        activeEncoder = 'libx264'
        activeEncoderArgs = getEncoderArgs('libx264', 16, 'fast')
        step1Handle = runStep1Ffmpeg(activeEncoderArgs)
        step1Result = await step1Handle.promise
      }

      if (isCancelled(job)) {
        cleanup()
        return
      }

      if (!step1Result.success) {
        keepFilterFile = true
        logger.error(`[RenderQueue:${job.id}] Filter graph kept for diagnosis: ${filterFile}`)
        job.status = 'failed'
        job.error = step1Result.error ?? 'FFmpeg video filter step failed'
        job.stderr = step1Result.stderr
        cleanup()
        notifyFinish(job)
        emitToRenderer('render:error', {
          jobId: job.id,
          error: job.error,
          stderr: job.stderr,
        })
        return
      }
    }

    // ── Step 2: Audio mixdown (85% -> 92%, or 0% -> 80% for audio-only) ─
    if (!isGif) {
      const audioStartPercent = isAudioOnly ? 0 : 86
      const audioEndPercent = isAudioOnly ? 80 : 92
      logger.info(`[RenderQueue:${job.id}] Step 2: Audio mixdown`)
      job.percent = audioStartPercent
      emitToRenderer('render:progress', {
        jobId: job.id,
        percent: audioStartPercent,
        timeSeconds: timelineDuration * (audioStartPercent / 100),
      })

      const { pcmBuffer, sampleRate, channels: audioChannels } = await mixAudioToPcm(clips, timelineDuration, ffmpegPath)

      if (isCancelled(job)) {
        cleanup()
        return
      }

      tmpRawPcm = path.join(tmpDir, `komfy-pcm-${fileId}.raw`)
      fs.writeFileSync(tmpRawPcm, pcmBuffer)

      const step2Handle = runFfmpegWithProgress(
        ffmpegPath,
        [
          '-y', '-f', 's16le', '-ar', String(sampleRate), '-ac', String(audioChannels),
          '-i', tmpRawPcm, '-c:a', 'pcm_s16le', tmpAudio,
        ],
        progress => {
          if (job.status !== 'running') return
          const outTimeSec = progress.outTimeUs && Number.isFinite(progress.outTimeUs)
            ? progress.outTimeUs / 1_000_000
            : 0
          const raw = audioStartPercent + (outTimeSec / (timelineDuration || 1)) * (audioEndPercent - audioStartPercent)
          const stepPercent = Number.isFinite(raw) ? Math.min(audioEndPercent, Math.max(audioStartPercent, raw)) : audioStartPercent
          job.percent = Number(stepPercent.toFixed(1))
          emitToRenderer('render:progress', {
            jobId: job.id,
            percent: job.percent,
            fps: Number.isFinite(progress.fps) ? progress.fps : undefined,
            timeSeconds: outTimeSec,
          })
        },
      )

      job.activeHandle = step2Handle
      const step2Result = await step2Handle.promise

      if (isCancelled(job)) {
        cleanup()
        return
      }

      if (!step2Result.success) {
        job.status = 'failed'
        job.error = step2Result.error ?? 'FFmpeg audio mix step failed'
        job.stderr = step2Result.stderr
        cleanup()
        notifyFinish(job)
        emitToRenderer('render:error', {
          jobId: job.id,
          error: job.error,
          stderr: job.stderr,
        })
        return
      }
    }

    // ── Step 3: Final output encoding & muxing ──────────────────────────
    const muxStartPercent = isAudioOnly ? 80 : isGif ? 70 : 93
    logger.info(`[RenderQueue:${job.id}] Step 3: Generating final output for codec: ${codec}`)
    job.percent = muxStartPercent
    emitToRenderer('render:progress', {
      jobId: job.id,
      percent: muxStartPercent,
      timeSeconds: timelineDuration * (muxStartPercent / 100),
    })

    // 3A: GIF generation with high-quality palettegen/paletteuse
    if (isGif) {
      const gifFps = Math.min(30, Math.max(5, fps || 15))
      const paletteFilter = `fps=${gifFps},scale=${width}:${height}:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`

      const gifHandle = runFfmpegWithProgress(
        ffmpegPath,
        [
          '-y', '-i', tmpVideo,
          '-vf', paletteFilter,
          outputPath,
        ],
        progress => {
          if (job.status !== 'running') return
          const outTimeSec = progress.outTimeUs && Number.isFinite(progress.outTimeUs)
            ? progress.outTimeUs / 1_000_000
            : 0
          const raw = 70 + (outTimeSec / (timelineDuration || 1)) * 29
          const stepPercent = Number.isFinite(raw) ? Math.min(99, Math.max(70, raw)) : 70
          job.percent = Number(stepPercent.toFixed(1))
          emitToRenderer('render:progress', {
            jobId: job.id,
            percent: job.percent,
            fps: Number.isFinite(progress.fps) ? progress.fps : undefined,
            timeSeconds: outTimeSec,
          })
        },
      )

      job.activeHandle = gifHandle
      const gifResult = await gifHandle.promise

      cleanup()
      if (isCancelled(job)) return

      if (!gifResult.success) {
        job.status = 'failed'
        job.error = gifResult.error ?? 'FFmpeg GIF palette generation failed'
        job.stderr = gifResult.stderr
        notifyFinish(job)
        emitToRenderer('render:error', { jobId: job.id, error: job.error, stderr: job.stderr })
        return
      }

      job.status = 'completed'
      job.percent = 100
      logger.info(`[RenderQueue:${job.id}] Export GIF complete: ${outputPath}`)
      notifyFinish(job)
      emitToRenderer('render:progress', { jobId: job.id, percent: 100, timeSeconds: timelineDuration })
      emitToRenderer('render:complete', { jobId: job.id, outputPath })
      return
    }

    // 3B: Audio-only export (WAV / MP3 / AAC)
    if (isAudioOnly) {
      let audioArgs: string[]
      if (codec === 'wav') {
        audioArgs = ['-c:a', 'pcm_s16le']
      } else if (codec === 'mp3') {
        const aBitrate = audioBitrate ? `${Math.round(audioBitrate)}k` : '320k'
        audioArgs = ['-c:a', 'libmp3lame', '-b:a', aBitrate]
      } else {
        const aBitrate = audioBitrate ? `${Math.round(audioBitrate)}k` : '256k'
        audioArgs = ['-c:a', 'aac', '-b:a', aBitrate]
      }

      const audioHandle = runFfmpegWithProgress(
        ffmpegPath,
        [
          '-y', '-i', tmpAudio,
          ...audioArgs,
          outputPath,
        ],
        progress => {
          if (job.status !== 'running') return
          const outTimeSec = progress.outTimeUs && Number.isFinite(progress.outTimeUs)
            ? progress.outTimeUs / 1_000_000
            : 0
          const raw = 80 + (outTimeSec / (timelineDuration || 1)) * 19
          const stepPercent = Number.isFinite(raw) ? Math.min(99, Math.max(80, raw)) : 80
          job.percent = Number(stepPercent.toFixed(1))
          emitToRenderer('render:progress', {
            jobId: job.id,
            percent: job.percent,
            fps: Number.isFinite(progress.fps) ? progress.fps : undefined,
            timeSeconds: outTimeSec,
          })
        },
      )

      job.activeHandle = audioHandle
      const audioResult = await audioHandle.promise

      cleanup()
      if (isCancelled(job)) return

      if (!audioResult.success) {
        job.status = 'failed'
        job.error = audioResult.error ?? 'FFmpeg audio export failed'
        job.stderr = audioResult.stderr
        notifyFinish(job)
        emitToRenderer('render:error', { jobId: job.id, error: job.error, stderr: job.stderr })
        return
      }

      job.status = 'completed'
      job.percent = 100
      logger.info(`[RenderQueue:${job.id}] Audio export complete: ${outputPath}`)
      notifyFinish(job)
      emitToRenderer('render:progress', { jobId: job.id, percent: 100, timeSeconds: timelineDuration })
      emitToRenderer('render:complete', { jobId: job.id, outputPath })
      return
    }

    // 3C: Standard video export (H.264 / ProRes / VP9)
    let videoCodecArgs: string[]
    let audioCodecArgs: string[]
    let step3HwEncoder: string | null = null

    if (codec === 'h264' || codec === 'libx264') {
      const hwCaps = await detectHardwareEncoders(ffmpegPath)
      const useHw = params.hardwareAcceleration !== false && hwCaps.hardwareAccelerationSupported && hwCaps.preferredEncoder !== null
      step3HwEncoder = useHw ? hwCaps.preferredEncoder : null
      const encoder = step3HwEncoder || 'libx264'

      if (videoBitrate && videoBitrate > 0) {
        const vbK = Math.round(videoBitrate)
        const maxrateK = Math.round(videoBitrate * 1.5)
        const bufsizeK = Math.round(videoBitrate * 2)
        videoCodecArgs = [
          '-c:v', encoder,
          '-b:v', `${vbK}k`,
          '-maxrate', `${maxrateK}k`,
          '-bufsize', `${bufsizeK}k`,
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
        ]
      } else {
        videoCodecArgs = [...getEncoderArgs(encoder, quality || 18, 'medium'), '-movflags', '+faststart']
      }

      const aBitrate = audioBitrate ? `${Math.round(audioBitrate)}k` : '192k'
      audioCodecArgs = ['-c:a', 'aac', '-b:a', aBitrate]
    } else if (codec === 'prores') {
      videoCodecArgs = ['-c:v', 'prores_ks', '-profile:v', String(quality || 3), '-pix_fmt', 'yuva444p10le']
      audioCodecArgs = ['-c:a', 'pcm_s16le']
    } else if (codec === 'vp9') {
      const vBitrate = videoBitrate ? `${Math.round(videoBitrate)}k` : `${quality || 8}M`
      videoCodecArgs = ['-c:v', 'libvpx-vp9', '-b:v', vBitrate, '-pix_fmt', 'yuv420p']
      const aBitrate = audioBitrate ? `${Math.round(audioBitrate)}k` : '128k'
      audioCodecArgs = ['-c:a', 'libopus', '-b:a', aBitrate]
    } else {
      cleanup()
      job.status = 'failed'
      job.error = `Unknown codec: ${codec}`
      notifyFinish(job)
      emitToRenderer('render:error', { jobId: job.id, error: job.error })
      return
    }

    const canCopyVideo = (codec === 'h264' || codec === 'libx264') && (!videoBitrate || videoBitrate <= 0)
    const chapterInputs: string[] = []
    const chapterMaps: string[] = []

    if (markers && markers.length > 0 && formatSupportsChapters(outputPath)) {
      const metadataContent = generateFfmetadataChapters(markers, timelineDuration)
      if (metadataContent) {
        fs.writeFileSync(tmpChapters, metadataContent, 'utf8')
        hasChapters = true
        chapterInputs.push('-i', tmpChapters)
        chapterMaps.push('-map_metadata', '2')
      }
    }

    const runStep3Ffmpeg = (vArgs: string[]) => {
      const handle = runFfmpegWithProgress(
        ffmpegPath,
        [
          '-y', '-i', tmpVideo, '-i', tmpAudio,
          ...chapterInputs,
          '-map', '0:v', '-map', '1:a',
          ...chapterMaps,
          ...vArgs,
          ...audioCodecArgs, '-shortest', outputPath,
        ],
        progress => {
          if (job.status !== 'running') return
          const outTimeSec = progress.outTimeUs && Number.isFinite(progress.outTimeUs)
            ? progress.outTimeUs / 1_000_000
            : 0
          const raw = 93 + (outTimeSec / (timelineDuration || 1)) * 6
          const stepPercent = Number.isFinite(raw) ? Math.min(99, Math.max(93, raw)) : 93
          job.percent = Number(stepPercent.toFixed(1))
          emitToRenderer('render:progress', {
            jobId: job.id,
            percent: job.percent,
            fps: Number.isFinite(progress.fps) ? progress.fps : undefined,
            timeSeconds: outTimeSec,
          })
        },
      )
      job.activeHandle = handle
      return handle
    }

    let step3Handle = runStep3Ffmpeg(canCopyVideo ? ['-c:v', 'copy'] : videoCodecArgs)
    let step3Result = await step3Handle.promise

    if (!step3Result.success && !canCopyVideo && step3HwEncoder && !isCancelled(job)) {
      logger.warn(
        `[RenderQueue:${job.id}] Step 3 hardware encoding with ${step3HwEncoder} failed: ${step3Result.error ?? 'unknown error'}. Retrying with CPU libx264.`
      )
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch {}
      const fallbackArgs = [...getEncoderArgs('libx264', quality || 18, 'medium'), '-movflags', '+faststart']
      step3Handle = runStep3Ffmpeg(fallbackArgs)
      step3Result = await step3Handle.promise
    }

    cleanup()

    if (isCancelled(job)) return

    if (!step3Result.success) {
      job.status = 'failed'
      logger.error(
        `[RenderQueue:${job.id}] Step 3 (mux) failed writing ${outputPath}: ${step3Result.error ?? 'unknown error'}`,
      )
      job.error = step3Result.error ?? 'FFmpeg mux step failed'
      job.stderr = step3Result.stderr
      notifyFinish(job)
      emitToRenderer('render:error', {
        jobId: job.id,
        error: job.error,
        stderr: job.stderr,
      })
      return
    }

    // Complete
    job.status = 'completed'
    job.percent = 100
    logger.info(`[RenderQueue:${job.id}] Export complete: ${outputPath}`)
    notifyFinish(job)
    emitToRenderer('render:progress', {
      jobId: job.id,
      percent: 100,
      timeSeconds: timelineDuration,
    })
    emitToRenderer('render:complete', {
      jobId: job.id,
      outputPath,
    })
  } catch (err) {
    cleanup()
    if (isCancelled(job)) return
    job.status = 'failed'
    job.error = String(err)
    notifyFinish(job)
    emitToRenderer('render:error', {
      jobId: job.id,
      error: job.error,
    })
  }
}

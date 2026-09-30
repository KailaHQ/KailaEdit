import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Captions,
  Settings,
  Loader2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import { SUBTITLE_PRESETS, getSubtitlePreset } from '@core/text-presets'
import { selectCaptionSourceClips, whisperSegmentsToSrtCues } from '@core/whisper-types'
import type { SrtCue } from '@core/srt'
import { makeId } from '@core/id-generator'
import { useSettings } from '../../../contexts/SettingsContext'
import { useTranslation } from '../../../i18n/I18nContext'
import { selectClips, selectSelectedClipIds } from '../editor-selectors'
import { useEditorActions, useEditorStore } from '../editor-store'

export function AutoCaptionsPanel() {
  const { t } = useTranslation()
  const { settings, openSettings } = useSettings()
  const actions = useEditorActions()
  const clips = useEditorStore(selectClips)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)

  const [isTranscribing, setIsTranscribing] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ percent: number; message: string }>({ percent: 0, message: '' })
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState<string>(settings.whisperLanguage || '')
  const [smartChunking, setSmartChunking] = useState<boolean>(true)
  const [selectedPresetId, setSelectedPresetId] = useState<string>('tiktok-classic')
  /** Set by the Cancel button; read between clips so a long run stops promptly. */
  const cancelledRef = useRef(false)
  /** Which clip the running whisper job belongs to, for the progress bar. */
  const progressClipIdRef = useRef<string | null>(null)

  /** Every clip the captions should cover — see selectCaptionSourceClips. */
  const captionTargets = useMemo(
    () => selectCaptionSourceClips(clips, selectedClipIds),
    [clips, selectedClipIds],
  )

  const targetClip = captionTargets[0]
  const captionTotalDuration = useMemo(
    () => captionTargets.reduce((total, clip) => total + clip.duration, 0),
    [captionTargets],
  )

  // Progress listener
  useEffect(() => {
    if (!window.electronAPI?.on) return
    const unbind = window.electronAPI.on('whisper:progress', (payload) => {
      if (!currentJobId || payload.jobId !== currentJobId) return
      // One job per clip: fold its progress into the span this clip occupies
      // on the overall bar, or a five-clip run would rewind to 0% five times.
      const index = Math.max(0, captionTargets.findIndex(clip => clip.id === progressClipIdRef.current))
      const total = Math.max(1, captionTargets.length)
      const within = (payload.percent ?? 0) / 100
      // The main process reports a stage key, not a sentence, so the message
      // follows the app's language instead of whatever it was written in.
      const stage = payload.step ? t(`captions.progress.${payload.step}`) : ''
      const stageText = payload.detail ? `${stage} ${payload.detail}`.trim() : stage
      setProgress({
        percent: Math.min(100, Math.round(((index + within) / total) * 100)),
        message: total > 1 && stageText
          ? `${stageText} (${index + 1}/${total})`
          : stageText,
      })
    })
    return unbind
  }, [captionTargets, currentJobId, t])

  const handleStartTranscribe = async () => {
    if (captionTargets.length === 0) {
      setFeedback({ success: false, message: t('captions.noSelection') })
      return
    }

    if (!window.electronAPI?.whisperTranscribe) {
      setFeedback({ success: false, message: t('captions.apiUnavailable') })
      return
    }

    cancelledRef.current = false
    setIsTranscribing(true)
    setFeedback(null)
    setProgress({ percent: 5, message: t('captions.extractingAudio') })

    const chosenPreset = getSubtitlePreset(selectedPresetId)
    const styleOverride = chosenPreset ? chosenPreset.style : undefined
    const chunkOptions = { chunk: smartChunking, minWords: 3, maxWords: 5, maxChars: 28 }

    const cues: SrtCue[] = []
    const failures: string[] = []

    try {
      for (let position = 0; position < captionTargets.length; position += 1) {
        if (cancelledRef.current) break

        const clip = captionTargets[position]
        const filePath = clip.asset?.path || (clip as any).path
        if (!filePath) {
          failures.push(clip.id)
          continue
        }

        const jobId = makeId('transcribe')
        progressClipIdRef.current = clip.id
        setCurrentJobId(jobId)
        setProgress({
          percent: Math.round((position / captionTargets.length) * 100),
          message: captionTargets.length > 1
            ? t('captions.clipProgress', { current: position + 1, total: captionTargets.length })
            : t('captions.extractingAudio'),
        })

        // The clip's own slice of the file, at media speed: a clip played at 2x
        // covers twice as much of the recording as its timeline duration says.
        const speed = clip.speed || 1

        const res = await window.electronAPI.whisperTranscribe({
          jobId,
          filePath,
          startTime: clip.trimStart,
          duration: clip.duration * speed,
          endpoint: settings.whisperEndpoint,
          apiKey: settings.whisperApiKey,
          model: settings.whisperModel,
          language: selectedLanguage,
          prompt: settings.whisperPrompt,
        })

        if (cancelledRef.current) break

        // Whisper timestamps run from the start of the extracted audio, so they
        // are media seconds inside this clip. Speed maps them onto the timeline,
        // and the clip's own start puts them where the clip actually plays.
        const toTimeline = (seconds: number) => seconds / speed

        if (res.success && res.result && res.result.segments.length > 0) {
          // Keep the sentences before chunking cuts them into three-word
          // scraps. Highlights and B-roll read this instead of re-transcribing,
          // and they want whole utterances; the scraps are only good on screen.
          // Media seconds, from the start of the file, so a later re-trim
          // still reads the right words out of it.
          actions.storeAssetTranscript({
            assetPath: filePath,
            language: res.result.language,
            segments: res.result.segments.map(segment => ({
              start: clip.trimStart + segment.start,
              end: clip.trimStart + segment.end,
              text: segment.text,
            })),
          })

          const segments = res.result.segments.map(segment => ({
            ...segment,
            start: toTimeline(segment.start),
            end: toTimeline(segment.end),
            ...(segment.words
              ? {
                  words: segment.words.map(word => ({
                    ...word,
                    start: toTimeline(word.start),
                    end: toTimeline(word.end),
                  })),
                }
              : {}),
          }))
          cues.push(...whisperSegmentsToSrtCues(segments, clip.startTime, chunkOptions))
        } else if (res.success && res.result?.text) {
          cues.push(...whisperSegmentsToSrtCues(
            [{ id: 0, start: 0, end: clip.duration, text: res.result.text }],
            clip.startTime,
            chunkOptions,
          ))
        } else {
          failures.push(res.error || clip.id)
        }
      }

      // One import for the whole timeline: importSrtCues replaces the subtitle
      // track, so importing clip by clip would leave only the last one.
      if (cues.length > 0) {
        const ordered = cues
          .slice()
          .sort((left, right) => left.startTime - right.startTime)
          .map((cue, index) => ({ ...cue, index: index + 1 }))
        actions.importSrtCues(ordered, { style: styleOverride })
      }

      if (cues.length === 0) {
        setFeedback({
          success: false,
          message: cancelledRef.current ? t('captions.cancelled') : (failures[0] || t('captions.failed')),
        })
      } else if (failures.length > 0) {
        setFeedback({
          success: true,
          message: `${t('captions.done', { count: cues.length })} ${t('captions.partial', { count: failures.length })}`,
        })
      } else {
        setFeedback({ success: true, message: t('captions.done', { count: cues.length }) })
      }
    } catch (err: any) {
      setFeedback({
        success: false,
        message: err.message || String(err),
      })
    } finally {
      setIsTranscribing(false)
      setCurrentJobId(null)
      cancelledRef.current = false
    }
  }

  const handleCancel = () => {
    // The run walks a list of clips now, so cancelling the job in flight is not
    // enough — the flag stops the loop before it starts the next one.
    cancelledRef.current = true
    if (currentJobId && window.electronAPI?.whisperCancel) {
      window.electronAPI.whisperCancel({ jobId: currentJobId })
    }
    setIsTranscribing(false)
    setCurrentJobId(null)
    setProgress({ percent: 0, message: '' })
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Header info */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <p className="text-[12px] font-semibold text-zinc-200">{t('captions.generateTitle')}</p>
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">{t('captions.generateDesc')}</p>
        </div>
        <button
          onClick={() => openSettings('speech')}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title={t('captions.configurePrompt')}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Whisper Provider status pill */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/90 border border-zinc-800 text-[11px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-zinc-400">
            {settings.whisperProvider === 'cloud' ? 'OpenAI Cloud' : 'Self-hosted Whisper'}
          </span>
          <span className="text-zinc-500 font-mono truncate max-w-[200px]">
            {settings.whisperEndpoint || 'http://localhost:8000/v1'}
          </span>
        </div>
        <button
          onClick={() => openSettings('speech')}
          className="text-teal-400 hover:underline text-[11px]"
        >
          {t('captions.openSettings')}
        </button>
      </div>

      {/* Target scope */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-zinc-300 block">{t('captions.sourceScope')}</label>
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-[11px]">
          {targetClip ? (
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 font-medium truncate max-w-[190px]">
                {captionTargets.length > 1
                  ? t('captions.clipCount', { count: captionTargets.length })
                  : (targetClip.importedName || (targetClip.asset?.path ? targetClip.asset.path.split(/[/\\]/).pop() : targetClip.id))}
              </span>
              <span className="text-zinc-500 font-mono">
                {captionTotalDuration.toFixed(1)}s
              </span>
            </div>
          ) : (
            <span className="text-zinc-500">{t('captions.noSelection')}</span>
          )}
        </div>
      </div>

      {/* Language */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-zinc-300 block">{t('captions.language')}</label>
        <select
          value={selectedLanguage}
          onChange={(e) => setSelectedLanguage(e.target.value)}
          disabled={isTranscribing}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-teal-500 cursor-pointer disabled:opacity-50"
        >
          <option value="">{t('settings.speech.languageAuto')}</option>
          <option value="vi">Vietnamese (vi)</option>
          <option value="en">English (en)</option>
          <option value="zh">Chinese (zh)</option>
          <option value="ja">Japanese (ja)</option>
          <option value="ko">Korean (ko)</option>
          <option value="fr">French (fr)</option>
          <option value="de">German (de)</option>
          <option value="es">Spanish (es)</option>
        </select>
      </div>

      {/* Smart Captions Chunking Toggle */}
      <div className="flex items-center justify-between rounded-lg bg-zinc-900 border border-zinc-800 p-2.5">
        <div className="flex flex-col">
          <span className="text-[11px] font-medium text-zinc-200">{t('library.smartCaptions')}</span>
          <span className="text-[10px] text-zinc-400">{t('library.smartCaptionsDesc')}</span>
        </div>
        <button
          type="button"
          onClick={() => setSmartChunking(prev => !prev)}
          disabled={isTranscribing}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            smartChunking ? 'bg-teal-500' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
              smartChunking ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Preset Style Selector */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-zinc-300 block">{t('library.subtitleStylePreset')}</label>
        <select
          value={selectedPresetId}
          onChange={(e) => setSelectedPresetId(e.target.value)}
          disabled={isTranscribing}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-teal-500 cursor-pointer disabled:opacity-50"
        >
          {SUBTITLE_PRESETS.map(preset => {
            const key = preset.id.replace(/-/g, '_')
            const nameKey = `captions.presets.${key}.name`
            const descKey = `captions.presets.${key}.description`
            const presetName = t(nameKey) !== nameKey ? t(nameKey) : preset.name
            const presetDesc = t(descKey) !== descKey ? t(descKey) : preset.description
            return (
              <option key={preset.id} value={preset.id}>
                {presetName} — {presetDesc}
              </option>
            )
          })}
        </select>
      </div>

      {/* Progress or Actions */}
      {isTranscribing ? (
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-teal-400 font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progress.message || t('captions.transcribing')}
            </span>
            <span className="text-zinc-400 font-mono">{progress.percent}%</span>
          </div>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 transition-all duration-300"
              style={{ width: `${Math.max(5, progress.percent)}%` }}
            />
          </div>
          <button
            onClick={handleCancel}
            className="w-full py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-rose-400 text-[11px] font-medium transition-colors"
          >
            {t('captions.cancelBtn')}
          </button>
        </div>
      ) : (
        <div className="pt-2 space-y-2">
          <button
            onClick={handleStartTranscribe}
            disabled={!targetClip}
            className="w-full py-2 px-3 rounded-lg bg-teal-500 hover:bg-teal-400 text-zinc-950 text-[12px] font-semibold transition-all shadow-md shadow-teal-500/10 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
          >
            <Captions className="h-4 w-4" />
            {t('captions.generateBtn')}
          </button>

          {feedback && (
            <div className={`flex items-start gap-1.5 text-[11px] p-2.5 rounded-lg border ${
              feedback.success
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}>
              {feedback.success ? (
                <CheckCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

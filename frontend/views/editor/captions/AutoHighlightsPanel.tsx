import { useState, useMemo, useEffect } from 'react'
import {
  Sparkles,
  Settings,
  Loader2,
  CheckCircle,
  AlertCircle,
  Zap,
  Captions,
} from 'lucide-react'
import type { HighlightCandidate } from '@core/auto-highlight'
import { buildHighlightEditPatch, formatTranscriptForHighlights } from '@core/auto-highlight'
import { applyEditPatchToState } from '@core/edit-patch'
import {
  findAssetTranscript,
  subtitlesAsTranscriptCues,
  transcriptCuesForClip,
} from '@core/transcript-store'
import { whisperSegmentsToSrtCues } from '@core/whisper-types'
import { makeId } from '@core/id-generator'
import { useSettings } from '../../../contexts/SettingsContext'
import { useTranslation } from '../../../i18n/I18nContext'
import { selectClips, selectSelectedClipIds } from '../editor-selectors'
import { useEditorActions, useEditorStore, useEditorStoreApi } from '../editor-store'
import { CliRequiredNotice, readCliFailure } from './CliRequiredNotice'

export function AutoHighlightsPanel() {
  const { t } = useTranslation()
  const { settings, openSettings } = useSettings()
  const actions = useEditorActions()
  const store = useEditorStoreApi()
  const clips = useEditorStore(selectClips)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const transcripts = useEditorStore(s => s.editorModel.transcripts)

  const subtitles = useEditorStore(
    s => s.editorModel.timelines.find(t => t.id === s.editorModel.activeTimelineId)?.subtitles || [],
  )

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [cliFailure, setCliFailure] = useState<
    { kind: 'missing' } | { kind: 'failed'; detail: string } | null
  >(null)
  /**
   * Whether making the transcript should also caption the timeline.
   *
   * Off by default, and that is deliberate: importing cues REPLACES the whole
   * subtitle track, so a user who came here for highlights and happened to
   * have captions would lose them to a button they pressed for another reason.
   * Transcribing for analysis and captioning the video are two different jobs
   * that happen to need the same trip to Whisper.
   */
  const [alsoCaptionTimeline, setAlsoCaptionTimeline] = useState(false)
  const [candidates, setCandidates] = useState<HighlightCandidate[]>([])
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null)
  const [hasLlmSecureKey, setHasLlmSecureKey] = useState(false)

  useEffect(() => {
    if (window.electronAPI?.llmGetSecureKey) {
      window.electronAPI.llmGetSecureKey().then(res => {
        if (res?.hasKey) setHasLlmSecureKey(true)
      }).catch(() => {})
    }
  }, [])

  const isLlmConfigured = useMemo(() => {
    const endpoint = settings.llmEndpoint?.trim() || 'https://api.openai.com/v1'
    const isCustomLocal = endpoint !== 'https://api.openai.com/v1' && !endpoint.includes('api.openai.com')
    if (isCustomLocal) return true
    return Boolean(settings.llmApiKey?.trim() || hasLlmSecureKey)
  }, [settings.llmEndpoint, settings.llmApiKey, hasLlmSecureKey])

  const targetClip = useMemo(() => {
    return (
      clips.find(c => selectedClipIds.has(c.id) && (c.type === 'video' || c.type === 'audio') && (c.asset?.path || (c as any).path)) ||
      clips.find(c => (c.type === 'video' || c.type === 'audio') && (c.asset?.path || (c as any).path))
    )
  }, [clips, selectedClipIds])

  /**
   * The words the model is asked to pick highlights from.
   *
   * Subtitles first: once captions exist they are already the user's own
   * transcript, already on the timeline's clock, and free. Only when there are
   * none does the clip get sent to Whisper, and its timestamps are media
   * seconds inside that clip — speed and the clip's own start put them back on
   * the timeline, because every range the model returns is read as a timeline
   * position when the Short is cut.
   */
  const targetFilePath = targetClip?.asset?.path || (targetClip as any)?.path || ''

  /**
   * The words available for this clip, and where they came from.
   *
   * Deciding this up front is what lets the panel talk about the transcript
   * instead of the file: analysing is offered once there is something to
   * analyse, and transcribing is offered when there is not.
   */
  const transcriptState = useMemo(() => {
    if (!targetClip || !targetFilePath) return { cues: [], source: 'none' as const }

    const stored = transcriptCuesForClip(findAssetTranscript(transcripts, targetFilePath), targetClip)
    if (stored.length > 0) return { cues: stored, source: 'stored' as const }

    // Captions still count: a project captioned before the store existed has
    // the words, just chopped into three-word pieces.
    if (subtitles.length > 0) {
      return { cues: subtitlesAsTranscriptCues(subtitles), source: 'subtitles' as const }
    }
    return { cues: [], source: 'none' as const }
  }, [targetClip, targetFilePath, transcripts, subtitles])

  const hasTranscript = transcriptState.cues.length > 0

  /**
   * Transcribe the clip once and keep it.
   *
   * Separate from analysing, and that separation is the point: the transcript
   * is the shared asset that highlights and B-roll both read, so it is made
   * deliberately, by its own button, rather than as a hidden side effect of
   * asking for highlights.
   */
  const handleCreateTranscript = async () => {
    const clip = targetClip
    if (!clip || !targetFilePath || !window.electronAPI?.whisperTranscribe) return

    setIsTranscribing(true)
    setFeedback(null)
    try {
      const speed = clip.speed || 1
      const res = await window.electronAPI.whisperTranscribe({
        jobId: makeId('highlight-transcribe'),
        filePath: targetFilePath,
        startTime: clip.trimStart,
        duration: clip.duration * speed,
        endpoint: settings.whisperEndpoint,
        apiKey: settings.whisperApiKey,
        model: settings.whisperModel,
        prompt: settings.whisperPrompt,
      })

      if (!res.success || !res.result || res.result.segments.length === 0) {
        setFeedback({ success: false, message: res.error || t('library.autoHighlights.noTranscript') })
        return
      }

      // Media seconds from the start of the file, so re-trimming the clip
      // later reads the right words out of it rather than re-transcribing.
      actions.storeAssetTranscript({
        assetPath: targetFilePath,
        language: res.result.language,
        segments: res.result.segments.map(segment => ({
          start: clip.trimStart + segment.start,
          end: clip.trimStart + segment.end,
          text: segment.text,
        })),
      })

      if (alsoCaptionTimeline) {
        const onTimeline = res.result.segments.map(segment => ({
          ...segment,
          start: segment.start / speed,
          end: segment.end / speed,
        }))
        actions.importSrtCues(
          whisperSegmentsToSrtCues(onTimeline, clip.startTime, {
            chunk: true, minWords: 3, maxWords: 5, maxChars: 28,
          }),
        )
      }

      setFeedback({
        success: true,
        message: t('library.autoHighlights.transcriptReady', { count: res.result.segments.length }),
      })
    } catch (err: any) {
      setFeedback({ success: false, message: err.message || String(err) })
    } finally {
      setIsTranscribing(false)
    }
  }

  const handleExtract = async () => {
    if (!targetClip) {
      setFeedback({ success: false, message: t('library.autoHighlights.noClip') })
      return
    }

    const filePath = targetClip.asset?.path || (targetClip as any).path
    if (!filePath) {
      setFeedback({ success: false, message: t('library.autoHighlights.noClip') })
      return
    }

    if (!window.electronAPI?.whisperExtractHighlights) {
      setFeedback({ success: false, message: t('library.autoHighlights.ipcNotAvailable') })
      return
    }

    setIsAnalyzing(true)
    setFeedback(null)
    setCliFailure(null)

    try {
      // Reads the transcript, never the media: the trip to Whisper is a
      // separate, explicit step now, so analysis costs nothing but the model.
      const transcriptText = formatTranscriptForHighlights(transcriptState.cues)
      if (!transcriptText) {
        setFeedback({ success: false, message: t('library.autoHighlights.noTranscript') })
        return
      }

      const res = await window.electronAPI.whisperExtractHighlights({
        transcriptText,
        apiKey: settings.llmApiKey,
        endpoint: settings.llmEndpoint,
        model: settings.llmModel || 'gpt-4o-mini',
        maxItems: 4,
      })

      if (res.success && res.highlights && res.highlights.length > 0) {
        setCandidates(res.highlights)
        setFeedback({ success: true, message: t('library.autoHighlights.foundCount', { count: res.highlights.length }) })
        return
      }

      // A missing or broken CLI gets its own block with a way out of it,
      // rather than a raw error code in the feedback strip.
      const failure = readCliFailure(res.error)
      if (failure) {
        setCliFailure(failure)
        return
      }

      setFeedback({
        success: false,
        message: res.error === 'EMPTY_TRANSCRIPT'
          ? t('library.autoHighlights.noTranscript')
          : res.error === 'MISSING_API_KEY' || res.error === 'NO_LLM_API_KEY'
          ? t('library.autoHighlights.missingApiKey')
          : res.error || t('library.autoHighlights.notFound'),
      })
    } catch (err: any) {
      setFeedback({ success: false, message: err.message || String(err) })
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleApplyHighlight = (candidate: HighlightCandidate) => {
    if (!targetClip) return
    const patch = buildHighlightEditPatch(candidate, targetClip)
    store.getState().setStateWithHistory(prev => applyEditPatchToState(prev, patch))
    setFeedback({ success: true, message: t('library.autoHighlights.shortCreated', { title: candidate.title }) })
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-accent" />
            <p className="text-[12px] font-semibold text-zinc-200">{t('library.autoHighlights.title')}</p>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">
            {t('library.autoHighlights.desc')}
          </p>
        </div>
        <button
          onClick={() => openSettings('speech')}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title={t('library.autoHighlights.configureApiKeyTitle')}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Transcript — the thing being analysed, and the thing shared with B-roll */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-zinc-300 block">
          {t('library.autoHighlights.transcriptLabel')}
        </label>
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-[11px] space-y-2">
          {!targetClip ? (
            <span className="text-zinc-500">{t('library.autoHighlights.noClip')}</span>
          ) : hasTranscript ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {t('library.autoHighlights.transcriptReadyShort', { count: transcriptState.cues.length })}
                </span>
                <button
                  onClick={handleCreateTranscript}
                  disabled={isTranscribing || isAnalyzing}
                  className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline disabled:opacity-40 disabled:pointer-events-none"
                >
                  {t('library.autoHighlights.retranscribe')}
                </button>
              </div>
              {transcriptState.source === 'subtitles' && (
                <p className="text-[10.5px] leading-relaxed text-amber-400/80">
                  {t('library.autoHighlights.fromSubtitlesNote')}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="leading-relaxed text-zinc-400">
                {t('library.autoHighlights.transcriptMissing')}
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-zinc-400">
                <input
                  type="checkbox"
                  checked={alsoCaptionTimeline}
                  onChange={e => setAlsoCaptionTimeline(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-accent"
                />
                <span className="leading-relaxed">
                  {t('library.autoHighlights.alsoCaption')}
                  <span className="block text-[10.5px] text-zinc-500">
                    {t('library.autoHighlights.alsoCaptionHint')}
                  </span>
                </span>
              </label>
              <button
                onClick={handleCreateTranscript}
                disabled={isTranscribing}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-[12px] font-medium text-zinc-100 transition-colors hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-40"
              >
                {isTranscribing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('library.autoHighlights.transcribing')}</span>
                  </>
                ) : (
                  <>
                    <Captions className="h-4 w-4" />
                    <span>{t('library.autoHighlights.createTranscript')}</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {!isLlmConfigured && hasTranscript && (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px]">
          <span className="leading-relaxed">{t('library.autoHighlights.llmNotConfigured')}</span>
          <button
            onClick={() => openSettings('speech')}
            className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium whitespace-nowrap cursor-pointer transition-colors"
          >
            {t('library.autoHighlights.configureNow')}
          </button>
        </div>
      )}

      <button
        onClick={handleExtract}
        disabled={isAnalyzing || isTranscribing || !hasTranscript || !isLlmConfigured}
        title={!isLlmConfigured ? t('library.autoHighlights.llmNotConfigured') : undefined}
        className="w-full py-2 px-3 rounded-lg bg-accent hover:bg-accent/90 text-zinc-950 text-[12px] font-semibold transition-all shadow-md shadow-accent/10 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('library.autoHighlights.analyzing')}</span>
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            <span>{t('library.autoHighlights.extractBtn')}</span>
          </>
        )}
      </button>

      {cliFailure && <CliRequiredNotice failure={cliFailure} />}

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

      {/* Candidate list */}
      {candidates.length > 0 && (
        <div className="space-y-2.5 pt-2">
          <p className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
            {t('library.autoHighlights.suggestedTitle', { count: candidates.length })}
          </p>
          {candidates.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 space-y-2 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12px] font-medium text-zinc-100 line-clamp-1">{c.title}</span>
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent shrink-0">
                  {c.viralScore} {t('library.autoHighlights.pointsUnit')}
                </span>
              </div>

              <div className="text-[11px] text-zinc-400 space-y-1">
                <p className="text-[10px] text-zinc-500 font-mono">
                  {c.startTime.toFixed(1)}s – {c.endTime.toFixed(1)}s ({c.duration.toFixed(1)}s)
                </p>
                <div className="rounded bg-zinc-950/80 p-1.5 border border-zinc-800/80">
                  <span className="text-[10px] text-accent font-semibold block">Hook 3s:</span>
                  <span className="text-[11px] text-zinc-200 italic">&ldquo;{c.hookText}&rdquo;</span>
                </div>
                <p className="text-[10px] text-zinc-400 line-clamp-2">{c.reason}</p>
              </div>

              <button
                onClick={() => handleApplyHighlight(c)}
                className="w-full mt-1 py-1.5 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-accent transition-colors flex items-center justify-center gap-1.5"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>{t('library.autoHighlights.createShortNow')}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

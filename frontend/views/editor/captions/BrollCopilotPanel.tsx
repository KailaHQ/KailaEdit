import { useState, useMemo, useRef } from 'react'
import {
  Eye,
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  Upload,
  Plus,
} from 'lucide-react'
import {
  applyBrollSuggestions,
  detectBrollOpportunities,
  type BrollOpportunity,
} from '@core/broll-copilot'
import {
  subtitlesAsTranscriptCues,
  timelineTranscriptCues,
} from '@core/transcript-store'
import { useTranslation } from '../../../i18n/I18nContext'
import { selectClips } from '../editor-selectors'
import { useEditorActions, useEditorStore } from '../editor-store'
import { CliRequiredNotice, readCliFailure } from './CliRequiredNotice'

export function BrollCopilotPanel({ importFiles }: {
  importFiles: (files: FileList | File[]) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const actions = useEditorActions()
  const clips = useEditorStore(selectClips)
  const subtitles = useEditorStore(s => s.editorModel.timelines.find(t => t.id === s.editorModel.activeTimelineId)?.subtitles || [])
  const transcripts = useEditorStore(s => s.editorModel.transcripts)
  const assets = useEditorStore(s => s.editorModel.assets)
  const [opportunities, setOpportunities] = useState<BrollOpportunity[]>([])
  const [hasScanned, setHasScanned] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [cliFailure, setCliFailure] = useState<
    { kind: 'missing' } | { kind: 'failed'; detail: string } | null
  >(null)
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null)
  const [selectedBrollAssetId, setSelectedBrollAssetId] = useState<string>('')

  /**
   * Media that could actually serve as B-roll.
   *
   * Anything already on the timeline is excluded. The panel used to take the
   * first video asset in the project, which is the footage being edited — so
   * "insert B-roll" laid a few seconds of the video over itself, and playback
   * looked unchanged because it was the same picture.
   */
  const brollAssets = useMemo(() => {
    const onTimeline = new Set(
      clips.map(clip => clip.assetId).filter((id): id is string => Boolean(id)),
    )
    return assets.filter(
      asset => (asset.type === 'video' || asset.type === 'image') && !onTimeline.has(asset.id),
    )
  }, [assets, clips])

  const brollAsset = brollAssets.find(a => a.id === selectedBrollAssetId) ?? brollAssets[0]
  const brollFileInputRef = useRef<HTMLInputElement>(null)

  const handleImportBrollMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) await importFiles(files)
    e.target.value = ''
  }

  /**
   * Two halves, deliberately kept apart.
   *
   * WHERE a cutaway goes is arithmetic on the transcript — a run of speech with
   * nothing covering it — so it stays here, offline and repeatable. WHAT to
   * show is a judgement about what is being said, and that goes to the CLI
   * configured in EditPilot. Counting word frequency used to stand in for the
   * second half, which is why a spot about 3D model quality came back labelled
   * "#quality #only #mesh": the words were in the sentence, but they were not a
   * suggestion. Nothing is shown now unless a model actually wrote it.
   */
  const handleScan = async () => {
    // The stored transcript wins over the caption track: it holds whole
    // utterances, so a talking block is found from where speech actually runs
    // rather than from where smart chunking happened to break a line. Captions
    // remain the fallback for projects transcribed before the store existed.
    const transcriptCues = timelineTranscriptCues(transcripts, clips)
    const speechCues = transcriptCues.length > 0 ? transcriptCues : subtitlesAsTranscriptCues(subtitles)

    const spots = detectBrollOpportunities({
      subtitles: speechCues.map((cue, index) => ({
        id: `transcript-${index}`,
        text: cue.text,
        startTime: cue.startTime,
        endTime: cue.endTime,
        trackIndex: 0,
      })),
      existingClips: clips,
      minDuration: 5.0,
      maxDuration: 8.0,
    })

    setCliFailure(null)
    setHasScanned(true)

    if (spots.length === 0) {
      setOpportunities([])
      setFeedback({
        success: false,
        message: speechCues.length === 0
          ? t('library.brollCopilot.noSubtitles')
          : t('library.brollCopilot.noLongSpeeches'),
      })
      return
    }

    if (!window.electronAPI?.brollSuggest) {
      setOpportunities([])
      setCliFailure({ kind: 'missing' })
      return
    }

    setIsScanning(true)
    setFeedback(null)
    try {
      const res = await window.electronAPI.brollSuggest({
        spots: spots.map(spot => ({
          startTime: spot.startTime,
          endTime: spot.endTime,
          contextText: spot.contextText,
        })),
      })

      if (res.success && res.suggestions) {
        setOpportunities(applyBrollSuggestions(spots, res.suggestions))
        setFeedback({
          success: true,
          message: t('library.brollCopilot.foundCount', { count: spots.length }),
        })
        return
      }

      // No half-written suggestions on screen: the spots are real but nothing
      // has said what to put in them, and keyword soup is what we just removed.
      setOpportunities([])
      setCliFailure(readCliFailure(res.error) ?? { kind: 'failed', detail: res.error ?? '' })
    } catch (err: any) {
      setOpportunities([])
      setCliFailure({ kind: 'failed', detail: err?.message || String(err) })
    } finally {
      setIsScanning(false)
    }
  }

  const handleInsert = (opp: BrollOpportunity) => {
    if (!brollAsset) return
    actions.insertBrollClip({
      assetId: brollAsset.id,
      assetPath: brollAsset.path,
      startTime: opp.startTime,
      duration: opp.duration,
      fadeIn: 0.25,
      fadeOut: 0.25,
      muteAudio: true,
    })
    setFeedback({
      success: true,
      message: t('library.brollCopilot.insertedFeedback', {
        time: opp.startTime.toFixed(1),
        duration: opp.duration.toFixed(1),
      }),
    })
    const updatedOpps = opportunities.filter(o => o.id !== opp.id)
    setOpportunities(updatedOpps)
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Eye className="h-4 w-4 text-accent" />
            <p className="text-[12px] font-semibold text-zinc-200">{t('library.brollCopilot.title')}</p>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-1">
            {t('library.brollCopilot.desc')}
          </p>
        </div>
      </div>

      <button
        onClick={handleScan}
        disabled={isScanning}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-accent text-zinc-950 text-[12px] font-semibold hover:bg-accent/90 transition-colors shadow-sm disabled:opacity-40 disabled:pointer-events-none"
      >
        {isScanning ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('library.brollCopilot.scanning')}</span>
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            <span>{t('library.brollCopilot.scanBtn')}</span>
          </>
        )}
      </button>

      {cliFailure && <CliRequiredNotice failure={cliFailure} />}

      {feedback && (
        <div
          className={`flex items-start gap-2 p-2.5 rounded-lg text-[11px] leading-relaxed border ${
            feedback.success
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
              : 'bg-amber-950/40 border-amber-800/80 text-amber-300'
          }`}
        >
          {feedback.success ? (
            <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {hasScanned && opportunities.length > 0 && (
        <div className="space-y-3">
          {/* What actually gets laid over the speaker. Without this the panel
              silently reused the footage being edited, so nothing changed. */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-zinc-300">
              {t('library.brollCopilot.sourceLabel')}
            </label>
            {brollAssets.length > 0 ? (
              <select
                value={brollAsset?.id ?? ''}
                onChange={e => setSelectedBrollAssetId(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200"
              >
                {brollAssets.map(asset => (
                  <option key={asset.id} value={asset.id}>
                    {asset.path ? asset.path.split(/[/\\]/).pop() : asset.id}
                  </option>
                ))}
              </select>
            ) : (
              // A dead end otherwise: the panel said to import media and gave
              // no way to do it, so the run simply stopped here.
              <div className="space-y-2 rounded-lg border border-amber-800/80 bg-amber-950/40 p-2">
                <p className="text-[11px] leading-relaxed text-amber-300">
                  {t('library.brollCopilot.noBrollMedia')}
                </p>
                <button
                  onClick={() => brollFileInputRef.current?.click()}
                  className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-amber-900/60 px-2.5 py-1.5 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-900"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{t('library.brollCopilot.importBrollBtn')}</span>
                </button>
                <input
                  ref={brollFileInputRef}
                  type="file"
                  accept="video/*,image/*"
                  multiple
                  className="hidden"
                  onChange={handleImportBrollMedia}
                />
              </div>
            )}
          </div>

          <p className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
            {t('library.brollCopilot.suggestedSpots', { count: opportunities.length })}
          </p>
          {opportunities.map(o => (
            <div
              key={o.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 space-y-2 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-mono text-zinc-400">
                  {o.startTime.toFixed(1)}s – {o.endTime.toFixed(1)}s ({o.duration.toFixed(1)}s)
                </span>
                <span className="text-[10px] bg-accent/20 text-accent font-semibold px-1.5 py-0.5 rounded">
                  Overlay Track
                </span>
              </div>

              {o.contextText && (
                <p className="text-[11px] text-zinc-300 italic line-clamp-2 bg-zinc-950/60 p-1.5 rounded border border-zinc-800/50">
                  &ldquo;{o.contextText}&rdquo;
                </p>
              )}

              {o.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {o.keywords.map(kw => (
                    <span key={kw} className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">
                      #{kw}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => handleInsert(o)}
                disabled={!brollAsset}
                className="w-full mt-1 py-1.5 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-accent transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('library.brollCopilot.insertBtn')}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

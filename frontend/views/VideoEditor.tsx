import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react'
import { useKeyboardShortcuts } from '../contexts/KeyboardShortcutsContext'
import { useSettings } from '../contexts/SettingsContext'
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels'
import { ExportModal } from '../components/ExportModal'
import { ProjectSettingsModal } from '../components/ProjectSettingsModal'
import type { MenuDefinition } from './editor/EditorChrome'
import { ImportTimelineModal } from '../components/ImportTimelineModal'
import type { Project } from '../types/project-model'
import {
  AUTOSAVE_DELAY,
  type EditorLayout,
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  loadLayout, saveLayout,
} from './editor/video-editor-utils'
import { createInitialEditorState, type EditorModel } from './editor/editor-state'
import { getEditorModel, updatedProject } from './editor/editor-project-bridging'
import { useProjects } from '../contexts/ProjectContext'
import { persistProjectToDisk } from '../lib/project-storage'
import { createIpcBackend } from './editor/editpilot-backend'
import {
  selectCurrentTime,
  selectIsAgentSessionActive,
  selectLayout,
  selectLibrarySection,
  selectLibraryTab,
  selectSelectedClipForProperties,
  selectSelectedClipIds,
  selectShowExportModal,
  selectShowImportTimelineModal,
  selectShowProjectSettingsModal,
  selectSubtitles,
  selectSubtitleTrackStyleIdx,
  selectTotalDuration,
} from './editor/editor-selectors'
import { type VideoEditorAssetsPanelHandle } from './editor/VideoEditorAssetsPanel'
import { ClipPropertiesPanel } from './editor/ClipPropertiesPanel'
import { SubtitlePropertiesPanel } from './editor/SubtitlePropertiesPanel'
import { ProgramMonitor, type ProgramMonitorHandle } from './editor/ProgramMonitor'
import { VideoEditorTimelineEditingPanel } from './editor/VideoEditorTimelineEditingPanel'
import { EditorLeftNav, EditorTabRail, EditorTitleBar } from './editor/EditorChrome'
import { EditPilotLauncher, EditPilotPanel } from './editor/EditPilotPanel'
import { EditorLibraryPanel } from './editor/EditorLibraryPanel'
import { ProjectDetailsPanel } from './editor/ProjectDetailsPanel'
import { useEditorKeyboard } from './editor/useEditorKeyboard'
import { useBuildMenuDefinitions } from './editor/buildMenuDefinitions'
import { usePlaybackEngine } from './editor/usePlaybackEngine'
import { usePlaybackAudioSync } from './editor/usePlaybackAudioSync'
import { useSubtitleImportExport } from './editor/useSubtitleImportExport'
import { useEditorMediaImport } from './editor/useEditorMediaImport'
import { useTimelineXmlExport } from './editor/useTimelineXmlExport'
import { useProxyManager } from './editor/useProxyManager'
import { useRenderCache } from './editor/useRenderCache'
import { useMatteBakeAudit } from '../hooks/useMatteBake'
import {
  createEditorStore,
  EditorStoreProvider,
  useEditorActions,
  useEditorGetState,
  useEditorStore,
  useEditorStoreApi,
  useEditorSubscribeToSlice,
  type EditorStoreApi,
} from './editor/editor-store'
import {
  applyEditPatchToState,
  describePatch,
  type EditPatch,
} from '@core/edit-patch'
import { undo } from './editor/editor-actions'
import { SubtitleTrackStyleEditor } from './editor/SubtitleTrackStyleEditor'
import { RejectedEditNotice } from './editor/RejectedEditNotice'

function getStructuralFingerprint(model: EditorModel): string {
  const activeTimeline = model.timelines.find(t => t.id === model.activeTimelineId) ?? model.timelines[0]
  return [
    model.assets.length,
    model.timelines.length,
    activeTimeline?.tracks.length ?? 0,
    activeTimeline?.clips.length ?? 0,
    activeTimeline?.subtitles?.length ?? 0,
    activeTimeline?.width ?? '',
    activeTimeline?.height ?? '',
    activeTimeline?.fps ?? '',
    activeTimeline?.name ?? '',
    JSON.stringify(activeTimeline?.background ?? ''),
    activeTimeline?.cover ? `${activeTimeline.cover.updatedAt ?? ''}:${activeTimeline.cover.templateId ?? ''}:${activeTimeline.cover.time}` : '',
  ].join(':')
}

interface VideoEditorProps {
  currentProject: Project
  saveProject: (project: Project) => void
}

export function VideoEditor(props: VideoEditorProps) {
  const { currentProject } = props
  const editorStoreRef = useRef<EditorStoreApi | null>(null)

  if (!editorStoreRef.current) {
    const editorModel = getEditorModel(currentProject)
    editorStoreRef.current = createEditorStore(createInitialEditorState(editorModel, loadLayout()))
  }

  const editorStore = editorStoreRef.current
  if (!editorStore) throw new Error('Editor store failed to initialize')

  return (
    <EditorStoreProvider store={editorStore}>
      <VideoEditorWithStore
        currentProject={props.currentProject}
        saveProject={props.saveProject}
      />
    </EditorStoreProvider>
  )
}

function VideoEditorWithStore({ currentProject, saveProject }: VideoEditorProps) {
  const { activeLayout: kbLayout, isEditorOpen: isKbEditorOpen, setEditorOpen: setKbEditorOpen } = useKeyboardShortcuts()
  const kbLayoutRef = useRef(kbLayout)
  kbLayoutRef.current = kbLayout
  const isKbEditorOpenRef = useRef(isKbEditorOpen)
  isKbEditorOpenRef.current = isKbEditorOpen

  const currentProjectId = currentProject.id
  const actions = useEditorActions()
  const { settings, openSettings } = useSettings()
  useProxyManager()
  useRenderCache()
  useMatteBakeAudit(currentProjectId)

  const getEditorState = useEditorGetState()
  const editorModel = useEditorStore(state => state.editorModel)
  const subtitles = useEditorStore(selectSubtitles)
  const isPlaying = useEditorStore(state => state.session.transport.isPlaying)
  const isAgentSessionActive = useEditorStore(selectIsAgentSessionActive)
  const isAgentSessionActiveRef = useRef(isAgentSessionActive)
  isAgentSessionActiveRef.current = isAgentSessionActive
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const showPropertiesPanel = useEditorStore(state => state.session.ui.showPropertiesPanel)
  const showImportTimelineModal = useEditorStore(selectShowImportTimelineModal)
  const showExportModal = useEditorStore(selectShowExportModal)
  const showProjectSettingsModal = useEditorStore(selectShowProjectSettingsModal)
  const layout = useEditorStore(selectLayout)
  const libraryTab = useEditorStore(selectLibraryTab)
  const librarySection = useEditorStore(selectLibrarySection)
  const selectedSubtitleId = useEditorStore(state => state.session.selection.subtitleId)
  const subtitleTrackStyleIdx = useEditorStore(selectSubtitleTrackStyleIdx)

  const { reloadActiveProjectFromDisk } = useProjects()

  const editorModelRef = useRef(editorModel)
  editorModelRef.current = editorModel
  const currentProjectRef = useRef(currentProject)
  currentProjectRef.current = currentProject

  const editPilotBackend = useMemo(() => {
    return createIpcBackend({
      getProjectId: () => currentProjectId,
      onRunStart: async () => {
        // Cancel pending autosave and flush in-memory state to disk immediately
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current)
          autoSaveTimerRef.current = null
        }
        actions.setIsAgentSessionActive(true)
        await persistProjectToDisk(
          currentProjectId,
          updatedProject(currentProjectRef.current, editorModelRef.current),
        )
      },
      onRunEnd: async () => {
        // Reload project from disk and update editor store
        try {
          const reloaded = await reloadActiveProjectFromDisk()
          if (reloaded) {
            actions.replaceEditorModel(getEditorModel(reloaded))
            currentProjectRef.current = reloaded
          }
        } finally {
          actions.setIsAgentSessionActive(false)
        }
      },
    })
  }, [actions, currentProjectId, reloadActiveProjectFromDisk])

  const store = useEditorStoreApi()

  // S5-6: Live Edit Bridge Listener (applies patches directly to active Zustand store)
  useEffect(() => {
    if (!window.electronAPI?.on) return

    const unsubApply = window.electronAPI.on('editpilot:live-apply-patch', async ({ requestId, projectId, patch }) => {
      if (projectId !== currentProjectId) return

      try {
        const validatedPatch = patch as EditPatch
        let diffDescription = ''

        // 1. Apply to store with history (records 1 undo step)
        store.getState().setStateWithHistory(prev => {
          diffDescription = describePatch(prev, validatedPatch)
          return applyEditPatchToState(prev, validatedPatch)
        })

        // 2. Persist updated model to disk
        const updatedModel = store.getState().state.editorModel
        const savedProject = {
          ...currentProjectRef.current,
          updatedAt: Date.now(),
          assets: updatedModel.assets,
          bins: updatedModel.bins,
          timelines: updatedModel.timelines,
          activeTimelineId: updatedModel.activeTimelineId || currentProjectRef.current.activeTimelineId,
        }
        await persistProjectToDisk(currentProjectId, savedProject)
        currentProjectRef.current = savedProject

        // 3. Respond success to live bridge
        await window.electronAPI.editPilotRespondLivePatch({
          requestId,
          success: true,
          description: diffDescription,
          appliedCount: (validatedPatch.operations || []).length,
        })
      } catch (err: any) {
        await window.electronAPI.editPilotRespondLivePatch({
          requestId,
          success: false,
          error: err.message || String(err),
        })
      }
    })

    const unsubUndo = window.electronAPI.on('editpilot:live-undo', async ({ requestId, projectId }) => {
      if (projectId !== currentProjectId) return

      try {
        store.getState().setStateWithoutHistory(prev => undo(prev))
        const updatedModel = store.getState().state.editorModel
        const savedProject = {
          ...currentProjectRef.current,
          updatedAt: Date.now(),
          assets: updatedModel.assets,
          bins: updatedModel.bins,
          timelines: updatedModel.timelines,
          activeTimelineId: updatedModel.activeTimelineId || currentProjectRef.current.activeTimelineId,
        }
        await persistProjectToDisk(currentProjectId, savedProject)
        currentProjectRef.current = savedProject

        await window.electronAPI.editPilotRespondLiveUndo({
          requestId,
          success: true,
          description: 'Reverted last edit in live editor',
        })
      } catch (err: any) {
        await window.electronAPI.editPilotRespondLiveUndo({
          requestId,
          success: false,
          error: err.message || String(err),
        })
      }
    })

    return () => {
      unsubApply()
      unsubUndo()
    }
  }, [currentProjectId, store])

  const bladeShiftHeldRef = useRef(false)
  const [bladeShiftHeld, setBladeShiftHeld] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const held = e.shiftKey
      bladeShiftHeldRef.current = held
      setBladeShiftHeld(held)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey) }
  }, [])

  // Resizable layout
  const leftPanelResizeRef = useRef<PanelImperativeHandle | null>(null)
  const rightPanelResizeRef = useRef<PanelImperativeHandle | null>(null)
  const timelinePanelResizeRef = useRef<PanelImperativeHandle | null>(null)
  const assetsPanelActionsRef = useRef<VideoEditorAssetsPanelHandle | null>(null)
  const programMonitorActionsRef = useRef<ProgramMonitorHandle | null>(null)

  const timelineRef = useRef<HTMLDivElement>(null)
  const trackContainerRef = useRef<HTMLDivElement>(null)
  const trackHeadersRef = useRef<HTMLDivElement>(null)
  const rulerScrollRef = useRef<HTMLDivElement>(null)
  // Written by the timeline on every mouse move, read by Ctrl+B.
  const timelineHoverRef = useRef<{ time: number; trackIndex: number } | null>(null)
  const centerOnPlayheadRef = useRef(false) // Flag: center view on playhead after next zoom change
  const initialPanelDefaultsRef = useRef<{
    leftPanelWidth: number
    rightPanelWidth: number
    timelineHeight: number
  } | null>(null)
  if (!initialPanelDefaultsRef.current) {
    initialPanelDefaultsRef.current = {
      leftPanelWidth: layout.leftPanelWidth,
      rightPanelWidth: layout.rightPanelWidth,
      timelineHeight: layout.timelineHeight,
    }
  }

  // --- Performance refs: allow the rAF playback loop to sync video directly ---
  const playbackTimeRef = useRef(0)            // authoritative time during playback
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedStructuralRef = useRef<string>('')
  const isDirtyRef = useRef(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  // Mirror the transport time into the ref without subscribing: this component
  // is the timeline's parent, so re-rendering it on every playhead tick would
  // re-render every clip along with it.
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const subscribeToSlice = useEditorSubscribeToSlice()
  useEffect(() => subscribeToSlice(selectCurrentTime, (time) => {
    if (!isPlayingRef.current) playbackTimeRef.current = time
  }), [subscribeToSlice, playbackTimeRef])

  const applyLayoutToPanels = useCallback((nextLayout: EditorLayout) => {
    leftPanelResizeRef.current?.resize(nextLayout.leftPanelWidth)
    timelinePanelResizeRef.current?.resize(nextLayout.timelineHeight)
    if (showPropertiesPanel) {
      rightPanelResizeRef.current?.resize(nextLayout.rightPanelWidth)
    }
  }, [showPropertiesPanel])

  const updateLayoutField = useCallback((
    field: 'leftPanelWidth' | 'rightPanelWidth' | 'timelineHeight',
    inPixels: number,
  ) => {
    const value = Math.round(inPixels)
    const currentLayout = selectLayout(getEditorState())
    if (currentLayout[field] === value) return
    const next = { ...currentLayout, [field]: value }
    saveLayout(next)
    actions.setLayout(next)
  }, [actions, getEditorState])

  const handleResetLayout = useCallback(() => {
    const nextLayout = { ...DEFAULT_LAYOUT }
    actions.resetLayout()
    saveLayout(nextLayout)
    requestAnimationFrame(() => applyLayoutToPanels(nextLayout))
  }, [actions, applyLayoutToPanels])

  const hasAppliedInitialLayoutRef = useRef(false)
  useLayoutEffect(() => {
    if (hasAppliedInitialLayoutRef.current) return
    hasAppliedInitialLayoutRef.current = true
    const currentLayout = selectLayout(getEditorState())
    requestAnimationFrame(() => applyLayoutToPanels(currentLayout))
  }, [applyLayoutToPanels, getEditorState])

  const prevShowPropertiesPanelRef = useRef(showPropertiesPanel)
  useEffect(() => {
    if (showPropertiesPanel && !prevShowPropertiesPanelRef.current) {
      const currentLayout = selectLayout(getEditorState())
      requestAnimationFrame(() => {
        rightPanelResizeRef.current?.resize(currentLayout.rightPanelWidth)
      })
    }
    prevShowPropertiesPanelRef.current = showPropertiesPanel
  }, [getEditorState, showPropertiesPanel])

  const { subtitleFileInputRef, handleImportSrt, handleExportSrt } = useSubtitleImportExport()
  const { handleExportTimelineXml } = useTimelineXmlExport()
  const selectedGapRef = useRef<{ trackIndex: number; startTime: number; endTime: number } | null>(null)
  const clearSelectedGapRef = useRef<() => void>(() => {})
  const closeSelectedGapRef = useRef<() => void>(() => {})

  const { fileInputRef, handleImportFile, importFiles } = useEditorMediaImport({ currentProjectId })

  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const totalDuration = useEditorStore(selectTotalDuration)

  // Dynamic minimum zoom: at min zoom the whole timeline fits in view
  const getMinZoom = useCallback(() => {
    const container = trackContainerRef.current
    if (!container || totalDuration <= 0) return 0.05
    const containerWidth = container.clientWidth - 20
    return Math.min(0.5, Math.max(0.01, containerWidth / (totalDuration * 100)))
  }, [totalDuration])
  const getMinZoomRef = useRef(getMinZoom)
  getMinZoomRef.current = getMinZoom

  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      lastSavedStructuralRef.current = getStructuralFingerprint(editorModel)
      return
    }
    if (isAgentSessionActive) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      return
    }

    isDirtyRef.current = true
    const currentFingerprint = getStructuralFingerprint(editorModel)
    const isMajorChange = currentFingerprint !== lastSavedStructuralRef.current

    // If autoSave is disabled or interval is 0: only save on major structural changes
    if (!settings.autoSave || (settings.autoSaveIntervalMinutes ?? 1) === 0) {
      if (isMajorChange) {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = setTimeout(() => {
          saveProject(updatedProject(currentProjectRef.current, editorModelRef.current))
          lastSavedStructuralRef.current = getStructuralFingerprint(editorModelRef.current)
          setLastSavedAt(new Date())
          isDirtyRef.current = false
          autoSaveTimerRef.current = null
        }, AUTOSAVE_DELAY)
      }
      return
    }

    // AutoSave is enabled with an interval > 0
    if (isMajorChange) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(() => {
        saveProject(updatedProject(currentProjectRef.current, editorModelRef.current))
        lastSavedStructuralRef.current = getStructuralFingerprint(editorModelRef.current)
        setLastSavedAt(new Date())
        isDirtyRef.current = false
        autoSaveTimerRef.current = null
      }, AUTOSAVE_DELAY)
    } else if (!autoSaveTimerRef.current) {
      const intervalMs = (settings.autoSaveIntervalMinutes ?? 1) * 60 * 1000
      autoSaveTimerRef.current = setTimeout(() => {
        saveProject(updatedProject(currentProjectRef.current, editorModelRef.current))
        lastSavedStructuralRef.current = getStructuralFingerprint(editorModelRef.current)
        setLastSavedAt(new Date())
        isDirtyRef.current = false
        autoSaveTimerRef.current = null
      }, intervalMs)
    }
  }, [editorModel, saveProject, isAgentSessionActive, settings.autoSave, settings.autoSaveIntervalMinutes])

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!isAgentSessionActiveRef.current && isDirtyRef.current) {
        const savedProject = updatedProject(currentProjectRef.current, editorModelRef.current)
        saveProject(savedProject)
        void persistProjectToDisk(currentProjectRef.current.id, savedProject)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      if (!isAgentSessionActiveRef.current && isDirtyRef.current) {
        const savedProject = updatedProject(currentProjectRef.current, editorModelRef.current)
        saveProject(savedProject)
        void persistProjectToDisk(currentProjectRef.current.id, savedProject)
      }
    }
  }, [saveProject])

  // --- Core timeline logic ---
  const deleteAssetActionRef = useRef<() => void>(() => {})
  const fitToViewRef = useRef<() => void>(() => {})
  const toggleFullscreenRef = useRef<() => void>(() => {})
  const openSettingsRef = useRef<() => void>(openSettings)
  openSettingsRef.current = openSettings

  useEditorKeyboard({
    refs: {
      kbLayoutRef,
      isKbEditorOpenRef,
      getState: getEditorState,
      playbackTimeRef,
      centerOnPlayheadRef,
      getMinZoomRef,
      selectedGapRef,
      clearSelectedGapRef,
      closeSelectedGapRef,
      fitToViewRef,
      toggleFullscreenRef,
      openSettingsRef,
      timelineHoverRef,
    },
    context: { deleteAssetActionRef },
  })

  usePlaybackEngine({ playbackTimeRef })
  usePlaybackAudioSync({ playbackTimeRef })

  deleteAssetActionRef.current = () => {
    assetsPanelActionsRef.current?.deleteAsset()
  }
  toggleFullscreenRef.current = () => {
    programMonitorActionsRef.current?.toggleFullscreen()
  }

  const menuDefinitions: MenuDefinition[] = useBuildMenuDefinitions({
    kbLayout,
    fileInputRef, subtitleFileInputRef,
    handleExportTimelineXml, handleExportSrt,
    setKbEditorOpen,
    fitToViewRef,
    handleResetLayout,
    openSettings,
  })

  // --- Render ---

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-black">
      <EditorTitleBar
        menus={menuDefinitions}
        projectName={currentProject?.name || 'Untitled'}
        lastSavedAt={lastSavedAt}
        isAgentSessionActive={isAgentSessionActive}
        onExport={() => actions.openExportModal()}
      />
      {/* Body: library / player / details on top, timeline spanning the full
          width underneath — modern editor arrangement, as opposed to the timeline
          sitting inside the centre column.

          The padding and the gaps are the layout: every region is its own card
          on the shell, so EditPilot starts level with the library's tab rail
          rather than below a rail that used to span the whole window. */}
      <div className="flex min-h-0 flex-1 gap-1.5 overflow-hidden p-1.5">
        <div className="min-w-0 flex-1">
        <Group orientation="vertical" className="h-full w-full">
          <Panel minSize={200} className="min-h-0">
            <Group orientation="horizontal" className="h-full w-full">
              <Panel
                id="editor-left-panel"
                panelRef={leftPanelResizeRef}
                defaultSize={initialPanelDefaultsRef.current.leftPanelWidth}
                minSize={LAYOUT_LIMITS.leftPanelWidth.min}
                maxSize={LAYOUT_LIMITS.leftPanelWidth.max}
                groupResizeBehavior="preserve-pixel-size"
                onResize={(size, _id, prev) => {
                  if (!prev) return
                  updateLayoutField('leftPanelWidth', size.inPixels)
                }}
                className="min-h-0 min-w-0"
              >
                <div className="editor-panel cc-panel">
                  <EditorTabRail
                    activeTab={libraryTab}
                    onSelect={(tab, defaultSection) => actions.setLibraryTab(tab, defaultSection)}
                  />
                  <div className="flex min-h-0 flex-1">
                  <EditorLeftNav
                    tab={libraryTab}
                    section={librarySection}
                    onSelect={(section) => actions.setLibrarySection(section)}
                  />
                  <EditorLibraryPanel
                    tab={libraryTab}
                    section={librarySection}
                    assetsPanelRef={assetsPanelActionsRef}
                    openSourceAsset={() => {}}
                    handleImportFile={handleImportFile}
                    importFiles={importFiles}
                    onImportSrt={() => subtitleFileInputRef.current?.click()}
                  />
                  </div>
                </div>
              </Panel>

              <Separator className="w-1.5 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40 active:bg-accent/60 relative z-10" />

              <Panel id="editor-player-panel" className="min-w-0">
                <div className="cc-panel">
                  <ProgramMonitor
                    ref={programMonitorActionsRef}
                    playbackTimeRef={playbackTimeRef}
                    kbLayout={kbLayout}
                  />
                </div>
              </Panel>

              {showPropertiesPanel && (
                <>
                  <Separator className="w-1.5 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40 active:bg-accent/60 relative z-10" />
                  <Panel
                    id="editor-properties-panel"
                    panelRef={rightPanelResizeRef}
                    defaultSize={initialPanelDefaultsRef.current.rightPanelWidth}
                    minSize={LAYOUT_LIMITS.rightPanelWidth.min}
                    maxSize={LAYOUT_LIMITS.rightPanelWidth.max}
                    groupResizeBehavior="preserve-pixel-size"
                    onResize={(size, _id, prev) => {
                      if (!prev) return
                      updateLayoutField('rightPanelWidth', size.inPixels)
                    }}
                    className="min-w-0"
                  >
                    <div className="cc-panel">
                      {selectedSubtitleId && selectedClipIds.size === 0 && subtitles.some(s => s.id === selectedSubtitleId) ? (
                        <SubtitlePropertiesPanel />
                      ) : selectedClip ? (
                        <ClipPropertiesPanel />
                      ) : (
                        <ProjectDetailsPanel project={currentProject} />
                      )}
                    </div>
                  </Panel>
                </>
              )}
            </Group>
          </Panel>

          <Separator className="h-1.5 flex-shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-accent/40 active:bg-accent/60 relative z-10" />

          <Panel
            id="editor-timeline-panel"
            panelRef={timelinePanelResizeRef}
            defaultSize={initialPanelDefaultsRef.current.timelineHeight}
            minSize={LAYOUT_LIMITS.timelineHeight.min}
            maxSize={LAYOUT_LIMITS.timelineHeight.max}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size, _id, prev) => {
              if (!prev) return
              updateLayoutField('timelineHeight', size.inPixels)
            }}
            className="min-h-0"
          >
            <div className="cc-panel">
            <VideoEditorTimelineEditingPanel
              importFiles={importFiles}
              currentProjectId={currentProjectId}
              playbackTimeRef={playbackTimeRef}
              centerOnPlayheadRef={centerOnPlayheadRef}
              getMinZoom={getMinZoom}
              kbLayout={kbLayout}
              subtitleFileInputRef={subtitleFileInputRef}
              handleImportSrt={handleImportSrt}
              selectedGapRefBridge={selectedGapRef}
              clearSelectedGapRefBridge={clearSelectedGapRef}
              closeSelectedGapRefBridge={closeSelectedGapRef}
              timelineRefBridge={timelineRef}
              trackContainerRefBridge={trackContainerRef}
              trackHeadersRefBridge={trackHeadersRef}
              rulerScrollRefBridge={rulerScrollRef}
              timelineHoverRef={timelineHoverRef}
              bladeShiftHeld={bladeShiftHeld}
              fitToViewRef={fitToViewRef}
              onRevealAsset={(assetId) => assetsPanelActionsRef.current?.revealAsset(assetId)}
            />
            </div>
          </Panel>
        </Group>
        </div>

        {/* Docked full-height beside the whole editor body
            — not inside the top row with Details. */}
        <EditPilotPanel
          backend={editPilotBackend}
          projectId={currentProjectId}
          playbackTimeRef={playbackTimeRef}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        multiple
        onChange={handleImportFile}
        className="hidden"
      />

      {showExportModal && (
        <ExportModal projectName={currentProject?.name || 'Untitled'} />
      )}

      {showProjectSettingsModal && <ProjectSettingsModal />}

      {/* Says why an edit was refused, instead of the control looking dead. */}
      <RejectedEditNotice />

      {showImportTimelineModal && (
        <ImportTimelineModal projectId={currentProjectId} />
      )}

      {subtitleTrackStyleIdx !== null && <SubtitleTrackStyleEditor />}

      <EditPilotLauncher />
    </div>
  )
}

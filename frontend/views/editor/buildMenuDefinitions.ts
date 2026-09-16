import { type MenuDefinition } from './EditorChrome'
import { TEXT_PRESETS } from '../../types/project'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'
import { useMemo } from 'react'
import { shallow } from 'zustand/vanilla/shallow'
import {
  selectCanRedo,
  selectCanUndo,
  selectCanUseClipboard,
  selectCurrentTime,
  selectMenuState,
} from './editor-selectors'
import { useEditorActions, useEditorGetState, useEditorStore } from './editor-store'
import { getShortcutLabel } from './video-editor-utils'
import { useTranslation } from '../../i18n/I18nContext'
import { useUpdateState } from '../../hooks/useUpdateState'

export interface MenuDepsParams {
  kbLayout: KeyboardLayout
  fileInputRef: React.RefObject<HTMLInputElement>
  subtitleFileInputRef: React.RefObject<HTMLInputElement>
  handleExportTimelineXml: () => void
  handleExportSrt: () => void
  setKbEditorOpen: (v: boolean) => void
  fitToViewRef: React.RefObject<() => void>
  handleResetLayout: () => void
  openSettings?: () => void
}

export function useBuildMenuDefinitions(p: MenuDepsParams): MenuDefinition[] {
  const actions = useEditorActions()
  const { t } = useTranslation()
  const { updateState, downloadUpdate, installNow, checkForUpdates } = useUpdateState()
  const menuState = useEditorStore(selectMenuState, shallow)
  const canUseClipboard = useEditorStore(selectCanUseClipboard)
  const canUndo = useEditorStore(selectCanUndo)
  const canRedo = useEditorStore(selectCanRedo)
  // Read lazily: the menu only needs the playhead when an item is clicked, and
  // subscribing here would re-render the whole editor as the playhead moves.
  const getEditorState = useEditorGetState()

  return useMemo(() => ([
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        { id: 'import-media', label: t('menu.importMedia'), shortcut: 'Ctrl+I', action: () => p.fileInputRef.current?.click() },
        { id: 'import-timeline', label: t('menu.importTimeline'), action: () => actions.openImportTimelineModal() },
        { id: 'import-srt', label: t('menu.importSrt'), action: () => p.subtitleFileInputRef.current?.click() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'export-timeline', label: t('menu.exportTimeline'), shortcut: 'Ctrl+E', action: () => actions.openExportModal() },
        { id: 'export-xml', label: t('menu.exportXml'), action: () => p.handleExportTimelineXml() },
        { id: 'export-srt', label: t('menu.exportSrt'), action: () => p.handleExportSrt(), disabled: menuState.subtitles.length === 0 },
        { id: 'sep-settings', label: '', separator: true },
        { id: 'settings', label: t('menu.settings'), shortcut: 'Ctrl+,', action: () => p.openSettings?.() },
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        { id: 'undo', label: t('menu.undo'), shortcut: getShortcutLabel(p.kbLayout, 'edit.undo'), action: () => actions.undo(), disabled: !canUndo },
        { id: 'redo', label: t('menu.redo'), shortcut: getShortcutLabel(p.kbLayout, 'edit.redo'), action: () => actions.redo(), disabled: !canRedo },
        { id: 'sep-1', label: '', separator: true },
        { id: 'cut', label: t('menu.cut'), shortcut: getShortcutLabel(p.kbLayout, 'edit.cut'), action: () => actions.cutSelection() },
        { id: 'copy', label: t('menu.copy'), shortcut: getShortcutLabel(p.kbLayout, 'edit.copy'), action: () => actions.copySelection() },
        { id: 'paste', label: t('menu.paste'), shortcut: getShortcutLabel(p.kbLayout, 'edit.paste'), action: () => actions.pasteSelection(), disabled: !canUseClipboard },
        { id: 'sep-2', label: '', separator: true },
        { id: 'select-all', label: t('menu.selectAll'), shortcut: getShortcutLabel(p.kbLayout, 'edit.selectAll'), action: () => actions.selectAllClips() },
        { id: 'deselect-all', label: t('menu.deselectAll'), shortcut: getShortcutLabel(p.kbLayout, 'edit.deselect'), action: () => actions.clearClipSelection() },
        { id: 'sep-3', label: '', separator: true },
        { id: 'keyboard-shortcuts', label: t('menu.keyboardShortcuts'), action: () => p.setKbEditorOpen(true) },
      ],
    },
    {
      id: 'clip',
      label: t('menu.clip'),
      items: [
        {
          id: 'split',
          label: t('menu.split'),
          shortcut: getShortcutLabel(p.kbLayout, 'edit.split'),
          action: () => {
            if (menuState.selectedClip) {
              actions.splitClipsAtTime([menuState.selectedClip.id], selectCurrentTime(getEditorState()))
            }
          },
          disabled: !menuState.selectedClip,
        },
        {
          id: 'duplicate',
          label: t('menu.duplicate'),
          action: () => {
            if (menuState.selectedClip) {
              actions.duplicateClips([menuState.selectedClip.id])
            }
          },
          disabled: !menuState.selectedClip,
        },
        {
          id: 'delete',
          label: t('menu.delete'),
          shortcut: getShortcutLabel(p.kbLayout, 'edit.delete'),
          action: () => actions.deleteClips([...menuState.selectedClipIds]),
          disabled: menuState.selectedClipIds.size === 0,
        },
        { id: 'sep-1', label: '', separator: true },
        {
          id: 'flip-h',
          label: t('menu.flipH'),
          action: () => {
            if (menuState.selectedClip) {
              actions.updateClip(menuState.selectedClip.id, { flipH: !menuState.selectedClip.flipH })
            }
          },
          disabled: !menuState.selectedClip,
        },
        {
          id: 'flip-v',
          label: t('menu.flipV'),
          action: () => {
            if (menuState.selectedClip) {
              actions.updateClip(menuState.selectedClip.id, { flipV: !menuState.selectedClip.flipV })
            }
          },
          disabled: !menuState.selectedClip,
        },
        {
          id: 'reverse',
          label: t('menu.reverse'),
          action: () => {
            if (menuState.selectedClip) {
              actions.toggleClipReverse(menuState.selectedClip.id)
            }
          },
          disabled: !menuState.selectedClip,
        },
        { id: 'sep-2', label: '', separator: true },
        {
          id: 'mute',
          label: menuState.selectedClip?.muted ? t('menu.unmute') : t('menu.mute'),
          action: () => {
            if (menuState.selectedClip) {
              actions.toggleClipMute(menuState.selectedClip.id)
            }
          },
          disabled: !menuState.selectedClip,
        },
        {
          id: 'link-audio',
          label: menuState.selectedClip?.linkedClipIds?.length ? t('menu.unlinkAudio') : t('menu.linkAudio'),
          action: () => {
            if (menuState.selectedClip?.linkedClipIds?.length) {
              actions.unlinkClipGroup(menuState.selectedClip.id)
            }
          },
          disabled: !menuState.selectedClip,
        },
        { id: 'sep-3', label: '', separator: true },
        { id: 'speed-025', label: 'Speed: 0.25x', action: () => {
          if (!menuState.selectedClip) return
          const clip = menuState.selectedClip
          const oldSpeed = clip.speed ?? 1
          const newDuration = Math.max(0.1, clip.duration * (oldSpeed / 0.25))
          actions.setClipSpeed(clip.id, 0.25, newDuration)
        }, disabled: !menuState.selectedClip },
        { id: 'speed-050', label: 'Speed: 0.5x', action: () => {
          if (!menuState.selectedClip) return
          const clip = menuState.selectedClip
          const oldSpeed = clip.speed ?? 1
          const newDuration = Math.max(0.1, clip.duration * (oldSpeed / 0.5))
          actions.setClipSpeed(clip.id, 0.5, newDuration)
        }, disabled: !menuState.selectedClip },
        { id: 'speed-100', label: 'Speed: 1x (Normal)', action: () => {
          if (!menuState.selectedClip) return
          const clip = menuState.selectedClip
          const oldSpeed = clip.speed ?? 1
          const newDuration = Math.max(0.1, clip.duration * (oldSpeed / 1))
          actions.setClipSpeed(clip.id, 1, newDuration)
        }, disabled: !menuState.selectedClip },
        { id: 'speed-150', label: 'Speed: 1.5x', action: () => {
          if (!menuState.selectedClip) return
          const clip = menuState.selectedClip
          const oldSpeed = clip.speed ?? 1
          const newDuration = Math.max(0.1, clip.duration * (oldSpeed / 1.5))
          actions.setClipSpeed(clip.id, 1.5, newDuration)
        }, disabled: !menuState.selectedClip },
        { id: 'speed-200', label: 'Speed: 2x', action: () => {
          if (!menuState.selectedClip) return
          const clip = menuState.selectedClip
          const oldSpeed = clip.speed ?? 1
          const newDuration = Math.max(0.1, clip.duration * (oldSpeed / 2))
          actions.setClipSpeed(clip.id, 2, newDuration)
        }, disabled: !menuState.selectedClip },
        { id: 'speed-400', label: 'Speed: 4x', action: () => {
          if (!menuState.selectedClip) return
          const clip = menuState.selectedClip
          const oldSpeed = clip.speed ?? 1
          const newDuration = Math.max(0.1, clip.duration * (oldSpeed / 4))
          actions.setClipSpeed(clip.id, 4, newDuration)
        }, disabled: !menuState.selectedClip },
      ],
    },
    {
      id: 'sequence',
      label: t('menu.sequence'),
      items: [
        { id: 'add-video-track', label: t('menu.addVideoTrack'), action: () => actions.addTrack('video') },
        { id: 'add-audio-track', label: t('menu.addAudioTrack'), action: () => actions.addTrack('audio') },
        { id: 'add-subtitle-track', label: t('menu.addSubtitleTrack'), action: () => actions.addSubtitleTrack() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'add-adjustment', label: t('menu.addAdjustment'), action: () => actions.createAdjustmentLayerAsset() },
        { id: 'sep-2', label: '', separator: true },
        { id: 'add-text', label: t('menu.addText'), action: () => actions.addTextClip() },
        { id: 'add-text-lower', label: t('menu.addLowerThird'), action: () => actions.addTextClip({ style: TEXT_PRESETS.find(pr => pr.id === 'lower-third-basic')?.style }) },
        { id: 'add-text-subtitle', label: t('menu.addCaption'), action: () => actions.addTextClip({ style: TEXT_PRESETS.find(pr => pr.id === 'subtitle-style')?.style }) },
        { id: 'sep-3', label: '', separator: true },
        { id: 'snap-toggle', label: menuState.snapEnabled ? t('menu.disableSnapping') : t('menu.enableSnapping'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.toggleSnap'), action: () => actions.toggleSnap() },
      ],
    },
    {
      id: 'tools',
      label: t('menu.tools'),
      items: [
        { id: 'tool-select', label: t('menu.selectTool'), shortcut: getShortcutLabel(p.kbLayout, 'tool.select'), action: () => actions.setActiveTool('select') },
        { id: 'tool-blade', label: t('menu.bladeTool'), shortcut: getShortcutLabel(p.kbLayout, 'tool.blade'), action: () => actions.setActiveTool('blade') },
        { id: 'sep-1', label: '', separator: true },
        { id: 'tool-ripple', label: t('menu.rippleTrim'), shortcut: getShortcutLabel(p.kbLayout, 'tool.ripple'), action: () => { actions.setActiveTool('ripple'); actions.setLastTrimTool('ripple') } },
        { id: 'tool-roll', label: t('menu.rollTrim'), shortcut: getShortcutLabel(p.kbLayout, 'tool.roll'), action: () => { actions.setActiveTool('roll'); actions.setLastTrimTool('roll') } },
        { id: 'tool-slip', label: t('menu.slipTool'), shortcut: getShortcutLabel(p.kbLayout, 'tool.slip'), action: () => { actions.setActiveTool('slip'); actions.setLastTrimTool('slip') } },
        { id: 'tool-slide', label: t('menu.slideTool'), shortcut: getShortcutLabel(p.kbLayout, 'tool.slide'), action: () => { actions.setActiveTool('slide'); actions.setLastTrimTool('slide') } },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        { id: 'properties-panel', label: menuState.showPropertiesPanel ? t('menu.hideDetails') : t('menu.showDetails'), action: () => actions.setShowPropertiesPanel(!menuState.showPropertiesPanel) },
        { id: 'sep-1', label: '', separator: true },
        { id: 'fit-to-view', label: t('menu.zoomToFit'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.fitToView'), action: () => p.fitToViewRef.current?.() },
        { id: 'zoom-in', label: t('menu.zoomIn'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.zoomIn'), action: () => actions.zoomIn() },
        { id: 'zoom-out', label: t('menu.zoomOut'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.zoomOut'), action: () => actions.zoomOut() },
        { id: 'sep-2', label: '', separator: true },
        { id: 'reset-layout', label: t('menu.resetLayout'), action: () => p.handleResetLayout() },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        { id: 'shortcuts', label: t('menu.keyboardShortcuts'), action: () => p.setKbEditorOpen(true) },
        { id: 'sep-updates', label: '', separator: true },
        {
          id: 'check-updates',
          label: (() => {
            switch (updateState.status) {
              case 'checking':
                return t('update.menuChecking')
              case 'available':
                return t('update.menuAvailable', { version: updateState.version || '' })
              case 'downloading':
                return t('update.menuDownloading', { percent: Math.round(updateState.percent ?? 0) })
              case 'downloaded':
                return t('update.menuRestart', { version: updateState.version || '' })
              case 'idle':
                return updateState.upToDate ? t('update.menuUpToDate') : t('menu.checkForUpdates')
              default:
                return t('menu.checkForUpdates')
            }
          })(),
          disabled: updateState.status === 'checking' || updateState.status === 'downloading',
          action: () => {
            if (updateState.status === 'available') {
              void downloadUpdate()
            } else if (updateState.status === 'downloaded') {
              void installNow().then(res => {
                if (!res.success && res.error) {
                  alert(t('update.exportInProgress'))
                }
              })
            } else {
              void checkForUpdates()
            }
          },
        },
        { id: 'sep-settings', label: '', separator: true },
        { id: 'settings', label: t('menu.settings'), shortcut: 'Ctrl+,', action: () => p.openSettings?.() },
      ],
    },
  ]), [
    actions,
    canRedo,
    canUndo,
    canUseClipboard,
    checkForUpdates,
    downloadUpdate,
    getEditorState,
    installNow,
    menuState,
    p.fileInputRef,
    p.fitToViewRef,
    p.handleExportSrt,
    p.handleExportTimelineXml,
    p.handleResetLayout,
    p.kbLayout,
    p.openSettings,
    p.setKbEditorOpen,
    p.subtitleFileInputRef,
    t,
    updateState,
  ])
}

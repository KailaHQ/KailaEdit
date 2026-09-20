import type { Asset } from '../project-model'
import type { EditorState } from '../editor-state'
import { selectAssetById } from '../editor-selectors'
import {
  updateEditorModel,
  deleteBinEntry,
} from './action-helpers'
import { replaceActiveTimeline } from './timeline-actions'

export function addAssetToEditor(state: EditorState, asset: Asset): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: [asset, ...editorModel.assets],
  }))
}

export function addAssetsToEditor(state: EditorState, assets: Asset[]): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: [...assets, ...editorModel.assets],
  }))
}


export function deleteAssets(state: EditorState, assetIds: string[]): EditorState {
  const deleteSet = new Set(assetIds)
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: editorModel.assets.filter(asset => !deleteSet.has(asset.id)),
    timelines: editorModel.timelines.map(timeline => ({
      ...timeline,
      clips: timeline.clips.filter(clip => !clip.assetId || !deleteSet.has(clip.assetId)),
    })),
  }))
}

export function updateAsset(state: EditorState, assetId: string, patch: Partial<Asset>): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: editorModel.assets.map(asset => (asset.id === assetId ? { ...asset, ...patch } : asset)),
  }))
}

export function setAssetBin(state: EditorState, assetId: string, binId?: string): EditorState {
  return updateAsset(state, assetId, { binId })
}

export function createBin(state: EditorState, binId: string, name: string): EditorState {
  const trimmedName = name.trim()
  if (!trimmedName) return state

  return updateEditorModel(state, editorModel => (
    editorModel.bins[binId] || Object.values(editorModel.bins).includes(trimmedName)
      ? editorModel
      : {
          ...editorModel,
          bins: {
            ...editorModel.bins,
            [binId]: trimmedName,
          },
        }
  ))
}

export function assignAssetsToBin(state: EditorState, assetIds: string[], binId?: string): EditorState {
  const assetSet = new Set(assetIds)
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: editorModel.assets.map(asset => (assetSet.has(asset.id) ? { ...asset, binId } : asset)),
  }))
}

export function renameBin(state: EditorState, binId: string, newName: string): EditorState {
  const trimmedName = newName.trim()
  if (!trimmedName) return state

  return updateEditorModel(state, editorModel => (
    !editorModel.bins[binId] || Object.entries(editorModel.bins).some(([id, name]) => id !== binId && name === trimmedName)
      ? editorModel
      : {
          ...editorModel,
          bins: {
            ...editorModel.bins,
            [binId]: trimmedName,
          },
        }
  ))
}

export function clearBin(state: EditorState, binId: string): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    bins: deleteBinEntry(editorModel.bins, binId),
    assets: editorModel.assets.map(asset => (asset.binId === binId ? { ...asset, binId: undefined } : asset)),
  }))
}

export function toggleAssetFavorite(state: EditorState, assetId: string): EditorState {
  const asset = selectAssetById(state, assetId)
  if (!asset) return state
  return updateAsset(state, assetId, { favorite: !asset.favorite })
}

export function setAssetColorLabel(state: EditorState, assetId: string, colorLabel?: string): EditorState {
  const next = updateAsset(state, assetId, { colorLabel })
  return replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: timeline.clips.map(clip => (
      clip.assetId === assetId
        ? { ...clip, colorLabel }
        : clip
    )),
  }))
}


import type { Asset } from '../project-model'
import type { AssetListFilters, EditorState } from '../editor-state'
import { COLOR_LABELS } from '../video-editor-utils'
import { selectAssets } from '../editor-selectors'

export interface AssetBinListItem {
  id: string
  name: string
  count: number
}

function parseResolutionHeight(resolution?: string): number {
  const match = resolution?.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

export function selectAssetBins(state: EditorState): AssetBinListItem[] {
  const assetCounts = state.editorModel.assets.reduce((counts, asset) => {
    if (!asset.binId) return counts
    counts.set(asset.binId, (counts.get(asset.binId) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  return Object.entries(state.editorModel.bins)
    .map(([id, name]) => ({
      id,
      name,
      count: assetCounts.get(id) ?? 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function equalAssetBins(left: AssetBinListItem[], right: AssetBinListItem[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false

  return left.every((bin, index) => {
    const other = right[index]
    return (
      bin.id === other.id
      && bin.name === other.name
      && bin.count === other.count
    )
  })
}

/**
 * The media panel is the list of files the user imported from their machine.
 * A sticker dropped on the timeline still needs an asset for clip lookups, but
 * showing it here left blank tiles the user never asked for. Projects saved
 * before `source` existed are recognised by the prompt addStickerClip writes.
 * Sound effect (SFX) clips ship with the app and should likewise never clutter
 * the user's imported media library.
 */
export function isUserImportedAsset(asset: Asset): boolean {
  if (asset.source === 'sticker' || asset.source === 'sfx') return false
  if (asset.prompt.startsWith('Sticker: ') || asset.prompt.startsWith('SFX: ')) return false
  if (asset.path && (asset.path.startsWith('stickers/') || asset.path.startsWith('sfx/'))) return false
  return true
}

export function selectFilteredAssets(state: EditorState, filters: AssetListFilters): Asset[] {
  let result = selectAssets(state).filter(isUserImportedAsset)
  if (filters.assetFilter && filters.assetFilter !== 'all') {
    result = result.filter(asset => asset.type === filters.assetFilter)
  }
  if (filters.selectedBinId !== undefined && filters.selectedBinId !== null) {
    result = result.filter(asset => asset.binId === filters.selectedBinId)
  }
  return result
}

export function selectSortedAssets(state: EditorState, filters: AssetListFilters): Asset[] {
  const filteredAssets = selectFilteredAssets(state, filters)
  if (filters.assetViewMode !== 'list') return filteredAssets

  const sorted = [...filteredAssets]
  const dir = filters.listSortDir === 'desc' ? -1 : 1
  sorted.sort((a, b) => {
    switch (filters.listSortCol) {
      case 'type':
        return dir * a.type.localeCompare(b.type)
      case 'duration':
        return dir * ((a.duration ?? 0) - (b.duration ?? 0))
      case 'resolution':
        return dir * (parseResolutionHeight(a.resolution) - parseResolutionHeight(b.resolution))
      case 'date':
        return dir * (a.createdAt - b.createdAt)
      case 'color': {
        const order = COLOR_LABELS.map((color) => color.id)
        const idxA = a.colorLabel ? order.indexOf(a.colorLabel) : order.length
        const idxB = b.colorLabel ? order.indexOf(b.colorLabel) : order.length
        return dir * (idxA - idxB)
      }
      case 'name':
      default: {
        const nameA = (a.path?.split(/[/\\]/).pop() || a.type || '').toLowerCase()
        const nameB = (b.path?.split(/[/\\]/).pop() || b.type || '').toLowerCase()
        return dir * nameA.localeCompare(nameB)
      }
    }
  })
  return sorted
}

export function selectVisibleAssets(state: EditorState, filters: AssetListFilters): Asset[] {
  return selectSortedAssets(state, filters)
}

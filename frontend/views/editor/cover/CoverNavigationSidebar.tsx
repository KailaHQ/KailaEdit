import React from 'react'
import {
  LayoutTemplate,
  Type,
  Image as ImageIcon,
  Shapes,
  Layers,
} from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import type { CoverDrawerTab } from './types'

export interface CoverNavigationSidebarProps {
  activeDrawerTab: CoverDrawerTab | null
  onToggleTab: (tab: CoverDrawerTab) => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export const CoverNavigationSidebar: React.FC<CoverNavigationSidebarProps> = ({
  activeDrawerTab,
  onToggleTab,
  fileInputRef,
  onFileInputChange,
}) => {
  return (
    <div
      className="w-14 border-r border-zinc-800/80 bg-zinc-950 flex flex-col items-center py-3 gap-3 flex-shrink-0 z-30"
      onClick={e => e.stopPropagation()}
    >
      <Tooltip content="Templates" side="right">
        <button
          onClick={() => onToggleTab('templates')}
          className={`p-2.5 rounded-xl transition-all ${
            activeDrawerTab === 'templates'
              ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          }`}
        >
          <LayoutTemplate className="h-5 w-5" />
        </button>
      </Tooltip>

      <Tooltip content="Text" side="right">
        <button
          onClick={() => onToggleTab('text')}
          className={`p-2.5 rounded-xl transition-all ${
            activeDrawerTab === 'text'
              ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          }`}
        >
          <Type className="h-5 w-5" />
        </button>
      </Tooltip>

      <Tooltip content="Images" side="right">
        <button
          onClick={() => onToggleTab('images')}
          className={`p-2.5 rounded-xl transition-all ${
            activeDrawerTab === 'images'
              ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          }`}
        >
          <ImageIcon className="h-5 w-5" />
        </button>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileInputChange}
      />

      <Tooltip content="Shapes" side="right">
        <button
          onClick={() => onToggleTab('shapes')}
          className={`p-2.5 rounded-xl transition-all ${
            activeDrawerTab === 'shapes'
              ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          }`}
        >
          <Shapes className="h-5 w-5" />
        </button>
      </Tooltip>

      <div className="flex-1" />

      {/* Layers */}
      <Tooltip content="Layers" side="right">
        <button
          onClick={() => onToggleTab('position')}
          className={`p-2.5 rounded-xl transition-all ${
            activeDrawerTab === 'position'
              ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          }`}
        >
          <Layers className="h-5 w-5" />
        </button>
      </Tooltip>
    </div>
  )
}

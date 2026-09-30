import React, { useState } from 'react'
import { Upload, ImageIcon, Plus, Trash2 } from 'lucide-react'
import type { UploadedCoverImage } from '../types'

export interface CoverImagesTabProps {
  uploadedImages?: UploadedCoverImage[]
  onAddImageToCanvas?: (src: string, name: string) => void
  onUploadNewImage?: () => void
  onDeleteUploadedImage?: (id: string) => void
  onDropFiles?: (files: FileList) => void
}

export const CoverImagesTab: React.FC<CoverImagesTabProps> = ({
  uploadedImages = [],
  onAddImageToCanvas,
  onUploadNewImage,
  onDeleteUploadedImage,
  onDropFiles,
}) => {
  const [isDragOver, setIsDragOver] = useState<boolean>(false)

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragOver={e => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(true)
      }}
      onDragLeave={e => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)
      }}
      onDrop={e => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onDropFiles?.(e.dataTransfer.files)
        }
      }}
    >
      {/* Top Upload Action Header */}
      <div className="p-3 border-b border-zinc-800 flex-shrink-0 space-y-2">
        <button
          onClick={onUploadNewImage}
          className="w-full py-2.5 px-3 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 active:bg-sky-500/30 text-sky-400 border border-sky-500/30 hover:border-sky-500/50 flex items-center justify-center gap-2 font-medium text-xs transition-all shadow-sm group"
        >
          <Upload className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
          <span>Upload Image</span>
        </button>
        <p className="text-[10px] text-zinc-500 text-center">
          PNG, JPG, WebP, SVG • Drag & drop supported
        </p>
      </div>

      {/* Drag Overlay Hint */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-sky-950/80 backdrop-blur-sm border-2 border-dashed border-sky-400 m-2 rounded-xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150">
          <Upload className="h-10 w-10 text-sky-400 mb-2 animate-bounce" />
          <p className="text-sm font-semibold text-white">Drop images here</p>
          <p className="text-xs text-sky-300 mt-1">They will be added to your library & cover</p>
        </div>
      )}

      {/* Section Header */}
      <div className="px-4 py-2 flex items-center justify-between flex-shrink-0 text-zinc-400">
        <span className="text-[11px] font-semibold text-zinc-300">
          Uploaded Images ({uploadedImages.length})
        </span>
        {uploadedImages.length > 0 && (
          <span className="text-[10px] text-zinc-500 font-normal">Click to add</span>
        )}
      </div>

      {/* Empty State */}
      {uploadedImages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 text-xs gap-3">
          <div className="w-12 h-12 rounded-full bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-500">
            <ImageIcon className="h-6 w-6" />
          </div>
          <div className="space-y-1 max-w-[200px]">
            <p className="font-medium text-zinc-200">No images uploaded</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Upload images from your computer to quickly reuse them across your covers.
            </p>
          </div>
          <button
            onClick={onUploadNewImage}
            className="mt-1 px-3.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sky-400 hover:text-sky-300 font-medium text-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Upload now</span>
          </button>
        </div>
      ) : (
        /* Uploaded Images Grid */
        <div className="flex-1 overflow-y-auto px-4 py-2 grid grid-cols-2 gap-2.5 content-start">
          {uploadedImages.map(img => (
            <div
              key={img.id}
              onClick={() => onAddImageToCanvas?.(img.src, img.name)}
              className="group relative rounded-lg overflow-hidden border border-zinc-800 hover:border-sky-500/70 bg-zinc-950/80 transition-all cursor-pointer aspect-square flex items-center justify-center hover:shadow-lg hover:shadow-sky-950/30"
              title={`${img.name} (Click to add)`}
            >
              <img
                src={img.src}
                alt={img.name}
                className="w-full h-full object-contain p-1.5 transition-transform group-hover:scale-105"
                loading="lazy"
              />

              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5">
                {/* Top Delete Button */}
                <div className="flex justify-end">
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onDeleteUploadedImage?.(img.id)
                    }}
                    className="p-1 rounded bg-zinc-900/80 hover:bg-red-500 text-zinc-400 hover:text-white transition-colors shadow"
                    title="Delete from library"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* Middle Plus Indicator */}
                <div className="flex items-center justify-center pointer-events-none">
                  <div className="w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                    <Plus className="h-4 w-4 stroke-[2.5]" />
                  </div>
                </div>

                {/* Bottom File Name */}
                <span className="text-[10px] text-zinc-200 font-medium truncate w-full px-1 text-center pointer-events-none">
                  {img.name}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

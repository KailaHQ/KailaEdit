import fs from 'fs'
import path from 'path'
import { findFfmpegPath, runFfmpegCapture } from '../export/ffmpeg-utils'

const DEFAULT_THUMBNAIL_MAX_DIMENSION = 400

export function getThumbnailPaths(assetPath: string): { bigThumbnailPath: string; smallThumbnailPath: string } {
  const parsed = path.parse(assetPath)
  return {
    bigThumbnailPath: path.join(parsed.dir, `${parsed.name}_big_thumbnail.png`),
    smallThumbnailPath: path.join(parsed.dir, `${parsed.name}_small_thumbnail.png`),
  }
}

function requireFfmpeg(): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not found')
  }
  return ffmpegPath
}

export async function createDownsampledThumbnail(
  sourcePath: string,
  outputPath: string,
  maxDimension = DEFAULT_THUMBNAIL_MAX_DIMENSION,
): Promise<void> {
  const ffmpegPath = requireFfmpeg()
  // Fit inside a maxDimension box without upscaling, honouring any EXIF orientation.
  const scaleFilter = `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`
  const result = await runFfmpegCapture(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-vf', scaleFilter, '-frames:v', '1', outputPath],
    15000,
  )
  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    throw new Error(`ffmpeg resize failed (code ${result.status}): ${stderr}`)
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Failed to create small thumbnail: ${outputPath}`)
  }
}

export async function getImageDimensions(sourcePath: string): Promise<{ width: number; height: number }> {
  const ffmpegPath = requireFfmpeg()
  const result = await runFfmpegCapture(ffmpegPath, ['-hide_banner', '-i', sourcePath], 10000)
  // ffmpeg with no output file exits non-zero and prints the stream info on stderr.
  const output = `${result.stdout}\n${result.stderr}`
  const videoStreamLine = output.split('\n').find(line => line.includes('Video:'))
  const match = videoStreamLine?.match(/(\d{2,5})x(\d{2,5})(?:[,\s[]|$)/)

  if (!match) {
    throw new Error(`Could not determine image dimensions for ${sourcePath}`)
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid image dimensions for ${sourcePath}: ${match[1]}x${match[2]}`)
  }

  return { width, height }
}

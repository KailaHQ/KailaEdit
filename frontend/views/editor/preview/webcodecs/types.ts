export interface VideoDemuxTrackInfo {
  id: number
  codec: string
  /** Display width — rotated if the container says so. */
  width: number
  /** Display height — rotated if the container says so. */
  height: number
  duration: number // in seconds
  timescale: number
  nb_samples: number
  description?: Uint8Array
  /** Raw coded width from the bitstream (before any container rotation). */
  codedWidth: number
  /** Raw coded height from the bitstream (before any container rotation). */
  codedHeight: number
  /**
   * Container-level rotation in degrees (0, 90, 180, 270), extracted from the
   * `tkhd` transformation matrix. Phone-recorded portrait video typically has
   * `rotation === 90` — coded dimensions are landscape, and the matrix says
   * "rotate 90° for display".
   *
   * When non-zero, `width` and `height` above are the **display** dimensions
   * (already swapped by the demuxer), while `codedWidth` / `codedHeight`
   * retain the original bitstream geometry for the decoder.
   */
  rotation: number
}

export interface VideoSampleRecord {
  index: number
  pts: number // in seconds
  dts: number // in seconds
  duration: number // in seconds
  isKeyframe: boolean
  offset: number
  size: number
  chunk?: EncodedVideoChunk
}

export interface DemuxedVideoMetadata {
  trackInfo: VideoDemuxTrackInfo
  samples: VideoSampleRecord[]
  keyframeIndices: number[] // indices into samples array where isKeyframe is true
  fps: number
  duration: number
}

export interface DecodedFrameResult {
  frame: VideoFrame
  timestamp: number // in seconds
}

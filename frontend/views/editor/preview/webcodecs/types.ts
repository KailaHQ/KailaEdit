export interface VideoDemuxTrackInfo {
  id: number
  codec: string
  width: number
  height: number
  duration: number // in seconds
  timescale: number
  nb_samples: number
  description?: Uint8Array
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

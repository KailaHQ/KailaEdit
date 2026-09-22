/** One frame per source PTS, all-intra. Speed/trim never enter this cache format. */
export function scrubProxyArgs(input: string, output: string): string[] {
  return ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-an',
    '-vf', "scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
    '-fps_mode', 'passthrough', '-enc_time_base', '1:1000000', '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2',
    '-crf', '18', '-g', '1', '-bf', '0', '-pix_fmt', 'yuv420p', '-video_track_timescale', '1000000',
    '-movflags', '+faststart', output]
}

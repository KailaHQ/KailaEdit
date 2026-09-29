import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const READ_ONLY_TOOLS: Tool[] = [
  {
    name: 'project_list',
    description: 'List all available KomfyEdit projects stored on disk with summary metadata (ID, name, clip count, duration, file path).',
    inputSchema: {
      type: 'object',
      properties: {
        projectsDir: {
          type: 'string',
          description: 'Optional custom directory path where project JSON files are stored.',
        },
      },
    },
  },
  {
    name: 'project_open',
    description: 'Load a KomfyEdit project into memory by ID or file path and inspect its tracks, assets, and active timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID or file path of the project to open.',
        },
        projectsDir: {
          type: 'string',
          description: 'Optional custom directory path where project JSON files are stored.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'timeline_describe',
    description: 'Provide a comprehensive breakdown of the timeline including canvas dimensions (width, height, fps, aspectRatio, background), clips with transforms, tracks, transitions, and subtitles.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID. Defaults to active timeline.',
        },
      },
    },
  },
  {
    name: 'subtitle_list',
    description: 'List all subtitle cues on the timeline with index, text, start, end, duration, and track info.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID. Defaults to active timeline.',
        },
      },
    },
  },
  {
    name: 'timeline_summary',
    description: 'Generate a compact, token-efficient timeline representation (<= 16KB) suitable for LLM context, including tracks, clips, and gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID.',
        },
        maxBytes: {
          type: 'number',
          description: 'Maximum size ceiling in bytes (default 16384).',
        },
      },
    },
  },
  {
    name: 'media_list',
    description: 'List all media assets registered in the project with ID, type, file path, resolution, duration, and proxy status.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses active opened project.',
        },
      },
    },
  },
  {
    name: 'media_probe',
    description: 'Inspect low-level media properties (duration, video codec/resolution, audio channels/sample rate) via ffprobe.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to media file.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID to resolve media file from active timeline.',
        },
      },
    },
  },
  {
    name: 'observe_silence',
    description: 'Detect silence intervals in an audio/video file using ffmpeg silencedetect filter.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to media file.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID to resolve media from active timeline.',
        },
        noiseDb: {
          type: 'number',
          description: 'Noise tolerance threshold in dB (default -35dB). E.g. -30dB or -40dB.',
        },
        minDurationSec: {
          type: 'number',
          description: 'Minimum silence duration in seconds to trigger detection (default 0.75s).',
        },
      },
    },
  },
  {
    name: 'observe_scenes',
    description: 'Detect scene changes/cuts in a video using ffmpeg select="gt(scene,threshold)".',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to video file.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID to resolve video from active timeline.',
        },
        threshold: {
          type: 'number',
          description: 'Scene change detection threshold from 0.0 to 1.0 (default 0.35).',
        },
      },
    },
  },
  {
    name: 'observe_loudness',
    description: 'Measure integrated loudness (LUFS), loudness range (LRA), and true peak (dBTP) using ffmpeg ebur128.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to audio/video file.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID to resolve media from active timeline.',
        },
      },
    },
  },
  {
    name: 'observe_filmstrip',
    description: 'Generate a visual multi-frame contact sheet / filmstrip thumbnail of a video interval (<= 500KB PNG) for visual inspection.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to video file.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID to resolve video from active timeline.',
        },
        startTime: {
          type: 'number',
          description: 'Start time in seconds (default 0).',
        },
        endTime: {
          type: 'number',
          description: 'End time in seconds.',
        },
        columns: {
          type: 'number',
          description: 'Number of columns in grid (default 5, clamped 1-12).',
        },
        maxWidth: {
          type: 'number',
          description: 'Maximum width of final filmstrip image in px (default 1280).',
        },
      },
    },
  },
  {
    name: 'transcribe',
    description: 'Transcribe spoken audio from a media file using local/remote Whisper API, returning word-level timestamps and text segments.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to media file.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID to resolve media from active timeline.',
        },
        startTime: {
          type: 'number',
          description: 'Optional start offset in seconds.',
        },
        duration: {
          type: 'number',
          description: 'Optional duration in seconds to transcribe.',
        },
        language: {
          type: 'string',
          description: 'ISO-639-1 language code (e.g. "vi", "en"). Defaults to auto-detect.',
        },
        wordTimestamps: {
          type: 'boolean',
          description: 'Whether to extract word-level timestamps (default true).',
        },
        endpoint: {
          type: 'string',
          description: 'Optional custom Whisper HTTP endpoint URL.',
        },
        apiKey: {
          type: 'string',
          description: 'Optional Whisper API Key (if cloud endpoint).',
        },
        model: {
          type: 'string',
          description: 'Model name (e.g. "whisper-1", "large-v3", "base").',
        },
        prompt: {
          type: 'string',
          description: 'Optional guiding prompt or glossary for specialized terms.',
        },
      },
    },
  },
  {
    name: 'extract_highlights',
    description: 'Analyze transcript text or audio to identify engaging highlight candidates suitable for short-form content (TikTok/Reels/Shorts).',
    inputSchema: {
      type: 'object',
      properties: {
        transcriptText: {
          type: 'string',
          description: 'Full transcript text with timestamps (or plain text).',
        },
        filePath: {
          type: 'string',
          description: 'Optional media file path to transcribe if transcriptText is not provided.',
        },
        maxItems: {
          type: 'number',
          description: 'Maximum number of highlight segments to extract (default 4).',
        },
        endpoint: {
          type: 'string',
          description: 'Optional LLM OpenAI-compatible endpoint URL.',
        },
        apiKey: {
          type: 'string',
          description: 'LLM API key for completions.',
        },
        model: {
          type: 'string',
          description: 'LLM model name (default "gpt-4o-mini").',
        },
      },
    },
  },
  {
    name: 'qc_check',
    description: 'Run an automated Quality Control (QC) health check on the project/timeline to detect orphan clips, missing media, short clips (<0.5s), overlay gaps, and subtitle overlaps.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID.',
        },
      },
    },
  },
  {
    name: 'filter_list',
    description: 'List available built-in 3D LUT video filters with ID, name, category, description, and default intensity.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to filter by (e.g. "cinematic", "film", "vintage", "bw", "creative", "moody").',
        },
      },
    },
  },
  {
    name: 'sticker_list',
    description: 'List available built-in stickers with ID, name, category, and keywords for use with add_sticker.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to filter by ("emoji", "badge", "arrow", "icon", "animated").',
        },
      },
    },
  },
  {
    name: 'sfx_list',
    description: 'List available built-in sound effects (16-bit WAV) with ID, name, category, duration, description, and keywords for use with add_sfx.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to filter by ("transition", "accent", "notification", "impact", "comedy", "foley").',
        },
      },
    },
  },
  {
    name: 'suggest_broll',
    description: 'Analyze the timeline transcript/subtitles to identify continuous talking intervals (> 5s) lacking visual variety, and suggest B-roll insertion points with timestamps and extracted keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project ID to analyze. Defaults to the active project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID to analyze (defaults to active timeline).',
        },
        minDuration: {
          type: 'number',
          description: 'Minimum duration of continuous talking head speech to consider for B-roll (default 5.0 seconds).',
        },
        maxDuration: {
          type: 'number',
          description: 'Maximum recommended duration for a B-roll clip (default 8.0 seconds).',
        },
      },
    },
  },
]

export const EDIT_TOOLS: Tool[] = [
  {
    name: 'ask_confirm',
    description: 'Ask the user to confirm before an irreversible or ambiguous edit, and BLOCK until they answer in the KomfyEdit panel. Returns the id of the button they pressed, plus the item numbers still ticked when the list was selectable. Use it in place of asking in chat: a chat question is only read after the run has already finished.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short heading for the card, e.g. "Filler words detected".',
        },
        message: {
          type: 'string',
          description: 'Optional sentence explaining what will happen if they confirm.',
        },
        items: {
          type: 'array',
          description: 'What the action would touch, one entry per clip/word/range. Pass every match; the panel shows the first 40 and reports the rest as a count.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short primary text.' },
              detail: { type: 'string', description: 'Secondary text, e.g. a duration or timecode.' },
              highlight: { type: 'boolean', description: 'True for entries the action will actually change.' },
              startSec: { type: 'number', description: 'Where this entry sits on the timeline, in seconds. Pass it and the row becomes clickable: the playhead jumps there, so the user can watch the spot before deciding.' },
              endSec: { type: 'number', description: 'Where the entry ends, in seconds.' },
            },
            required: ['label'],
          },
        },
        actions: {
          type: 'array',
          description: 'Buttons to offer. Defaults to Xác nhận / Huỷ. The chosen id comes back to you.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              style: { type: 'string', enum: ['primary', 'danger', 'secondary'] },
            },
            required: ['id', 'label'],
          },
        },
        taskIndex: {
          type: 'number',
          description: '1-based index of the plan item this question belongs to, so the checklist can point at it.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID; defaults to the active project.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'edit_propose',
    description: 'Propose an EditPatch for validation and preview semantic diff against the timeline without modifying disk.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        patch: {
          type: 'object',
          description: 'The EditPatch object to propose (containing version, description, operations: split_clip, cut_range, delete_clip, move_clip, import_srt, add_subtitle, chunk_subtitles, punch_in_cut, punch_in_sequence, set_mask, set_chroma_key, set_stabilization, replace_clip, set_blend_mode, set_canvas, set_timeline_dimensions, set_timeline_background, normalize_audio, duck_audio, etc.).',
        },
      },
      required: ['patch'],
    },
  },
  {
    name: 'edit_apply',
    description: 'Apply a previously proposed EditPatch atomically in a transaction and save changes to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        patchId: {
          type: 'string',
          description: 'The unique patchId returned by edit.propose.',
        },
      },
      required: ['patchId'],
    },
  },
  {
    name: 'edit_undo',
    description: 'Revert the most recent edit applied in this session and restore the project file on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project ID or path.',
        },
      },
    },
  },
  {
    name: 'render_preview',
    description: 'Render a fast, low-resolution (480p) short preview snippet for a specified time interval to visually verify edits without touching the official export.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID.',
        },
        startTime: {
          type: 'number',
          description: 'Start time in seconds (default 0).',
        },
        endTime: {
          type: 'number',
          description: 'End time in seconds (defaults to startTime + 10).',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (default 10s).',
        },
        resolution: {
          type: 'string',
          enum: ['480p', '360p', '720p'],
          description: 'Resolution of preview (default 480p).',
        },
        wait: {
          type: 'boolean',
          description: 'Whether to wait for render completion before returning (default true).',
        },
      },
    },
  },
  {
    name: 'render_cancel',
    description: 'Cancel an active rendering job (export or preview) by jobId.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The job ID to cancel.',
        },
      },
      required: ['jobId'],
    },
  },
]

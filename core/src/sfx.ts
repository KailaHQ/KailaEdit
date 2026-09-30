export type SfxCategory =
  | 'accent'
  | 'transition'
  | 'notification'
  | 'impact'
  | 'comedy'
  | 'foley'

export interface SfxDefinition {
  id: string
  name: string
  category: SfxCategory
  filename: string
  duration: number
  description: string
  keywords: string[]
}

export const SFX_DEFINITIONS: SfxDefinition[] = [
  // Transition
  {
    id: 'whoosh',
    name: 'Whoosh / Swoosh',
    category: 'transition',
    filename: 'whoosh.wav',
    duration: 0.45,
    description: 'Fast swish sound for punch-in zoom, quick scene transitions, and sliding text',
    keywords: ['whoosh', 'swoosh', 'zoom', 'punch-in', 'chuyển cảnh', 'transition'],
  },
  {
    id: 'whoosh-fast',
    name: 'Fast Whip Whoosh',
    category: 'transition',
    filename: 'whoosh-fast.wav',
    duration: 0.25,
    description: 'Super fast whip sound for whip pans, quick card swipes, and slide transitions',
    keywords: ['whoosh', 'fast', 'whip', 'swipe', 'slide', 'nhanh'],
  },
  {
    id: 'whoosh-deep',
    name: 'Cinematic Deep Whoosh',
    category: 'transition',
    filename: 'whoosh-deep.wav',
    duration: 0.65,
    description: 'Cinematic deep transition whoosh sound',
    keywords: ['cinematic', 'deep', 'whoosh', 'bass', 'điện ảnh', 'trầm'],
  },
  {
    id: 'glitch',
    name: 'Digital Glitch',
    category: 'transition',
    filename: 'glitch.wav',
    duration: 0.35,
    description: 'Digital static noise, screen glitch, cyberpunk scene transition',
    keywords: ['glitch', 'digital', 'cyber', 'nhiễu', 'static', 'tech'],
  },
  {
    id: 'rewind',
    name: 'Tape Rewind',
    category: 'transition',
    filename: 'rewind.wav',
    duration: 0.50,
    description: 'Fast cassette tape rewind sound for flashbacks',
    keywords: ['rewind', 'tape', 'cassette', 'tua', 'ngược', 'flashback'],
  },

  // Accent & UI
  {
    id: 'pop',
    name: 'Pop / Bubble',
    category: 'accent',
    filename: 'pop.wav',
    duration: 0.15,
    description: 'Playful bubble pop sound for stickers, badges, and icon appearances',
    keywords: ['pop', 'bubble', 'badge', 'sticker', 'appear', 'nhẹ'],
  },
  {
    id: 'mouse-click',
    name: 'UI Mouse Click',
    category: 'accent',
    filename: 'mouse-click.wav',
    duration: 0.08,
    description: 'Crisp mouse click sound for buttons and link clicks',
    keywords: ['click', 'mouse', 'ui', 'button', 'nút', 'chuột'],
  },
  {
    id: 'keyboard-type',
    name: 'Mechanical Key Click',
    category: 'accent',
    filename: 'keyboard-type.wav',
    duration: 0.12,
    description: 'Crisp mechanical keystroke sound for typing or title reveals',
    keywords: ['keyboard', 'type', 'key', 'bàn phím', 'gõ', 'chữ', 'text'],
  },
  {
    id: 'camera-shutter',
    name: 'Camera Shutter',
    category: 'accent',
    filename: 'camera-shutter.wav',
    duration: 0.30,
    description: 'Camera shutter click for screenshots and freeze frames',
    keywords: ['camera', 'shutter', 'photo', 'máy ảnh', 'chụp hình', 'freeze'],
  },
  {
    id: 'cork-pop',
    name: 'Cork Bottle Pop',
    category: 'accent',
    filename: 'cork-pop.wav',
    duration: 0.20,
    description: 'Playful champagne bottle cork pop sound',
    keywords: ['cork', 'pop', 'bottle', 'chai', 'mở', 'ăn mừng'],
  },
  {
    id: 'snap',
    name: 'Finger Snap',
    category: 'accent',
    filename: 'snap.wav',
    duration: 0.12,
    description: 'Crisp finger snap sound for idea switches or sudden reveals',
    keywords: ['snap', 'finger', 'búng tay', 'thay đổi', 'magic'],
  },

  // Notification & Game
  {
    id: 'ding',
    name: 'Ding / Chime',
    category: 'notification',
    filename: 'ding.wav',
    duration: 0.85,
    description: 'Resonant bell chime for striking numbers, highlights, and results',
    keywords: ['ding', 'chime', 'bell', 'number', 'số', 'highlight', 'tiền', 'free'],
  },
  {
    id: 'bell-chime',
    name: 'Service Bell',
    category: 'notification',
    filename: 'bell-chime.wav',
    duration: 0.90,
    description: 'Crisp desk bell chime to capture attention',
    keywords: ['bell', 'hotel', 'desk', 'chuông', 'gọi', 'chú ý'],
  },
  {
    id: 'success',
    name: 'Success Chime',
    category: 'notification',
    filename: 'success.wav',
    duration: 0.60,
    description: 'Harmonic chime chord for correct answers or completed tasks',
    keywords: ['success', 'complete', 'win', 'thành công', 'đúng', 'chúc mừng'],
  },
  {
    id: 'coin',
    name: '8-Bit Retro Coin',
    category: 'notification',
    filename: 'coin.wav',
    duration: 0.35,
    description: 'Playful 8-bit retro Mario-style gold coin pickup sound',
    keywords: ['coin', 'retro', '8bit', 'mario', 'xu', 'tiền', 'game'],
  },
  {
    id: 'cash-register',
    name: 'Cash Register Cha-Ching',
    category: 'notification',
    filename: 'cash-register.wav',
    duration: 0.75,
    description: 'Classic cha-ching cash register sound for sales and revenue',
    keywords: ['cash', 'money', 'register', 'cha-ching', 'tiền', 'bán hàng', 'két'],
  },
  {
    id: 'alert',
    name: 'Warning / Alert',
    category: 'notification',
    filename: 'alert.wav',
    duration: 0.40,
    description: 'Two-tone warning chime for notes, disclaimers, and errors',
    keywords: ['alert', 'warning', 'cảnh báo', 'chú ý', 'lưu ý', 'disclaimer'],
  },
  {
    id: 'error-buzz',
    name: 'Error Buzz / Wrong',
    category: 'notification',
    filename: 'error-buzz.wav',
    duration: 0.30,
    description: 'Buzzer sound for wrong answers, errors, or failed actions',
    keywords: ['error', 'buzz', 'wrong', 'sai', 'thất bại', 'cấm', 'fail'],
  },
  {
    id: 'level-up',
    name: 'Major Fanfare / Level Up',
    category: 'notification',
    filename: 'level-up.wav',
    duration: 0.65,
    description: 'Triumphant fanfare chord for level up or feature upgrades',
    keywords: ['level up', 'fanfare', 'upgrade', 'lên cấp', 'thăng hạng', 'game'],
  },

  // Impact & Dramatic
  {
    id: 'sub-boom',
    name: 'Cinematic Sub Bass Boom',
    category: 'impact',
    filename: 'sub-boom.wav',
    duration: 1.20,
    description: 'Shaking sub-bass boom for dramatic hits and sudden emphasis',
    keywords: ['sub', 'boom', 'bass', 'impact', 'cinematic', 'trầm', 'rung', 'đột ngột'],
  },
  {
    id: 'thud-impact',
    name: 'Deep Thud Impact',
    category: 'impact',
    filename: 'thud-impact.wav',
    duration: 0.40,
    description: 'Heavy thud impact for dropped items or slamming doors',
    keywords: ['thud', 'hit', 'drop', 'đập', 'rơi', 'nặng'],
  },
  {
    id: 'metal-hit',
    name: 'Metallic Clang Impact',
    category: 'impact',
    filename: 'metal-hit.wav',
    duration: 0.50,
    description: 'Crisp metallic clang impact for action hits',
    keywords: ['metal', 'clang', 'hit', 'kim loại', 'va chạm', 'kiếm'],
  },
  {
    id: 'dramatic-riser',
    name: 'Tension Riser',
    category: 'impact',
    filename: 'dramatic-riser.wav',
    duration: 1.50,
    description: 'Tension riser sound building suspense and climax',
    keywords: ['riser', 'tension', 'suspense', 'hồi hộp', 'cao trào', 'dồn dập'],
  },

  // Comedy & Meme
  {
    id: 'funny-boing',
    name: 'Cartoon Spring Boing',
    category: 'comedy',
    filename: 'funny-boing.wav',
    duration: 0.45,
    description: 'Classic cartoon spring boing sound effect',
    keywords: ['boing', 'spring', 'cartoon', 'lò xo', 'hài hước', 'funny', 'nhảy'],
  },
  {
    id: 'record-scratch',
    name: 'Vinyl Record Scratch',
    category: 'comedy',
    filename: 'record-scratch.wav',
    duration: 0.40,
    description: 'Abrupt vinyl record scratch for sudden comical pauses',
    keywords: ['scratch', 'vinyl', 'record', 'dừng', 'ngạc nhiên', 'bất ngờ', 'meme'],
  },
  {
    id: 'fail-trombone',
    name: 'Sad Trombone Wah-Wah',
    category: 'comedy',
    filename: 'fail-trombone.wav',
    duration: 1.20,
    description: 'Sad trombone wah-wah sound for comical failures',
    keywords: ['trombone', 'sad', 'wah-wah', 'fail', 'thất bại', 'quê', 'buồn'],
  },

  // Foley & Atmosphere
  {
    id: 'applause',
    name: 'Studio Crowd Applause',
    category: 'foley',
    filename: 'applause.wav',
    duration: 1.50,
    description: 'Enthusiastic studio audience cheering and applause',
    keywords: ['applause', 'cheer', 'clap', 'vỗ tay', 'khán giả', 'tán thưởng'],
  },
  {
    id: 'heartbeat',
    name: 'Tense Heartbeat',
    category: 'foley',
    filename: 'heartbeat.wav',
    duration: 0.80,
    description: 'Tense thumping heartbeat for suspense and anxiety',
    keywords: ['heartbeat', 'heart', 'pulse', 'tim đập', 'hồi hộp', 'lo lắng'],
  },
  {
    id: 'clock-tick',
    name: 'Clock Ticking',
    category: 'foley',
    filename: 'clock-tick.wav',
    duration: 0.15,
    description: 'Ticking clock sound for countdowns and urgency',
    keywords: ['clock', 'tick', 'time', 'đồng hồ', 'tích tắc', 'đếm ngược'],
  },
]

export interface SfxCategoryInfo {
  id: SfxCategory | 'all'
  nameVi: string
  nameEn: string
  label: string
}

export const SFX_CATEGORIES: SfxCategoryInfo[] = [
  { id: 'all', nameVi: 'Tất cả', nameEn: 'All', label: 'All' },
  { id: 'transition', nameVi: 'Chuyển cảnh', nameEn: 'Transitions', label: 'Transitions' },
  { id: 'accent', nameVi: 'Điểm nhấn', nameEn: 'Accents & UI', label: 'Accents & UI' },
  { id: 'notification', nameVi: 'Thông báo / Game', nameEn: 'Notifications & Game', label: 'Notifications & Game' },
  { id: 'impact', nameVi: 'Va đập / Kịch tính', nameEn: 'Impacts & Hits', label: 'Impacts & Hits' },
  { id: 'comedy', nameVi: 'Hài hước / Meme', nameEn: 'Comedy & Meme', label: 'Comedy & Meme' },
  { id: 'foley', nameVi: 'Hiệu ứng Foley', nameEn: 'Foley & Ambience', label: 'Foley & Ambience' },
]

export function getSfxDefinition(id: string): SfxDefinition | undefined {
  return SFX_DEFINITIONS.find(s => s.id === id || s.filename === id)
}

export function isValidSfxId(id: string): boolean {
  return SFX_DEFINITIONS.some(s => s.id === id || s.filename === id)
}

export function resolveSfxRelativePath(filenameOrId: string): string {
  const def = getSfxDefinition(filenameOrId)
  const filename = def ? def.filename : (filenameOrId.endsWith('.wav') || filenameOrId.endsWith('.mp3') ? filenameOrId : `${filenameOrId}.wav`)
  return `sfx/${filename}`
}

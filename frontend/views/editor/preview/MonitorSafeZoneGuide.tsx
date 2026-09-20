export interface MonitorSafeZoneGuideProps {
  show: boolean
}

export function MonitorSafeZoneGuide({ show }: MonitorSafeZoneGuideProps) {
  if (!show) return null

  return (
    <div className="absolute inset-0 pointer-events-none z-[28]">
      {/* Top zone: ~12% */}
      <div className="absolute top-0 left-0 right-0 h-[12%] border-b border-dashed border-red-500/60 bg-red-500/10 flex items-center justify-center">
        <span className="text-[10px] text-red-300 font-mono bg-black/60 px-1.5 py-0.5 rounded">
          Top UI / Header Zone (12%)
        </span>
      </div>
      {/* Right zone: ~15% from 20% to 80% height */}
      <div className="absolute top-[20%] bottom-[25%] right-0 w-[15%] border-l border-dashed border-red-500/60 bg-red-500/10 flex items-center justify-center">
        <span className="text-[9px] text-red-300 font-mono bg-black/60 px-1 py-0.5 rounded -rotate-90">
          Icons / Buttons (15%)
        </span>
      </div>
      {/* Bottom zone: ~25% */}
      <div className="absolute bottom-0 left-0 right-0 h-[25%] border-t border-dashed border-red-500/60 bg-red-500/10 flex items-center justify-center">
        <span className="text-[10px] text-red-300 font-mono bg-black/60 px-1.5 py-0.5 rounded">
          Bottom Description & Nav Zone (25%)
        </span>
      </div>
      {/* Center recommended safe zone for subtitles: ~70-75% from top */}
      <div className="absolute top-[68%] left-[10%] right-[18%] h-[8%] border border-teal-400/80 bg-teal-500/10 rounded flex items-center justify-center">
        <span className="text-[10px] text-teal-300 font-mono bg-black/70 px-1.5 py-0.5 rounded font-bold">
          ★ Recommended Subtitle Safe Zone (70–75%)
        </span>
      </div>
    </div>
  )
}

interface AppLogoProps {
  className?: string
  showText?: boolean
}

/** KailaEdit brand emblem and wordmark. */
export function AppLogo({ className = 'h-7', showText = true }: AppLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* KailaEdit Brand Icon Emblem (Exact approved brand icon) */}
      {/* Relative, not "/icon.png": a packaged build is loaded over file://,
          where a leading slash resolves to the root of the drive instead of
          the app directory. Vite is configured with base "./" for the same
          reason. */}
      <img
        src="./icon.png"
        alt="KailaEdit Icon"
        className="h-full w-auto aspect-square flex-shrink-0 object-contain rounded-md select-none pointer-events-none"
      />
      {showText && (
        <span className="font-bold tracking-tight text-white flex items-center text-base">
          Kaila<span className="text-cyan-400 font-semibold ml-0.5">Edit</span>
        </span>
      )}
    </div>
  )
}

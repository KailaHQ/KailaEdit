import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Aperture,
  ArrowLeft,
  Captions as CaptionsIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Clapperboard,
  Layout,
  Music2,
  Share2,
  SlidersHorizontal,
  LayoutTemplate,
  Sparkles,
  Sticker,
  Type,
  Upload,
  Waypoints,
} from 'lucide-react'
import { useView } from '../../contexts/ViewContext'
import { useTranslation } from '../../i18n/I18nContext'
import { WindowControls } from '../../components/WindowControls'
import { UpdateButton } from '../../components/UpdateButton'
import type { LibraryTab } from './editor-state'

/** One command in the Menu dropdown. */
export interface MenuItem {
  id: string
  label: string
  shortcut?: string
  action?: () => void
  disabled?: boolean
  /** Renders a divider line instead of a command. */
  separator?: boolean
}

/** A named group of commands, rendered as a labelled section. */
export interface MenuDefinition {
  id: string
  label: string
  items: MenuItem[]
}

/* ────────────────────────────────────────────────────────────────
   Title bar

   Collapses commands into one unified "Menu" dropdown, giving the
   freed space to the project name and the Export button. We keep
   every command grouped by its logical category.
   ──────────────────────────────────────────────────────────────── */

export interface EditorTitleBarProps {
  menus: MenuDefinition[]
  projectName: string
  lastSavedAt: Date | null
  isAgentSessionActive?: boolean
  onExport: () => void
}

export function EditorTitleBar({ menus, projectName, lastSavedAt, isAgentSessionActive, onExport }: EditorTitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { goHome } = useView()
  const { t } = useTranslation()

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const savedLabel = lastSavedAt
    ? t('chrome.autoSaved', { time: lastSavedAt.toLocaleTimeString(undefined, { hour12: false }) })
    : t('chrome.notSavedYet')

  return (
    <div
      ref={rootRef}
      className="app-drag relative z-[70] flex h-[34px] flex-shrink-0 select-none items-center border-b border-zinc-800 bg-zinc-950 pl-2"
    >
      {/* Left cluster */}
      <div className="flex flex-1 items-center gap-2">
        <button onClick={goHome} className="editor-icon-btn cc-icon-btn app-no-drag" title={t('chrome.backToProjects')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="pr-1 text-[13px] font-semibold tracking-tight text-zinc-100">
          Kaila<span className="text-accent">Edit</span>
        </span>

        <div className="app-no-drag relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className={`flex h-[22px] items-center gap-1 rounded-[4px] px-2 text-[12px] transition-colors ${
              menuOpen ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
            }`}
          >
            {t('chrome.menu')}
            <ChevronDown className="h-3 w-3" />
          </button>
          {menuOpen && <MenuDropdown menus={menus} onClose={() => setMenuOpen(false)} />}
        </div>

        {isAgentSessionActive ? (
          <div className="flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            {t('chrome.editPilotRunning')}
          </div>
        ) : (
          <div className="flex items-center gap-1 pl-1 text-[11px] text-zinc-500">
            <CircleCheck className="h-3.5 w-3.5 text-accent" />
            {savedLabel}
          </div>
        )}
      </div>

      {/* Project name — centred independently of the side clusters so it stays
          put as the left/right content changes width. */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[12px] text-zinc-200">
        {projectName}
      </div>

      {/* Right cluster */}
      <div className="flex flex-1 items-center justify-end gap-1.5">
        <UpdateButton />
        <button className="editor-icon-btn cc-icon-btn app-no-drag" title={t('chrome.layout')}>
          <Layout className="h-4 w-4" />
        </button>
        <button
          className="app-no-drag flex h-[24px] items-center gap-1.5 rounded-[4px] px-2.5 text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800"
        >
          <Share2 className="h-3.5 w-3.5" />
          {t('chrome.share')}
        </button>
        <button
          onClick={onExport}
          className="app-no-drag flex h-[24px] items-center gap-1.5 rounded-[4px] bg-accent px-3 text-[12px] font-medium text-zinc-950 transition-colors hover:bg-accent-dark"
        >
          <Upload className="h-3.5 w-3.5" />
          {t('chrome.export')}
        </button>
        {/* Minimise / maximise / close sit right of Export — the native frame
            is gone, so this bar is the only place they exist. */}
        <WindowControls className="ml-1.5" />
      </div>
    </div>
  )
}

function MenuDropdown({ menus, onClose }: { menus: MenuDefinition[]; onClose: () => void }) {
  const run = (item: MenuItem) => {
    if (item.disabled || !item.action) return
    item.action()
    onClose()
  }

  return (
    <div className="absolute left-0 top-full mt-1 max-h-[70vh] w-[280px] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/60">
      {menus.map(menu => (
        <div key={menu.id}>
          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {menu.label}
          </div>
          {menu.items.map((item, i) => item.separator ? (
            <div key={`sep-${menu.id}-${i}`} className="mx-2 my-1 h-px bg-zinc-800" />
          ) : (
            <button
              key={item.id}
              onClick={() => run(item)}
              disabled={item.disabled}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors ${
                item.disabled ? 'cursor-not-allowed text-zinc-600' : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span>{item.label}</span>
              {item.shortcut && <span className="ml-6 text-[10px] text-zinc-500">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
   Tab rail
   ──────────────────────────────────────────────────────────────── */

interface TabDefinition {
  id: LibraryTab
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** First sub-nav section, selected whenever the tab is entered. */
  defaultSection: string
}

export const LIBRARY_TABS: TabDefinition[] = [
  { id: 'media',       label: 'Media',       icon: Clapperboard,      defaultSection: 'media' },
  { id: 'audio',       label: 'Audio',       icon: Music2,            defaultSection: 'audio-files' },
  { id: 'text',        label: 'Text',        icon: Type,              defaultSection: 'add-text' },
  { id: 'stickers',    label: 'Stickers',    icon: Sticker,           defaultSection: 'stickers' },
  { id: 'effects',     label: 'Effects',     icon: Sparkles,          defaultSection: 'video-effects' },
  { id: 'transitions', label: 'Transitions', icon: Waypoints,         defaultSection: 'transitions' },
  { id: 'captions',    label: 'Captions',    icon: CaptionsIcon,      defaultSection: 'local-captions' },
  { id: 'filters',     label: 'Filters',     icon: Aperture,          defaultSection: 'filters' },
  { id: 'adjust',      label: 'Adjust',      icon: SlidersHorizontal, defaultSection: 'adjust' },
  { id: 'templates',   label: 'Templates',   icon: LayoutTemplate,    defaultSection: 'templates' },
]

export interface EditorTabRailProps {
  activeTab: LibraryTab
  onSelect: (tab: LibraryTab, defaultSection: string) => void
}

export function EditorTabRail({ activeTab, onSelect }: EditorTabRailProps) {
  const { t } = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })

  // The rail lives inside the library column, which the user can drag down
  // to 300px — narrower than the nine tabs. The chevrons page the list.
  const measure = () => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setOverflow({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 })
  }

  useEffect(() => {
    measure()
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const page = (direction: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: direction * 156, behavior: 'smooth' })
  }

  return (
    <div className="relative flex h-[46px] flex-shrink-0 select-none items-stretch border-b border-zinc-800 bg-zinc-950">
      {overflow.left && (
        <button
          onClick={() => page(-1)}
          className="flex w-5 flex-shrink-0 items-center justify-center bg-zinc-950 text-zinc-500 hover:text-zinc-200"
          title={t('library.prevTabs')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div
        ref={scrollerRef}
        onScroll={measure}
        className="editor-no-scrollbar cc-no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto pl-1"
      >
        {LIBRARY_TABS.map(tab => {
          const Icon = tab.icon
          const isActive = tab.id === activeTab
          const label = t(`library.tabs.${tab.id}` as any) || tab.label
          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id, tab.defaultSection)}
              className={`flex w-[52px] flex-shrink-0 flex-col items-center justify-center gap-[3px] transition-colors ${
                isActive ? 'text-accent' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-[17px] w-[17px]" />
              <span className="max-w-full truncate px-0.5 text-[10px] leading-none">{label}</span>
            </button>
          )
        })}
      </div>

      {overflow.right && (
        <button
          onClick={() => page(1)}
          className="flex w-5 flex-shrink-0 items-center justify-center bg-zinc-950 text-zinc-500 hover:text-zinc-200"
          title={t('library.nextTabs')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
   Left sub-nav

   The narrow column of pills between the tab rail and the library
   panel. Entries with children expand in place; the rest act as a
   plain section switch.
   ──────────────────────────────────────────────────────────────── */

interface NavEntry {
  id: string
  label: string
  children?: { id: string; label: string }[]
  badge?: string
}

const NAV_LABEL_KEYS: Record<string, string> = {
  media: 'library.nav.media',
  'audio-files': 'library.nav.audioFiles',
  'sound-effects': 'library.nav.soundEffects',
  extract: 'library.nav.extractAudio',
  'add-text': 'library.nav.addText',
  'text-templates': 'library.nav.textTemplates',
  'text-effects': 'library.nav.textEffects',
  stickers: 'library.nav.stickers',
  shapes: 'library.nav.shapes',
  'video-effects': 'library.nav.videoEffects',
  transitions: 'library.nav.transitions',
  'local-captions': 'library.nav.localCaptions',
  'auto-captions': 'library.nav.autoCaptions',
  'auto-highlights': 'library.nav.autoHighlights',
  'broll-copilot': 'library.nav.brollCopilot',
  filters: 'library.nav.filters',
  adjust: 'library.nav.adjust',
}

const NAV_BY_TAB: Record<LibraryTab, NavEntry[]> = {
  media: [
    { id: 'media', label: 'Media' },
  ],
  audio: [
    { id: 'audio-files', label: 'Audio files' },
    { id: 'sound-effects', label: 'Sound effects' },
    { id: 'extract', label: 'Extract audio' },
  ],
  text: [
    { id: 'add-text', label: 'Add text' },
    { id: 'text-templates', label: 'Text templates' },
    { id: 'text-effects', label: 'Text effects' },
  ],
  stickers: [
    { id: 'stickers', label: 'Stickers' },
    { id: 'shapes', label: 'Shapes' },
  ],
  effects: [
    { id: 'video-effects', label: 'Video effects' },
  ],
  transitions: [
    { id: 'transitions', label: 'Transitions' },
  ],
  captions: [
    { id: 'local-captions', label: 'Local captions' },
    { id: 'auto-captions', label: 'Auto captions' },
    { id: 'auto-highlights', label: 'Auto highlights', badge: 'AI' },
    { id: 'broll-copilot', label: 'B-roll Copilot', badge: 'AI' },
  ],
  filters: [
    { id: 'filters', label: 'Filters' },
  ],
  adjust: [
    { id: 'adjust', label: 'Adjust' },
  ],
  templates: [
    { id: 'templates', label: 'All' },
    { id: 'tpl-yours', label: 'Yours' },
    { id: 'tpl-opener', label: 'Openers' },
    { id: 'tpl-montage', label: 'Montage' },
    { id: 'tpl-compare', label: 'Compare' },
    { id: 'tpl-text', label: 'Text' },
  ],
}

export interface EditorLeftNavProps {
  tab: LibraryTab
  section: string
  onSelect: (section: string) => void
}

export function EditorLeftNav({ tab, section, onSelect }: EditorLeftNavProps) {
  const { t } = useTranslation()
  const entries = NAV_BY_TAB[tab]
  const getNavLabel = (entry: { id: string; label: string }) => NAV_LABEL_KEYS[entry.id] ? t(NAV_LABEL_KEYS[entry.id] as any) : entry.label

  // An entry counts as expanded when it, or one of its children, is the
  // current section — so switching tabs opens the right group with no
  // separate expansion state to keep in sync.
  const expandedId = useMemo(() => {
    const owner = entries.find(e => e.id === section || e.children?.some(c => c.id === section))
    return owner?.children?.length ? owner.id : null
  }, [entries, section])

  return (
    <div className="flex w-[122px] flex-shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-2">
      {entries.map(entry => {
        const isActive = entry.id === section
        const isExpanded = entry.id === expandedId
        const hasChildren = Boolean(entry.children && entry.children.length > 0)
        return (
          <div key={entry.id}>
            <button
              onClick={() => onSelect(entry.children?.[0]?.id ?? entry.id)}
              className={`editor-nav-pill cc-nav-pill ${isActive || isExpanded ? 'editor-nav-pill-on cc-nav-pill-on' : ''}`}
            >
              <span className="truncate">{getNavLabel(entry)}</span>
              {entry.badge && (
                <span className="ml-1 rounded-[3px] bg-accent px-1 text-[9px] font-bold leading-[13px] text-zinc-950">
                  {entry.badge}
                </span>
              )}
              {hasChildren && !entry.badge && (
                isExpanded
                  ? <ChevronUp className="h-3 w-3 flex-shrink-0" />
                  : <ChevronDown className="h-3 w-3 flex-shrink-0" />
              )}
            </button>
            {isExpanded && entry.children!.map(child => (
              <button
                key={child.id}
                onClick={() => onSelect(child.id)}
                className={`mt-1 block w-full rounded-[4px] px-3 py-[6px] text-left text-[12px] transition-colors ${
                  child.id === section ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {getNavLabel(child)}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

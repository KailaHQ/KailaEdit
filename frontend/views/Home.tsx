import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Folder, MoreVertical, Trash2, Pencil, Settings as SettingsIcon } from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { prepareProjectFirstFrame } from './editor/preview/first-frame-prefetch'
import { useView } from '../contexts/ViewContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTranslation } from '../i18n/I18nContext'
import { AppLogo } from '../components/AppLogo'
import { Button } from '../components/ui/button'
import { pathToFileUrl } from '../lib/file-url'
import type { Project } from '../types/project-model'
import { getProjectThumbnailAsset } from '@core/video-editor-utils'
import { useProjectReferencesMigration } from '../hooks/useProjectReferencesMigration'
import { UpdateButton } from '../components/UpdateButton'

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function ProjectCard({ project, onOpen, onHover, onDelete, onRename, renameLabel, deleteLabel }: {
  project: Project
  onOpen: () => void
  /** The pointer is over the card: the project is probably about to be opened. */
  onHover: () => void
  onDelete: () => void
  onRename: () => void
  renameLabel: string
  deleteLabel: string
}) {
  const [showMenu, setShowMenu] = useState(false)
  const [thumbError, setThumbError] = useState(false)
  const [videoError, setVideoError] = useState(false)
  
  // Prioritize first video frame from Track 1 (V1), ignoring stickers
  const representativeAsset = useMemo(() => getProjectThumbnailAsset(project), [project])
  const representativeUrl = representativeAsset?.path ? pathToFileUrl(representativeAsset.path) : null
  const representativeThumbnailPath = representativeAsset?.bigThumbnailPath || representativeAsset?.smallThumbnailPath
  const representativeThumbnailUrl = representativeThumbnailPath
    ? pathToFileUrl(representativeThumbnailPath)
    : null

  return (
    <div
      className="group relative bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer"
      onClick={onOpen}
      onMouseEnter={onHover}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-zinc-800 flex items-center justify-center relative overflow-hidden">
        {representativeAsset ? (
          representativeAsset.type === 'video' ? (
            representativeThumbnailUrl && !thumbError ? (
              <img
                src={representativeThumbnailUrl}
                alt={project.name}
                className="w-full h-full object-cover"
                onError={() => setThumbError(true)}
              />
            ) : representativeUrl && !videoError ? (
              <video
                src={representativeUrl}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
                onError={() => setVideoError(true)}
              />
            ) : (
              <Folder className="h-7 w-7 sm:h-8 sm:w-8 text-zinc-600" />
            )
          ) : representativeUrl && !thumbError ? (
            <img
              src={representativeUrl}
              alt={project.name}
              className="w-full h-full object-cover"
              onError={() => setThumbError(true)}
            />
          ) : (
            <Folder className="h-7 w-7 sm:h-8 sm:w-8 text-zinc-600" />
          )
        ) : (
          <Folder className="h-7 w-7 sm:h-8 sm:w-8 text-zinc-600" />
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      
      {/* Info */}
      <div className="p-2.5">
        <h3 className="font-medium text-xs sm:text-sm text-white truncate">{project.name}</h3>
        <p className="text-[11px] text-zinc-500 mt-0.5">{formatDate(project.updatedAt)}</p>
      </div>
      
      {/* Menu button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
      >
        <MoreVertical className="h-3.5 w-3.5 text-white" />
      </button>
      
      {/* Dropdown menu */}
      {showMenu && (
        <div 
          className="absolute top-8 right-1.5 bg-zinc-800 rounded-lg shadow-lg border border-zinc-700 py-1 z-10 min-w-[110px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onRename(); setShowMenu(false) }}
            className="w-full px-2.5 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            {renameLabel}
          </button>
          <button
            onClick={() => { onDelete(); setShowMenu(false) }}
            className="w-full px-2.5 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-700 flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleteLabel}
          </button>
        </div>
      )}
    </div>
  )
}

export function Home() {
  const { t } = useTranslation()
  const { openSettings, settings } = useSettings()
  const { projectIds, getProject, createProject, deleteProject, renameProject } = useProjects()
  const { openProject } = useView()
  const { migrationStatus, migrateProjects } = useProjectReferencesMigration()
  const [isCreating, setIsCreating] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const migrationStartedRef = useRef(false)

  useEffect(() => {
    if (migrationStatus.status !== 'needed' || migrationStartedRef.current) return
    migrationStartedRef.current = true
    void migrateProjects()
  }, [migrateProjects, migrationStatus.status])

  // The main process is the only one that knows the packaged version, so this
  // has to come over IPC. Stays null outside Electron and on failure, and the
  // heading simply renders without it.
  useEffect(() => {
    let cancelled = false
    void window.electronAPI?.getAppInfo()
      .then(info => {
        if (!cancelled && info?.version) setAppVersion(info.version)
      })
      .catch(() => {
        // Nothing to do: the version is decoration, not a feature.
      })
    return () => { cancelled = true }
  }, [])

  const projects = useMemo(() => (
    projectIds
      .map(projectId => getProject(projectId))
      .filter((project): project is Project => project !== null)
  ), [getProject, projectIds])

  // The first frame of a project is decoded before it is opened, so the monitor has its picture
  // the moment the editor appears: for the most recent project as soon as this screen is up,
  // and for any project the pointer settles on.
  const proxyEnabled = settings.proxyEnabled
  const prepareProject = useCallback(
    (project: Project) => prepareProjectFirstFrame(project, proxyEnabled),
    [proxyEnabled],
  )
  const mostRecentProject = projects[0]
  useEffect(() => {
    if (!mostRecentProject) return
    const timer = window.setTimeout(() => prepareProject(mostRecentProject), 400)
    return () => window.clearTimeout(timer)
  }, [mostRecentProject, prepareProject])

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      const project = createProject(newProjectName.trim())
      setNewProjectName('')
      setIsCreating(false)
      openProject(project.id)
    }
  }
  
  const handleRenameProject = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
  }
  
  const submitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameProject(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }

  if (migrationStatus.status === 'needed' || migrationStatus.status === 'inProgress') {
    const progressPct = migrationStatus.status === 'inProgress'
      ? migrationStatus.ratio * 100
      : 0

    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="w-[360px]">
          <p className="text-center text-sm text-zinc-300 mb-4">
            Migrating project references...
          </p>
          <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-150"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 flex flex-col">
        <div className="p-6">
          <AppLogo className="h-6 w-auto text-white" />
        </div>
        
        <nav className="flex-1 px-3 flex flex-col justify-between overflow-y-auto">
          <div>
            <button className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-left text-sm font-medium flex items-center gap-2">
              <Folder className="h-4 w-4" />
              {t('home.home')}
            </button>
            
            {projects.length > 0 && (
              <div className="mt-6">
                <h4 className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  {t('home.recentProjects')}
                </h4>
                {projects.slice(0, 5).map(project => (
                  <button
                    key={project.id}
                    onClick={() => openProject(project.id)}
                    onMouseEnter={() => prepareProject(project)}
                    className="w-full px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-left text-sm flex items-center gap-2 transition-colors truncate"
                  >
                    <Folder className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{project.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-800/80 mb-2">
            <button
              onClick={() => openSettings()}
              className="w-full px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-left text-sm flex items-center gap-2 transition-colors"
            >
              <SettingsIcon className="h-4 w-4 text-zinc-400" />
              <span>{t('home.settings')}</span>
            </button>
          </div>
        </nav>
        
        <div className="p-4 border-t border-zinc-800">
          <button
            onClick={() => setIsCreating(true)}
            className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('home.newProject')}
          </button>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Header Banner with compact cinematic image background */}
        <div className="relative h-36 overflow-hidden">
          <img
            src="./banner-studio.jpg"
            alt="KailaEdit Studio Banner"
            className="absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none"
          />
          {/* Subtle dark gradient overlay for crystal-clear text contrast */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
          <div className="absolute bottom-4 left-8 z-10">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-white tracking-tight drop-shadow-md">
                KailaEdit{' '}
                {appVersion && (
                  <span className="ml-2 align-middle text-sm font-medium text-zinc-300/90 drop-shadow-sm">
                    v{appVersion}
                  </span>
                )}
              </h1>
              <UpdateButton />
            </div>
            <p className="text-xs sm:text-sm text-zinc-300 drop-shadow-sm">{t('home.tagline')}</p>
          </div>
        </div>
        
        {/* Projects Grid */}
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">{t('home.recentProjects')}</h2>
          </div>
          
          {projects.length === 0 ? (
            <div className="text-center py-16">
              <Folder className="h-16 w-16 text-zinc-700 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-zinc-400 mb-2">{t('home.noProjects')}</h3>
              <p className="text-zinc-500 mb-6">{t('home.createProjectPrompt')}</p>
              <Button 
                onClick={() => setIsCreating(true)}
                className="bg-blue-600 hover:bg-blue-500"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('home.newProject')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => openProject(project.id)}
                  onHover={() => prepareProject(project)}
                  onDelete={() => {
                    if (confirm(t('home.deleteProjectConfirm'))) {
                      deleteProject(project.id)
                    }
                  }}
                  onRename={() => handleRenameProject(project.id, project.name)}
                  renameLabel={t('home.renameProject')}
                  deleteLabel={t('home.deleteProject')}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      
      {/* Create Project Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md border border-zinc-800">
            <h2 className="text-xl font-semibold text-white mb-4">{t('home.newProject')}</h2>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('home.createProjectPrompt')}
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            />
            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => { setIsCreating(false); setNewProjectName('') }}
                className="flex-1 border-zinc-700"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500"
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Rename Modal */}
      {renamingId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md border border-zinc-800">
            <h2 className="text-xl font-semibold text-white mb-4">{t('home.renameProject')}</h2>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t('home.createProjectPrompt')}
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submitRename()}
            />
            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => { setRenamingId(null); setRenameValue('') }}
                className="flex-1 border-zinc-700"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={submitRename}
                disabled={!renameValue.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500"
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

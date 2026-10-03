import { useEffect } from 'react'
import { ProjectProvider } from './contexts/ProjectContext'
import { ViewProvider, useView } from './contexts/ViewContext'
import { KeyboardShortcutsProvider } from './contexts/KeyboardShortcutsContext'
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal'
import { SettingsProvider } from './contexts/SettingsContext'
import { SettingsModal } from './components/SettingsModal'
import { I18nProvider } from './i18n/I18nContext'
import { FramelessTopBar } from './components/WindowControls'
import { Home } from './views/Home'
import { Project } from './views/Project'
import { warmUpVideoDecoder } from './views/editor/preview/webcodecs/decoder-warmup'

function AppContent() {
  const { currentView } = useView()

  return (
    <div className="relative h-screen w-screen">
      {/* The editor draws its own title bar with the controls in it; every
          other screen gets this overlay strip instead. */}
      {currentView !== 'project' && <FramelessTopBar />}
      {currentView === 'project' ? <Project /> : <Home />}
    </div>
  )
}

export default function App() {
  // While the home screen is up: the first hardware decoder of the session is slow to start,
  // and a project's first frame would otherwise wait on it.
  useEffect(() => {
    const timer = window.setTimeout(() => { void warmUpVideoDecoder() }, 300)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <I18nProvider>
      <SettingsProvider>
        <ProjectProvider>
          <ViewProvider>
            <KeyboardShortcutsProvider>
              <AppContent />
              <KeyboardShortcutsModal />
              <SettingsModal />
            </KeyboardShortcutsProvider>
          </ViewProvider>
        </ProjectProvider>
      </SettingsProvider>
    </I18nProvider>
  )
}


import type { Project, Timeline, EditPatch } from '@komfyedit/core'

export interface ProposedPatchEntry {
  patch: EditPatch
  projectPath: string
  rawContentBefore: string
  baseProject: Project
}

export interface UndoStackEntry {
  projectPath: string
  rawContentBefore: string
  previousProject: Project
  description: string
}

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface McpServerContext {
  profile: 'read' | 'edit'
  readonly activeProject: Project | null
  readonly activeProjectPath: string | null
  proposedPatches: Map<string, ProposedPatchEntry>
  undoStack: UndoStackEntry[]
  resolveProject: (projectId?: string) => Project
  resolveTimeline: (project: Project, timelineId?: string) => Timeline
  resolveMediaPath: (toolArgs: Record<string, any>) => string
  setActiveProject: (project: Project | null, filePath?: string | null) => void
}

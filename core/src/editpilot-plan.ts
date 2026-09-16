/**
 * The task-checklist protocol between EditPilot's agent and the panel.
 *
 * A CLI agent answers in prose, so "what is it doing right now" is invisible
 * until the whole run finishes. EditPilot solves this by showing the plan as a
 * checklist that ticks itself off, and that only works if the agent says where
 * it is. So the system prompt asks it to bracket its plan in
 * `<komfyedit:plan>` and to print `<komfyedit:step>N</komfyedit:step>` as each
 * item lands; this module turns that stream back into checklist state and
 * hands the panel the text with every marker removed.
 *
 * An agent that ignores the protocol still gets a checklist: a plain numbered
 * list in the reply is read as the plan. That fallback cannot know when an item
 * completes, so a clean finish marks the whole list done — the agent's own
 * answer is the only evidence available, and leaving every box unticked after a
 * successful run would read as a failure that did not happen.
 */

export type EditPilotTaskStatus = 'pending' | 'running' | 'done'

export interface EditPilotTask {
  /** 1-based, matching the numbers the agent uses in its step markers. */
  index: number
  label: string
  status: EditPilotTaskStatus
}

/** Where the run stands, which decides how unfinished items are read. */
export type EditPilotPhase = 'streaming' | 'finished' | 'error'

export interface EditPilotStreamView {
  /** The reply with every protocol marker stripped — what the bubble shows. */
  text: string
  tasks: EditPilotTask[]
}

const PLAN_BLOCK_RE = /<(?:coedit|kailaedit|komfyedit):plan>[\s\S]*?<\/(?:coedit|kailaedit|komfyedit):plan>/i
const PLAN_BODY_RE = /<(?:coedit|kailaedit|komfyedit):plan>([\s\S]*?)<\/(?:coedit|kailaedit|komfyedit):plan>/i
const STEP_RE = /<(?:coedit|kailaedit|komfyedit):step>\s*(\d+)\s*<\/(?:coedit|kailaedit|komfyedit):step>/gi
const STEP_SELF_CLOSING_RE = /<(?:coedit|kailaedit|komfyedit):step\s+n=["']?(\d+)["']?\s*\/?>/gi
const DONE_RE = /<(?:coedit|kailaedit|komfyedit):done\s*\/?>/gi
/** Non-global twin: `.test` on a /g regex carries `lastIndex` between calls. */
const DONE_TEST_RE = /<(?:coedit|kailaedit|komfyedit):done\s*\/?>/i
/** A marker the stream has only half-delivered; hiding it avoids flicker. */
const PARTIAL_MARKER_RE = /<\/?(?:c(?:o(?:e(?:d(?:i(?:t(?::[^>]*)?)?)?)?)?)?|k(?:a(?:i(?:l(?:a(?:e(?:d(?:i(?:t(?::[^>]*)?)?)?)?)?)?)?)?)?|k(?:o(?:m(?:f(?:y(?:e(?:d(?:i(?:t(?::[^>]*)?)?)?)?)?)?)?)?)?)$/i

/** Strips the bullet or number an agent naturally writes in front of a task. */
function cleanTaskLabel(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/\s+$/, '')
    .replace(/[.;]$/, '')
}

function collectStepMarkers(raw: string): { doneIndices: Set<number>; sawDone: boolean } {
  const doneIndices = new Set<number>()
  for (const match of raw.matchAll(STEP_RE)) doneIndices.add(Number(match[1]))
  for (const match of raw.matchAll(STEP_SELF_CLOSING_RE)) doneIndices.add(Number(match[1]))
  return { doneIndices, sawDone: DONE_TEST_RE.test(raw) }
}

function splitPlanLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map(cleanTaskLabel)
    .filter(line => line.length > 0)
}

/** Task labels from an explicit `<kailaedit:plan>` or `<komfyedit:plan>` block, open or closed. */
function readDeclaredPlan(raw: string): string[] | null {
  const closed = raw.match(PLAN_BODY_RE)
  if (closed) return splitPlanLines(closed[1])

  // Still streaming: show the items that have arrived rather than nothing.
  const openMatch = raw.match(/<(?:kailaedit|komfyedit):plan>/i)
  if (!openMatch || openMatch.index === undefined) return null
  const lines = raw.slice(openMatch.index + openMatch[0].length).split(/\r?\n/)
  // The trailing line may be half-typed, so it is not a task yet.
  lines.pop()
  const parsed = splitPlanLines(lines.join('\n'))
  return parsed.length > 0 ? parsed : null
}

/**
 * Reads a plain numbered list out of the reply, for agents that answered in
 * prose. Requires it to start at 1 and run consecutively so an ordinary
 * sentence like "1080p" or a lone "1." never becomes a checklist.
 */
function readNumberedFallback(text: string): string[] {
  const items: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)[.)]\s+(\S.*)$/)
    if (!match) continue
    if (Number(match[1]) !== items.length + 1) continue
    items.push(cleanTaskLabel(match[2]))
  }
  return items.length >= 2 ? items : []
}

/**
 * A marker on a line of its own takes the line with it; one sitting inside a
 * sentence is cut out in place. Otherwise removing a marker either punches a
 * hole in the paragraph or leaves a blank line where a step used to be.
 */
function removeMarker(text: string, marker: RegExp): string {
  const ownLine = new RegExp(`^[ \t]*(?:${marker.source})[ \t]*(?:\r?\n|$)`, 'gmi')
  return text.replace(ownLine, '').replace(new RegExp(marker.source, 'gi'), '')
}

/**
 * Strips technical debugging sections (diffs, raw qc_check alerts, track IDs)
 * that an agent might inadvertently output, keeping the user-facing chat
 * clean and friendly.
 */
export function sanitizeTechnicalNoise(text: string): string {
  let cleaned = text
  // Remove technical details block (e.g. ### Chi tiết thay đổi: ... or **Diff:** ...)
  cleaned = cleaned.replace(/###\s*(?:Chi tiết thay đổi|Technical details):?[\s\S]*?(?=\n\n[^\s*-]|\n\n$|$)/gi, '')
  // Remove raw qc_check note blocks: > [!NOTE]\s*> Cảnh báo chất lượng (`qc_check`)...
  cleaned = cleaned.replace(/>\s*\[!NOTE\]\s*\n(?:>\s*.*(?:\r?\n|$))+/gi, '')
  // Remove standalone qc_check lines
  cleaned = cleaned.replace(/^[ \t]*[-*•]?\s*(?:Cảnh báo chất lượng|qc_check).*$/gmi, '')
  // Remove standalone Diff / Track lines if any remain
  cleaned = cleaned.replace(/^[ \t]*[-*•]?\s*\*\*Diff:\*\*.*$/gmi, '')
  cleaned = cleaned.replace(/^[ \t]*[-*•]?\s*\*\*Track tạo mới:\*\*.*$/gmi, '')
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

function stripMarkers(raw: string, streaming: boolean): string {
  let text = removeMarker(raw, PLAN_BLOCK_RE)

  // An unterminated plan block would otherwise leak its raw tag into the chat.
  const openMatch = text.match(/<(?:kailaedit|komfyedit):plan>/i)
  if (openMatch && openMatch.index !== undefined) text = text.slice(0, openMatch.index)

  text = removeMarker(text, STEP_RE)
  text = removeMarker(text, STEP_SELF_CLOSING_RE)
  text = removeMarker(text, DONE_RE)

  if (streaming) text = text.replace(PARTIAL_MARKER_RE, '')

  text = sanitizeTechnicalNoise(text)

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Derives the display text and the checklist from everything the agent has
 * said so far. Pure and whole-buffer, so a marker split across two stream
 * chunks still parses once the rest arrives.
 */
export function parseEditPilotStream(raw: string, phase: EditPilotPhase = 'streaming'): EditPilotStreamView {
  const text = stripMarkers(raw, phase === 'streaming')
  const declared = readDeclaredPlan(raw)
  const labels = declared ?? readNumberedFallback(text)

  if (labels.length === 0) return { text, tasks: [] }

  const { doneIndices, sawDone } = collectStepMarkers(raw)
  const trackedByAgent = doneIndices.size > 0 || sawDone
  // A finished run whose agent never used the markers has no per-step evidence;
  // its own answer is all there is, so take it at its word.
  const completeAll = sawDone || (phase === 'finished' && !trackedByAgent)

  const tasks: EditPilotTask[] = labels.map((label, position) => ({
    index: position + 1,
    label,
    status: completeAll || doneIndices.has(position + 1) ? 'done' : 'pending',
  }))

  // Exactly one item is ever in flight: the first one still outstanding.
  if (phase === 'streaming') {
    const next = tasks.find(task => task.status === 'pending')
    if (next) next.status = 'running'
  }

  return { text, tasks }
}

export function countCompletedTasks(tasks: EditPilotTask[]): number {
  return tasks.filter(task => task.status === 'done').length
}


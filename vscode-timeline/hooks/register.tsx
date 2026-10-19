import { atom, memberOf, read, update } from 'claude-code'
import type { Elements, Register, RenderChildren, RenderElement, RenderViewport } from 'claude-code'

// The desktop Code tab, drawn the way the Claude VS Code extension draws its
// transcript: every step a row on a dotted timeline, tool calls as a bold name
// with a dim summary and, for shell-like calls, one IN/OUT card in monospace.

type UI = Elements['desktop']
type Tone = 'done' | 'failed' | 'running' | 'neutral'

type Call = {
  id: string
  tool: string
  input: unknown
  output?: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

const expanded = atom({ plugin: 'vscode-timeline', key: 'expanded' } as const, false)

const DOT: Record<Tone, string> = {
  done: '#4fb867',
  failed: '#f14c4c',
  running: '#d97757',
  neutral: '#8a8a8a',
}
const LINE = '#80808059'
const ORANGE = '#d97757'
// File paths in a header, in the theme's link-like blue as VS Code draws them.
const PATH = 'suggestion'

const IN_LINES = 3
const OUT_LINES = 4
const DIFF_LINES = 12
const WRITE_LINES = 8
const EXPANDED_LINES = 200
const MAX_LINE_CHARS = 300

// The card is an SVG drawn at the row's width, so its text keeps its size:
// the desktop reports its width in cells of its code font, about 7.8px each.
const CELL_PX = 7.8
const MONO = "Consolas, 'Cascadia Mono', 'Courier New', monospace"
const SANS = "'Segoe UI', system-ui, sans-serif"
const LINE_H = 18
const PAD_Y = 7
const LABEL_X = 12
const TEXT_X = 52

const SHELLS: Record<string, string> = { Bash: 'bash', PowerShell: 'powershell' }
const TITLES: Record<string, string> = {
  WebFetch: 'Fetch',
  WebSearch: 'Web Search',
  TodoWrite: 'Update Todos',
  ToolSearch: 'Tool Search',
}
// Built-in tools this mod draws; every other built-in keeps the app's own row
// (questions, plans, artifacts, file cards and the rest).
const DRAWN = new Set([
  'Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'NotebookEdit', 'Grep', 'Glob',
  'WebFetch', 'WebSearch', 'Agent', 'TodoWrite', 'Skill', 'ToolSearch', 'Monitor',
])
const CARDED = new Set(['Bash', 'PowerShell', 'Agent', 'WebFetch', 'Monitor', 'NotebookEdit'])
const COMPACT = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'Skill', 'ToolSearch'])
// MCP tools whose rows are the app's own widgets (task list, inline visuals,
// browser and desktop screenshots) stay as the app draws them.
const NATIVE_MCP = /^mcp__(ccd_|visualize|Claude_Browser|computer-use|terminal)|__(show_widget|read_me|screenshot|zoom)$/
// A group holding one of these keeps the app's drawing, so the picture shows.
const WIDGET = /__(show_widget|screenshot|zoom)$/
// The app's own plumbing (task list, next-step box): no row of its own.
const PLUMBING = /^mcp__ccd_turn__/

function isDrawn(tool: string): boolean {
  if (tool.startsWith('mcp__')) return !NATIVE_MCP.test(tool)
  return DRAWN.has(tool)
}

// ---- plain-data helpers -------------------------------------------------

function str(o: unknown, k: string): string | undefined {
  if (o === null || typeof o !== 'object') return undefined
  const v = (o as Record<string, unknown>)[k]
  return typeof v === 'string' ? v : undefined
}

function num(o: unknown, k: string): number | undefined {
  if (o === null || typeof o !== 'object') return undefined
  const v = (o as Record<string, unknown>)[k]
  return typeof v === 'number' ? v : undefined
}

function arr(o: unknown, k: string): unknown[] | undefined {
  if (o === null || typeof o !== 'object') return undefined
  const v = (o as Record<string, unknown>)[k]
  return Array.isArray(v) ? v : undefined
}

// Code and Text take tab and newline as their only control characters.
function clean(s: string): string {
  return s
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

function lines(s: string): string[] {
  const text = clean(s).replace(/\s+$/, '')
  return text === '' ? [] : text.split('\n')
}

function oneLine(s: string): string {
  return clean(s).replace(/\s+/g, ' ').trim()
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function blockText(block: unknown): string {
  if (typeof block === 'string') return block
  if (str(block, 'type') === 'image') return '[image]'
  return str(block, 'text') ?? ''
}

function outputText(output: unknown): string {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return output.map(blockText).filter(Boolean).join('\n')
  if (typeof output === 'object') {
    if ((output as Record<string, unknown>).isImage === true) return '[image]'
    const stdout = str(output, 'stdout')
    const stderr = str(output, 'stderr')
    if (stdout !== undefined || stderr !== undefined) {
      const background = str(output, 'backgroundTaskId')
      if (background && !stdout && !stderr) return `Running in the background (${background})`
      return [stdout, stderr].filter(s => s).join('\n')
    }
    const content = arr(output, 'content')
    if (content) return outputText(content)
    const text = str(output, 'text') ?? str(output, 'result') ?? str(output, 'message')
    if (text !== undefined) return text
  }
  try {
    return JSON.stringify(output, null, 2) ?? ''
  } catch {
    return String(output)
  }
}

function countLinks(o: unknown, depth = 0): number {
  if (depth > 6 || o === null || typeof o !== 'object') return 0
  if (Array.isArray(o)) return o.reduce<number>((n, x) => n + countLinks(x, depth + 1), 0)
  if (typeof (o as Record<string, unknown>).url === 'string') return 1
  return Object.values(o).reduce<number>((n, x) => n + countLinks(x, depth + 1), 0)
}

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// What a search found, from its record or, where the row holds the text the
// model read, from that text ("Found 3 files", or one result per line).
function countOf(p: { tool: string; input: unknown; output?: unknown }): string {
  const o = p.output
  if (o === undefined) return ''
  if (p.tool === 'WebSearch') {
    const n = countLinks(o)
    return n > 0 ? counted(n, 'result', 'results') : ''
  }
  if (p.tool !== 'Grep' && p.tool !== 'Glob') return ''

  const mode = p.tool === 'Glob' ? 'files_with_matches' : str(o, 'mode') ?? str(p.input, 'output_mode') ?? 'files_with_matches'
  const [one, many] = mode === 'content' ? ['line', 'lines'] : mode === 'count' ? ['match', 'matches'] : ['file', 'files']

  if (typeof o === 'string' || Array.isArray(o)) {
    const rows = lines(outputText(o)).filter(l => l.trim() !== '')
    const found = rows[0]?.match(/^Found (\d+)/)
    if (found) return counted(Number(found[1]), one, many)
    if (rows.length === 1 && /^No (files|matches) found/.test(rows[0] ?? '')) return counted(0, one, many)
    return counted(rows.length, one, many)
  }

  const n = mode === 'content' ? num(o, 'numLines') : mode === 'count' ? num(o, 'numMatches') : num(o, 'numFiles')
  return n === undefined ? '' : counted(n, one, many)
}

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

function isHunk(h: unknown): h is Hunk {
  return num(h, 'oldStart') !== undefined && num(h, 'newStart') !== undefined && Array.isArray(arr(h, 'lines'))
}

// Keeps the first `max` diff lines and rewrites the cut hunk's header, so the
// shortened source still parses as a unified diff.
function hunkSource(hunks: Hunk[], max: number): { source: string; hidden: number } {
  const out: string[] = []
  let shown = 0
  let total = 0
  for (const h of hunks) {
    const body = h.lines.map(l => clean(l))
    total += body.length
    if (shown >= max) continue
    const kept = body.slice(0, max - shown)
    shown += kept.length
    const oldCount = kept.filter(l => !l.startsWith('+')).length
    const newCount = kept.filter(l => !l.startsWith('-')).length
    out.push(`@@ -${h.oldStart},${oldCount} +${h.newStart},${newCount} @@`, ...kept)
  }
  return { source: out.join('\n'), hidden: total - shown }
}

function previewHunks(oldText: string, newText: string): Hunk[] {
  const removed = lines(oldText)
  const added = lines(newText)
  return [{
    oldStart: 1,
    oldLines: removed.length,
    newStart: 1,
    newLines: added.length,
    lines: [...removed.map(l => `-${l}`), ...added.map(l => `+${l}`)],
  }]
}

function toneOf(p: { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }): Tone {
  if (p.isErrored || p.isInterrupted) return 'failed'
  return p.isRunning ? 'running' : 'done'
}

function titleOf(tool: string): string {
  if (tool.startsWith('mcp__')) return tool.split('__').slice(2).join('__') || tool
  return TITLES[tool] ?? tool
}

function summaryOf(tool: string, input: unknown): string {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return str(input, 'description') ?? lines(str(input, 'command') ?? '')[0] ?? ''
    case 'Read': {
      const offset = num(input, 'offset')
      const limit = num(input, 'limit')
      const name = basename(str(input, 'file_path') ?? '')
      if (offset === undefined && limit === undefined) return name
      const from = offset ?? 1
      return limit === undefined ? `${name}  lines ${from}+` : `${name}  lines ${from}–${from + limit - 1}`
    }
    case 'Edit':
    case 'Write':
      return basename(str(input, 'file_path') ?? '')
    case 'NotebookEdit':
      return basename(str(input, 'notebook_path') ?? '')
    case 'Grep':
    case 'Glob': {
      const pattern = str(input, 'pattern') ?? ''
      const path = str(input, 'path')
      const glob = str(input, 'glob')
      return `${tool === 'Grep' ? `"${pattern}"` : pattern}${path ? ` in ${basename(path)}` : ''}${glob ? ` (${glob})` : ''}`
    }
    case 'WebFetch':
      return str(input, 'url') ?? ''
    case 'WebSearch':
      return str(input, 'query') ?? ''
    case 'Agent':
      return str(input, 'description') ?? ''
    case 'Skill':
      return str(input, 'skill') ?? ''
    case 'ToolSearch':
      return str(input, 'query') ?? ''
  }
  for (const k of ['description', 'title', 'query', 'prompt', 'url', 'file_path', 'path', 'pattern', 'command', 'name']) {
    const v = str(input, k)
    if (v) return v
  }
  return ''
}

function inputSource(tool: string, input: unknown, isOpen: boolean): string {
  if (SHELLS[tool]) return clean(str(input, 'command') ?? '')
  if (tool === 'Agent') return clean(str(input, 'prompt') ?? '')
  if (tool === 'WebFetch') return clean(str(input, 'prompt') ?? '')
  try {
    return clean(isOpen ? JSON.stringify(input, null, 2) : JSON.stringify(input))
  } catch {
    return ''
  }
}

function cardWidth(viewport: RenderViewport | undefined): number {
  const columns = viewport?.columns ?? 110
  return Math.max(320, Math.min(1200, Math.round((columns - 4) * CELL_PX) - 2))
}

// ---- the SVG pieces -----------------------------------------------------

// The dot, with the timeline drawn through it: below always, above when the
// row continues one drawn just before it in the same tree.
function dotSource(tone: Tone, joinTop: boolean): string {
  const pulse = tone === 'running'
    ? '<animate attributeName="opacity" values="1;0.25;1" dur="1.2s" repeatCount="indefinite"/>'
    : ''
  const above = joinTop ? '<line x1="5" y1="0" x2="5" y2="6" stroke="#808080" stroke-opacity=".35"/>' : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" viewBox="0 0 10 20">${above}<line x1="5" y1="14" x2="5" y2="20" stroke="#808080" stroke-opacity=".35"/><circle cx="5" cy="10" r="3.5" fill="${DOT[tone]}">${pulse}</circle></svg>`
}

type Section = { label: string; lines: string[]; note?: string; isError?: boolean; fades?: boolean }

// One IN/OUT card as VS Code draws it: a rounded box, small grey labels on
// the left, monospace text clipped at the right edge, a hairline between the
// sections and the last lines of a cut output fading out.
function cardSource(width: number, sections: Section[]): string {
  const defs: string[] = []
  const body: string[] = []
  let y = 0

  sections.forEach((s, i) => {
    if (i > 0) body.push(`<line class="d" x1="1" y1="${y + 0.5}" x2="${width - 1}" y2="${y + 0.5}"/>`)
    const rows = Math.max(1, s.lines.length)
    const h = PAD_Y * 2 + rows * LINE_H
    const base = y + PAD_Y + 13
    body.push(`<text class="l${s.isError ? ' le' : ''}" x="${LABEL_X}" y="${base}">${xml(s.label)}</text>`)

    let mask = ''
    if (s.fades) {
      const from = y + h - PAD_Y - 2 * LINE_H
      defs.push(
        `<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="0" y1="${from}" x2="0" y2="${y + h - PAD_Y}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
        `<mask id="m${i}" maskUnits="userSpaceOnUse"><rect x="0" y="0" width="${width}" height="${from}" fill="#fff"/><rect x="0" y="${from}" width="${width}" height="${y + h - from}" fill="url(#g${i})"/></mask>`,
      )
      mask = ` mask="url(#m${i})"`
    }

    const spans = s.lines.length === 0
      ? `<tspan class="n" x="${TEXT_X}" y="${base}">${xml(s.note ?? '')}</tspan>`
      : s.lines.map((l, j) => `<tspan x="${TEXT_X}" y="${base + j * LINE_H}">${xml(l.slice(0, MAX_LINE_CHARS)) || ' '}</tspan>`).join('')
    body.push(`<text class="t${s.isError ? ' e' : ''}" clip-path="url(#c)"${mask} xml:space="preserve">${spans}</text>`)
    y += h
  })

  const height = y + 1
  const style = [
    `text{font-family:${MONO};font-size:12.5px;white-space:pre}`,
    '.t{fill:#cccccc}.e{fill:#f48771}.n{fill:#8b8b8b;font-style:italic}',
    `.l{font-family:${SANS};font-size:11px;fill:#8b8b8b;letter-spacing:.06em}.l.le{fill:#f14c4c}`,
    '.b{fill:#ffffff08;stroke:#ffffff24}.d{stroke:#ffffff1c}',
    '@media (prefers-color-scheme:light){.t{fill:#333333}.e{fill:#c72e0f}.n,.l{fill:#767676}.l.le{fill:#d32f2f}.b{fill:#00000005;stroke:#00000026}.d{stroke:#0000001c}}',
  ].join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<style>${style}</style>`,
    `<defs><clipPath id="c"><rect x="${TEXT_X}" y="0" width="${width - TEXT_X - 10}" height="${height}"/></clipPath>${defs.join('')}</defs>`,
    `<rect class="b" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6"/>`,
    ...body,
    '</svg>',
  ].join('')
}

// ---- drawing ------------------------------------------------------------

function row(ui: UI, tone: Tone, joinTop: boolean, body: RenderChildren): RenderElement {
  const { Box, Svg } = ui
  const pulse = tone === 'running' ? { isInteractive: true } : {}

  return (
    <Box flexDirection="row" width="100%" minWidth="0%">
      <Box flexDirection="column" alignItems="center" width={2} flexShrink={0}>
        <Svg source={dotSource(tone, joinTop)} alt={tone} width={10} height={20} {...pulse} />
        <Box flexGrow={1} width="5%" alignSelf="center" backgroundColor={LINE} />
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth="0%" overflow="hidden" paddingLeft={1} paddingBottom={1}>
        {body}
      </Box>
    </Box>
  )
}

function header(ui: UI, title: string, summary: string, extra?: RenderChildren, isPath = false): RenderElement {
  const { Box, Text } = ui

  return (
    <Box flexDirection="row" gap={1} minWidth="0%">
      <Box flexShrink={0}>
        <Text bold>{oneLine(title)}</Text>
      </Box>
      {summary !== '' && (
        <Box flexShrink={1} minWidth="0%" overflow="hidden">
          {isPath
            ? <Text color={PATH} wrap="truncate-start">{oneLine(summary)}</Text>
            : <Text dimColor wrap="truncate-end">{oneLine(summary)}</Text>}
        </Box>
      )}
      {extra}
    </Box>
  )
}

// A card that unfolds the way VS Code's does: hovering it shows a small
// "Click to expand" chip in its bottom-right corner, and the chip toggles it.
function expandable(ui: UI, id: string, isOpen: boolean, hidden: number, onPress: () => void, card: RenderChildren): RenderElement {
  const { Box, Button } = ui
  const canToggle = isOpen || hidden > 0

  return (
    <Box key={`card:${id}`} flexDirection="column" width="100%" minWidth="0%" overflow="hidden" marginTop={0.25}>
      {card}
      {canToggle && (
        <Box position="absolute" bottom={0} right={0} paddingRight={1} paddingBottom={0.4} display="none" hover={{ display: 'flex' }}>
          <Button key={`expand:${id}`} onPress={onPress}>
            {isOpen ? 'Click to collapse' : 'Click to expand'}
          </Button>
        </Box>
      )}
    </Box>
  )
}

function changeSummary(added: number, removed: number): string {
  const plural = (n: number) => `${n} line${n === 1 ? '' : 's'}`
  if (added > 0 && removed > 0) return `Added ${plural(added)}, removed ${plural(removed)}`
  if (removed > 0) return `Removed ${plural(removed)}`
  return `Added ${plural(added)}`
}

// One tool call as a timeline row, for a standalone row and inside a group.
function drawCall(ui: UI, p: Call, isOpen: boolean, flip: () => void, width: number, joinTop: boolean): RenderElement {
  const { Box, Code, Svg, Text } = ui
  const tone = toneOf(p)
  const title = titleOf(p.tool)
  const summary = summaryOf(p.tool, p.input)
  const isFailed = p.isErrored || p.isInterrupted
  const errorText = isFailed ? outputText(p.output) : ''

  const errorLines = (max: number) => {
    if (p.isInterrupted) return <Text color={DOT.failed}>Interrupted</Text>
    if (!p.isErrored) return null
    return <Text color={DOT.failed}>{lines(errorText).slice(0, max).join('\n') || 'Failed'}</Text>
  }

  // Edit and Write, as VS Code heads them: the full path, a dim line saying
  // what changed, and the desktop's own code block as the card.
  if (p.tool === 'Edit' || p.tool === 'Write') {
    const path = str(p.input, 'file_path') ?? ''
    if (isFailed) return row(ui, tone, joinTop, [header(ui, title, path, undefined, true), errorLines(3)])

    if (p.tool === 'Write') {
      const content = lines(str(p.input, 'content') ?? '')
      const max = isOpen ? EXPANDED_LINES : WRITE_LINES

      return row(ui, tone, joinTop, [
        header(ui, title, path, undefined, true),
        <Text dimColor>{changeSummary(content.length, 0)}</Text>,
        content.length > 0 && expandable(ui, p.id, isOpen, content.length - max, flip,
          <Code source={content.slice(0, max).join('\n')} path={path} wrap="truncate-end" />),
      ])
    }

    const patch = arr(p.output, 'structuredPatch')?.filter(isHunk)
    const hunks = patch && patch.length > 0
      ? patch
      : previewHunks(str(p.input, 'old_string') ?? '', str(p.input, 'new_string') ?? '')
    const all = hunks.flatMap(h => h.lines)
    const added = all.filter(l => l.startsWith('+')).length
    const removed = all.filter(l => l.startsWith('-')).length
    const { source, hidden } = hunkSource(hunks, isOpen ? EXPANDED_LINES : DIFF_LINES)

    return row(ui, tone, joinTop, [
      header(ui, title, path, undefined, true),
      <Text dimColor>{changeSummary(added, removed)}</Text>,
      source !== '' && expandable(ui, p.id, isOpen, hidden, flip,
        <Code source={source} format="diff" wrap="truncate-end" />),
    ])
  }

  // Read: the full path, and the lines it read when it read only some.
  if (p.tool === 'Read') {
    const path = str(p.input, 'file_path') ?? ''
    const range = summary.includes('  lines ') ? summary.slice(summary.indexOf('  lines ') + 2) : ''
    const extra = range !== '' ? <Box flexShrink={0}><Text dimColor>{range}</Text></Box> : undefined

    return row(ui, tone, joinTop, [header(ui, title, path, extra, true), errorLines(3)])
  }

  // The todo list: one line per item.
  if (p.tool === 'TodoWrite') {
    const todos = arr(p.input, 'todos') ?? []

    return row(ui, tone, joinTop, [
      header(ui, title, ''),
      ...todos.map(todo => {
        const status = str(todo, 'status')
        const text = oneLine(str(todo, 'content') ?? '')
        if (status === 'completed') return <Text dimColor strikethrough>{`☑ ${text}`}</Text>
        if (status === 'in_progress') return <Text bold>{`◐ ${text}`}</Text>
        return <Text>{`☐ ${text}`}</Text>
      }),
    ])
  }

  // Shells, agents, fetches and MCP tools: the IN/OUT card.
  if (CARDED.has(p.tool) || (p.tool.startsWith('mcp__') && !NATIVE_MCP.test(p.tool))) {
    const inLines = lines(inputSource(p.tool, p.input, isOpen))
    const inShown = inLines.slice(0, isOpen ? EXPANDED_LINES : IN_LINES)
    const outLines = lines(isFailed ? errorText : outputText(p.output))
    const outShown = outLines.slice(0, isOpen ? EXPANDED_LINES : OUT_LINES)
    const hidden = outLines.length - outShown.length + inLines.length - inShown.length

    const sections: Section[] = []
    if (inShown.length > 0) sections.push({ label: 'IN', lines: inShown })
    sections.push(
      p.isRunning
        ? { label: 'OUT', lines: [], note: 'Running…' }
        : p.isInterrupted
          ? { label: 'OUT', lines: [], note: 'Interrupted', isError: true }
          : outShown.length === 0
            ? { label: 'OUT', lines: [], note: '(no output)', isError: p.isErrored }
            : { label: 'OUT', lines: outShown, isError: p.isErrored, fades: outLines.length > outShown.length },
    )
    const alt = `IN: ${oneLine(inShown.join(' '))}. OUT: ${oneLine(outShown.slice(0, 2).join(' ')) || 'none'}`

    return row(ui, tone, joinTop, [
      header(ui, title, summary),
      expandable(ui, p.id, isOpen, hidden, flip,
        <Svg source={cardSource(width, sections)} alt={alt.slice(0, 500)} />),
    ])
  }

  // Searches, listings and everything else: one line, a dim count.
  const count = COMPACT.has(p.tool) && !p.isRunning && !p.isErrored ? countOf(p) : ''
  const extra = count !== '' ? <Text dimColor>{`· ${count}`}</Text> : undefined

  return row(ui, tone, joinTop, [header(ui, title, summary, extra), errorLines(3)])
}

export const register: Register = on => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || !isDrawn(e.props.tool)) return next(e)

    const ui = $.ui.resolve(e)
    const open = memberOf(expanded, e)
    const isOpen = await read($, open)
    const call: Call = { ...e.props, id: e.props.tool_use_id }

    return drawCall(ui, call, isOpen, () => void update($, open, v => !v), cardWidth(e.viewport), false)
  })

  // The row above draws the result itself, so the app's own result block
  // under it is left out.
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (e.surface !== 'desktop' || !isDrawn(e.props.tool)) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  // VS Code lists every call on its own line of the timeline; the app folds a
  // run of calls into a summary or a framed group, so the group is drawn here.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.calls.some(c => WIDGET.test(c.tool))) return next(e)

    const ui = $.ui.resolve(e)
    const { Box } = ui
    const width = cardWidth(e.viewport)
    const rows: RenderElement[] = []

    for (const [i, c] of e.props.calls.entries()) {
      if (PLUMBING.test(c.tool)) continue
      const id = c.tool_use_id ?? `${e.requestId}:${i}`
      const open = atom({ plugin: 'vscode-timeline', key: 'expanded', id }, false)
      const isOpen = await read($, open)
      const call: Call = { ...c, id }
      rows.push(drawCall(ui, call, isOpen, () => void update($, open, v => !v), width, rows.length > 0))
    }

    if (rows.length === 0) return next(e)

    return <Box flexDirection="column" width="100%" minWidth="0%" overflow="hidden">{rows}</Box>
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const ui = $.ui.resolve(e)
    const { Markdown } = ui

    return row(ui, 'neutral', false, <Markdown text={e.props.text} dimColor={e.props.isSummary === true} />)
  })

  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const said = oneLine(e.props.message ?? e.props.word)
    const label = /(…|\.\.\.)$/.test(said) ? said : `${said}${e.props.suffix}`

    // One line: the app keeps the row one line tall and draws its own token
    // count and state beside it.
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={ORANGE} bold>✻</Text>
        <Text bold wrap="truncate-end">{label}</Text>
      </Box>
    )
  })
}

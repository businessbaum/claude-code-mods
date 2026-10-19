import { expect, test } from 'claude-code/testing'

const OUTPUT = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')

const BASH = {
  tool_use_id: 'toolu_bash',
  tool: 'Bash',
  input: { command: 'ls -la', description: 'List files in the project' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { stdout: OUTPUT, stderr: '', interrupted: false },
}

const EDIT = {
  tool_use_id: 'toolu_edit',
  tool: 'Edit',
  input: { file_path: 'C:/src/app/Shell.cs', old_string: 'a', new_string: 'b' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: {
    filePath: 'C:/src/app/Shell.cs',
    structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-a', '+b'] }],
  },
}

const READ = {
  tool_use_id: 'toolu_read',
  tool: 'Read',
  input: { file_path: 'C:/src/app/Shell.cs' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { type: 'text', file: { filePath: 'C:/src/app/Shell.cs', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
}

test('a Bash call draws the header and one IN/OUT card on the desktop', async $ => {
  const ui = await $.ui.mount({ plugin: 'vscode-timeline', surface: 'desktop', component: 'ToolUse', props: BASH, requestId: BASH.tool_use_id })

  expect(await ui.find({ type: 'Text', text: 'Bash' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'List files in the project' })).toBeDefined()
  const card = await ui.findAll({ type: 'Svg' })
  expect(card).toHaveLength(2)
  expect(String(card[1]?.props.source)).toContain('>IN<')
  expect(String(card[1]?.props.source)).toContain('>OUT<')
  expect(String(card[1]?.props.source)).toContain('line 4')
  expect(String(card[1]?.props.source)).not.toContain('line 5')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect((await ui.find({ key: 'expand:toolu_bash' }))?.text).toBe('Click to expand')

  await ui.press({ key: 'expand:toolu_bash' })
  expect((await ui.find({ key: 'expand:toolu_bash' }))?.text).toBe('Click to collapse')
  expect(String((await ui.findAll({ type: 'Svg' }))[1]?.props.source)).toContain('line 10')
  await ui.unmount()
})

test('a running call says so in its OUT row', async $ => {
  const props = { ...BASH, tool_use_id: 'toolu_running', isRunning: true, output: undefined }
  const ui = await $.ui.mount({ plugin: 'vscode-timeline', surface: 'desktop', component: 'ToolUse', props, requestId: props.tool_use_id })

  expect(String((await ui.findAll({ type: 'Svg' }))[1]?.props.source)).toContain('Running…')
  expect(await ui.find({ key: 'expand:toolu_running' })).toBeUndefined()
  await ui.unmount()
})

test('an Edit draws its diff with the line counts', async $ => {
  const ui = await $.ui.mount({ plugin: 'vscode-timeline', surface: 'desktop', component: 'ToolUse', props: EDIT, requestId: EDIT.tool_use_id })

  expect(await ui.find({ type: 'Text', text: 'C:/src/app/Shell.cs' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Added 1 line, removed 1 line' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  await ui.unmount()
})

test('a group draws each call as its own row, without the app frame', async $ => {
  const calls = [BASH, READ, EDIT].map(({ tool_use_id, tool, input, isRunning, isErrored, isInterrupted, output }) =>
    ({ tool_use_id, tool, input, isRunning, isErrored, isInterrupted, output }))
  const ui = await $.ui.mount({
    plugin: 'vscode-timeline',
    surface: 'desktop',
    component: 'ToolGroup',
    props: { calls, isActive: false, isExpanded: false },
  })

  expect(await ui.find({ type: 'Text', text: 'Bash' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Edit' })).toBeDefined()
  expect(await ui.find({ key: 'expand:toolu_bash' })).toBeDefined()
  await ui.press({ key: 'expand:toolu_bash' })
  expect((await ui.find({ key: 'expand:toolu_bash' }))?.text).toBe('Click to collapse')
  await ui.unmount()
})

test('the result block under a drawn row is left out', async $ => {
  const ui = await $.ui.mount({
    plugin: 'vscode-timeline',
    surface: 'desktop',
    component: 'ToolResult',
    props: { tool_use_id: BASH.tool_use_id, tool: 'Bash', output: BASH.output, isErrored: false },
  })

  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await ui.unmount()
})

test('assistant text and the spinner draw as timeline rows', async $ => {
  const text = await $.ui.mount({
    plugin: 'vscode-timeline',
    surface: 'desktop',
    component: 'AssistantMessage',
    props: { text: 'I found the bug.', isFirstOfReply: true },
  })
  expect(await text.find({ type: 'Markdown' })).toBeDefined()
  expect(await text.find({ type: 'Svg' })).toBeDefined()
  await text.unmount()

  const spinner = await $.ui.mount({
    plugin: 'vscode-timeline',
    surface: 'desktop',
    component: 'Spinner',
    props: { word: 'Pontificating', message: null, suffix: '…', mode: 'thinking' },
  })
  expect(await spinner.find({ type: 'Text', text: 'Pontificating…' })).toBeDefined()
  expect(await spinner.find({ type: 'Svg' })).toBeUndefined()
  await spinner.unmount()
})

test('a search counts what it found from the text the model read', async $ => {
  const props = {
    ...READ,
    tool_use_id: 'toolu_grep',
    tool: 'Grep',
    input: { pattern: 'return', output_mode: 'content' },
    output: 'a.ts:3:  return 1\na.ts:7:  return 2',
  }
  const ui = await $.ui.mount({ plugin: 'vscode-timeline', surface: 'desktop', component: 'ToolUse', props, requestId: props.tool_use_id })

  expect(await ui.find({ type: 'Text', text: '· 2 lines' })).toBeDefined()
  await ui.unmount()
})

test('the terminal keeps its own drawing', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount({ plugin: 'vscode-timeline', surface: 'terminal', component: 'ToolUse', props: BASH, requestId: 'toolu_terminal' })

  expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

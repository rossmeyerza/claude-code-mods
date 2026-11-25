import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-costs', component: 'Pane', requestId: 'claude-costs',
  props: { title: 'Claude costs', isFocused: true, bodyColumns: 70, placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const DAY = 86400000
const ROOT = '/home/me/.claude/projects'
const FILES: Record<string, string> = Object.fromEntries([0, 1, 2, 9].map(i => [
  `${ROOT}/-home-me-demo-app/s${i}.jsonl`,
  JSON.stringify({ type: 'user', cwd: '/home/me/demo-app' }) + '\n' + JSON.stringify({
    type: 'cost-state', sessionId: 's' + i, totalCostUSD: 2 + i, startTime: Date.now() - i * DAY,
    totalAPIDuration: 600000, totalDuration: 3600000, totalLinesAdded: 10, totalLinesRemoved: 2,
    modelUsage: { 'claude-opus-5-5': { costUSD: 2 + i, inputTokens: 10, outputTokens: 20,
      cacheReadInputTokens: 900, cacheCreationInputTokens: 100 } },
  }) + '\n',
]))

// An in-memory file system in place of the engine's. The files are ASCII, so bytes are characters.
function engine(on: any, store: Record<string, unknown>) {
  on('command.register', () => ({ value: { command: 'costs' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  on('clock.after', () => ({ value: undefined }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('fs.exists', (_: unknown, e: any) => ({ value: e.path === ROOT }))
  on('fs.list', (_: unknown, e: any) => {
    if (e.path === ROOT) return { value: [{ name: '-home-me-demo-app', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    return { value: Object.entries(FILES).filter(([path]) => path.startsWith(e.path + '/')).map(([path, text]) =>
      ({ name: path.split('/').pop(), kind: 'file', size: text.length, mtimeMs: 1, isLink: false })) }
  })
  on('fs.read', (_: unknown, e: any) => {
    const text = (FILES[e.path] ?? '').slice(e.offset ?? 0, (e.offset ?? 0) + (e.length ?? Infinity))
    return { value: e.as === 'bytes' ? { base64: btoa(text) } : text }
  })
}

async function settled(find: () => Promise<unknown>) {
  for (let i = 0; i < 100; i++) {
    if (await find()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('the pane reads the transcripts and draws every surface', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, store)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'costs', args: '' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await settled(() => ui.find({ type: 'Text', text: /\$20\.00/ }))
    expect((await ui.find({ type: 'Text', text: /\$20\.00/ }))?.text).toContain('$20.00')
    await ui.unmount()
  }
  expect(Object.keys((store['scan-cache'] as any).files)).toHaveLength(4)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-projects' })
  expect((await ui.find({ type: 'Text', text: /Spend by project/ }))?.text).toContain('Spend by project')
  await ui.press({ key: 'tab-sessions' })
  expect((await ui.find({ type: 'Text', text: /Most expensive/ }))?.text).toContain('Most expensive')
  await ui.unmount()
})

test('the desktop widget seat draws the compact view', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'costs', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop',
    props: { ...PANE.props, placement: 'widget', anchoredEdges: ['bottom', 'right'], bodyColumns: 30 } })
  await settled(() => ui.find({ type: 'Text', text: /\$20\.00/ }))
  expect((await ui.find({ type: 'Text', text: /\$20\.00/ }))?.text).toContain('$20.00')
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('the pane asks for a read before it has data', async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Press r/ }))?.text).toContain('Press r')
  await ui.unmount()
})

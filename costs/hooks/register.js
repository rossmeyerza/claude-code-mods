import { render, TABS } from './view.js'
import { CACHE_VERSION, createScan } from './scan.js'
import { PERIODS } from './stats.js'

const id = 'claude-costs'
const CACHE_KEY = 'scan-cache'
const SLICE_MS = 1500
const STALL_MS = 5000
const state = { data: undefined, error: undefined, busy: false, progress: null, lastStep: 0, tab: 'overview', period: 'month', readAt: '' }

const clock = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

// $.fs in the shape the scan takes. Each read marks the time, so a long file is not taken for a stall.
const touched = promise => promise.finally(() => { state.lastStep = Date.now() })
const io = $ => ({
  exists: path => $.fs.exists(path),
  list: path => $.fs.list(path),
  text: (path, offset, length) => touched($.fs.read(path, { offset, length })),
  bytes: async (path, offset, length) =>
    Uint8Array.fromBase64((await touched($.fs.read(path, { as: 'bytes', offset, length }))).base64),
})

async function prepare($) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (!config && !home) throw new Error('neither HOME nor CLAUDE_CONFIG_DIR is set')
  const saved = await $.store.get(CACHE_KEY)
  const cache = saved && saved.version === CACHE_VERSION && saved.files ? saved.files : {}
  return createScan(io($), { root: config || `${home}/.claude`, home, cache })
}

async function finish($, job) {
  const { report, cache } = job.result()
  state.data = report
  state.readAt = clock()
  try { await $.store.set(CACHE_KEY, { version: CACHE_VERSION, files: cache }) } catch {
    await $.store.delete(CACHE_KEY) // too large to keep: the next refresh reads every file again
  }
}

let job = null

// One slice of the scan. The first runs in the hook that asked for the read; the rest
// chain on timers. If a timer never fires, pressing r runs the next slice by hand.
async function runSlice($) {
  state.lastStep = Date.now()
  let current = job
  try {
    current = job ?? (job = await prepare($))
    const isDone = await current.step(Date.now() + SLICE_MS)
    state.lastStep = Date.now()
    if (job !== current) return // a newer read has taken over
    if (!isDone) {
      state.progress = current.progress()
      await $.ui.invalidate('ui.render')
      $.clock.after(0, () => runSlice($))
      return
    }
    await finish($, current)
  } catch (problem) {
    if (job !== current) return
    state.error = `Cannot read saved costs: ${problem?.message ?? problem}.`
  }
  job = null
  state.busy = false
  state.progress = null
  await $.ui.invalidate('ui.render')
}

async function refresh($) {
  if (state.busy) {
    if (Date.now() - state.lastStep > STALL_MS) await runSlice($)
    return
  }
  state.busy = true
  state.error = undefined
  await $.ui.invalidate('ui.render')
  await runSlice($)
}

function actions($) {
  const redraw = () => $.ui.invalidate('ui.render')
  return {
    tab: tab => { state.tab = tab; return redraw() },
    period: () => {
      const index = PERIODS.findIndex(p => p.id === state.period)
      state.period = PERIODS[(index + 1) % PERIODS.length].id
      return redraw()
    },
    refresh: () => refresh($),
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'costs', description: 'View saved Claude Code cost estimates' })
    return next(e)
  })
  on('command.run', { command: 'costs' }, async ($) => {
    await $.ui.open({ id, title: 'Claude costs', rows: 34, columns: 80, focus: true, closeOnEscape: true })
    await refresh($)
    return {}
  })
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== id) return next(e)
    if (!TABS.some(t => t.id === state.tab)) state.tab = 'overview'
    const now = Date.now()
    return render($.ui.resolve(e), { ...state, now, stalled: state.busy && now - state.lastStep > STALL_MS, width: e.props.bodyColumns ?? 60,
      surface: e.surface, placement: e.props.placement, actions: actions($) })
  })
}

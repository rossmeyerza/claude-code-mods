// Reads saved cost records from Claude Code transcripts through an I/O adapter, so the
// same code runs in the mod ($.fs) and in tests (node:fs). Transcripts only grow, so a
// cache keeps each file's byte offset and a refresh reads only the bytes added since.
export const CACHE_VERSION = 1
const CHUNK = 4_000_000
const FIELDS = ['costUSD', 'inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens']
const POOL = 4

const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const num = value => (valid(value) ? value : 0)
const tally = (text, pattern) => text.match(pattern)?.length ?? 0

// UTF-8 byte length of a string, without a per-character loop.
export function utf8Length(text) {
  if (!/[^\x00-\x7f]/.test(text)) return text.length
  return text.length + tally(text, /[\u0080-\u07ff]/g) + 2 * tally(text, /[\u0800-\ud7ff\ue000-\uffff]/g)
    + tally(text, /[\ud800-\udfff]/g)
}

const strip = path => path.replace(/[\\/]+$/, '')

export function projectName(cwd, dir, home) {
  if (typeof cwd !== 'string' || !strip(cwd)) return dir
  if (home && strip(cwd) === strip(home)) return '~ (home)'
  return strip(cwd).split(/[\\/]/).pop() || dir
}

function compact(row) {
  const models = {}
  for (const [name, metrics] of Object.entries(row.modelUsage ?? {})) {
    if (metrics && typeof metrics === 'object') models[name] = FIELDS.map(key => num(metrics[key]))
  }
  return { start: row.startTime, cost: row.totalCostUSD, api: num(row.totalAPIDuration), wall: num(row.totalDuration),
    added: num(row.totalLinesAdded), removed: num(row.totalLinesRemoved), unknown: Boolean(row.hasUnknownModelCost), models }
}

// Takes one line into the file's state. A partial last line may fail to parse; it is read again later.
function absorb(state, line, stem, partial) {
  const isCost = line.slice(0, 256).includes('"cost-state"')
  if (state.cwd === null && !isCost && line.includes('"cwd"')) {
    try { const cwd = JSON.parse(line)?.cwd; if (cwd !== undefined) state.cwd = cwd } catch {}
  }
  if (!isCost && (state.activity || !line.includes('"assistant"'))) return
  let row
  try { row = JSON.parse(line) } catch {
    if (isCost && !partial) throw new Error('Invalid cost record')
    return
  }
  if (row?.type === 'assistant') {
    const model = row.message?.model
    if (model !== undefined && model !== null && model !== '<synthetic>') state.activity = true
  }
  if (row?.type === 'cost-state' && row.sessionId === stem) {
    if (!valid(row.totalCostUSD) || !valid(row.startTime)) throw new Error('Invalid cost or session date')
    state.row = compact(row)
  }
}

async function skipLine(io, path, offset, size, chunk) {
  for (let at = offset; at < size; at += chunk) {
    const index = (await io.bytes(path, at, Math.min(chunk, size - at))).indexOf(10)
    if (index >= 0) return at + index + 1
  }
  return null
}

async function scanFile(io, file, cached, chunk) {
  const usable = cached && cached.offset <= file.size
  if (usable && cached.size === file.size && cached.mtimeMs === file.mtimeMs) return cached
  const state = usable ? { ...cached } : { offset: 0, cwd: null, activity: false, row: null }
  Object.assign(state, { size: file.size, mtimeMs: file.mtimeMs, dir: file.dir })
  while (state.offset < file.size) {
    const length = Math.min(chunk, file.size - state.offset)
    const text = await io.text(file.path, state.offset, length)
    const end = text.lastIndexOf('\n')
    const atEnd = state.offset + length >= file.size
    if (end < 0 && !atEnd) {
      const next = await skipLine(io, file.path, state.offset, file.size, chunk)
      if (next === null) break
      state.offset = next
      continue
    }
    const complete = text.slice(0, end + 1)
    for (const line of complete.split('\n')) if (line) absorb(state, line, file.stem, false)
    if (atEnd && end + 1 < text.length) absorb(state, text.slice(end + 1), file.stem, true)
    state.offset += utf8Length(complete)
    if (atEnd) break
  }
  if (state.offset > 0 && (await io.bytes(file.path, state.offset - 1, 1))[0] !== 10) {
    throw new Error('The read did not end on a line boundary')
  }
  return state
}

async function listFiles(io, projects) {
  const dirs = (await io.list(projects)).filter(entry => entry.kind === 'dir')
  let errors = 0
  const lists = await Promise.all(dirs.map(async dir => {
    try {
      return (await io.list(`${projects}/${dir.name}`))
        .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
        .map(entry => ({ path: `${projects}/${dir.name}/${entry.name}`, stem: entry.name.slice(0, -6),
          dir: dir.name, size: entry.size, mtimeMs: entry.mtimeMs }))
    } catch { errors += 1; return [] }
  }))
  return { files: lists.flat(), errors }
}

function collect(files, states, home) {
  const sessions = new Map()
  const missing = new Set()
  for (const file of files) {
    const state = states.get(file.path)
    if (!state) continue
    if (state.row) {
      const old = sessions.get(file.stem)
      if (!old || state.mtimeMs > old.mtimeMs) sessions.set(file.stem, state)
    } else if (state.activity) missing.add(file.stem)
  }
  for (const stem of sessions.keys()) missing.delete(stem)
  const rows = [...sessions].map(([id, state]) => ({ id, project: projectName(state.cwd, state.dir, home), ...state.row }))
  return { sessions: rows, missing: missing.size }
}

// A scan that runs in steps, so that no one hook or timer runs for long.
// root: the Claude config folder. cache: the cache of the last scan, or {}.
export function createScan(io, { root, home, cache = {}, chunk = CHUNK }) {
  const projects = `${strip(root)}/projects`
  const states = new Map()
  let files = null
  let errors = 0
  let next = 0
  let done = 0
  return {
    progress: () => ({ done, total: files?.length ?? 0 }),
    // Reads files until `until` (ms since the epoch) has passed; true once every file is read.
    async step(until) {
      if (!files) {
        if (!(await io.exists(projects))) throw new Error('The Claude Code transcript folder is not available')
        const listed = await listFiles(io, projects)
        files = listed.files
        errors = listed.errors
      }
      const worker = async () => {
        while (next < files.length && Date.now() < until) {
          const file = files[next++]
          try { states.set(file.path, await scanFile(io, file, cache[file.path], chunk)) } catch { errors += 1 }
          done += 1
        }
      }
      await Promise.all(Array.from({ length: POOL }, worker))
      return done >= files.length
    },
    result: () => ({ report: { ...collect(files, states, home), errors }, cache: Object.fromEntries(states) }),
  }
}

export async function scan(io, options) {
  const job = createScan(io, options)
  while (!(await job.step(Infinity))) { /* each step reads every file that is left */ }
  return job.result()
}

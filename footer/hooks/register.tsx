import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'
import { panel } from './panel'

const project = atom({ plugin: 'footer', key: 'project' } as const, null)
const metrics = atom({ plugin: 'footer', key: 'metrics' } as const, null)

// Read the project and model at session start and after each turn.
async function refresh($: EngineInterface) {
  const cwd = await $.session.cwd()
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd
  const model = await $.session.model()
  let branch = ''
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 2000 })
    if (exitCode === 0) branch = stdout.trim()
  } catch {
    branch = ''
  }
  const shortModel = model.replace(/^claude-/, '')
  await update($, project, () => ({ folder, branch, model: shortModel }))
}

type Usage = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>

// Optional: CLAUDE_FOOTER_EXPORT names a command that gets the 5-hour and
// 7-day limits as JSON on stdin, for example to feed a status bar.
async function publishUsage($: EngineInterface, snapshot: Usage) {
  const command = (await $.env.get('CLAUDE_FOOTER_EXPORT'))?.trim()
  if (!command) return
  const rateLimits = snapshot.rateLimits.filter(limit =>
    (limit.kind === 'five_hour' || limit.kind === 'seven_day') &&
    Number.isFinite(limit.percentUsed) && limit.percentUsed >= 0 && limit.percentUsed <= 100)
  if (!['five_hour', 'seven_day'].every(kind => rateLimits.some(limit => limit.kind === kind))) return
  try {
    const observed_at = Math.floor(await $.clock.now() / 1000)
    const result = await $.process.run(command.split(/\s+/), { stdin: JSON.stringify({ version: 1, observed_at, rateLimits }), timeoutMs: 2000 })
    if (result.exitCode !== 0) throw new Error(result.stderr || 'The export command failed')
  } catch (error) {
    $.ui.log(`Usage export failed: ${String(error)}`, { to: 'debug' })
  }
}

async function refreshUsage($: EngineInterface, current?: Usage, publish = true) {
  const snapshot = current ?? await $.session.usage()
  let context = snapshot.context
  if (context.percent === undefined) {
    try {
      // A summary uses local estimates and makes no token-count API requests.
      context = (await $.session.usage({ breakdown: 'summary' })).context
    } catch {
      // Keep the context label visible if no estimate is available.
    }
  }
  const percent = context.percent ?? context.breakdown?.percentage
  await update($, metrics, () => ({
    contextPercent: percent !== undefined && Number.isFinite(percent) ? percent : null,
    estimated: context.percent === undefined,
    limits: snapshot.rateLimits,
    cost: snapshot.cost && Number.isFinite(snapshot.cost.usd) ? snapshot.cost.usd : null,
  }))
  if (publish) await publishUsage($, snapshot)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($)
    await refreshUsage($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    await refreshUsage($)
    return done
  })

  on('session.measure', async ($, e, next) => {
    await refreshUsage($, e, e.changed.includes('rateLimits'))
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const currentProject = await read($, project)
    const currentMetrics = await read($, metrics)
    if (!currentProject && !currentMetrics) return next(e)

    const ui = $.ui.resolve(e)
    return ui.Box({ flexDirection: 'column', children: [
      panel(ui, currentProject, currentMetrics, e.viewport?.columns ?? 64),
      await next(e),
    ] })
  })
}

import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createScan, scan, utf8Length } from './hooks/scan.js'
import { summarise } from './hooks/stats.js'
import { nodeIo } from './node-io.mjs'

const cost = (sessionId, totalCostUSD, startTime = Date.now()) => ({
  type: 'cost-state', sessionId, totalCostUSD, startTime,
  modelUsage: { 'claude-opus-test': { costUSD: totalCostUSD, inputTokens: 10, outputTokens: 5,
    cacheReadInputTokens: 30, cacheCreationInputTokens: 0 } },
})
const lines = rows => rows.map(row => JSON.stringify(row)).join('\n')

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'claude-cost-test-'))
  try { return await run(root, join(root, 'projects', '-home-me-my-app')) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('The scan keeps the last snapshot and excludes nested sessions', () => fixture(async (root, project) => {
  const nested = join(project, 'session', 'subagents')
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(project, 'session.jsonl'), lines([{ type: 'user', cwd: '/home/me/my-app' }, cost('session', 2), cost('session', 3)]))
  writeFileSync(join(project, 'old.jsonl'), lines([cost('old', 5, Date.UTC(2020, 0, 1))]))
  writeFileSync(join(nested, 'agent.jsonl'), lines([cost('agent', 7)]))
  writeFileSync(join(project, 'missing.jsonl'), lines([{ type: 'assistant', message: { model: 'claude-test' } }]))
  writeFileSync(join(project, 'home.jsonl'), lines([{ type: 'user', cwd: '/home/me/' }, cost('home', 1)]))
  const { report } = await scan(nodeIo, { root, home: '/home/me' })
  assert.equal(report.sessions.length, 3)
  assert.equal(report.missing, 1)
  assert.equal(report.errors, 0)
  const byId = Object.fromEntries(report.sessions.map(s => [s.id, s]))
  assert.equal(byId.session.cost, 3)
  assert.equal(byId.session.project, 'my-app')
  assert.equal(byId.old.project, '-home-me-my-app')
  assert.equal(byId.home.project, '~ (home)')
  const all = summarise(report, 'all', Date.now())
  assert.equal(all.total, 9)
  assert.equal(summarise(report, 'week', Date.now()).total, 4)
  assert.equal(all.tokens.cacheShare, 0.75)
}))

test('A refresh reads only the bytes added since the last scan', () => fixture(async (root, project) => {
  mkdirSync(project, { recursive: true })
  const path = join(project, 's.jsonl')
  writeFileSync(path, lines([{ type: 'user', cwd: '/w/app', text: 'café ☕ 😀' }, cost('s', 1)]) + '\n')
  const first = await scan(nodeIo, { root, home: '/h' })
  let reads = 0
  const counting = { ...nodeIo, text: (p, offset, length) => { reads += 1; assert.ok(offset > 0); return nodeIo.text(p, offset, length) } }
  appendFileSync(path, JSON.stringify(cost('s', 4)) + '\n')
  const second = await scan(counting, { root, home: '/h', cache: first.cache })
  assert.equal(reads, 1)
  assert.equal(second.report.sessions[0].cost, 4)
  assert.equal(second.report.sessions[0].project, 'app')
}))

test('Small chunks give the same result, across multi-byte characters and skipped long lines', () => fixture(async (root, project) => {
  mkdirSync(project, { recursive: true })
  const long = { type: 'user', text: 'é'.repeat(300) + '😀'.repeat(100) }
  writeFileSync(join(project, 's.jsonl'), lines([{ type: 'user', cwd: '/w/ünï' }, long, cost('s', 2), long, cost('s', 6), long]))
  const whole = await scan(nodeIo, { root, home: '/h' })
  assert.ok(JSON.stringify(cost('s', 6)).length < 280)
  // A chunk holds every cost record but not the long lines, which the scan skips.
  for (const chunk of [280, 333, 512, 4096]) {
    const parts = await scan(nodeIo, { root, home: '/h', chunk })
    assert.equal(parts.report.errors, 0, `chunk ${chunk}`)
    assert.deepEqual(parts.report, whole.report, `chunk ${chunk}`)
  }
  assert.equal(whole.report.sessions[0].cost, 6)
  assert.equal(whole.report.sessions[0].project, 'ünï')
}))

test('A partial last line is read again once it is complete', () => fixture(async (root, project) => {
  mkdirSync(project, { recursive: true })
  const path = join(project, 's.jsonl')
  const row = JSON.stringify(cost('s', 9))
  writeFileSync(path, JSON.stringify(cost('s', 1)) + '\n' + row.slice(0, 20))
  const first = await scan(nodeIo, { root, home: '/h' })
  assert.equal(first.report.errors, 0)
  assert.equal(first.report.sessions[0].cost, 1)
  appendFileSync(path, row.slice(20) + '\n')
  const second = await scan(nodeIo, { root, home: '/h', cache: first.cache })
  assert.equal(second.report.sessions[0].cost, 9)
}))

test('A step stops at its deadline and a later step goes on', () => fixture(async (root, project) => {
  mkdirSync(project, { recursive: true })
  for (let i = 0; i < 6; i++) writeFileSync(join(project, `s${i}.jsonl`), lines([cost(`s${i}`, 1)]))
  const job = createScan(nodeIo, { root, home: '/h' })
  assert.equal(await job.step(0), false)
  assert.equal(job.progress().total, 6)
  assert.equal(job.progress().done, 0)
  assert.equal(await job.step(Infinity), true)
  assert.equal(job.result().report.sessions.length, 6)
}))

test('An invalid cost record counts as an error', () => fixture(async (root, project) => {
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'bad.jsonl'), '{"type":"cost-state","sessionId":"bad","totalCostUSD":\n' + JSON.stringify(cost('bad', 1)))
  const { report } = await scan(nodeIo, { root, home: '/h' })
  assert.equal(report.errors, 1)
  assert.equal(report.sessions.length, 0)
}))

test('The byte length matches UTF-8', () => {
  for (const text of ['abc', 'é', '€', '😀', 'a€é😀\n']) assert.equal(utf8Length(text), Buffer.byteLength(text))
})

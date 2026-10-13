// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { backupBeforeUpgrade, openStore, resetStore, SCHEMA_VERSION } from '../index'
import schema from '../schema.sql?raw'
import { importBoard } from '../import-board'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'decision-ide-'))
const T = '2026-10-06T10:00:00+05:30'

const board = {
  sessions: {
    s1: { id: 's1', title: 'ABC-1 work', ticket: 'ABC-1', state: 'waiting', started_at: T, updated_at: T, archived: false,
          inbox: [{ id: 'm1', text: 'hello', by: 'board', created_at: T, delivered_at: null }] }
  },
  decisions: {
    'ABC-1/D1': { id: 'ABC-1/D1', ticket: 'ABC-1', number: 'D1', session: 's1', question: 'Q?', options: ['a', 'b'],
                  evidence: ['x.rb:1'], refs: [], status: 'answered', answer: 'a', created_at: T, updated_at: T,
                  thread: [{ who: 'you', text: 'why?', at: T }] }
  },
  reviews: {
    'R-1': { id: 'R-1', ticket: 'ABC-1', session: 's1', title: 'PR 1', status: 'accepted', created_at: T, updated_at: T,
             changes: [{ id: 'C1', file: 'a.rb', diff: '+x', verdict: 'accept', comment: null, thread: [] }] }
  },
  backlog: { 'B-1': { id: 'B-1', title: 'T', problem: 'p', evidence: [], status: 'applied', headline: 'h', created_at: T, updated_at: T } },
  runs: { 'R-1': { id: 'R-1', role: 'pm', status: 'ok', cost: 0.12, exit: 0, started_at: T } },
  company: { paused: false }
}

describe('openStore', () => {
  it('creates the schema once and reopens without re-running it', () => {
    const path = join(tmp(), 'board.db')
    const db = openStore(path)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
    const again = openStore(path)
    expect(again.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('upgrades a version 1 store in place and keeps its rows', () => {
    const path = join(tmp(), 'board.db')
    const v1 = new Database(path)
    v1.exec(schema)
    v1.prepare("INSERT INTO sessions (id, state, started_at, updated_at) VALUES ('s1', 'working', ?, ?)").run(T, T)
    v1.close()
    const db = openStore(path)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(db.prepare('SELECT id, mode, model FROM sessions').all()).toEqual([{ id: 's1', mode: null, model: null }])
    expect(db.prepare('SELECT COUNT(*) AS n FROM approvals').get()).toEqual({ n: 0 })
  })

  it('rejects a state the board does not allow', () => {
    const db = openStore(join(tmp(), 'board.db'))
    expect(() => db.prepare("INSERT INTO sessions (id, state, started_at, updated_at) VALUES ('x', 'stuck', ?, ?)").run(T, T)).toThrow(/CHECK/)
  })
})

describe('importBoard', () => {
  it('imports every collection and keeps fields with no column in backlog.extra', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'board.json'), JSON.stringify(board))
    const db = openStore(join(dir, 'board.db'))
    expect(importBoard(db, join(dir, 'board.json'))).toEqual({
      sessions: 1, messages: 1, decisions: 1, decision_thread: 1, reviews: 1, review_changes: 1, backlog: 1, runs: 1, settings: 1
    })
    expect(db.prepare('SELECT options, evidence FROM decisions').get()).toEqual({ options: '["a","b"]', evidence: '["x.rb:1"]' })
    expect(JSON.parse((db.prepare('SELECT extra FROM backlog').get() as { extra: string }).extra)).toEqual({ headline: 'h' })
    expect(db.prepare('SELECT cost_usd, exit_code FROM runs').get()).toEqual({ cost_usd: 0.12, exit_code: 0 })
  })

  it('runs only into an empty store', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'board.json'), JSON.stringify(board))
    const db = openStore(join(dir, 'board.db'))
    importBoard(db, join(dir, 'board.json'))
    expect(importBoard(db, join(dir, 'board.json'))).toBeNull()
  })

  it('imports nothing when one row is invalid', () => {
    const dir = tmp()
    const bad = { ...board, decisions: { ...board.decisions, 'ABC-1/D2': { ...board.decisions['ABC-1/D1'], id: 'ABC-1/D2', session: 'ghost', thread: [] } } }
    writeFileSync(join(dir, 'board.json'), JSON.stringify(bad))
    const db = openStore(join(dir, 'board.db'))
    expect(() => importBoard(db, join(dir, 'board.json'))).toThrow(/FOREIGN KEY/)
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })
})

describe('syncBoard (switch-over catch-up)', () => {
  it('copies new rows, replaces shared ids with the prototype version, and keeps rows only the app has', async () => {
    const { syncBoard } = await import('../import-board')
    const { search } = await import('../../../shared/memory')
    const dir = tmp()
    const db = openStore(join(dir, 'board.db'))
    const first = join(dir, 'first.json')
    writeFileSync(first, JSON.stringify(board))
    importBoard(db, first)
    db.prepare("INSERT INTO sessions (id, state, via, started_at, updated_at) VALUES ('chat-1', 'working', 'chat', ?, ?)").run(T, T)
    const later = structuredClone(board) as typeof board & { decisions: Record<string, unknown>; reviews: Record<string, unknown> }
    ;(later.decisions['ABC-1/D1'] as Record<string, unknown>).answer = 'b, after all'
    ;(later.decisions['ABC-1/D1'] as Record<string, unknown>).thread = []
    later.decisions['ABC-1/D2'] = { id: 'ABC-1/D2', ticket: 'ABC-1', number: 'D2', session: 's1', question: 'Backfill invoices?', options: [], evidence: [], refs: [], status: 'open', created_at: T, updated_at: T }
    later.reviews['R-2'] = { id: 'R-2', ticket: 'ABC-1', session: 's1', title: 'Origin column', status: 'open', created_at: T, updated_at: T, changes: [{ id: 'C1', file: 'db.rb', diff: '+x', verdict: 'pending', comment: null, thread: [] }] }
    const path = join(dir, 'later.json')
    writeFileSync(path, JSON.stringify(later))
    expect(syncBoard(db, path)).toEqual({ sessions: 1, messages: 1, decisions: 2, reviews: 2 })
    expect(db.prepare('SELECT id, answer FROM decisions ORDER BY id').all()).toEqual([{ id: 'ABC-1/D1', answer: 'b, after all' }, { id: 'ABC-1/D2', answer: null }])
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_thread').get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT id FROM sessions WHERE id = 'chat-1'").get()).toEqual({ id: 'chat-1' })
    expect(db.prepare("SELECT file FROM review_changes WHERE review_id = 'R-2'").all()).toEqual([{ file: 'db.rb' }])
    expect(search(db, 'backfill').map((h) => h.ref)).toEqual(['ABC-1/D2'])
    expect(search(db, 'origin').map((h) => h.ref)).toEqual(['R-2'])
    expect(syncBoard(db, path)).toEqual({ sessions: 1, messages: 1, decisions: 2, reviews: 2 }) // running it again changes nothing
    expect(db.prepare('SELECT COUNT(*) AS n FROM decisions').get()).toEqual({ n: 2 })
    expect(search(db, 'origin').length).toBe(1)
  })
})

describe('resetStore', () => {
  it('backs the store up, then empties every table (search index included) and keeps the schema', async () => {
    const { mkdtempSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const { touchSession, postDecision } = await import('../../../shared/board')
    const { search } = await import('../../../shared/memory')
    const dir = mkdtempSync(join(tmpdir(), 'reset-'))
    const db = openStore(join(dir, 'b.db'))
    touchSession(db, 's1', { title: 'x' })
    postDecision(db, { ticket: 'KA-1', number: 'D1', session: 's1', question: 'Which payment rail?' })
    db.prepare("INSERT INTO settings (key, value) VALUES ('app', '{}')").run()
    resetStore(db, join(dir, 'backup.db'))
    for (const t of ['sessions', 'decisions', 'settings']) expect(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()).toEqual({ n: 0 })
    expect(search(db, 'payment')).toEqual([])
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const backup = openStore(join(dir, 'backup.db'))
    expect(backup.prepare('SELECT count(*) AS n FROM decisions').get()).toEqual({ n: 1 })
  })
})

describe('copy before an upgrade', () => {
  // An existing board one version behind: the newest column dropped and the version stepped back.
  const olderBoard = (dir: string): string => {
    const path = join(dir, 'board.db')
    const db = openStore(path)
    db.prepare("INSERT INTO sessions (id, state, started_at, updated_at) VALUES ('s1', 'working', 't', 't')").run()
    db.exec('ALTER TABLE sessions DROP COLUMN effort') // the newest migration's column (v20)
    db.pragma(`user_version = ${SCHEMA_VERSION - 1}`)
    db.close()
    return path
  }
  const backups = (dir: string): string[] => readdirSync(dir).filter((f) => f.includes('.bak-')).sort()

  it('a fresh board gets no copy; an older board is copied as it was, then upgraded', () => {
    const fresh = tmp()
    openStore(join(fresh, 'board.db')).close()
    expect(backups(fresh)).toEqual([])

    const dir = tmp()
    const path = olderBoard(dir)
    openStore(path).close()
    const [copy] = backups(dir)
    expect(copy).toMatch(new RegExp(`^board\\.db\\.bak-v${SCHEMA_VERSION - 1}-\\d{8}T\\d{9}Z$`))
    const old = new Database(join(dir, copy), { readonly: true })
    expect([old.pragma('user_version', { simple: true }), old.prepare('SELECT id FROM sessions').all()]).toEqual([SCHEMA_VERSION - 1, [{ id: 's1' }]])
    old.close()
    const now = openStore(path)
    expect(now.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    now.close()
    expect(backups(dir)).toEqual([copy]) // nothing pending: no second copy
  })

  it('keeps the newest three copies and leaves other files alone', () => {
    const dir = tmp()
    const path = olderBoard(dir)
    writeFileSync(join(dir, 'board.db.bak-pre-v2-2026-10-06'), 'older backup, not ours to prune')
    const db = new Database(path)
    for (const day of ['01', '02', '03', '04']) backupBeforeUpgrade(db, path, 18, new Date(`2026-10-${day}T10:00:00.000Z`))
    db.close()
    expect(backups(dir)).toEqual(['board.db.bak-pre-v2-2026-10-06', 'board.db.bak-v18-20261002T100000000Z', 'board.db.bak-v18-20261003T100000000Z', 'board.db.bak-v18-20261004T100000000Z'])
  })
})

// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import Database from 'better-sqlite3'
import { readdirSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import schema from './schema.sql?raw'
import migrate2 from './migrate-2.sql?raw'
import migrate3 from './migrate-3.sql?raw'
import migrate4 from './migrate-4.sql?raw'
import migrate5 from './migrate-5.sql?raw'
import migrate6 from './migrate-6.sql?raw'
import migrate7 from './migrate-7.sql?raw'
import migrate8 from './migrate-8.sql?raw'
import migrate9 from './migrate-9.sql?raw'
import migrate10 from './migrate-10.sql?raw'
import migrate11 from './migrate-11.sql?raw'
import migrate12 from './migrate-12.sql?raw'
import migrate13 from './migrate-13.sql?raw'
import migrate14 from './migrate-14.sql?raw'
import migrate15 from './migrate-15.sql?raw'
import migrate16 from './migrate-16.sql?raw'
import migrate17 from './migrate-17.sql?raw'
import migrate18 from './migrate-18.sql?raw'
import migrate19 from './migrate-19.sql?raw'

export type Store = Database.Database

// Each step runs once, in order. A new migration is appended here.
const STEPS = [schema, migrate2, migrate3, migrate4, migrate5, migrate6, migrate7, migrate8, migrate9, migrate10, migrate11, migrate12, migrate13, migrate14, migrate15, migrate16, migrate17, migrate18, migrate19]
export const SCHEMA_VERSION = STEPS.length

// Opens (and on first run creates) the store.
// - WAL: sessions, the decide CLI and the UI write at the same time.
// - busy_timeout: a writer waits for another instead of failing straight away.
// - Before a newer app upgrades an existing board, a copy is saved next to it (backupBeforeUpgrade).
export function openStore(path: string): Store {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  const from = db.pragma('user_version', { simple: true }) as number
  if (from > 0 && from < STEPS.length) backupBeforeUpgrade(db, path, from)
  // Each step runs in its own transaction and ends by bumping user_version.
  for (let v = from; v < STEPS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(STEPS[v])
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}

// A copy of the board before its schema is upgraded: <board>.bak-v<old version>-<UTC time to the ms>, newest KEEP_BACKUPS kept.
// - Milliseconds in the name: the app and a session's CLI can open an old board in the same second.
// - Not on a fresh install (version 0) or when nothing is pending.
// - If the copy fails (e.g. a full disk), the error is thrown and the upgrade does not run: no upgrade without a copy.
const KEEP_BACKUPS = 3
// at: the time in the name (tests pass one; the app uses now).
export function backupBeforeUpgrade(db: Store, path: string, from: number, at = new Date()): string {
  const stamp = at.toISOString().replace(/[-:.]/g, '')
  const file = `${path}.bak-v${from}-${stamp}`
  db.prepare('VACUUM INTO ?').run(file)
  const mine = new RegExp(`^${basename(path).replace(/[.]/g, '\\.')}\\.bak-v\\d+-(\\d{8}T\\d{9}Z)$`)
  const when = (f: string): string => mine.exec(f)![1]
  const old = readdirSync(dirname(path)).filter((f) => mine.test(f)).sort((a, b) => when(b).localeCompare(when(a)))
  for (const f of old.slice(KEEP_BACKUPS)) rmSync(join(dirname(path), f))
  return file
}

// Reset (start fresh): a copy of the store goes to `backup` first, then every table is emptied in one transaction.
// - The schema stays. The search index (memory) is a virtual table: emptying it clears its own internal tables.
export function resetStore(db: Store, backup: string): void {
  db.prepare('VACUUM INTO ?').run(backup)
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name)
  const own = tables.filter((t) => !tables.some((v) => t !== v && t.startsWith(`${v}_`)))
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      for (const t of own) db.prepare(`DELETE FROM "${t}"`).run()
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

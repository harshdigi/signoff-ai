// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { readBoard } from '../board-state'
import { openStore } from '../store'
import { addReview, setVerdict, submitReview, touchSession } from '../../shared/board'

describe('board state', () => {
  it('sends diffs only for open reviews; closed ones carry their size, so the board stays small', () => {
    const db = openStore(join(mkdtempSync(join(tmpdir(), 'bs-')), 'b.db'))
    touchSession(db, 's1', {})
    const patch = 'diff --git a/x.rb b/x.rb\n--- a/x.rb\n+++ b/x.rb\n@@ -1 +1 @@\n-a\n+b\n'
    const open = addReview(db, { ticket: 'KA-1', session: 's1', title: 'open one', patch })
    const done = addReview(db, { ticket: 'KA-1', session: 's1', title: 'done one', patch })
    setVerdict(db, done.id, 'C1', 'accept')
    submitReview(db, done.id)
    const reviews = readBoard(db).reviews
    const change = (id: string): { diff: string | null; lines: number } => reviews.find((r) => r.id === id)!.changes[0]
    expect(change(open.id).diff).toContain('+b')
    expect(change(done.id)).toMatchObject({ diff: null, lines: change(open.id).lines })
  })
})

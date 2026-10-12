// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { openStore } from '../../main/store'
import { addComment, editComment, openComments, replyComment, sendComments } from '../comments'

describe('code comments', () => {
  it('drafts are batched into one numbered chat message with file, lines and code; replies are recorded per comment', () => {
    const db = openStore(join(mkdtempSync(join(tmpdir(), 'cm-')), 'b.db'))
    const a = addComment(db, { session: 's1', root: '/repo', path: 'app/x.rb', start: 3, end: 4, code: 'def x\n  1\n', text: 'why 1?' })
    const b = addComment(db, { session: 's1', root: '/repo', path: 'lib/y.rb', start: 9, end: 9, code: 'y = 2', text: 'rename y' })
    editComment(db, b.id, 'rename y to total')
    const msg = sendComments(db, 's1', [a.id, b.id])
    expect(msg).toBe([
      'Review comments (2). Answer each one here, and record each answer with: signoff comment reply --id <n> --text "..." (n is the number after #c).',
      '',
      `#c${a.id} /repo/app/x.rb:3-4\n\`\`\`rb\ndef x\n  1\n\n\`\`\`\nwhy 1?\n\n#c${b.id} /repo/lib/y.rb:9\n\`\`\`rb\ny = 2\n\`\`\`\nrename y to total`
    ].join('\n'))
    expect(openComments(db, 's1').map((c) => c.id)).toEqual([a.id, b.id])
    expect(() => editComment(db, a.id, 'x')).toThrow('only a comment not sent yet can be edited')
    expect(() => sendComments(db, 's1', [a.id])).toThrow("only this session's unsent comments can be sent")
    replyComment(db, a.id, 'It is the default page size.')
    expect(openComments(db, 's1').map((c) => c.id)).toEqual([b.id])
    expect(db.prepare('SELECT status, reply FROM comments WHERE id = ?').get(a.id)).toEqual({ status: 'answered', reply: 'It is the default page size.' })
  })
})

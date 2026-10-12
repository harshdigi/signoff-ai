// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { evidenceSnippet } from '../evidence'

describe('evidence snippets', () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'ev-')))
  mkdirSync(join(top, 'service/app'), { recursive: true })
  writeFileSync(join(top, 'service/app/link.rb'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'))
  writeFileSync(join(tmpdir(), 'outside.rb'), 'secret')

  it('finds a repo-relative path inside a folder of repos and shows the lines around it', () => {
    const s = evidenceSnippet(top, 'app/link.rb:10 :: the check')!
    expect(s.file).toBe(join(top, 'service/app/link.rb'))
    expect([s.from, s.to]).toEqual([10, 10])
    expect(s.lines.map((l) => l.n)).toEqual([7, 8, 9, 10, 11, 12, 13])
    expect(s.lines[3].text).toBe('line 10')
  })

  it('reads a range, and nothing outside the session folder or past the end of the file', () => {
    expect(evidenceSnippet(top, 'service/app/link.rb:28-29')!.lines.map((l) => l.n)).toEqual([25, 26, 27, 28, 29, 30])
    expect(evidenceSnippet(top, join(tmpdir(), 'outside.rb') + ':1')).toBeNull()
    expect(evidenceSnippet(top, 'app/link.rb:99')).toBeNull()
    expect(evidenceSnippet(top, 'no line number here')).toBeNull()
  })
})

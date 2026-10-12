// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { editedFiles } from '../transcript'

describe("a session's edited files", () => {
  it('reads the files a session edited or wrote from its transcript, once each, in order', () => {
    const t = join(mkdtempSync(join(tmpdir(), 't-')), 's.jsonl')
    const use = (name: string, input: object): string => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
    writeFileSync(t, [use('Read', { file_path: '/r/x' }), use('Edit', { file_path: '/r/a.rb' }), use('Write', { file_path: '/n/new.md' }), use('MultiEdit', { file_path: '/r/a.rb' })].join('\n') + '\n')
    expect(editedFiles(t)).toEqual(['/r/a.rb', '/n/new.md'])
  })
})

// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { findFiles, grep, readCode, reposIn } from '../code-search'

// A folder of repos (like ~/Documents/Project): two repos and a plain folder that is not searched.
let folder: string
const repo = (name: string, files: Record<string, string>): string => {
  const root = join(folder, name)
  mkdirSync(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true })
    writeFileSync(join(root, p), text)
  }
  return root
}
let api: string
let web: string
beforeAll(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'code-search-')))
  api = repo('api', { 'app/models/invite_link.rb': 'class InviteLink\n  def expired?\n    false\n  end\nend\n', '.gitignore': 'log/\n', 'log/dev.log': 'InviteLink in a log\n' })
  web = repo('web', { 'src/link.ts': 'export const inviteLink = 1\n' })
  mkdirSync(join(folder, 'notes'))
  writeFileSync(join(folder, 'notes', 'invites.md'), 'InviteLink notes\n')
})

describe('code search', () => {
  it('searches each repo inside a folder of repos, not plain folders', async () => {
    expect((await reposIn(folder)).sort()).toEqual([api, web])
    expect(await reposIn(api)).toEqual([api])
  })

  it('finds file names, file-name matches first, skipping ignored files', async () => {
    expect(await findFiles(folder, 'link')).toEqual({ hits: [{ root: web, path: 'src/link.ts' }, { root: api, path: 'app/models/invite_link.rb' }], truncated: false })
    expect(await findFiles(folder, 'link', '*.rb')).toEqual({ hits: [{ root: api, path: 'app/models/invite_link.rb' }], truncated: false })
  })

  it('finds lines, case-insensitive unless asked, with whole word and regex', async () => {
    expect(await grep(folder, { q: 'invitelink' })).toEqual({
      hits: [{ root: api, path: 'app/models/invite_link.rb', line: 1, text: 'class InviteLink' }, { root: web, path: 'src/link.ts', line: 1, text: 'export const inviteLink = 1' }],
      truncated: false
    })
    expect((await grep(folder, { q: 'InviteLink', caseSensitive: true })).hits.map((h) => h.path)).toEqual(['app/models/invite_link.rb'])
    expect((await grep(folder, { q: 'expire', word: true })).hits).toEqual([])
    expect((await grep(folder, { q: 'def \\w+\\?', regex: true })).hits.map((h) => h.line)).toEqual([2])
  })

  it('reads a file only inside a repo of the folder', async () => {
    expect(await readCode(folder, web, 'src/link.ts')).toBe('export const inviteLink = 1\n')
    await expect(readCode(folder, web, '../api/app/models/invite_link.rb')).rejects.toThrow(/outside the repo/)
    await expect(readCode(folder, join(folder, 'notes'), 'invites.md')).rejects.toThrow(/not a repo of the open folder/)
  })
})

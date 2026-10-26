// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ignored, RepoWatch } from '../repo-watch'

// SIGNOFF-39-PROCS/D4: git runs after a file change, not on a timer.
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let dir = ''
let w: RepoWatch | null = null
afterEach(() => {
  w?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('repo watch', () => {
  it('ignores node_modules and git churn, not edits or commits', () => {
    expect(['node_modules/x.js', 'web/node_modules', '.git/objects/ab/cd', '.git/logs/HEAD', '.git/index.lock', 'src/a.ts', '.git/HEAD', '.git/refs/heads/main', 'my_node_modules.ts'].map(ignored))
      .toEqual([true, true, true, true, true, false, false, false, false])
  })

  it('reports a burst of edits once, after they settle', async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rw-')))
    const seen: string[] = []
    w = new RepoWatch((root) => seen.push(root), 300)
    w.set([dir])
    // FSEvents needs a moment, and can still report the folder's own creation late: start clean after it.
    await wait(600)
    seen.length = 0
    writeFileSync(join(dir, 'a.ts'), '1')
    writeFileSync(join(dir, 'b.ts'), '2')
    await wait(900)
    expect(seen).toEqual([dir])
  })

  it('stops watching roots no longer listed', async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rw-')))
    const seen: string[] = []
    w = new RepoWatch((root) => seen.push(root), 50)
    w.set([dir])
    expect(w.roots()).toEqual([dir])
    w.set([])
    expect(w.roots()).toEqual([])
    writeFileSync(join(dir, 'a.ts'), '1')
    await wait(300)
    expect(seen).toEqual([])
  })
})

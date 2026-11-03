// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { watch, type FSWatcher } from 'fs'

// Repos watched for file changes (SIGNOFF-39-PROCS/D4): macOS reports them (FSEvents), so git runs after an edit,
// not on a timer.
// - changes settle for SETTLE_MS first, so a save or checkout of many files is one run;
// - git's own churn (objects, logs, lock files) and node_modules are ignored;
// - a watch that fails is dropped with a log line; the 60 s re-read still covers its repo.
const SETTLE_MS = 500
const IGNORED = /(^|\/)(node_modules|\.git\/objects|\.git\/logs)(\/|$)|\.lock$/
export const ignored = (file: string): boolean => IGNORED.test(file)

export class RepoWatch {
  private watchers = new Map<string, FSWatcher>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(private onChange: (root: string) => void, private settleMs = SETTLE_MS) {}

  // Watches exactly these roots: new ones start, ones no longer listed stop.
  set(roots: Iterable<string>): void {
    const want = new Set(roots)
    for (const r of [...this.watchers.keys()]) if (!want.has(r)) this.drop(r)
    for (const r of want) if (!this.watchers.has(r)) this.add(r)
  }

  roots(): string[] {
    return [...this.watchers.keys()]
  }

  close(): void {
    this.set([])
  }

  private add(root: string): void {
    try {
      const w = watch(root, { recursive: true }, (_event, file) => {
        if (file && ignored(String(file))) return
        clearTimeout(this.timers.get(root))
        this.timers.set(root, setTimeout(() => {
          this.timers.delete(root)
          this.onChange(root)
        }, this.settleMs))
      })
      w.on('error', (e) => {
        console.error(`watching ${root} stopped:`, e.message)
        this.drop(root)
      })
      this.watchers.set(root, w)
    } catch (e) {
      console.error(`could not watch ${root}:`, (e as Error).message)
    }
  }

  private drop(root: string): void {
    this.watchers.get(root)?.close()
    this.watchers.delete(root)
    clearTimeout(this.timers.get(root))
    this.timers.delete(root)
  }
}

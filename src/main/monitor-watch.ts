// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import type { Store } from './store'
import { addEvent, getSetup, liveMonitors, setStage, type Monitor } from '../shared/monitors'
import { recordRequest, requestsOf } from '../shared/review-requests'
import type { Setup } from './monitor-setup'

// The monitor watcher (SIGNOFF-23 step 3, D1 hybrid): follows each live monitor through GitHub with the gh CLI, at
// no token cost, and moves its stage:
//   ci      → the pull request's checks; all done and green → merge. A failing check tells the session (not an incident).
//   merge   → waits for the merge (or a close without merging → done).
//   deploy  → waits for a successful production deploy run that contains the merge commit (D5) → stable.
//             A failed deploy run that contains it → incident.
//   stable  → for the window you picked: a workflow on main that was green before the merge and fails on a commit that
//             contains it → incident. Window over with nothing new failing → done.
// Error checks (Scout and others) and the review message are later steps; they hook in through `on`.
export type Gh = (args: string[]) => Promise<string>
export type Check = { name: string; status: string; conclusion: string | null }
export type Run = { databaseId: number; workflowName: string; headSha: string; createdAt: string; status: string; conclusion: string | null }
export type WatchEvents = {
  ciGreen: (m: Monitor) => void                       // review request (step 5)
  ciRed: (m: Monitor, failed: string[]) => void       // tell the owner session
  incident: (m: Monitor, what: string) => void        // fire fighting (step 7)
  // Once per monitor, when the app first sees it (its pull request exists): the Story is written (SIGNOFF-24/D3).
  started?: (m: Monitor) => void
  // The error check (step 6), at the monitor's interval during the stability window. Null when the app has none.
  checkErrors?: (m: Monitor) => Promise<{ newErrors: boolean; summary: string }>
  // The approval check (SIGNOFF-31/D13): reads the review-request threads, every 15 min while the PR waits for its merge.
  checkApproval?: (m: Monitor) => Promise<unknown>
}
export const THREAD_EVERY_MS = 15 * 60_000

// gh, optionally in a folder (then `gh pr view` with no number means that folder's current branch).
export const ghIn = (cwd: string | undefined, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile('gh', args, { cwd, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, out, errOut) => (err ? reject(new Error(`gh ${args.slice(0, 3).join(' ')}: ${(errOut || err.message).trim()}`)) : resolve(out)))
})
export const gh: Gh = (args) => ghIn(undefined, args)

const failedOf = (checks: Check[]): string[] => checks.filter((c) => ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'ERROR'].includes((c.conclusion ?? '').toUpperCase())).map((c) => c.name)
const settled = (checks: Check[]): boolean => checks.every((c) => (c.status ?? '').toUpperCase() === 'COMPLETED')

export class MonitorWatcher {
  private checking = new Map<string, Promise<void>>() // error checks running (minutes each): one per monitor, not awaited by tick
  private reading = new Map<string, Promise<void>>() // approval checks running: one per monitor, not awaited by tick
  private lastRead = new Map<string, number>()
  private ticking = false
  constructor(private db: Store, private gh: Gh, private on: WatchEvents, private deployWorkflow: (repo: string) => string | null, private now = (): number => Date.now()) {}

  // One pass over every live monitor. A failure to reach GitHub is logged on that monitor's timeline and retried next pass.
  async tick(): Promise<void> {
    // A pass still running (slow GitHub) is not overlapped: two passes could both move a monitor and fire its events twice.
    if (this.ticking) return
    this.ticking = true
    try {
      await this.pass()
    } finally {
      this.ticking = false
    }
  }

  // Resolves when the error checks started so far have finished (tests, and a clean quit).
  idle(): Promise<void> {
    return Promise.all([...this.checking.values(), ...this.reading.values()]).then(() => undefined)
  }

  private async pass(): Promise<void> {
    for (const m of liveMonitors(this.db)) {
      if (this.on.started && !this.db.prepare("SELECT 1 FROM monitor_events WHERE monitor_id = ? AND kind = 'story'").get(m.id)) {
        addEvent(this.db, m.id, 'story', 'Writing the Story for this pull request')
        this.on.started(m)
      }
      try {
        await this.step(m)
      } catch (e) {
        addEvent(this.db, m.id, 'error', `Could not check GitHub: ${(e as Error).message.slice(0, 200)}`)
      }
    }
  }

  async step(m: Monitor): Promise<void> {
    if (m.kind === 'change') return m.stage === 'stable' ? this.changeWindow(m) : undefined
    if (m.stage === 'ci' || m.stage === 'merge') return this.pullRequest(m)
    if (m.stage === 'deploy') return this.deploy(m)
    if (m.stage === 'stable') return this.stable(m)
  }

  private async pullRequest(m: Monitor): Promise<void> {
    const pr = JSON.parse(await this.gh(['pr', 'view', String(m.pr), '-R', m.repo, '--json', 'state,mergeCommit,statusCheckRollup,reviewDecision,latestReviews'])) as
      { state: string; mergeCommit: { oid: string } | null; statusCheckRollup: { name?: string; context?: string; status?: string; state?: string; conclusion?: string | null }[]
        reviewDecision?: string | null; latestReviews?: { author?: { login?: string }; state?: string }[] }
    this.approvals(m, pr)
    if (pr.state === 'MERGED' && pr.mergeCommit) {
      setStage(this.db, m.id, 'deploy', `Merged as ${pr.mergeCommit.oid.slice(0, 8)}; waiting for the production deploy`, { merge_sha: pr.mergeCommit.oid })
      return
    }
    if (pr.state === 'CLOSED') return void setStage(this.db, m.id, 'done', 'Closed without merging')
    if (m.stage !== 'ci') return
    const checks: Check[] = pr.statusCheckRollup.map((c) => ({ name: c.name ?? c.context ?? '?', status: c.status ?? (c.state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED'), conclusion: c.conclusion ?? c.state ?? null }))
    const failed = failedOf(checks)
    if (failed.length) {
      const said = this.lastEvent(m.id)
      const text = `CI failed: ${failed.join(', ')}`
      if (said !== text) { addEvent(this.db, m.id, 'ci-red', text); this.on.ciRed(m, failed) }
      return
    }
    if (checks.length && settled(checks)) {
      const next = setStage(this.db, m.id, 'merge', `CI passed (${checks.length} checks)`)
      this.on.ciGreen(next)
    }
  }

  // Approval (SIGNOFF-31/D13): a GitHub approval is recorded at once (free); the review-request threads are read in the
  // background every 15 min while the PR is open and not approved yet.
  private approvals(m: Monitor, pr: { state: string; reviewDecision?: string | null; latestReviews?: { author?: { login?: string }; state?: string }[] }): void {
    const n = m.pr
    if (n === null) return
    const reqs = requestsOf(this.db, m.repo, n)
    if (pr.reviewDecision === 'APPROVED' && !reqs.some((r) => r.app === 'GitHub' && r.state === 'approved')) {
      const by = (pr.latestReviews ?? []).filter((r) => r.state === 'APPROVED').map((r) => r.author?.login).filter(Boolean).join(', ') || null
      recordRequest(this.db, { repo: m.repo, pr: n, app: 'GitHub', place: 'pull request', state: 'approved', by })
      addEvent(this.db, m.id, 'approved', `Approved on GitHub${by ? ` by ${by}` : ''}`)
      return
    }
    if (pr.state !== 'OPEN' || !this.on.checkApproval || this.reading.has(m.id)) return
    if (reqs.some((r) => r.state === 'approved') || !reqs.some((r) => r.app !== 'GitHub')) return
    if (this.now() - (this.lastRead.get(m.id) ?? 0) < THREAD_EVERY_MS) return
    this.lastRead.set(m.id, this.now())
    const run = this.on.checkApproval(m)
      .catch((e: unknown) => addEvent(this.db, m.id, 'error', `Could not check the review thread: ${(e as Error).message.slice(0, 200)}`))
      .then(() => undefined)
      .finally(() => this.reading.delete(m.id))
    this.reading.set(m.id, run)
  }

  // A change watch (SIGNOFF-34/D2): no CI, merge or deploy; only the error checks for its window, from the change time.
  private changeWindow(m: Monitor): void {
    if (this.now() - Date.parse(m.deployed_at!) >= m.window_minutes * 60_000) return void setStage(this.db, m.id, 'done', `Stable for ${m.window_minutes} min after the change`)
    this.startErrorCheck(m)
  }

  private async deploy(m: Monitor): Promise<void> {
    const wf = this.deployWorkflow(m.repo)
    if (!wf) return void setStage(this.db, m.id, 'done', 'Merged; no production deploy workflow is set for this repo, so watching stops here')
    const runs = JSON.parse(await this.gh(['run', 'list', '-R', m.repo, '--workflow', wf, '--limit', '15', '--json', 'databaseId,workflowName,headSha,createdAt,status,conclusion'])) as Run[]
    for (const r of runs.filter((x) => x.status === 'completed').sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!(await this.contains(m.repo, r.headSha, m.merge_sha!))) continue
      if (r.conclusion === 'success') {
        setStage(this.db, m.id, 'stable', `Deployed to production (run ${r.databaseId}); watching for ${m.window_minutes} min`, { deployed_at: r.createdAt })
        return
      }
      const what = `The production deploy that contains this change failed (run ${r.databaseId}: ${r.conclusion})`
      this.on.incident(setStage(this.db, m.id, 'incident', what), what)
      return
    }
  }

  private async stable(m: Monitor): Promise<void> {
    const runs = JSON.parse(await this.gh(['run', 'list', '-R', m.repo, '--branch', 'main', '--limit', '40', '--json', 'databaseId,workflowName,headSha,createdAt,status,conclusion'])) as Run[]
    const done = runs.filter((r) => r.status === 'completed')
    const before = (wf: string): Run | undefined => done.filter((r) => r.workflowName === wf && r.createdAt < m.deployed_at!).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    for (const r of done.filter((x) => x.createdAt >= m.deployed_at! && x.conclusion === 'failure')) {
      // Only a failure that is new: the same workflow was green before this change went out.
      if (before(r.workflowName)?.conclusion !== 'success') continue
      if (!(await this.contains(m.repo, r.headSha, m.merge_sha!))) continue
      const what = `${r.workflowName} started failing after the deploy (run ${r.databaseId})`
      this.on.incident(setStage(this.db, m.id, 'incident', what), what)
      return
    }
    if (this.now() - Date.parse(m.deployed_at!) >= m.window_minutes * 60_000) return void setStage(this.db, m.id, 'done', `Stable for ${m.window_minutes} min after the deploy`)
    this.startErrorCheck(m)
  }

  // Check now (SIGNOFF-34-WATCH/D5): an error check at once, outside the timer. One at a time per monitor: a check
  // already running is returned instead. Only while watching production; before the deploy there is no "after".
  checkNow(m: Monitor): Promise<void> {
    if (!this.on.checkErrors) throw new Error('no error check is set up')
    if (m.stage !== 'stable') throw new Error(`${m.id} is not watching production (${m.stage})`)
    const running = this.checking.get(m.id)
    if (running) return running
    const run = this.errorCheck(m, this.on.checkErrors)
    this.checking.set(m.id, run)
    return run
  }

  // Runs the error check when one is due: the first at one interval after the deploy, then every interval.
  private startErrorCheck(m: Monitor): void {
    if (!this.on.checkErrors || this.checking.has(m.id)) return
    const last = (this.db.prepare("SELECT at FROM monitor_events WHERE monitor_id = ? AND kind IN ('error-check','error-check-failed') ORDER BY id DESC LIMIT 1").get(m.id) as { at: string } | undefined)?.at ?? m.deployed_at!
    if (this.now() - Date.parse(last) < m.check_minutes * 60_000) return
    this.checking.set(m.id, this.errorCheck(m, this.on.checkErrors))
  }

  private async errorCheck(m: Monitor, check: NonNullable<WatchEvents['checkErrors']>): Promise<void> {
    try {
      const v = await check(m)
      if (v.newErrors) {
        const what = `New production errors after the ${m.kind === 'change' ? 'change' : 'deploy'}: ${v.summary}`
        this.on.incident(setStage(this.db, m.id, 'incident', what), what)
      } else addEvent(this.db, m.id, 'error-check', `Errors checked: ${v.summary}`)
    } catch (e) {
      addEvent(this.db, m.id, 'error-check-failed', `Error check failed: ${(e as Error).message.slice(0, 200)}`)
    } finally {
      this.checking.delete(m.id)
    }
  }

  // Does `head` contain `commit`? GitHub's compare says "identical" or "ahead" when it does.
  private async contains(repo: string, head: string, commit: string): Promise<boolean> {
    if (head === commit) return true
    const status = (await this.gh(['api', `repos/${repo}/compare/${commit}...${head}`, '--jq', '.status'])).trim()
    return status === 'identical' || status === 'ahead'
  }

  private lastEvent(id: string): string | undefined {
    return (this.db.prepare('SELECT text FROM monitor_events WHERE monitor_id = ? ORDER BY id DESC LIMIT 1').get(id) as { text: string } | undefined)?.text
  }
}

// The repo's production deploy workflow: your choice if you made one, else what the setup check found. The check may
// name it "Deploy … (.github/workflows/deploy.yml)": the file name is what gh takes.
export function deployWorkflowOf(db: Store, repo: string): string | null {
  const s = getSetup<Setup & { chosen: { deployWorkflow?: string } | null }>(db, repo)
  const raw = s?.chosen?.deployWorkflow ?? s?.found.deploy.workflow ?? null
  if (!raw) return null
  const file = /\.github\/workflows\/([\w.-]+\.ya?ml)/.exec(raw)
  return file ? file[1] : raw.trim()
}

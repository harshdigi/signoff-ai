// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { answerApproval, leaveToTerminal, type Answer } from '../shared/approvals'
import { renameSession, setParent, setRemoved } from '../shared/board'
import { readCatalog } from './catalog'
import { search } from '../shared/memory'
import { getSettings, saveSettings, type Settings } from './settings'
import { skillDirs } from './skilldirs'
import { createSkill, type NewSkill } from './skillwriter'
import { appFiles } from './paths'
import { disableIntegration, enableIntegration, integrationPlan } from './integration'
import { syncBoard } from './store/import-board'
import { resetStore } from './store'
import { evidenceSnippet } from './evidence'
import { addCase, removeCase, setCase, type CaseStatus } from '../shared/testplan'
import { addComment, editComment, removeComment, sendComments } from '../shared/comments'
import { getSetup } from '../shared/monitors'
import { repoOfFolder, runSetup } from './monitor-setup'
import { editedFiles, findTranscript, listConversations, shellDirs } from './transcript'
import { deleteWorkflow, getWorkflow, listWorkflows, saveWorkflow, teamLine, type WorkflowInput } from './workflows'
import type { ChatImage, ChatManager, Mode } from './chat'
import type { RouteChoice } from './context'
import type { Store } from './store'
import { detectAll } from './tasks'
import { customRuns, removeRun } from './runs'
import { impact } from './impact'
import { checkSetup, gitInstall, installCommand, tmuxInstall } from './setup'
import { addArgs, CATALOG, configured, CONNECTORS, CONNECTORS_URL, parseMcpList, SCOPES, specFor, type AddSpec, type Scope } from './integrations'
import { anchorsFor, anchorStatus, findFlowDocs, generatePrompt, indexDocs, readDoc, reposNear, touchedDocs, verifyDocs } from './flows'
import { allowedRoots, findFiles, grep, readCode, resolveRef, type CodeQuery } from './code-search'
import type { Pipeline } from './pipeline'
import type { Teams } from './teams'
import { adoptTeam } from '../shared/team'
import { updateSubtask, type SubtaskState } from '../shared/tickets'
import { detectFramework, listSpecs, relatedSpecs, type TestRunner } from './testing'
import { inUserShell, type TerminalManager } from './terminals'
import { getWorkspace, isTrusted, openFolder, review, rootsOf, setFileDiff, setTrust, tryGit, type ChangeSet, type DiffMode } from './workspace'
import { markReviewed, scoped, SCOPES as REVIEW_SCOPES, type Scope as ReviewScope, type Scoped } from './scopes'
import { sendTo } from './window-send'
import { openExternalSafely } from './security'

// The IDE channels: folder, changes, diffs, tasks, skills catalog, chat and permission answers.
// Chats and tasks only run in a folder the user trusted (IDE/D12).
// What the review list shows: whose changes (session or the open folder), which scope, and for Commit, which one.
type View = { session: string | null; scope: ReviewScope; commit?: string | null }

export function registerIdeIpc(db: Store, chat: ChatManager, terms: TerminalManager, tests: TestRunner, pipeline: Pipeline, teams: Teams, window: () => BrowserWindow | null): () => void {
  const folder = (): string => {
    const w = getWorkspace(db)
    if (!w.current) throw new Error('open a folder first')
    return w.current
  }
  const trusted = (): string => {
    const f = folder()
    if (!isTrusted(db, f)) throw new Error('trust this folder first')
    return f
  }

  ipcMain.handle('ws:get', () => getWorkspace(db))
  ipcMain.handle('ws:pick', async () => {
    const w = window()
    const r = w ? await dialog.showOpenDialog(w, { properties: ['openDirectory', 'createDirectory'] }) : null
    return r && !r.canceled && r.filePaths[0] ? openFolder(db, r.filePaths[0]) : getWorkspace(db)
  })
  ipcMain.handle('ws:open', (_e, path: string) => openFolder(db, path))
  ipcMain.handle('ws:trust', (_e, path: string, yes: boolean) => setTrust(db, path, yes))
  // A worktree's base comes from the session working in it, when one says (stacked branches).
  const sessionBase = (root: string): string | null =>
    (db.prepare('SELECT base_branch FROM sessions WHERE cwd = ? AND base_branch IS NOT NULL ORDER BY updated_at DESC').get(root) as { base_branch: string } | undefined)?.base_branch ?? null
  ipcMain.handle('ws:changes', (_e, mode: DiffMode = 'branch') => review(folder(), mode, sessionBase))
  // Code comments (review): drafts are saved here; send types them into the session's chat as one message.
  ipcMain.handle('comments:add', (_e, c: Parameters<typeof addComment>[1]) => addComment(db, c))
  ipcMain.handle('comments:edit', (_e, id: number, text: string) => editComment(db, id, text))
  ipcMain.handle('comments:remove', (_e, id: number) => removeComment(db, id))
  ipcMain.handle('comments:send', (_e, session: string, ids: number[]) => chat.send(session, sendComments(db, session, ids)))
  // Test plan (session page): your own edits; Claude's go through signoff test.
  ipcMain.handle('plan:add', (_e, plan: string, c: { title: string; steps?: string; expected?: string }) => addCase(db, plan, c))
  ipcMain.handle('plan:set', (_e, plan: string, idx: number, f: { status?: CaseStatus; evidence?: string | null; title?: string; steps?: string; expected?: string }) => setCase(db, plan, idx, { ...f, by: 'you' }))
  ipcMain.handle('plan:remove', (_e, plan: string, idx: number) => removeCase(db, plan, idx))
  // Review (Files changed): a scope over the session's repos, wherever its files are (the folder need not be a repo),
  // or over the open folder's repo when no session is selected or it has edited nothing yet.
  // One review list takes about a second of git work, so results are shared:
  // - the same view within LIST_MS reuses the last result (or the one being computed);
  // - opening a diff or marking reviewed only checks the file against a list up to CHECK_MS old.
  const LIST_MS = 2500
  const CHECK_MS = 60_000
  const scopeCache = new Map<string, { at: number; p: Promise<Scoped> }>()
  const scopedFor = (v: View, maxAge = LIST_MS): Promise<Scoped> => {
    const key = JSON.stringify({ session: v.session, scope: v.scope, commit: v.commit ?? null })
    const hit = scopeCache.get(key)
    if (hit && Date.now() - hit.at < maxAge) return hit.p
    const p = computeScoped(v)
    scopeCache.set(key, { at: Date.now(), p })
    p.catch(() => scopeCache.delete(key))
    return p
  }
  const computeScoped = async (v: View): Promise<Scoped> => {
    const s = v.session ? db.prepare('SELECT transcript, cwd, base_branch FROM sessions WHERE id = ?').get(v.session) as { transcript: string | null; cwd: string | null; base_branch: string | null } | undefined : undefined
    const path = v.session ? findTranscript(v.session, s?.transcript ?? null) : null
    const files = path ? editedFiles(path) : []
    if (!REVIEW_SCOPES.includes(v.scope)) throw new Error(`unknown scope ${v.scope}`)
    // The session's own repo or worktree; "whole" when it is a worktree made for this session (team member, subtask).
    const root = s?.cwd && existsSync(s.cwd) ? await tryGit(s.cwd, ['rev-parse', '--show-toplevel']) : null
    const own = root ? { root, whole: !!s?.base_branch || root.includes('/.claude/worktrees/') } : null
    const shellRoots = path ? await rootsOf(shellDirs(path)) : []
    return scoped(db, { folder: folder(), sessionFiles: files.length ? files : null, scope: v.scope, commit: v.commit, sessionBase, own, shellRoots })
  }
  ipcMain.handle('ws:scoped', (_e, v: View) => scopedFor(v))
  // A changed file's set: from the review view it was opened in, else from the folder's worktrees.
  const changedSet = async (root: string, mode: DiffMode, v?: View): Promise<ChangeSet | undefined> =>
    (v ? await scopedFor(v, CHECK_MS) : await review(folder(), mode, sessionBase)).groups.find((g) => g.root === root)
  ipcMain.handle('ws:reviewed', async (_e, v: View, root: string, path: string, on: boolean) => {
    const set = await changedSet(root, 'branch', v)
    const known = set?.files.find((f) => f.path === path)
    if (!set || !known) throw new Error(`not a changed file: ${path}`)
    await markReviewed(db, set, known, on)
    // Show it at once: update the flag in every cached list that has this file, instead of recomputing them.
    for (const c of scopeCache.values()) {
      for (const g of (await c.p.catch(() => null))?.groups ?? []) {
        if (g.root !== root) continue
        for (const f of g.files) if (f.path === path) f.reviewed = on ? 'done' : null
      }
    }
  })
  ipcMain.handle('ws:diff', async (_e, root: string, path: string, mode: DiffMode, v?: View) => {
    // Only files git reports as changed in a known worktree or the review view: the window cannot read arbitrary paths.
    const set = await changedSet(root, mode, v)
    const known = set?.files.find((f) => f.path === path)
    if (!set || !known) throw new Error(`not a changed file: ${path}`)
    return setFileDiff(set, known)
  })

  ipcMain.handle('ws:impact', async (_e, root: string, path: string, mode: DiffMode, v?: View) => {
    const set = await changedSet(root, mode, v)
    const known = set?.files.find((f) => f.path === path)
    if (!set || !known) throw new Error(`not a changed file: ${path}`)
    return impact(set, known, anchorsFor(indexDocs(getSettings(db).flowDocs).anchors, path))
  })

  // Flow docs (IDE/D16 G): which docs the changes touch, one doc with its anchors' status, and the doc folder picker.
  ipcMain.handle('flows:touched', async () => {
    const { anchors } = indexDocs(getSettings(db).flowDocs)
    if (!anchors.length) return []
    const files = (await review(folder(), 'branch', sessionBase)).groups.flatMap((g) => g.files.map((f) => f.path))
    return touchedDocs(anchors, files)
  })
  ipcMain.handle('flows:doc', (_e, rel: string) => {
    const dir = getSettings(db).flowDocs
    const root = getWorkspace(db).current ?? ''
    return { content: readDoc(dir, rel), anchors: indexDocs(dir).anchors.filter((a) => a.doc === rel).map((a) => ({ ...a, status: anchorStatus(a, root) })) }
  })
  ipcMain.handle('flows:list', () => indexDocs(getSettings(db).flowDocs).docs)
  // Flow docs are built in: when none is set, look for one near the open folder and use it (Settings can change it).
  // Returns the folder only when it was just set, so the app can say so once.
  // set: a docs folder just found and set. offer: none found, this folder has repos, and it was not offered before,
  // so the app asks once whether to generate them.
  ipcMain.handle('flows:detect', () => {
    const w = getWorkspace(db)
    const st = getSettings(db)
    if (!w.current || st.flowDocs) return { set: null, offer: false }
    const dir = findFlowDocs(w.current)
    if (dir) {
      saveSettings(db, { flowDocs: dir })
      return { set: dir, offer: false }
    }
    return { set: null, offer: !st.docsOffered.includes(w.current) && reposNear(join(w.current, 'Claude Docs')).length > 0 }
  })
  const offered = (f: string): void => void saveSettings(db, { docsOffered: [...new Set([...getSettings(db).docsOffered, f])] })
  ipcMain.handle('flows:dismissOffer', () => offered(folder()))
  // Generate flow docs: a Claude session in the open folder explores the repos, asks which flows to write (a decision),
  // then writes them into <folder>/Claude Docs (or the docs folder already set). The folder is set as flow docs at once.
  ipcMain.handle('flows:generate', () => {
    const f = trusted()
    const target = getSettings(db).flowDocs || join(f, 'Claude Docs')
    mkdirSync(target, { recursive: true })
    saveSettings(db, { flowDocs: target })
    offered(f)
    const session = chat.create(f, { ticket: 'DOCS', title: 'Flow docs' })
    chat.send(session, generatePrompt({ folder: f, target, guide: join(appFiles().resources, 'flow-docs-guide.md'), repos: reposNear(target) }))
    return session
  })
  ipcMain.handle('flows:verify', () => {
    const dir = getSettings(db).flowDocs
    if (!dir) throw new Error('no flow docs folder is set')
    return verifyDocs(dir)
  })
  ipcMain.handle('ws:pickDir', async () => {
    const w = window()
    const r = w ? await dialog.showOpenDialog(w, { properties: ['openDirectory'] }) : null
    return r && !r.canceled ? r.filePaths[0] ?? null : null
  })

  // Tasks of the open folder and each repo inside it, plus run commands added for them (runs.ts).
  const allTasks = (f: string): ReturnType<typeof detectAll> => detectAll(f, (r) => customRuns(db, r))
  ipcMain.handle('tasks:list', () => allTasks(folder()))
  ipcMain.handle('tasks:removeRun', (_e, root: string, label: string) => removeRun(db, root, label))
  ipcMain.handle('tasks:run', (_e, id: string) => {
    const task = allTasks(trusted()).tasks.find((t) => t.id === id)
    if (!task) throw new Error(`no task ${id}`)
    const info = terms.spawn({ cwd: task.root })
    terms.write(info.id, task.command + '\r')
    return { ...info, title: task.label }
  })

  ipcMain.handle('settings:get', () => getSettings(db))
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => saveSettings(db, patch))
  // Terminal integration (IDE/D19). Turning it on also copies the prototype board's sessions, decisions and reviews in.
  const integrationState = (): string => join(app.getPath('userData'), 'terminal-integration.json')
  // Your login shell decides which file gets the `claude` wrapper; zsh is the macOS default.
  const where = (): { resources: string; shell: string } => ({ resources: appFiles().resources, shell: process.env.SHELL || '/bin/zsh' })
  ipcMain.handle('integration:plan', () => integrationPlan(homedir(), integrationState(), where()))
  ipcMain.handle('integration:enable', () => {
    // The board is found from the prototype's hooks, so read it before they are replaced; copy only once that worked.
    const board = integrationPlan(homedir(), integrationState(), where()).prototypeBoard
    const files = appFiles()
    const plan = enableIntegration(homedir(), integrationState(), { node: process.execPath, cli: files.cli, resources: files.resources, db: db.name, shell: where().shell })
    return { plan, copied: board ? syncBoard(db, board) : null }
  })
  ipcMain.handle('integration:disable', () => disableIntegration(homedir(), integrationState(), where()))
  // Tests run in a worktree git lists for the open folder (IDE/D16 E), or in a git repo inside the open folder
  // (a session's files may live in one when the folder itself is not a repo). Nothing outside the folder.
  const worktree = async (root: string): Promise<{ root: string; changed: string[] }> => {
    const inside = root.startsWith(folder() + '/')
    const set = (await review(folder(), 'branch', sessionBase)).groups.find((g) => g.root === root) ??
      (inside ? (await review(root, 'branch', sessionBase)).groups.find((g) => g.root === root) : undefined)
    if (!set) throw new Error(`not a worktree of this folder: ${root}`)
    return { root, changed: set.files.filter((f) => f.status !== 'deleted').map((f) => f.path) }
  }
  ipcMain.handle('tests:info', async (_e, root: string) => {
    const w = await worktree(root)
    const fw = detectFramework(root)
    if (!fw) return { framework: null, specs: [], related: [] }
    const specs = await listSpecs(root, fw)
    return { framework: fw, specs, related: relatedSpecs(fw, w.changed, specs) }
  })
  ipcMain.handle('tests:run', async (_e, root: string, target: string) => {
    trusted()
    await worktree(root)
    const fw = detectFramework(root)
    const m = /^(.+?)(?::(\d+))?$/.exec(target)
    if (!fw || !m || !(await listSpecs(root, fw)).includes(m[1])) throw new Error(`not a spec here: ${target}`)
    return tests.start(root, fw, target)
  })
  // Several spec files in one run (Test plan → Specs). Each must be a spec git knows in that repo.
  ipcMain.handle('tests:runMany', async (_e, root: string, files: string[]) => {
    trusted()
    await worktree(root)
    const fw = detectFramework(root)
    if (!fw) throw new Error(`no test framework found in ${root}`)
    const known = new Set(await listSpecs(root, fw))
    const bad = files.filter((f) => !known.has(f))
    if (!files.length || bad.length) throw new Error(`not specs here: ${bad.join(', ') || '(none given)'}`)
    return tests.start(root, fw, files)
  })
  ipcMain.handle('tests:runs', () => tests.list())
  // Ticket pipeline (IDE/D16 C). Your own start-ticket / create-pr skills are used when present.
  // Nearby folders whose skills load with --add-dir (Settings: nearbySkills).
  const nearby = (): string[] => {
    const f = getWorkspace(db).current
    return f && getSettings(db).nearbySkills ? skillDirs(f).dirs : []
  }
  const hasRole = (role: string): boolean => readCatalog(getWorkspace(db).current, undefined, nearby()).some((c) => c.role === role)
  ipcMain.handle('ticket:start', (_e, key: string, title: string, description: string) =>
    pipeline.start(trusted(), key, { title, description, hasStartSkill: hasRole('start-ticket') }))
  ipcMain.handle('ticket:startSubtask', (_e, key: string, idx: number) => {
    trusted()
    return pipeline.startSubtask(key, idx)
  })
  ipcMain.handle('ticket:openPr', (_e, key: string, idx: number) => pipeline.openPr(key, idx, hasRole('create-pr')))
  ipcMain.handle('ticket:setStatus', (_e, key: string, idx: number, status: SubtaskState) => updateSubtask(db, key, idx, { status }))
  ipcMain.handle('memory:search', (_e, q: string) => search(db, q, { limit: 40 }))
  // Code search (Search tab), in the repos of the open folder.
  ipcMain.handle('code:files', (_e, q: string, include?: string) => findFiles(folder(), q, include))
  ipcMain.handle('code:grep', (_e, o: CodeQuery) => grep(folder(), o))
  ipcMain.handle('code:read', (_e, root: string, path: string) => readCode(folder(), root, path))
  // A code reference in a message: looked up in the session's own repo or worktree first, then the folder's repos.
  ipcMain.handle('code:resolve', async (_e, ref: string, session: string | null) => {
    const roots = await allowedRoots(folder())
    const cwd = session ? (db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(session) as { cwd: string | null } | undefined)?.cwd : null
    const own = cwd ? await tryGit(cwd, ['rev-parse', '--show-toplevel']) : null
    return resolveRef(own && roots.includes(own) ? [own, ...roots.filter((r) => r !== own)] : roots, ref)
  })
  // First-run setup (IDE/D16 H). Each action runs in a visible terminal tab, only when the user clicks.
  ipcMain.handle('setup:check', () => checkSetup())
  ipcMain.handle('setup:installClaude', () => {
    const c = installCommand(process.platform)
    return { ...terms.spawn({ command: c.shell, args: c.args }), title: 'Install Claude Code' }
  })
  ipcMain.handle('setup:login', () => ({ ...terms.spawn({ command: 'claude', args: ['auth', 'login'] }), title: 'Sign in to Claude' }))
  ipcMain.handle('setup:installTmux', async () => {
    const t = tmuxInstall(process.platform, (await checkSetup()).tmux.brew)
    if (!t.command) { openExternalSafely(t.url); return null }
    return { ...terms.spawn(inUserShell(t.command)), title: 'Install tmux' }
  })
  ipcMain.handle('setup:installGit', () => {
    const g = gitInstall(process.platform)
    if (!g.command) { openExternalSafely(g.url); return null }
    return { ...terms.spawn(inUserShell(g.command)), title: 'Install git' }
  })
  // Connected tools: checked live, only when you press refresh in the Tools view (SIGNOFF-17/D1). `claude mcp list` starts
  // every configured server to check it, so it never runs by itself. Run in the open folder: local and project servers
  // belong to it.
  ipcMain.handle('tools:status', () => new Promise((resolve, reject) => {
    execFile('claude', ['mcp', 'list'], { cwd: getWorkspace(db).current ?? homedir(), timeout: 90_000 }, (err, out) => {
      if (err && !out) return reject(new Error(`could not check the MCP servers: ${err.message}`))
      resolve({ servers: parseMcpList(out), at: new Date().toISOString() })
    })
  }))
  // Integrations: connect through Claude Code's own `claude mcp` commands, in a visible terminal in the open folder
  // (local and project scope belong to that folder).
  ipcMain.handle('integrations:list', () => ({
    catalog: CATALOG.map((c) => ({ ...c, fields: c.fields.map(({ key, label, secret }) => ({ key, label, secret })) })),
    connectors: CONNECTORS, connectorsUrl: CONNECTORS_URL, scopes: SCOPES,
    configured: configured(getWorkspace(db).current)
  }))
  const inFolder = (scope: Scope): string | undefined => {
    if (scope === 'user') return getWorkspace(db).current ?? undefined
    return trusted()
  }
  ipcMain.handle('integrations:add', (_e, req: { catalogId?: string; scope: Scope; values?: Record<string, string>; name?: string; custom?: AddSpec }) => {
    const entry = req.catalogId ? CATALOG.find((c) => c.id === req.catalogId) : undefined
    if (req.catalogId && !entry) throw new Error(`unknown integration ${req.catalogId}`)
    const spec = entry ? specFor(entry, req.scope, req.values ?? {}, req.name || entry.id) : req.custom
    if (!spec) throw new Error('nothing to add')
    return { ...terms.spawn({ command: 'claude', args: addArgs(spec), cwd: inFolder(spec.scope) }), title: `Connect ${spec.name}` }
  })
  ipcMain.handle('integrations:login', (_e, name: string) => {
    if (!/^[A-Za-z0-9_. -]{1,80}$/.test(name)) throw new Error('bad server name')
    return { ...terms.spawn({ command: 'claude', args: ['mcp', 'login', name], cwd: getWorkspace(db).current ?? undefined }), title: `Sign in: ${name}` }
  })
  ipcMain.handle('integrations:remove', (_e, name: string, scope: Scope) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || !SCOPES.includes(scope)) throw new Error('bad server name or scope')
    return { ...terms.spawn({ command: 'claude', args: ['mcp', 'remove', name, '--scope', scope], cwd: inFolder(scope) }), title: `Remove ${name}` }
  })
  ipcMain.handle('integrations:openConnectors', () => openExternalSafely(CONNECTORS_URL))
  ipcMain.handle('catalog:list', () => readCatalog(getWorkspace(db).current, undefined, nearby()))
  ipcMain.handle('catalog:create', (_e, s: NewSkill) => createSkill({ ...s, folder: getWorkspace(db).current }))
  // Siri & Shortcuts: the exact commands for this install (paths differ between dev and the packaged app).
  ipcMain.handle('shortcuts:info', () => {
    const f = appFiles()
    const ask = `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${f.cli}" ask`
    return { ask, runUrl: 'decision-ide://run?skill=', askUrl: 'decision-ide://ask?text=' }
  })
  ipcMain.handle('catalog:nearby', () => {
    const f = getWorkspace(db).current
    return f ? { on: getSettings(db).nearbySkills, ...skillDirs(f) } : { on: getSettings(db).nearbySkills, dirs: [], skipped: [] }
  })

  ipcMain.handle('chat:history', (_e, session: string) => chat.history(session))
  ipcMain.handle('chat:status', (_e, session: string) => chat.status(session))
  ipcMain.handle('chat:send', (_e, session: string | null, text: string, images: ChatImage[] = [], choice?: RouteChoice) => chat.routeAndSend(session, text, trusted(), images, choice))
  // A new session with a team setup (IDE/D21); its Claude terminal starts with the first message, like any chat.
  ipcMain.handle('chat:create', (_e, workflow: string) => {
    const w = getWorkflow(db, workflow)
    return chat.create(trusted(), { workflow: w.id === 'solo' ? null : w.id })
  })
  ipcMain.handle('split:start', (_e, decision: string, keep: number[]) => teams.start(decision, keep))
  // The code lines behind a decision's evidence, read from that decision's session folder only.
  ipcMain.handle('evidence:snippet', (_e, session: string, ref: string) => {
    const s = db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(session) as { cwd: string | null } | undefined
    return s?.cwd ? evidenceSnippet(s.cwd, ref) : null
  })
  // Resume (Sessions → Resume…): Claude Code's saved conversations for the open folder.
  ipcMain.handle('chat:conversations', () => {
    const f = getWorkspace(db).current
    return f ? listConversations(f) : []
  })
  ipcMain.handle('chat:resume', (_e, id: string, title: string) => chat.resume(id, trusted(), title))
  // Reset (Settings): ends the app's sessions, empties the store (a backup copy is kept), deletes pasted images,
  // then restarts the app. Claude Code's own conversations, your code and terminal integration are not touched.
  ipcMain.handle('app:reset', () => {
    chat.stopAll()
    const data = app.getPath('userData')
    resetStore(db, join(data, `board.backup-${Date.now()}.db`))
    for (const d of ['attachments', 'open']) rmSync(join(data, d), { recursive: true, force: true })
    app.relaunch()
    app.exit(0)
  })
  // Open in Terminal: a .command file that attaches to the session; macOS opens it in your default terminal app.
  ipcMain.handle('session:openTerminal', async (_e, session: string) => {
    const dir = join(app.getPath('userData'), 'open')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${session}.command`)
    writeFileSync(file, `#!/bin/sh\nexec tmux ${chat.attachArgs(session).map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}\n`)
    chmodSync(file, 0o755)
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  })
  ipcMain.handle('workflows:list', () => listWorkflows(db).map((w) => ({ ...w, line: teamLine(w) })))
  ipcMain.handle('workflows:save', (_e, w: WorkflowInput) => saveWorkflow(db, w))
  ipcMain.handle('workflows:delete', (_e, id: string) => deleteWorkflow(db, id))
  // A team setup a session proposed (signoff team propose), approved on its card: saved, and that session leads it.
  ipcMain.handle('workflows:adopt', (_e, decision: string) => adoptTeam(db, decision))
  // Files for @-mentions in the chat: tracked and new files of the chat's folder, from git.
  ipcMain.handle('chat:files', async (_e, session: string | null) => {
    const cwd = session ? (db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(session) as { cwd: string } | undefined)?.cwd : getWorkspace(db).current
    if (!cwd) return []
    try {
      const { stdout } = await promisify(execFile)('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd, maxBuffer: 64 * 1024 * 1024 })
      return stdout.split('\n').filter(Boolean).slice(0, 20000)
    } catch {
      return [] // not a git folder: no file suggestions
    }
  })
  ipcMain.handle('chat:handoff', (_e, session: string) => chat.handoff(session, 'manual'))
  // Rename / remove / restore a chat or session. Removing a chat also stops its Claude process.
  // Monitor setup (SIGNOFF-23): a read-only Claude check of what the open folder's repo can use for monitoring.
  ipcMain.handle('monitor:setup', () => {
    const f = getWorkspace(db).current
    if (!f) throw new Error('open a folder first')
    return runSetup(db, f, { ...process.env, DECISION_IDE_DB: db.name, DECISION_IDE_APP: '1' })
  })
  ipcMain.handle('monitor:getSetup', () => {
    const f = getWorkspace(db).current
    if (!f) return null
    const repo = repoOfFolder(f)
    return { repo, setup: getSetup(db, repo) }
  })
  ipcMain.handle('session:rename', (_e, id: string, title: string) => renameSession(db, id, title))
  ipcMain.handle('session:setParent', (_e, id: string, parent: string | null) => setParent(db, id, parent))
  ipcMain.handle('session:remove', (_e, id: string) => {
    chat.stop(id)
    setRemoved(db, id, true)
  })
  ipcMain.handle('session:restore', (_e, id: string) => setRemoved(db, id, false))
  ipcMain.handle('chat:interrupt', (_e, session: string) => chat.interrupt(session))
  ipcMain.handle('chat:setMode', (_e, session: string, mode: Mode) => chat.setMode(session, mode))
  ipcMain.handle('chat:choose', (_e, session: string, question: string, option: number) => chat.choose(session, question, option))
  // Terminal chats: Shift+Tab cycles Claude Code's mode; model and effort are typed as /model and /effort.
  ipcMain.handle('chat:cycleMode', (_e, session: string) => chat.cycleMode(session))
  ipcMain.handle('chat:command', (_e, session: string, line: string) => chat.command(session, line))
  ipcMain.handle('chat:terminal', (_e, session: string) => chat.terminalOf(session))
  ipcMain.handle('approval:terminal', (_e, id: string) => leaveToTerminal(db, id))
  ipcMain.handle('approval:answer', (_e, id: string, ans: Answer) => answerApproval(db, id, ans))

  const offEvent = chat.onEvent((e) => sendTo(window(), 'chat:event', e))
  const offStatus = chat.onStatus((s) => sendTo(window(), 'chat:status', s))
  const offHandoff = chat.onHandoff((h) => sendTo(window(), 'chat:handoff', h))
  const offTests = tests.onResult((r) => sendTo(window(), 'tests:result', r))

  // Changes view: re-read git every 2 s after the previous read finished (a big repo can take seconds),
  // and tell the window only when something differs.
  let last = ''
  let stopped = false
  let timer: NodeJS.Timeout
  const poll = async (): Promise<void> => {
    const cur = getWorkspace(db).current
    if (cur) {
      try {
        const snap = JSON.stringify(await review(cur, 'branch', sessionBase))
        if (snap !== last) {
          last = snap
          sendTo(window(), 'ws:changed')
        }
      } catch (e) {
        console.error('reading git changes failed:', (e as Error).message)
      }
    }
    if (!stopped) timer = setTimeout(poll, 2000)
  }
  timer = setTimeout(poll, 0)
  return () => {
    stopped = true
    clearTimeout(timer)
    offEvent()
    offStatus()
    offHandoff()
    offTests()
  }
}

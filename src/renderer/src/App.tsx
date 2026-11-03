// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useBoard } from './board/useBoard'
import ChatPanel, { type ChatHandle } from './chat/ChatPanel'
import BottomPanel from './ide/BottomPanel'
import Editor, { FileDiffView } from './ide/Editor'
import { ordered } from './ide/review-order'
import { useChanges, useFolderData, useScoped, useWorkspace } from './ide/hooks'
import Palette, { type Command } from './ide/Palette'
import Settings from './ide/Settings'
import TestsView from './ide/Tests'
import { StartTicket } from './ide/Ticket'
import SearchView from './ide/Search'
import SetupScreen, { useSetup } from './ide/Setup'
import IntegrationsView from './ide/Integrations'
import ShortcutsHelp from './ide/Shortcuts'
import { DecisionsSideView, SessionsView, SkillsView, type View } from './ide/Sidebar'
import ReviewList from './ide/Review'
import RunView from './ide/Run'
import SessionPage, { type SessionTab } from './ide/SessionPage'
import WorkflowsView from './ide/Workflows'
import ResumePicker from './ide/Resume'
import { RefsProvider, type Nav } from './board/Refs'
import Toolbar from './ide/Toolbar'
import { Icon } from './ide/icons'
import { onYou } from './board/types'
import { base, errText, itemKey, tabKey, type CatalogItem, type DiffMode, type EditorTab, type Pin, type Task, type Term, type Workflow, type ReviewView, type Scope } from './ide/types'
import './ide/monaco'

// The IDE window (IDE/D8, IDE/D20): toolbar, activity bar + sidebar, editor tabs with the session page, terminal panel, status bar.
const REVIEW_PROMPT = 'Review my uncommitted changes (git diff, including untracked files). Report bugs, risks and convention problems with file:line. Do not edit any files.'

export default function App(): React.JSX.Element {
  const { board, error, refresh } = useBoard()
  const { ws, setWs } = useWorkspace()
  const folder = ws?.current ?? null
  const trusted = !!folder && !!ws?.trusted.includes(folder)
  // The folder-wide change list (status bar, flow docs, worktree diffs) is always the whole branch; Review has its own scopes.
  const diffMode: DiffMode = 'branch'
  const { changes, error: changesError } = useChanges(folder, diffMode)
  const changedCount = changes?.groups.reduce((n, g) => n + g.files.length, 0) ?? 0
  const mainSet = changes?.groups.find((g) => g.main)
  // Flow docs whose anchors point at changed files (IDE/D16 G); empty when no docs folder is set.
  const [docs, setDocs] = useState<{ doc: string; headings: string[]; files: string[] }[]>([])
  useEffect(() => {
    if (folder) window.api.flows.touched().then(setDocs, () => setDocs([]))
  }, [folder, changes])
  const { tasks, catalog, reloadCatalog, reloadTasks } = useFolderData(folder)
  // Tell main whether the window is on screen: its background checks pause while it is not (SIGNOFF-38-PERF/D5).
  useEffect(() => {
    const report = (): void => window.api.visible(!document.hidden)
    report()
    document.addEventListener('visibilitychange', report)
    return () => document.removeEventListener('visibilitychange', report)
  }, [])
  const chat = useRef<ChatHandle>(null)

  const [view, setView] = useState<View>('sessions')
  const [sidebar, setSidebar] = useState(true)
  const [tabs, setTabs] = useState<EditorTab[]>([{ kind: 'session' }, { kind: 'decisions' }])
  const [active, setActiveTab] = useState('session')
  // The page under opened files (a session, or all decisions): closing the file shown goes back to it.
  const [page, setPage] = useState<'session' | 'decisions'>('session')
  const setActive = useCallback((k: string): void => {
    if (k === 'session' || k === 'decisions') setPage(k)
    setActiveTab(k)
  }, [])
  const [chatId, setChatId] = useState<string | null>(null)
  const [sessionTab, setSessionTab] = useState<SessionTab>('chat')
  // Review (Files changed): the scope picked, over the selected session's repos (or the open folder's repo).
  const [scope, setScope] = useState<{ scope: Scope; commit?: string | null }>({ scope: 'session' })
  const reviewView: ReviewView = { session: chatId, scope: chatId || scope.scope !== 'session' ? scope.scope : 'ticket', commit: scope.commit ?? null }
  // Only while the review list or a diff opened from it is on screen.
  const reviewing = (active === 'session' && sessionTab === 'files') || tabs.some((t) => t.kind === 'diff' && !!t.view && tabKey(t) === active)
  const { scoped, error: scopedError, reload: reloadScoped } = useScoped(folder ? reviewView : null, reviewing)
  const [terms, setTerms] = useState<Term[]>([])
  // The bottom panel has terminals that belong to no session (shells, tasks); a session's own are in its Terminals tab.
  const [activeTerm, setActiveTerm] = useState<string | null>(null)
  const [sessionTerm, setSessionTerm] = useState<string | null>(null)
  const [panel, setPanel] = useState(false)
  // The diff open inside Files changed (null: the list of changed files).
  const [fileDiff, setFileDiff] = useState<{ root: string; path: string; view: ReviewView } | null>(null)
  // Full screen: macOS hides its window buttons, so the top bar needs no space for them.
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => {
    void window.api.window.isFullScreen().then(setFullScreen)
    return window.api.window.onFullScreen(setFullScreen)
  }, [])
  const [palette, setPalette] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)  // bumped to focus the Search tab's box (⌘K)
  const [resuming, setResuming] = useState(false)
  const [settings, setSettings] = useState(false)
  const [startingTicket, setStartingTicket] = useState(false)
  const [shortcutsHelp, setShortcutsHelp] = useState(false)
  // Pinned skills (top bar) and the one that runs when the app opens, from Settings.
  const [prefs, setPrefs] = useState<{ pins: Pin[]; onOpen: string | null }>({ pins: [], onOpen: null })
  const loadPrefs = useCallback(() => {
    window.api.settings.get().then((s: { pins: Pin[]; onOpen: string | null }) => setPrefs({ pins: s.pins, onOpen: s.onOpen }))
  }, [])
  useEffect(loadPrefs, [loadPrefs])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const loadWorkflows = useCallback(() => void window.api.workflows.list().then(setWorkflows), [])
  useEffect(loadWorkflows, [loadWorkflows])
  // A setup created from a chat's proposal card shows in Workflows at once.
  useEffect(() => {
    window.addEventListener('workflows-changed', loadWorkflows)
    return () => window.removeEventListener('workflows-changed', loadWorkflows)
  }, [loadWorkflows])
  // Setup opens by itself on start when Claude Code, sign-in or git is missing; dismissing hides it for this run.
  const setup = useSetup()
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null)
  useEffect(() => {
    if (setup.state && setupOpen === null) setSetupOpen(!(setup.state.claude.ok && setup.state.auth.ok && setup.state.git.ok && setup.state.tmux.ok))
  }, [setup.state, setupOpen])
  const [notice, setNotice] = useState<string | null>(null)
  // No flow docs for this folder yet: offered once (docsOffer). Generate starts a session that asks which flows to write.
  const [docsOffer, setDocsOffer] = useState(false)
  // Flow docs are built in: with none set, the app looks near the open folder once and says what it picked.
  useEffect(() => {
    if (!folder) return
    void window.api.flows.detect().then((r) => {
      if (r.set) setNotice(`Flow docs: using ${r.set}. Every session checks them before writing code. Change it in Settings.`)
      setDocsOffer(r.offer)
    })
  }, [folder])
  const [dark, setDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)')
    const on = (): void => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])

  // Terminals survive a window reload: list what main still has.
  useEffect(() => {
    window.api.terminal.list().then((ts: { id: string; command: string; exited: boolean; session: string | null }[]) =>
      setTerms(ts.map((t) => ({ id: t.id, title: t.command === 'claude' ? 'Claude' : 'Shell', exited: t.exited, session: t.session }))))
    return window.api.terminal.onExit((e) => setTerms((ts) => ts.map((t) => (t.id === e.id ? { ...t, exited: true } : t))))
  }, [])
  // Each chat is a Claude Code terminal the app starts: list it in its session's Terminals tab when it starts.
  useEffect(() => window.api.chat.onStatus((s) => {
    if (!s.terminal) return
    setTerms((ts) => (ts.some((t) => t.id === s.terminal) ? ts : [...ts, { id: s.terminal!, title: 'Chat', exited: false, session: s.session }]))
  }), [])

  const fail = (e: unknown): void => setNotice(errText(e))
  const openSearch = (): void => { setView('search'); setSidebar(true); setSearchFocus((n) => n + 1) }
  const openTab = useCallback((t: EditorTab) => {
    // A file already open from Search takes the new line; other tabs stay as they are.
    setTabs((ts) => (ts.some((x) => tabKey(x) === tabKey(t)) ? (t.kind === 'file' ? ts.map((x) => (tabKey(x) === tabKey(t) ? t : x)) : ts) : [...ts, t]))
    setActive(tabKey(t))
  }, [])
  // A code reference clicked anywhere (chat, decisions, reviews) opens that file at that line.
  useEffect(() => {
    const on = (e: Event): void => {
      const r = (e as CustomEvent<{ root: string; path: string; line: number }>).detail
      openTab({ kind: 'file', root: r.root, path: r.path, line: r.line })
    }
    window.addEventListener('open-code', on)
    return () => window.removeEventListener('open-code', on)
  }, [openTab])
  // Prev / Next in a diff: the next file takes the same tab instead of opening one more.
  // A breakpoint from the diff goes to that repo's "Attach debugger" terminal (rdbg): pause, set it, continue.
  const breakAt = (root: string, path: string, line: number): boolean => {
    const repo = base(root)
    const t = terms.find((x) => !x.exited && x.title === `${repo}: Attach debugger`)
    if (!t) {
      setNotice(`No debugger attached for ${repo}. Start the server, then Run → ${repo} → Attach debugger.`)
      return false
    }
    window.api.terminal.write(t.id, '\x03')
    setTimeout(() => window.api.terminal.write(t.id, `break ${root}/${path}:${line}\r`), 300)
    setTimeout(() => window.api.terminal.write(t.id, 'c\r'), 700)
    setActiveTerm(t.id)
    setPanel(true)
    return true
  }
  const replaceTab = (oldKey: string, t: EditorTab): void => {
    setTabs((ts) => {
      const at = ts.findIndex((x) => tabKey(x) === oldKey)
      const rest = ts.filter((x) => tabKey(x) !== tabKey(t))
      const i = rest.findIndex((x) => tabKey(x) === oldKey)
      return at < 0 || i < 0 ? [...rest, t] : [...rest.slice(0, i), t, ...rest.slice(i + 1)]
    })
    setActive(tabKey(t))
  }
  const closeTab = (k: string): void => {
    setTabs((ts) => ts.filter((t) => tabKey(t) !== k))
    if (active === k) setActive(page)
  }
  const openSession = (id: string | null, tab: SessionTab = 'chat'): void => {
    setChatId(id)
    setSessionTab(tab)
    setActive('session')
  }
  const generateDocs = (): void => void window.api.flows.generate().then((id) => { setDocsOffer(false); openSession(id) }, (e: unknown) => setNotice(errText(e)))
  const skipDocs = (): void => void window.api.flows.dismissOffer().then(() => setDocsOffer(false))
  // "Go to session" on a decision or review card opens that session's chat (setters only, so no stale state).
  useEffect(() => {
    const on = (e: Event): void => {
      setChatId((e as CustomEvent<string>).detail)
      setSessionTab('chat')
      setActive('session')
    }
    window.addEventListener('open-session', on)
    return () => window.removeEventListener('open-session', on)
  }, [])
  // Where reference links go (board/Refs.tsx). The target is highlighted once the tab has rendered it.
  const flash = (selector: string): void => {
    setTimeout(() => {
      const el = document.querySelector(selector)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1600)
    }, 150)
  }
  const nav: Nav = {
    openDecision: (id) => {
      const d = board?.decisions.find((x) => x.id === id)
      if (d?.session && board?.sessions.some((s) => s.id === d.session)) openSession(d.session, 'decisions')
      else openTab({ kind: 'decisions' })
      flash(`[data-decision="${id}"]`)
    },
    openTicket: (key) => openTab({ kind: 'ticket', id: key }),
    gotoChat: (session, anchor) => {
      openSession(session, 'chat')
      setTimeout(() => window.dispatchEvent(new CustomEvent('chat:goto', { detail: { session, anchor } })), 150)
    }
  }
  // The selected session's Claude terminal, started if needed (the Terminals tab asks for it when it has none).
  const startSessionTerminal = useCallback((): void => {
    if (chatId) window.api.chat.terminal(chatId).then((id: string) => { setSessionTerm(id); setSessionTab('terminals') }, fail)
  }, [chatId, fail])
  const showSessionTerminal = (id: string): void => {
    setSessionTerm(id)
    setSessionTab('terminals')
    setActive('session')
  }
  // A terminal with a session goes to that session's Terminals tab; one without, to the bottom panel.
  const addTerm = (info: { id: string }, title: string, session: string | null = null): void => {
    setTerms((ts) => [...ts, { id: info.id, title, exited: false, session }])
    if (session) return setSessionTerm(info.id)
    setActiveTerm(info.id)
    setPanel(true)
  }
  const newShell = (): void => void window.api.terminal.spawnShell().then((i) => addTerm(i, 'Shell'), fail)
  const startWorkflow = (id: string): void => void window.api.chat.create(id).then((sid) => openSession(sid), fail)
  const current = board?.sessions.find((s) => s.id === chatId)
  const newSessionShell = (): void => {
    if (current) void window.api.terminal.spawnShell(current.cwd ?? undefined, current.id).then((i) => addTerm(i, 'Shell', current.id), fail)
  }
  // The app picks the session id, so it knows which terminal a session lives in and can type into it from the chat panel.
  const newClaude = (): void => {
    const sid = crypto.randomUUID()
    void window.api.terminal.spawnClaude(['--session-id', sid], sid).then((i) => { addTerm(i, 'Claude', sid); openSession(sid, 'terminals') }, fail)
  }
  const terminalFor = (sid: string): string | null => terms.find((t) => t.session === sid && !t.exited)?.id ?? null
  const closeTerm = (id: string): void => {
    void window.api.terminal.close(id)
    setTerms((ts) => ts.filter((t) => t.id !== id))
  }
  const runTask = (t: Task): void => void window.api.tasks.run(t.id).then((i: { id: string }) => addTerm(i, `${t.repo}: ${t.label}`), fail)
  // Skills that take arguments go into the input for the user to finish; agents too.
  const runSkill = (c: CatalogItem): void => chat.current?.prefill(c.invoke + (c.invoke.endsWith(' ') ? '' : ' '))
  const review = (): void => chat.current?.send(REVIEW_PROMPT)
  // A pinned skill is a routine: it runs straight away (agents still go to the input, they need a task).
  const runPinned = (c: CatalogItem): void => (c.kind === 'agent' ? runSkill(c) : chat.current?.send(c.invoke))
  const pinned = prefs.pins.flatMap((p) => {
    const item = catalog.find((c) => itemKey(c) === p.key)
    return item ? [{ label: p.label, item }] : []
  })
  const togglePin = (c: CatalogItem): void => {
    const key = itemKey(c)
    const pins = prefs.pins.some((p) => p.key === key) ? prefs.pins.filter((p) => p.key !== key) : [...prefs.pins, { key, label: c.name.replace(/[-_]/g, ' ').replace(/^./, (x) => x.toUpperCase()) }]
    window.api.settings.save({ pins, onOpen: pins.some((p) => p.key === prefs.onOpen) ? prefs.onOpen : null }).then(loadPrefs, fail)
  }
  // Your docs skill when you have one (e.g. update-product-docs); otherwise a plain prompt with the docs and files.
  const updateDocs = (): void => {
    const skill = catalog.find((c) => c.role === 'docs')
    if (skill) return chat.current?.prefill(skill.invoke + ' ')
    chat.current?.send(`These flow docs have anchors on files I changed:\n${docs.map((d) => `- ${d.doc} (anchors on ${d.files.join(', ')})`).join('\n')}\n\nCheck each against the code now and propose doc updates as a review. Keep every claim anchored to file:line, and fix anchors whose lines moved.`)
  }
  const pickFolder = (): void => void window.api.workspace.pick().then(setWs, fail)
  const openFolder = (p: string): void => void window.api.workspace.open(p).then(setWs, fail)
  const trust = (yes: boolean): void => {
    if (folder) void window.api.workspace.trust(folder, yes).then(setWs, fail)
  }

  // Opening a folder resumes its most recent chat, if it has one.
  const lastChat = board?.sessions.find((s) => s.via === 'chat' && s.cwd === folder && !s.archived)?.id ?? null
  const [chatFolder, setChatFolder] = useState<string | null>(null)
  useEffect(() => {
    if (!board || chatFolder === folder) return
    setChatFolder(folder)
    setChatId(lastChat)
  }, [board, folder, chatFolder, lastChat])

  // Run on open: once per app start, when setup is done, a trusted folder is open and the skill is known.
  const ranOnOpen = useRef(false)
  useEffect(() => {
    if (ranOnOpen.current || !prefs.onOpen || !trusted || !setup.state?.claude.ok || !setup.state.auth.ok) return
    const item = catalog.find((c) => itemKey(c) === prefs.onOpen)
    if (!item) return
    ranOnOpen.current = true
    openSession(null)
    setTimeout(() => runPinned(item), 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.onOpen, trusted, setup.state, catalog])

  // decision-ide:// links from Shortcuts and Siri. Only pinned skills run straight away; the rest wait in the input.
  useEffect(() => window.api.onDeepLink((l) => {
    openSession(null)
    // A link from outside (a website, another app) only fills the chat box; you press Send. It never runs anything.
    if (l.action === 'ask') return void setTimeout(() => chat.current?.prefill(l.text), 300)
    const item = catalog.find((c) => c.name === l.skill)
    if (!item) return setNotice(`No skill called ${l.skill} here.`)
    setNotice(`A link asked to run ${item.name}. It is in the chat box: press Send to run it.`)
    setTimeout(() => runSkill(item), 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [catalog, prefs])

  // Keyboard: ⇧⌘P palette, ⌘K search, ⌘J terminal panel, ⌘B sidebar.
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'p' && e.shiftKey) { e.preventDefault(); setPalette(true) }
      if (k === 'k') { e.preventDefault(); openSearch() }
      if (k === 'j') { e.preventDefault(); setPanel((p) => !p) }
      if (k === 'b') { e.preventDefault(); setSidebar((s) => !s) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const commands = useMemo<Command[]>(() => [
    { id: 'open', label: 'Open Folder…', run: pickFolder },
    { id: 'chat', label: 'New Session', run: () => openSession(null) },
    { id: 'search', label: 'Search code, files, decisions, chats', detail: '⌘K', run: () => openSearch() },
    { id: 'resume', label: 'Resume a Claude conversation…', detail: 'like claude --resume', run: () => setResuming(true) },
    { id: 'shell', label: 'New Terminal', run: newShell },
    { id: 'claude', label: 'New Claude Terminal', detail: 'interactive claude as its own session', run: newClaude },
    { id: 'panel', label: 'Toggle Terminal Panel', detail: '⌘J', run: () => setPanel((p) => !p) },
    { id: 'side', label: 'Toggle Sidebar', detail: '⌘B', run: () => setSidebar((s) => !s) },
    { id: 'decisions', label: 'Show Decisions', run: () => openTab({ kind: 'decisions' }) },
    { id: 'review', label: 'Review uncommitted changes', run: review },
    { id: 'ticket', label: 'Start Ticket…', detail: 'plan, subtasks, a worktree per subtask', run: () => setStartingTicket(true) },
    { id: 'integrations', label: 'MCPs: connect Slack, GitHub, MCP servers', run: () => { setView('mcps'); setSidebar(true) } },
    { id: 'shortcuts', label: 'Siri & Shortcuts', detail: 'voice commands through the Shortcuts app', run: () => setShortcutsHelp(true) },
    ...pinned.map((p) => ({ id: 'pin:' + p.item.name, label: `Run: ${p.label}`, detail: p.item.invoke, run: () => runPinned(p.item) })),
    { id: 'setup', label: 'Setup: Claude Code, sign-in, git, tmux', run: () => { setup.recheck(); setSetupOpen(true) } },
    { id: 'settings', label: 'Settings', detail: 'profile, preferences', run: () => setSettings(true) },
    ...(ws?.recent ?? []).map((p) => ({ id: 'recent:' + p, label: `Open Recent: ${base(p)}`, detail: p, run: () => openFolder(p) })),
    ...tasks.tasks.map((t) => ({ id: 'task:' + t.id, label: `Run: ${t.repo} · ${t.label}`, detail: t.command, run: () => runTask(t) })),
    ...catalog.map((c) => ({ id: 'cat:' + c.kind + c.name, label: `${c.kind === 'agent' ? 'Agent' : 'Skill'}: ${c.name}`, detail: c.description.slice(0, 80), run: () => runSkill(c) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ws, tasks, catalog])

  if (!board || !ws) return <p className="empty pad">{error ? `Could not read the board: ${error}` : 'Loading…'}</p>
  const waiting = board.decisions.filter(onYou).length + board.reviews.filter((r) => r.status === 'open').length + board.approvals.length
  const chatStatus = current
  const sessionTerms = chatId ? terms.filter((t) => t.session === chatId) : []
  const nameTerm = (t: Term): Term => {
    // Name a Claude terminal after its chat or session.
    const s = t.session ? board.sessions.find((x) => x.id === t.session) : undefined
    return s && t.title !== 'Shell' ? { ...t, title: `${s.via === 'chat' ? 'Chat' : 'Claude'}: ${(s.title || s.id.slice(0, 8)).slice(0, 28)}` } : t
  }

  return (
    <RefsProvider value={{ board, nav }}>
    <div className="ide">
      <Toolbar fullScreen={fullScreen} sessionName={sidebar ? null : current?.title || null} ws={ws} branch={mainSet?.branch ?? null} tasks={tasks.tasks} catalog={catalog} trusted={trusted} pickFolder={pickFolder} openFolder={openFolder}
        runTask={runTask} runSkill={runSkill} review={review} palette={() => setPalette(true)} search={() => openSearch()} startTicket={() => setStartingTicket(true)}
        pinned={pinned} runPinned={runPinned} browseSkills={() => { setView('skills'); setSidebar(true) }} />
      {folder && !trusted && (
        <div className="trust">
          <b>Do you trust the files in {base(folder)}?</b> Claude and tasks run code from this folder, including its Claude Code hooks and MCP servers.
          <button className="primary" onClick={() => trust(true)}>Trust folder</button>
          <span className="meta">Until then you can browse changes, but not chat or run tasks.</span>
        </div>
      )}
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice} <span className="meta">(click to dismiss)</span></div>}
      {docsOffer && (
        <div className="notice docs-offer">
          <b>No flow docs for this folder yet.</b> Claude can write them from your code: it explores the repos, lists the business flows, and you pick which to document before anything is written. Every session then reads them before changing code.
          <span className="bar"><button className="primary" disabled={!trusted} title={trusted ? '' : 'Trust the folder first'} onClick={generateDocs}>Generate flow docs</button><button onClick={skipDocs}>Not now</button></span>
        </div>
      )}
      <div className="ide-main">
        <nav className="activity">
          {/* In the order you use them: your sessions, what waits on you, finding things, running things, then setup. */}
          {([['sessions', 'chat', 'Sessions'], ['decisions', 'decisions', 'Decisions: what waits on you'], ['search', 'search', 'Search: code, files, decisions, chats (⌘K)'], ['run', 'play', 'Run: servers, consoles, tests'], ['workflows', 'team', 'Teams: team setups and routines'], ['skills', 'spark', 'Skills & agents'], ['mcps', 'tool', 'Tools (MCP servers): Slack, GitHub and others']] as const).map(([v, icon, title]) => (
            <button key={v} className={view === v && sidebar ? 'on' : ''} title={title} onClick={() => (view === v ? setSidebar(!sidebar) : (setView(v), setSidebar(true)))}>
              <Icon name={icon} />{v === 'decisions' && waiting > 0 ? <span className="badge warn">{waiting}</span> : null}
            </button>
          ))}
          <span className="grow" />
          <button title="Settings" onClick={() => setSettings(true)}><Icon name="gear" /></button>
        </nav>
        <Group orientation="horizontal" className="ide-panels">
          {sidebar && (
            <>
              <Panel id="side" defaultSize="18" minSize={180}>
                <div className="sidebar">
                  {/* The other views draw their own title row, with their icon buttons (ide/SideHead). */}
                  {(view === 'search' || view === 'run') && <div className="side-title">{view === 'search' ? 'SEARCH' : 'RUN'}</div>}
                  {!folder && view === 'sessions' ? (
                    <div className="side-body"><button className="primary wide" onClick={pickFolder}>Open Folder…</button></div>
                  ) : view === 'decisions' ? <DecisionsSideView board={board} openSession={(id) => openSession(id, 'decisions')} openAll={() => openTab({ kind: 'decisions' })} />
                    : view === 'sessions' ? <SessionsView board={board} folder={folder} current={chatId} openSession={openSession} newSession={() => openSession(null)} resume={() => setResuming(true)} openTab={openTab} />
                    : view === 'search' ? <SearchView focus={searchFocus} openTab={openTab} openChat={(id) => openSession(id)} />
                    : view === 'run' ? <RunView tasks={tasks.tasks} trusted={trusted} run={runTask} reload={reloadTasks}
                        session={chatId} openChat={() => openSession(chatId)} ask={(text) => chat.current?.send(text)} />
                    : view === 'mcps' ? <IntegrationsView trusted={trusted} showTerminal={(id, title) => addTerm({ id }, title)} />
                    : view === 'workflows' ? <WorkflowsView workflows={workflows} reload={loadWorkflows} trusted={trusted} start={startWorkflow} routines={pinned} run={runPinned} />
                    : <SkillsView catalog={catalog} run={runSkill} pins={prefs.pins} togglePin={togglePin} created={reloadCatalog} />}
                </div>
              </Panel>
              <Separator className="sep v" />
            </>
          )}
          <Panel id="center" minSize={320}>
            <Group orientation="vertical">
              <Panel id="editor" minSize={120}>
                {folder ? (
                  <Editor tabs={tabs} page={page} active={active} setActive={setActive} close={closeTab} board={board} refresh={refresh} changes={changes} scoped={scoped} reloadScoped={reloadScoped} openTab={openTab} replaceTab={replaceTab} dark={dark} mode={diffMode} breakAt={breakAt} commentSession={reviewView.session ?? chatId}
                    openChat={(id) => openSession(id)} ask={(t) => chat.current?.send(t)}
                    sessionTitle={current?.title || (chatId ? chatId.slice(0, 8) : 'New session')}
                    sessionPage={
                      <SessionPage ask={(t) => chat.current?.send(t)} session={current ?? null} workflow={workflows.find((w) => w.id === current?.workflow) ?? null} board={board} refresh={refresh} tab={sessionTab} setTab={setSessionTab} open={(id) => openSession(id)}
                        startTerminal={startSessionTerminal}
                        terms={sessionTerms.map(nameTerm)} term={sessionTerm} setTerm={setSessionTerm} newShell={newSessionShell} closeTerm={closeTerm}
                        chat={
                          <ChatPanel ref={chat} board={board} refresh={refresh} folder={folder} trusted={trusted} session={chatId} setSession={setChatId} catalog={catalog}
                            terminalFor={terminalFor} showTerminal={showSessionTerminal} />
                        }
                        files={
                          <div className="files-tab">
                            {changesError && <div className="err">{changesError}</div>}
                            {/* A file's diff opens right here, in Files changed; ← goes back to the list. */}
                            {fileDiff ? (
                              <div className="files-diff">
                                <div className="files-back"><button className="link" onClick={() => setFileDiff(null)}>← All changed files</button></div>
                                <FileDiffView key={`${fileDiff.root}::${fileDiff.path}`} set={scoped?.groups.find((g) => g.root === fileDiff.root) ?? null} path={fileDiff.path} view={fileDiff.view} mode={diffMode} dark={dark}
                                  ask={(t) => chat.current?.send(t)} openTab={openTab} entries={ordered(scoped)} reload={reloadScoped} breakAt={breakAt} board={board} commentSession={reviewView.session ?? chatId}
                                  openChat={(id) => openSession(id)} go={(e) => setFileDiff({ root: e.set.root, path: e.file.path, view: fileDiff.view })} />
                              </div>
                            ) : (
                            <ReviewList board={board} view={reviewView} setView={(v) => setScope({ scope: v.scope, commit: v.commit })} scoped={scoped} error={scopedError} retry={reloadScoped} active={active}
                              openTab={(t) => (t.kind === 'diff' && t.view ? setFileDiff({ root: t.root, path: t.path, view: t.view }) : openTab(t))} docs={docs} updateDocs={updateDocs} />
                            )}
                            {!fileDiff && <details className="rv-kind rv-run">
                            <summary>Run specs</summary>
                            <TestsView changes={scoped ? { git: true, groups: scoped.groups } : null} trusted={trusted} analyse={(t) => { openSession(chatId); chat.current?.send(t) }} showTerminal={(id, title) => addTerm({ id }, title)} />
                            </details>}
                          </div>
                        } />
                    } />
                ) : (
                  <Welcome recent={ws.recent} pick={pickFolder} open={openFolder} />
                )}
              </Panel>
              {panel && (
                <>
                  <Separator className="sep h" />
                  <Panel id="panel" defaultSize="32" minSize={100}>
                    <BottomPanel terms={terms.filter((t) => !t.session)} active={activeTerm} setActive={setActiveTerm} close={closeTerm} newShell={newShell} newClaude={newClaude} hide={() => setPanel(false)}
                      title="TERMINAL" empty="No terminal. Start a shell, or run a task from the toolbar. A session's own terminals are in its Terminals tab." />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
        </Group>
      </div>
      <footer className="status">
        <span>{folder ? base(folder) : 'No folder'}</span>
        {mainSet?.branch && <span>⎇ {mainSet.branch}</span>}
        {changes?.git && <span>{changedCount} changed{changes.groups.length > 1 ? ` in ${changes.groups.length} worktrees` : ''}</span>}
        <span className={waiting ? 'warn' : ''} onClick={() => { setView('decisions'); setSidebar(true) }}>◆ {waiting} waiting on you</span>
        <span className="grow" />
        {chatStatus?.via === 'chat' && <span>{chatStatus.mode === 'acceptEdits' ? 'Accept edits' : chatStatus.mode === 'plan' ? 'Plan' : chatStatus.mode === 'auto' ? 'Auto' : 'Manual'} · {chatStatus.model || 'default model'}</span>}
        {!panel && <span className="link" onClick={() => setPanel(true)}>Terminal ⌘J</span>}
      </footer>
      {palette && <Palette commands={commands} close={() => setPalette(false)} />}
      {resuming && <ResumePicker close={() => setResuming(false)} opened={(id) => openSession(id)} />}
      {settings && <Settings close={() => { setSettings(false); loadPrefs() }} catalog={catalog} openShortcuts={() => { setSettings(false); setShortcutsHelp(true) }} />}
      {shortcutsHelp && <ShortcutsHelp close={() => setShortcutsHelp(false)} pinned={pinned.map((p) => p.item.name)} />}
      {setupOpen && <SetupScreen state={setup.state} recheck={setup.recheck} showTerminal={(id, title) => addTerm({ id }, title)} close={() => setSetupOpen(false)} />}
      {startingTicket && <StartTicket close={() => setStartingTicket(false)} started={(key, session) => { openTab({ kind: 'ticket', id: key }); setChatId(session) }} />}
    </div>
    </RefsProvider>
  )
}

function Welcome({ recent, pick, open }: { recent: string[]; pick: () => void; open: (p: string) => void }): React.JSX.Element {
  return (
    <div className="welcome">
      <h1>Signoff AI</h1>
      <p>Claude Code, with every decision, review and approval in one place.</p>
      <button className="primary" onClick={pick}>Open Folder…</button>
      {recent.length > 0 && <><h3>Recent</h3>{recent.map((p) => <div key={p} className="link" onClick={() => open(p)}>{base(p)} <span className="meta">{p}</span></div>)}</>}
    </div>
  )
}

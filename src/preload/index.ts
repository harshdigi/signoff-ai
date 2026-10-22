// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

// The window gets these calls and nothing else (no raw ipcRenderer).
type DataEvent = { id: string; data: string }
type ExitEvent = { id: string; exitCode: number }
type ChatEvent = { session: string; event: Record<string, unknown> }
type ReviewViewArg = { session: string | null; scope: 'ticket' | 'session' | 'today' | 'commit' | 'uncommitted'; commit?: string | null }
type ChatStatus = { session: string; running: boolean; busy: boolean; terminal: string | null; menu: { question: string; detail: string[]; options: string[]; selected: number } | null }
type SpeechEvent = { type: 'ready' | 'ended' } | { type: 'partial' | 'final'; text: string } | { type: 'error'; code: string; message: string }

const subscribe = <T,>(channel: string, cb: (e: T) => void): (() => void) => {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  window: {
    isFullScreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullScreen'),
    onFullScreen: (cb: (on: boolean) => void) => subscribe<boolean>('window:fullscreen', cb)
  },
  onDeepLink: (cb: (l: { action: 'run'; skill: string } | { action: 'ask'; text: string }) => void) => subscribe<{ action: 'run'; skill: string } | { action: 'ask'; text: string }>('deeplink', cb),
  board: {
    state: () => ipcRenderer.invoke('board:state'),
    reviewDiff: (review: string, change: string): Promise<string> => ipcRenderer.invoke('board:reviewDiff', review, change),
    answer: (id: string, text: string) => ipcRenderer.invoke('board:answer', id, text),
    deliver: (session: string): Promise<'running' | 'started' | 'turn-end'> => ipcRenderer.invoke('board:deliver', session),
    resend: (message: string): Promise<'running' | 'started' | 'turn-end'> => ipcRenderer.invoke('board:resend', message),
    withdraw: (id: string, reason: string) => ipcRenderer.invoke('board:withdraw', id, reason),
    ask: (id: string, text: string) => ipcRenderer.invoke('board:ask', id, text),
    forProduct: (id: string, note: string) => ipcRenderer.invoke('board:forProduct', id, note),
    backFromProduct: (id: string) => ipcRenderer.invoke('board:backFromProduct', id),
    setAside: (id: string) => ipcRenderer.invoke('board:setAside', id),
    bringBack: (id: string) => ipcRenderer.invoke('board:bringBack', id),
    reopen: (id: string) => ipcRenderer.invoke('board:reopen', id),
    object: (id: string, reason: string) => ipcRenderer.invoke('board:object', id, reason),
    message: (session: string, text: string) => ipcRenderer.invoke('board:message', session, text),
    typed: (session: string, text: string) => ipcRenderer.invoke('board:typed', session, text),
    verdict: (rid: string, cid: string, verdict: string, comment?: string) => ipcRenderer.invoke('board:verdict', rid, cid, verdict, comment),
    submit: (rid: string, acceptRest: boolean, note?: string) => ipcRenderer.invoke('board:submit', rid, acceptRest, note),
    dismissReview: (rid: string) => ipcRenderer.invoke('board:dismissReview', rid),
    onChanged: (cb: () => void) => subscribe<void>('board:changed', () => cb())
  },
  workspace: {
    get: () => ipcRenderer.invoke('ws:get'),
    pick: () => ipcRenderer.invoke('ws:pick'),
    open: (path: string) => ipcRenderer.invoke('ws:open', path),
    trust: (path: string, yes: boolean) => ipcRenderer.invoke('ws:trust', path, yes),
    changes: (mode: 'branch' | 'uncommitted') => ipcRenderer.invoke('ws:changes', mode),
    diff: (root: string, path: string, mode: 'branch' | 'uncommitted', view?: ReviewViewArg) => ipcRenderer.invoke('ws:diff', root, path, mode, view),
    impact: (root: string, path: string, mode: 'branch' | 'uncommitted', view?: ReviewViewArg) => ipcRenderer.invoke('ws:impact', root, path, mode, view),
    scoped: (view: ReviewViewArg) => ipcRenderer.invoke('ws:scoped', view),
    reviewed: (view: ReviewViewArg, root: string, path: string, on: boolean) => ipcRenderer.invoke('ws:reviewed', view, root, path, on),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke('ws:pickDir'),
    onChanged: (cb: () => void) => subscribe<void>('ws:changed', () => cb())
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    run: (id: string) => ipcRenderer.invoke('tasks:run', id),
    removeRun: (root: string, label: string) => ipcRenderer.invoke('tasks:removeRun', root, label)
  },
  tests: {
    info: (root: string) => ipcRenderer.invoke('tests:info', root),
    run: (root: string, target: string) => ipcRenderer.invoke('tests:run', root, target),
    runMany: (root: string, files: string[]) => ipcRenderer.invoke('tests:runMany', root, files),
    runs: () => ipcRenderer.invoke('tests:runs'),
    onResult: (cb: (r: Record<string, unknown>) => void) => subscribe<Record<string, unknown>>('tests:result', cb)
  },
  sessions: {
    rename: (id: string, title: string) => ipcRenderer.invoke('session:rename', id, title),
    setParent: (id: string, parent: string | null) => ipcRenderer.invoke('session:setParent', id, parent),
    remove: (id: string) => ipcRenderer.invoke('session:remove', id),
    restore: (id: string) => ipcRenderer.invoke('session:restore', id),
    // Removed sessions only; permanent.
    delete: (ids: string[]) => ipcRenderer.invoke('session:delete', ids)
  },
  story: {
    get: (session: string) => ipcRenderer.invoke('story:get', session),
    write: (session: string) => ipcRenderer.invoke('story:write', session)
  },
  autonomy: {
    get: (session: string) => ipcRenderer.invoke('autonomy:get', session),
    catalog: () => ipcRenderer.invoke('autonomy:catalog'),
    set: (session: string, choice: { mode?: string; items?: string[] }) => ipcRenderer.invoke('autonomy:set', session, choice),
    discuss: (session: string, on: boolean) => ipcRenderer.invoke('discuss:set', session, on)
  },
  monitor: {
    forSession: (session: string) => ipcRenderer.invoke('monitor:forSession', session),
    setup: (session: string) => ipcRenderer.invoke('monitor:setup', session),
    checkAsked: (session: string, recipients: { app: string; where: string; tags: string[] }[]) => ipcRenderer.invoke('monitor:checkAsked', session, recipients),
    choose: (repo: string, chosen: unknown) => ipcRenderer.invoke('monitor:choose', repo, chosen),
    start: (o: { session: string; owner?: string; windowMinutes: number; checkMinutes: number; notify: boolean; recipients: { app: string; where: string; tags: string[] }[] }) => ipcRenderer.invoke('monitor:start', o),
    stop: (id: string, why: string) => ipcRenderer.invoke('monitor:stop', id, why)
  },
  tickets: {
    start: (key: string, title: string, description: string) => ipcRenderer.invoke('ticket:start', key, title, description),
    startSubtask: (key: string, idx: number) => ipcRenderer.invoke('ticket:startSubtask', key, idx),
    openPr: (key: string, idx: number) => ipcRenderer.invoke('ticket:openPr', key, idx),
    setStatus: (key: string, idx: number, status: string) => ipcRenderer.invoke('ticket:setStatus', key, idx, status),
    close: (key: string) => ipcRenderer.invoke('ticket:close', key),
    reopen: (key: string) => ipcRenderer.invoke('ticket:reopen', key)
  },
  flows: {
    touched: () => ipcRenderer.invoke('flows:touched'),
    doc: (rel: string) => ipcRenderer.invoke('flows:doc', rel),
    list: (): Promise<string[]> => ipcRenderer.invoke('flows:list'),
    detect: (): Promise<{ set: string | null; offer: boolean }> => ipcRenderer.invoke('flows:detect'),
    dismissOffer: () => ipcRenderer.invoke('flows:dismissOffer'),
    generate: (): Promise<string> => ipcRenderer.invoke('flows:generate'),
    verify: (): Promise<{ checked: number; skipped: number; broken: { doc: string; docLine: number; anchor: string; problem: string }[] }> => ipcRenderer.invoke('flows:verify')
  },
  memory: { search: (q: string) => ipcRenderer.invoke('memory:search', q) },
  code: {
    files: (q: string, include?: string) => ipcRenderer.invoke('code:files', q, include),
    grep: (o: { q: string; regex?: boolean; caseSensitive?: boolean; word?: boolean; include?: string }) => ipcRenderer.invoke('code:grep', o),
    read: (root: string, path: string): Promise<string> => ipcRenderer.invoke('code:read', root, path),
    resolve: (ref: string, session: string | null): Promise<{ root: string; path: string; line: number } | null> => ipcRenderer.invoke('code:resolve', ref, session)
  },
  setup: {
    check: () => ipcRenderer.invoke('setup:check'),
    installClaude: () => ipcRenderer.invoke('setup:installClaude'),
    login: () => ipcRenderer.invoke('setup:login'),
    installGit: () => ipcRenderer.invoke('setup:installGit'),
    installTmux: () => ipcRenderer.invoke('setup:installTmux')
  },
  integrations: {
    list: () => ipcRenderer.invoke('integrations:list'),
    add: (req: Record<string, unknown>) => ipcRenderer.invoke('integrations:add', req),
    login: (name: string) => ipcRenderer.invoke('integrations:login', name),
    remove: (name: string, scope: string) => ipcRenderer.invoke('integrations:remove', name, scope),
    openConnectors: () => ipcRenderer.invoke('integrations:openConnectors')
  },
  tools: {
    status: () => ipcRenderer.invoke('tools:status')
  },
  catalog: {
    list: () => ipcRenderer.invoke('catalog:list'),
    nearby: () => ipcRenderer.invoke('catalog:nearby'),
    create: (s: Record<string, unknown>): Promise<string> => ipcRenderer.invoke('catalog:create', s)
  },
  shortcuts: { info: () => ipcRenderer.invoke('shortcuts:info') },
  workflows: {
    list: () => ipcRenderer.invoke('workflows:list'),
    save: (w: unknown) => ipcRenderer.invoke('workflows:save', w),
    remove: (id: string) => ipcRenderer.invoke('workflows:delete', id),
    adopt: (decision: string): Promise<string> => ipcRenderer.invoke('workflows:adopt', decision)
  },
  reset: () => ipcRenderer.invoke('app:reset'),
  comments: {
    add: (c: { session: string; root: string; path: string; start: number; end: number; code: string; text: string }) => ipcRenderer.invoke('comments:add', c),
    edit: (id: number, text: string) => ipcRenderer.invoke('comments:edit', id, text),
    remove: (id: number) => ipcRenderer.invoke('comments:remove', id),
    send: (session: string, ids: number[]) => ipcRenderer.invoke('comments:send', session, ids)
  },
  plan: {
    add: (plan: string, c: { title: string; steps?: string; expected?: string }) => ipcRenderer.invoke('plan:add', plan, c),
    set: (plan: string, idx: number, f: Record<string, unknown>) => ipcRenderer.invoke('plan:set', plan, idx, f),
    remove: (plan: string, idx: number) => ipcRenderer.invoke('plan:remove', plan, idx)
  },
  evidence: (session: string, ref: string) => ipcRenderer.invoke('evidence:snippet', session, ref),
  integration: {
    plan: () => ipcRenderer.invoke('integration:plan'),
    enable: () => ipcRenderer.invoke('integration:enable'),
    disable: () => ipcRenderer.invoke('integration:disable')
  },
  // Voice input (main/speech.ts): start listens in the language from Settings; events stream partial and final text.
  speech: {
    start: () => ipcRenderer.invoke('speech:start'),
    stop: () => ipcRenderer.invoke('speech:stop'),
    languages: (): Promise<{ id: string; onDevice: boolean }[]> => ipcRenderer.invoke('speech:languages'),
    onEvent: (cb: (e: SpeechEvent) => void) => subscribe<SpeechEvent>('speech:event', cb)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:save', patch)
  },
  chat: {
    history: (session: string) => ipcRenderer.invoke('chat:history', session),
    status: (session: string) => ipcRenderer.invoke('chat:status', session),
    create: (workflow: string): Promise<string> => ipcRenderer.invoke('chat:create', workflow),
    startSplit: (decision: string, keep: number[]): Promise<string[]> => ipcRenderer.invoke('split:start', decision, keep),
    openInTerminal: (session: string) => ipcRenderer.invoke('session:openTerminal', session),
    conversations: (): Promise<{ id: string; title: string; at: string }[]> => ipcRenderer.invoke('chat:conversations'),
    resume: (id: string, title: string): Promise<string> => ipcRenderer.invoke('chat:resume', id, title),
    send: (session: string | null, text: string, images: { mediaType: string; data: string }[] = [], choice?: 'here' | 'existing' | 'new', files: string[] = []): Promise<{ session: string | null; notice?: string; ask?: { key: string; current: string | null; existing: string | null } }> => ipcRenderer.invoke('chat:send', session, text, images, choice, files),
    // A dropped, pasted or picked file's path on disk; '' when it has none (a pasted screenshot).
    pathOf: (file: File): string => webUtils.getPathForFile(file),
    files: (session: string | null): Promise<string[]> => ipcRenderer.invoke('chat:files', session),
    handoff: (session: string): Promise<string> => ipcRenderer.invoke('chat:handoff', session),
    interrupt: (session: string) => ipcRenderer.invoke('chat:interrupt', session),
    setMode: (session: string, mode: string) => ipcRenderer.invoke('chat:setMode', session, mode),
    choose: (session: string, question: string, option: number) => ipcRenderer.invoke('chat:choose', session, question, option),
    cycleMode: (session: string) => ipcRenderer.invoke('chat:cycleMode', session),
    command: (session: string, line: string) => ipcRenderer.invoke('chat:command', session, line),
    terminal: (session: string): Promise<string> => ipcRenderer.invoke('chat:terminal', session),
    answerInTerminal: (id: string) => ipcRenderer.invoke('approval:terminal', id),
    answer: (id: string, ans: unknown) => ipcRenderer.invoke('approval:answer', id, ans),
    onEvent: (cb: (e: ChatEvent) => void) => subscribe<ChatEvent>('chat:event', cb),
    onStatus: (cb: (e: ChatStatus) => void) => subscribe<ChatStatus>('chat:status', cb),
    onHandoff: (cb: (e: { from: string; to: string; reason: string }) => void) => subscribe<{ from: string; to: string; reason: string }>('chat:handoff', cb)
  },
  terminal: {
    spawnShell: (cwd?: string, session?: string) => ipcRenderer.invoke('term:spawn', { cwd, session }),
    spawnClaude: (args: string[], session: string) => ipcRenderer.invoke('term:spawn', { command: 'claude', args, session }),
    write: (id: string, data: string) => ipcRenderer.send('term:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('term:resize', id, cols, rows),
    replay: (id: string): Promise<string> => ipcRenderer.invoke('term:replay', id),
    list: () => ipcRenderer.invoke('term:list'),
    close: (id: string) => ipcRenderer.invoke('term:close', id),
    onData: (cb: (e: DataEvent) => void) => subscribe<DataEvent>('term:data', cb),
    onExit: (cb: (e: ExitEvent) => void) => subscribe<ExitEvent>('term:exit', cb)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

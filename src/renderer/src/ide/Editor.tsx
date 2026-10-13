// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
type MonacoCodeEditor = MonacoEditor.IStandaloneCodeEditor
import { useEffect, useMemo, useRef, useState } from 'react'
import { ReviewCard } from '../board/Cards'
import type { BoardState } from '../board/types'
import { General } from '../board/Views'
import { languageOf } from './monaco'
import { TicketView } from './Ticket'
import ImpactPanel from './Impact'
import DocView from './Doc'
import FileView from './FileView'
import { base, errText, tabKey, type Changes, type ChangeSet, type DiffMode, type EditorTab, type FileDiff, type ReviewView, type Scoped } from './types'
import { ordered, type Entry } from './review-order'
import { CommentBox, CommentsPanel, DraftBar, type Selection } from './Comments'

// The middle area: the page picked in the left bar (a session, or all decisions), and files opened on top of it.
// No tab bar for the page itself; a slim strip shows only while a file, diff, ticket or doc is open:
// "← <page>" goes back to the page, each opened item has its ×.
type Props = {
  tabs: EditorTab[]; page: 'session' | 'decisions'; active: string; setActive: (k: string) => void; close: (k: string) => void
  board: BoardState; refresh: () => void; changes: Changes | null; scoped: Scoped | null; reloadScoped: () => void
  openTab: (t: EditorTab) => void; replaceTab: (oldKey: string, t: EditorTab) => void; dark: boolean
  mode: DiffMode
  breakAt: (root: string, path: string, line: number) => boolean
  commentSession: string | null  // where code comments go (the selected session)
  openChat: (session: string) => void
  ask: (text: string) => void
  sessionTitle: string; sessionPage: React.ReactNode
}

export default function Editor({ tabs, page, active, setActive, close, board, refresh, changes, scoped, reloadScoped, openTab, replaceTab, dark, mode, breakAt, commentSession, openChat, ask, sessionTitle, sessionPage }: Props): React.JSX.Element {
  const tab = tabs.find((t) => tabKey(t) === active) ?? tabs[0]
  const isPage = (t: EditorTab): boolean => t.kind === 'session' || t.kind === 'decisions'
  const lastPage: EditorTab = { kind: page } // the page to go back to: the one shown now, else the one shown last
  const opened = tabs.filter((t) => !isPage(t))
  const title = (t: EditorTab): string =>
    t.kind === 'decisions' ? 'All decisions'
    : t.kind === 'session' ? sessionTitle
    : t.kind === 'diff' || t.kind === 'file' ? base(t.path)
    : t.kind === 'review' ? `${t.id} review`
    : t.kind === 'ticket' ? t.id
    : base(t.id)
  return (
    <div className="editor">
      {opened.length > 0 && (
        <div className="editor-tabs">
          <div className={'etab page' + (isPage(tab) ? ' on' : '')} onClick={() => setActive(page)} title="Back to the page">
            {isPage(tab) ? '' : '← '}{title(lastPage)}
          </div>
          {opened.map((t) => {
            const k = tabKey(t)
            return (
              <div key={k} className={'etab' + (k === tabKey(tab) ? ' on' : '')} onClick={() => setActive(k)} title={t.kind === 'diff' || t.kind === 'file' ? t.path : undefined}>
                {title(t)}
                <span className="x" onClick={(e) => { e.stopPropagation(); close(k) }}>×</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="editor-body">
        {tab.kind === 'decisions' && <General b={board} refresh={refresh} open={openChat} />}
        {/* Always mounted, so the session's chat keeps its state while another tab is shown. */}
        <div className="session-host" hidden={tab.kind !== 'session'}>{sessionPage}</div>
        {tab.kind === 'review' && (() => {
          const r = board.reviews.find((x) => x.id === tab.id)
          return r ? <div className="view"><ReviewCard r={r} b={board} refresh={refresh} /></div> : <p className="empty pad">This review is gone.</p>
        })()}
        {tab.kind === 'doc' && <DocView key={tab.id} rel={tab.id} />}
        {tab.kind === 'file' && <FileView key={tabKey(tab)} root={tab.root} path={tab.path} line={tab.line} dark={dark} />}
        {tab.kind === 'ticket' && (() => {
          const t = board.tickets.find((x) => x.key === tab.id)
          return t ? <TicketView t={t} b={board} openChat={openChat} /> : <p className="empty pad">This ticket is gone.</p>
        })()}
        {tab.kind === 'diff' && (tab.view
          ? <FileDiffView key={tabKey(tab)} set={(scoped?.groups.find((g) => g.root === tab.root) as ChangeSet | undefined) ?? null} path={tab.path} view={tab.view} mode={mode} dark={dark} ask={ask} openTab={openTab}
              entries={ordered(scoped)} reload={reloadScoped} breakAt={breakAt} board={board} commentSession={commentSession} openChat={openChat} go={(e) => replaceTab(tabKey(tab), { kind: 'diff', root: e.set.root, path: e.file.path, view: tab.view })} />
          : <FileDiffView key={tabKey(tab)} set={changes?.groups.find((g) => g.root === tab.root) ?? null} path={tab.path} mode={mode} dark={dark} ask={ask} openTab={openTab} breakAt={breakAt} board={board} commentSession={commentSession} openChat={openChat} />)}
      </div>
    </div>
  )
}

// With a review view: Prev / Next through its files (j / k), and Reviewed (with "Reviewed → Next" to keep going).
export function FileDiffView({ set, path, view, mode, dark, ask, openTab, entries, go, reload, breakAt, board, commentSession, openChat }: {
  set: ChangeSet | null; path: string; view?: ReviewView; mode: DiffMode; dark: boolean; ask: (t: string) => void; openTab: (t: EditorTab) => void
  entries?: Entry[]; go?: (e: Entry) => void; reload?: () => void
  breakAt?: (root: string, path: string, line: number) => boolean  // false: no debugger attached
  board: BoardState; commentSession: string | null; openChat: (session: string) => void
}): React.JSX.Element {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  // Code comments: the selection on the new side, the comment box, and the comments on this file.
  const [sel, setSel] = useState<Selection | null>(null)
  const [composing, setComposing] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const right = useRef<MonacoCodeEditor | null>(null)
  const marks = useRef<{ set: (d: unknown[]) => void } | null>(null)
  // While the mouse button is down the selection is only noted (pending), and applied on release: updating the page
  // mid-drag re-rendered the diff and interrupted mouse and trackpad selection. Keyboard selection applies at once.
  const dragging = useRef(false)
  const pending = useRef<Selection | null | undefined>(undefined)
  useEffect(() => {
    const up = (): void => {
      if (!dragging.current) return
      dragging.current = false
      if (pending.current !== undefined) setSel(pending.current)
      pending.current = undefined
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  // Fixed between renders, so Monaco is not reconfigured on every state change.
  const glyphs = !!breakAt && !set?.to // breakpoints only on the working tree, when a debugger can take them
  const diffOptions = useMemo(() => ({ readOnly: true, originalEditable: false, renderSideBySide: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, glyphMargin: glyphs }), [glyphs])
  const comments = board.comments.filter((c) => c.session_id === commentSession && c.root === set?.root && c.path === path)
  const drafts = board.comments.filter((c) => c.session_id === commentSession && c.status === 'draft')
  // Line marks follow the comments' lines and states only (not every re-render).
  const markKey = comments.map((c) => `${c.id}:${c.start_line}-${c.end_line}:${c.status}`).join(',')
  useEffect(() => {
    marks.current?.set(comments.map((c) => ({ range: { startLineNumber: c.start_line, startColumn: 1, endLineNumber: c.end_line, endColumn: 1 }, options: { isWholeLine: true, className: 'cm-line', linesDecorationsClassName: 'cm-gutter ' + c.status } })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markKey])
  const addComment = async (text: string, send: boolean): Promise<void> => {
    if (!sel || !set || !commentSession) return
    const c = await window.api.comments.add({ session: commentSession, root: set.root, path, start: sel.start, end: sel.end, code: sel.code, text })
    if (send) await window.api.comments.send(commentSession, [c.id])
    setComposing(false)
    setShowComments(true)
  }
  const [showImpact, setShowImpact] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const change = set?.files.find((f) => f.path === path) ?? null
  // Reload when the change set changes (the file may have been edited again).
  useEffect(() => {
    if (!set || !change) return
    window.api.workspace.diff(set.root, path, mode, view).then((d: FileDiff) => { setDiff(d); setErr(null) }, (e: unknown) => setErr(errText(e)))
  }, [set, change, path, mode, view])
  const at = entries?.findIndex((e) => e.set.root === set?.root && e.file.path === path) ?? -1
  const here = at >= 0 ? entries![at] : null
  const prev = at > 0 ? entries![at - 1] : null
  const next = entries && at >= 0 && at < entries.length - 1 ? entries[at + 1] : null
  const nextOpen = entries?.slice(at + 1).find((e) => e.file.reviewed !== 'done') ?? null
  const mark = (on: boolean, then?: Entry | null): void => {
    if (!view || !set) return
    void window.api.workspace.reviewed(view, set.root, path, on).then(() => { reload?.(); if (then) go?.(then) }, (e: unknown) => setErr(errText(e)))
  }
  useEffect(() => {
    if (!go) return
    const on = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === 'j' && next) go(next)
      if (e.key === 'k' && prev) go(prev)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [go, next, prev])
  if (!change) return <p className="empty pad">{path} has no changes now.</p>
  if (err) return <p className="err pad">{err}</p>
  if (!diff) return <p className="empty pad">Loading…</p>
  if (diff.binary) return <p className="empty pad">Binary file changed.</p>
  if (diff.tooLarge) return <p className="empty pad">File is over 2 MB; open it in your editor.</p>
  return (
    <div className="diff-wrap">
      {here && (
        <div className="rv-nav">
          <button disabled={!prev} onClick={() => prev && go?.(prev)} title="Previous file (k)">‹ Prev</button>
          <span className="meta">{at + 1} of {entries!.length}</span>
          <button disabled={!next} onClick={() => next && go?.(next)} title="Next file (j)">Next ›</button>
          <label className="inline rv-check"><input type="checkbox" checked={here.file.reviewed === 'done'} onChange={(e) => mark(e.target.checked)} /> Reviewed</label>
          {here.file.reviewed === 'changed' && <span className="rv-mark changed">changed since you reviewed it</span>}
          {here.file.reviewed !== 'done' && <button className="primary" onClick={() => mark(true, nextOpen)}>{nextOpen ? 'Reviewed → Next' : 'Reviewed'}</button>}
        </div>
      )}
      <div className="diff-head"><span className={'st ' + change.status}>{change.status}</span> {path}{change.from ? ` (from ${change.from})` : ''}<span className="meta"> · {set!.to ? `commit ${set!.to.slice(0, 8)}` : set!.base ? `${set!.base} (merge-base) ↔ working tree` : `${set!.ref === 'HEAD' ? 'HEAD' : set!.ref.slice(0, 8)} ↔ working tree`}{set!.main ? '' : ` · ${base(set!.root)}`}</span>
        {/* Always takes its place (hidden without a selection), so the layout never shifts under a mouse drag. */}
        <button className={'primary cm-start' + (sel ? '' : ' hide')} disabled={!sel || !commentSession} title={commentSession ? 'Comment on the selected lines' : 'Open a session first: comments go to its chat'} onClick={() => setComposing(true)}>💬 Comment on {sel ? (sel.end > sel.start ? `L${sel.start}–${sel.end}` : `L${sel.start}`) : 'L0'}</button>
        <button className={'impact-toggle' + (showComments ? ' on' : '')} onClick={() => setShowComments(!showComments)} title="Comments on this file and Claude's replies">Comments{comments.length ? ` (${comments.length})` : ''}</button>
        <button className={'impact-toggle' + (showImpact ? ' on' : '')} onClick={() => setShowImpact(!showImpact)} title="Callers, entry points, specs and risks for this change">Impact</button></div>
      {commentSession && <DraftBar session={commentSession} drafts={drafts} />}
      {composing && sel && <CommentBox sel={sel} add={addComment} cancel={() => setComposing(false)} />}
      <div className="diff-body">
        <div className="diff-editor">
        <DiffEditor
          original={diff.original} modified={diff.modified} language={languageOf(path)} theme={dark ? 'vs-dark' : 'vs'}
          options={diffOptions}
          onMount={(ed) => {
            const newSide = ed.getModifiedEditor()
            right.current = newSide
            marks.current = newSide.createDecorationsCollection() as never
            // Selecting lines offers "Comment on L…" (a selection ending at the start of a line does not include that line).
            newSide.onMouseDown(() => { dragging.current = true })
            newSide.onDidChangeCursorSelection((e) => {
              const s = e.selection
              const next = s.startLineNumber === s.endLineNumber && s.startColumn === s.endColumn ? null
                : { start: s.startLineNumber, end: s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber, code: newSide.getModel()?.getValueInRange(s) ?? '' }
              if (dragging.current) pending.current = next
              else setSel(next)
            })
            if (!breakAt || set!.to) return
            // Clicking a line number (or the margin) on the new side sets a breakpoint in the attached debugger.
            const right2 = newSide
            const bpMarks = right2.createDecorationsCollection()
            const lines = new Set<number>()
            right2.onMouseDown((e) => {
              // monaco MouseTargetType: 2 = glyph margin, 3 = line numbers
              if ((e.target.type !== 2 && e.target.type !== 3) || !e.target.position) return
              const line = e.target.position.lineNumber
              if (!breakAt(set!.root, path, line)) return
              lines.add(line)
              bpMarks.set([...lines].map((l) => ({ range: { startLineNumber: l, startColumn: 1, endLineNumber: l, endColumn: 1 }, options: { glyphMarginClassName: 'bp-dot', glyphMarginHoverMessage: { value: 'Breakpoint (in the attached debugger)' } } })))
            })
          }}
        />
        </div>
        {showComments && <CommentsPanel list={comments} reveal={(line) => { right.current?.revealLineInCenter(line); right.current?.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }) }} />}
        {showImpact && <ImpactPanel session={commentSession} openChat={() => commentSession && openChat(commentSession)} set={set!} path={path} view={view} mode={mode} ask={ask} openDoc={(d) => openTab({ kind: 'doc', id: d })} />}
      </div>
    </div>
  )
}

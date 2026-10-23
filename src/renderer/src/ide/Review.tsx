// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { BoardState } from '../board/types'
import { base, type Commit, type EditorTab, type ReviewView, type Scope, type Scoped, type ScopedFile, type ScopedSet } from './types'
import { isTest, ordered } from './review-order'

// Review (Files changed tab): pick a scope, then the files in folded Code and Tests sections, grouped by folder. Opening a file shows
// its diff with Prev / Next and "Mark reviewed", so the list is only needed to jump around.
const LETTER: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' }
const SCOPE_LABEL: [Scope, string, string][] = [
  ['ticket', 'Ticket', 'Everything on the branch, against its base'],
  ['session', 'Session', 'Only files this session edited'],
  ['today', 'Today', 'Since the last commit before today, plus uncommitted work'],
  ['commit', 'Commit', 'One commit'],
  ['uncommitted', 'Uncommitted', 'Not committed yet']
]
// Files grouped by their folder, one level only: a small grey folder line, then its files, all at one indent.
function Files({ files, set, open, active }: { files: ScopedFile[]; set: ScopedSet; open: (set: ScopedSet, f: ScopedFile) => void; active: string }): React.JSX.Element {
  const byDir = new Map<string, ScopedFile[]>()
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    byDir.set(dir, [...(byDir.get(dir) ?? []), f])
  }
  return (
    <>
      {[...byDir.entries()].map(([dir, list]) => (
        <div key={dir} className="rv-group">
          {dir && <div className="rv-dirname" title={dir}>{dir}/</div>}
          {list.map((f) => (
            <div key={f.path} className={'side-item rv-file' + (active === `diff:${set.root}::${f.path}` ? ' on' : '') + (f.reviewed === 'done' ? ' rv-done' : '')} onClick={() => open(set, f)} title={f.path}>
              <span className={'st ' + f.status}>{LETTER[f.status]}</span>
              <span className={'name' + (f.status === 'deleted' ? ' gone' : '')}>{base(f.path)}</span>
              {f.reviewed === 'done' && <span className="rv-mark" title="Reviewed">✓</span>}
              {f.reviewed === 'changed' && <span className="rv-mark changed" title="Changed since you reviewed it">●</span>}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// A folded section (Code, Tests…): its name, how many files, and how many you have reviewed.
function Section({ title, files, children }: { title: string; files: ScopedFile[]; children: React.ReactNode }): React.JSX.Element {
  const done = files.filter((f) => f.reviewed === 'done').length
  return (
    <details className="rv-kind">
      <summary>{title}<span className="n">{done ? `${done}/${files.length} reviewed` : files.length}</span></summary>
      {children}
    </details>
  )
}

type Props = {
  board: BoardState; view: ReviewView; setView: (v: ReviewView) => void; scoped: Scoped | null; active: string
  openTab: (t: EditorTab) => void; docs: { doc: string; files: string[] }[]; updateDocs: () => void
}

export default function ReviewView({ board, view, setView, scoped, active, openTab, docs, updateDocs }: Props): React.JSX.Element {
  const reviews = board.reviews.filter((r) => r.status === 'open')
  const all = ordered(scoped)
  const done = all.filter((e) => e.file.reviewed === 'done').length
  const open = (set: ScopedSet, f: ScopedFile): void => openTab({ kind: 'diff', root: set.root, path: f.path, view })
  const commits: Commit[] = scoped?.commits ?? []
  return (
    <div className="side-body review">
      <div className="mode-toggle scopes">
        {SCOPE_LABEL.filter(([s]) => s !== 'session' || view.session).map(([s, l, t]) => (
          <button key={s} className={view.scope === s ? 'on' : ''} title={t} onClick={() => setView({ ...view, scope: s, commit: null })}>{l}</button>
        ))}
      </div>
      {view.scope === 'commit' && (
        <select className="rv-commit" value={view.commit ?? scoped?.commit ?? ''} onChange={(e) => setView({ ...view, commit: e.target.value })}>
          {commits.length === 0 && <option value="">No commits on this branch yet</option>}
          {commits.map((c) => <option key={c.id} value={c.id}>{c.sha.slice(0, 8)} · {c.subject}</option>)}
        </select>
      )}
      {scoped && all.length > 0 && (
        <div className="rv-progress" title="Files marked reviewed in this scope">
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(100 * done) / all.length}%` }} /></div>
          <span>Reviewed {done} of {all.length}</span>
        </div>
      )}
      {!scoped && <div className="side-empty">Loading…</div>}
      {scoped && all.length === 0 && <div className="side-empty">No changes in this scope{view.scope === 'session' ? ' yet: files this session edits show here' : ''}.</div>}
      {scoped?.groups.map((set) => {
        const code = set.files.filter((f) => !isTest(f.path))
        const tests = set.files.filter((f) => isTest(f.path))
        return (
          <div key={set.root} className="rv-repo">
            <div className="side-group" title={set.root}>{base(set.root)}{set.branch ? ` · ⎇ ${set.branch}` : ''}{set.base ? ` · ${set.files.length} files vs ${set.base}` : ''}</div>
            {code.length > 0 && <Section title="Code" files={code}><Files files={code} set={set} open={open} active={active} /></Section>}
            {tests.length > 0 && <Section title="Tests" files={tests}><Files files={tests} set={set} open={open} active={active} /></Section>}
          </div>
        )
      })}
      {!!scoped?.outside.length && (
        <details className="rv-kind">
          <summary>Not in a git repo <span className="n">{scoped.outside.length}</span></summary>
          {scoped.outside.map((f) => <div key={f} className="side-item" title={f}><span className="st">·</span><span className="name">{base(f)}</span></div>)}
        </details>
      )}
      {reviews.length > 0 && (
        <details className="rv-kind">
          <summary>Proposed by sessions <span className="n">{reviews.length}</span></summary>
          {reviews.map((r) => (
            <div key={r.id} className={'side-item' + (active === `review:${r.id}` ? ' on' : '')} onClick={() => openTab({ kind: 'review', id: r.id })}>
              <span className="st pending">R</span><span className="name">{r.title}</span><span className="dir">{r.changes.length} files</span>
            </div>
          ))}
        </details>
      )}
      {docs.length > 0 && (
        <details className="rv-kind">
          <summary>Flow docs to update <span className="n">{docs.length}</span></summary>
          {docs.map((d) => (
            <div key={d.doc} className="side-item" onClick={() => openTab({ kind: 'doc', id: d.doc })} title={`Anchors on: ${d.files.join(', ')}`}>
              <span className="st pending">D</span><span className="name">{d.doc}</span>
            </div>
          ))}
          <button className="wide" onClick={updateDocs}>Update these docs</button>
        </details>
      )}
    </div>
  )
}

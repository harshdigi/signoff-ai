// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import type { CatalogItem, Changes, DiffMode, ReviewView, Scoped, TaskList, Workspace } from './types'

export function useWorkspace(): { ws: Workspace | null; setWs: (w: Workspace) => void } {
  const [ws, setWs] = useState<Workspace | null>(null)
  useEffect(() => {
    window.api.workspace.get().then(setWs)
  }, [])
  return { ws, setWs }
}

// Runs load every ms while the window is on screen, and once when it comes back (SIGNOFF-38-PERF/D5).
// Hidden, minimised, covered or locked: no reads, so the Mac can rest.
export function pollWhileShown(load: () => void, ms: number): () => void {
  const shown = (): void => { if (!document.hidden) load() }
  const t = setInterval(shown, ms)
  document.addEventListener('visibilitychange', shown)
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', shown) }
}

// Git changes for the open folder; main pushes ws:changed when git status differs.
export function useChanges(folder: string | null, mode: DiffMode): { changes: Changes | null; error: string | null } {
  const [changes, setChanges] = useState<Changes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    if (!folder) return setChanges(null)
    window.api.workspace.changes(mode).then((c: Changes) => { setChanges(c); setError(null) }, (e: Error) => setError(e.message))
  }, [folder, mode])
  useEffect(() => {
    load()
    return window.api.workspace.onChanged(load)
  }, [load])
  return { changes, error }
}

// The review list for a view. Read again every 5 s and on folder changes, but only while it is on screen (live):
// each read is real git work in the main process.
export function useScoped(view: ReviewView | null, live: boolean): { scoped: Scoped | null; error: string | null; reload: () => void } {
  const key = view ? JSON.stringify(view) : null
  const [data, setData] = useState<{ key: string; s: Scoped } | null>(null)
  // A failed load is shown (SIGNOFF-38-PERF/D3); before, the list stayed on Loading… forever. Cleared by the next success.
  const [error, setError] = useState<{ key: string; text: string } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!key || !live) return
    // An identical result (the usual case between edits) changes nothing, so the window does not re-render for it.
    let last = ''
    const load = (): void => void window.api.workspace.scoped(JSON.parse(key)).then((s: Scoped) => {
      setError(null)
      const json = JSON.stringify(s)
      if (json === last) return
      last = json
      setData({ key, s })
    }, (e: unknown) => setError({ key, text: e instanceof Error ? e.message : String(e) }))
    load()
    const stop = pollWhileShown(load, 5000)
    const off = window.api.workspace.onChanged(load)
    return () => { stop(); off() }
  }, [key, tick, live])
  return { scoped: key && data?.key === key ? data.s : null, error: key && error?.key === key ? error.text : null, reload: () => setTick((n) => n + 1) }
}

// Tasks and skills are re-read when the folder changes (cheap file checks).
export function useFolderData(folder: string | null): { tasks: TaskList; catalog: CatalogItem[]; reloadCatalog: () => void; reloadTasks: () => void } {
  const [tasks, setTasks] = useState<TaskList>({ tasks: [], problems: [] })
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const reloadCatalog = useCallback(() => {
    window.api.catalog.list().then(setCatalog)
  }, [])
  const reloadTasks = useCallback(() => {
    if (folder) window.api.tasks.list().then(setTasks, (e: Error) => setTasks({ tasks: [], problems: [e.message] }))
  }, [folder])
  useEffect(() => {
    reloadTasks()
    reloadCatalog()
    // Run commands Claude adds (signoff run add) land in the store: reload with every board change.
    return window.api.board.onChanged(reloadTasks)
  }, [folder, reloadCatalog, reloadTasks])
  return { tasks, catalog, reloadCatalog, reloadTasks }
}

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
export function useScoped(view: ReviewView | null, live: boolean): { scoped: Scoped | null; reload: () => void } {
  const key = view ? JSON.stringify(view) : null
  const [data, setData] = useState<{ key: string; s: Scoped } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!key || !live) return
    // An identical result (the usual case between edits) changes nothing, so the window does not re-render for it.
    let last = ''
    const load = (): void => void window.api.workspace.scoped(JSON.parse(key)).then((s: Scoped) => {
      const json = JSON.stringify(s)
      if (json === last) return
      last = json
      setData({ key, s })
    })
    load()
    const t = setInterval(load, 5000)
    const off = window.api.workspace.onChanged(load)
    return () => { clearInterval(t); off() }
  }, [key, tick, live])
  return { scoped: key && data?.key === key ? data.s : null, reload: () => setTick((n) => n + 1) }
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

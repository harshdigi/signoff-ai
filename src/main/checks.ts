// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { onScreen } from './visibility'

// The timers that wake the app, for the Background view (SIGNOFF-39-PROCS/D1).
// Each check says how often it runs, whether it pauses while the window is off screen, and when it last ran.
export type CheckInfo = { id: string; label: string; every: string; pausesWhenHidden: boolean; paused: boolean; lastRun: number | null; runs: number }
type Entry = Omit<CheckInfo, 'paused'>

const checks = new Map<string, Entry>()

// Returns the function the check calls each time it does its work.
export function defineCheck(id: string, label: string, every: string, pausesWhenHidden: boolean): () => void {
  const e: Entry = { id, label, every, pausesWhenHidden, lastRun: null, runs: 0 }
  checks.set(id, e)
  return () => {
    e.lastRun = Date.now()
    e.runs++
  }
}

export const listChecks = (): CheckInfo[] => [...checks.values()].map((e) => ({ ...e, paused: e.pausesWhenHidden && !onScreen() }))

// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import type { BoardState } from './types'

// The board, refreshed whenever main reports a change (decide or a session wrote to the store).
export function useBoard(): { board: BoardState | null; error: string | null; refresh: () => void } {
  const [board, setBoard] = useState<BoardState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => {
    window.api.board.state().then((s: BoardState) => { setBoard(s); setError(null) }, (e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    refresh()
    return window.api.board.onChanged(refresh)
  }, [refresh])
  return { board, error, refresh }
}

// Runs a board call; returns its error text, or null.
export async function act(fn: () => Promise<unknown>, refresh: () => void): Promise<string | null> {
  try {
    await fn()
    refresh()
    return null
  } catch (e) {
    return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Board)?Error: /, '')
  }
}

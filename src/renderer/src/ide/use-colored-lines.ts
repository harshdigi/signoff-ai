// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { colorizeLines } from './monaco'

// Per-line coloured HTML for these lines, or null (not ready, no language, or failed).
export function useColoredLines(lines: string[], language: string | null): string[] | null {
  const code = lines.join('\n')
  const [done, setDone] = useState<{ key: string; html: string[] } | null>(null)
  const key = `${language}\u0000${code}`
  useEffect(() => {
    if (!language || !code) return
    let live = true
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    colorizeLines(code, language, dark).then((html) => live && setDone({ key, html }), () => live && setDone(null))
    return () => { live = false }
  }, [key, code, language])
  return done && done.key === key ? done.html : null
}

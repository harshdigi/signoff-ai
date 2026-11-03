// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// What some views need from a long chat, worked out in the app so the window gets a few rows instead of every line
// of the conversation (SIGNOFF-38-PERF/D1).
type Block = { type: string; id?: string; name?: string; text?: string; tool_use_id?: string }
type Ev = { type?: string; message?: { content?: unknown } }
const blocks = (e: Ev): Block[] => (Array.isArray(e.message?.content) ? (e.message!.content as Block[]) : [])

// Agents tab: the assistant lines that start helper agents (Agent / Task) and the lines with their results.
export function agentEvents<T extends Ev>(events: T[]): T[] {
  const ids = new Set<string>()
  return events.filter((e) => {
    if (e.type === 'assistant') {
      const calls = blocks(e).filter((b) => b.type === 'tool_use' && b.id && (b.name === 'Agent' || b.name === 'Task'))
      calls.forEach((b) => ids.add(b.id!))
      return calls.length > 0
    }
    return e.type === 'user' && blocks(e).some((b) => b.type === 'tool_result' && !!b.tool_use_id && ids.has(b.tool_use_id))
  })
}

// "Point 7: session status" headings in a chat, newest wins, with the passage under each (for step links).
export type Point = { anchor: string; text: string }
const HEADING = /^\s*(?:#{1,4}\s*|\*\*)?(?:point|step)\s+(\d+)\b\s*(?:\*\*)?\s*[:.)(—–-]/i
export function chatPoints(events: Ev[]): [number, Point][] {
  const map = new Map<number, Point>()
  for (const e of events) {
    if (e.type !== 'assistant') continue
    for (const b of blocks(e)) {
      if (b.type !== 'text' || !b.text) continue
      const lines = b.text.split('\n')
      lines.forEach((l, i) => {
        const m = HEADING.exec(l)
        if (!m) return
        const para = [l, ...lines.slice(i + 1, i + 6)]
        const end = para.findIndex((x, j) => j > 0 && (!x.trim() || HEADING.test(x)))
        map.set(Number(m[1]), { anchor: l.replace(/[#*]/g, '').trim(), text: (end > 0 ? para.slice(0, end) : para).join('\n').replace(/[#*`]/g, '').trim() })
      })
    }
  }
  return [...map]
}

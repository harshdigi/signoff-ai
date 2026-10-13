// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SpeechInput, type SpeechEvent } from '../speech'

// A stand-in for resources/speech/signoff-speech: a shell script that prints the helper's JSON lines.
const helper = (body: string): string => {
  const p = join(mkdtempSync(join(tmpdir(), 'speech-')), 'signoff-speech')
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}
const run = (path: string, act: (s: SpeechInput) => void = () => {}): Promise<SpeechEvent[]> => new Promise((resolve) => {
  const events: SpeechEvent[] = []
  const s = new SpeechInput(path, (e) => {
    events.push(e)
    if (e.type === 'ended') resolve(events)
  })
  s.start(null)
  act(s)
})

describe('voice input helper', () => {
  it('streams ready, partial and final text, and ends once after stop', async () => {
    const h = helper(`echo '{"type":"ready"}'\necho '{"type":"partial","text":"open the"}'\nread line\necho '{"type":"final","text":"Open the review."}'`)
    expect(await run(h, (s) => setTimeout(() => s.stop(), 100))).toEqual([
      { type: 'ready' }, { type: 'partial', text: 'open the' }, { type: 'final', text: 'Open the review.' }, { type: 'ended' }
    ])
  })

  it('passes the language from Settings to the helper', async () => {
    const h = helper(`printf '{"type":"final","text":"%s"}\\n' "$*"`)
    const events: SpeechEvent[] = []
    await new Promise<void>((resolve) => {
      const s = new SpeechInput(h, (e) => { events.push(e); if (e.type === 'ended') resolve() })
      s.start('en-IN')
    })
    expect(events).toEqual([{ type: 'final', text: '--locale en-IN' }, { type: 'ended' }])
  })

  it("reports the helper's own error once; a crash without one is reported as a crash", async () => {
    const denied = helper(`echo '{"type":"error","code":"mic-denied","message":"The microphone is off."}'\nexit 1`)
    expect(await run(denied)).toEqual([{ type: 'error', code: 'mic-denied', message: 'The microphone is off.' }, { type: 'ended' }])
    expect(await run(helper('kill -ABRT $$'))).toEqual([{ type: 'error', code: 'crashed', message: 'Voice input stopped unexpectedly (SIGABRT).' }, { type: 'ended' }])
  })

  it('a missing helper says so instead of failing silently', async () => {
    expect(await run('/nonexistent/signoff-speech')).toEqual([
      { type: 'error', code: 'missing', message: 'Voice input is not in this build of the app.' }, { type: 'ended' }
    ])
  })

  it('starting again drops the earlier run and its late events', async () => {
    const slow = helper(`echo '{"type":"ready"}'\nsleep 0.3\necho '{"type":"partial","text":"old"}'`)
    const fast = helper(`echo '{"type":"final","text":"new"}'`)
    const events: SpeechEvent[] = []
    let s!: SpeechInput
    await new Promise<void>((resolve) => {
      s = new SpeechInput(slow, (e) => {
        events.push(e)
        // the first run is listening: start again (with the other helper) while it would still print "old"
        if (e.type === 'ready') { (s as unknown as { helper: string }).helper = fast; s.start(null) }
        if (e.type === 'final') resolve()
      })
      s.start(null)
    })
    await new Promise((r) => setTimeout(r, 400))
    expect(events).toEqual([{ type: 'ready' }, { type: 'final', text: 'new' }, { type: 'ended' }])
  })

  it('lists languages, and an empty list when the helper is not built', async () => {
    const h = helper(`echo '[{"id":"en-IN","onDevice":true},{"id":"hi-IN","onDevice":false}]'`)
    expect(await new SpeechInput(h, () => {}).languages()).toEqual([{ id: 'en-IN', onDevice: true }, { id: 'hi-IN', onDevice: false }])
    expect(await new SpeechInput('/nonexistent/x', () => {}).languages()).toEqual([])
  })
})

// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { spawn, execFile, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { createInterface } from 'readline'

// Voice input for the chat box: runs the native helper (native/speech/main.swift → resources/speech/signoff-speech).
// - One listener at a time. Starting again ends the previous one, and its late events are dropped.
// - The helper captures the mic itself and recognises on the Mac only; the window gets text, never audio.
// - Every run ends with exactly one "ended" event, after its final text or its error.
export type SpeechEvent =
  | { type: 'ready' }
  | { type: 'partial' | 'final'; text: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'ended' }
export type SpeechLanguage = { id: string; onDevice: boolean }

export class SpeechInput {
  private proc: ChildProcess | null = null

  constructor(private helper: string, private onEvent: (e: SpeechEvent) => void) {}

  start(locale: string | null): void {
    this.kill()
    if (!existsSync(this.helper)) {
      this.onEvent({ type: 'error', code: 'missing', message: 'Voice input is not in this build of the app.' })
      return this.onEvent({ type: 'ended' })
    }
    const p = spawn(this.helper, locale ? ['--locale', locale] : [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = p
    let errored = false
    let stderr = ''
    const mine = (): boolean => this.proc === p
    createInterface({ input: p.stdout! }).on('line', (line) => {
      if (!mine()) return
      let e: SpeechEvent
      try {
        e = JSON.parse(line) as SpeechEvent
      } catch {
        return console.error('voice input: not a JSON line from the helper:', line.slice(0, 200))
      }
      if (e.type === 'error') errored = true
      this.onEvent(e)
    })
    p.stderr!.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000) })
    p.on('error', (err) => {
      if (!mine()) return
      errored = true
      this.onEvent({ type: 'error', code: 'start', message: `Could not start voice input: ${err.message}` })
    })
    p.on('exit', (code, signal) => {
      if (!mine()) return
      this.proc = null
      // Killed by macOS (e.g. a privacy check) or crashed: say so, with the helper's last words for diagnosis.
      if (!errored && (code !== 0 || signal)) {
        console.error('voice input helper stopped:', code, signal, stderr)
        this.onEvent({ type: 'error', code: 'crashed', message: `Voice input stopped unexpectedly (${signal ?? `exit ${code}`}).` })
      }
      this.onEvent({ type: 'ended' })
    })
  }

  // Stop listening: the helper finishes the words heard so far, sends them as "final", then exits.
  stop(): void {
    this.proc?.stdin?.end()
  }

  // End now, without a final result (app quitting, or a new run starting).
  kill(): void {
    const p = this.proc
    this.proc = null
    p?.kill()
  }

  // Languages Apple can recognise, and which of them work on this Mac without a network (only those can be used).
  languages(): Promise<SpeechLanguage[]> {
    if (!existsSync(this.helper)) return Promise.resolve([])
    return new Promise((resolve, reject) => {
      execFile(this.helper, ['--languages'], { timeout: 10_000 }, (err, out) => {
        if (err) return reject(new Error(`could not list voice input languages: ${err.message}`))
        try {
          resolve(JSON.parse(out) as SpeechLanguage[])
        } catch {
          reject(new Error('could not list voice input languages: unexpected output'))
        }
      })
    })
  }
}

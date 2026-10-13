// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Builds the voice-input helper (native/speech/main.swift) into resources/speech/signoff-speech:
// - one binary for Apple Silicon and Intel (lipo), macOS 13 or newer, like the app;
// - macOS only: on other systems it prints a note and builds nothing (voice input is a macOS feature).
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'native', 'speech', 'main.swift')
const OUT = join(ROOT, 'resources', 'speech', 'signoff-speech')

if (process.platform !== 'darwin') {
  console.log('build-speech: not macOS, voice input helper not built')
  process.exit(0)
}
const tmp = mkdtempSync(join(tmpdir(), 'signoff-speech-'))
try {
  const slices = ['arm64', 'x86_64'].map((arch) => {
    const out = join(tmp, arch)
    execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos13.0`, '-o', out, SRC], { stdio: 'inherit' })
    return out
  })
  mkdirSync(dirname(OUT), { recursive: true })
  execFileSync('lipo', ['-create', '-output', OUT, ...slices])
  console.log(`build-speech: ${OUT}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

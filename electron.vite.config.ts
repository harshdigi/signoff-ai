// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Monaco ships its own copy of DOMPurify (3.4.15 in monaco-editor 0.57, with advisories GHSA-p98j-92pf-mc4p and
// GHSA-6688-9rhm-gjv2) instead of using the npm package. Point its one import of that copy at the npm package,
// pinned to a patched version in package.json, so the app ships the fixed DOMPurify. See docs/security-audit.md (L1).
const patchedDompurify = (): Plugin => ({
  name: 'patched-dompurify',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (source === './dompurify/dompurify.js' && importer && /monaco-editor[\\/]esm[\\/]vs[\\/]base[\\/]browser[\\/]domSanitize\.js$/.test(importer)) {
      const npm = await this.resolve('dompurify', importer, { skipSelf: true })
      if (!npm) throw new Error('patched-dompurify: the dompurify package is missing; run npm install')
      return npm
    }
    return null
  }
})

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [patchedDompurify(), react()]
  }
})

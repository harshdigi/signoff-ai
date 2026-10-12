// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// Monaco from the app bundle, not a CDN (the window's CSP allows only 'self').
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}
loader.config({ monaco })

const BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'html', erb: 'html', rb: 'ruby', rake: 'ruby',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', sql: 'sql', sh: 'shell',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', php: 'php', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', dockerfile: 'dockerfile'
}

export function languageOf(path: string): string {
  const name = path.split('/').pop()!.toLowerCase()
  if (name === 'gemfile' || name === 'rakefile') return 'ruby'
  if (name === 'dockerfile') return 'dockerfile'
  return BY_EXT[name.split('.').pop() || ''] || 'plaintext'
}

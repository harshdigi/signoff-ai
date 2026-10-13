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

// Code coloured the same way the editor colours it, as HTML (Monaco escapes the text). Chat and doc code blocks use it.
export async function colorize(code: string, language: string, dark: boolean): Promise<string> {
  monaco.editor.setTheme(dark ? 'vs-dark' : 'vs') // the token colours come from the active theme
  return monaco.editor.colorize(code, language, { tabSize: 2 })
}

// The same, one HTML string per line of the code (Monaco ends each line with <br/>).
export async function colorizeLines(code: string, language: string, dark: boolean): Promise<string[]> {
  const n = code.split('\n').length
  return (await colorize(code, language, dark)).split(/<br\s*\/?>/).slice(0, n)
}

export { languageOf } from './languages'

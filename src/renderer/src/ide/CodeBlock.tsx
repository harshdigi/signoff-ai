// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { fenceLanguage, fencedLanguage } from './languages'
import { colorize } from './monaco'

// A fenced code block in Markdown (chat, plans, flow docs), coloured like the editor.
// - The language comes from the fence (```ruby). A fence without one, or one Monaco does not know, stays one colour.
// - Shows the plain text until the coloured HTML is ready, and if colouring fails.
export function CodeBlock({ code, fence }: { code: string; fence: string }): React.JSX.Element {
  const language = fenceLanguage(fence)
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    if (!language) return
    let live = true
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    colorize(code, language, dark).then((h) => live && setHtml(h), () => live && setHtml(null))
    return () => { live = false }
  }, [code, language])
  // Monaco escapes the code it colours, so its HTML carries no markup from the message.
  return html && language ? <code className="hl" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>
}

// react-markdown's code renderer: fenced blocks with a language are coloured; inline code and the rest unchanged.
export function MdCode({ className, children }: { className?: string; children?: React.ReactNode }): React.JSX.Element {
  const fence = fencedLanguage(className)
  return fence ? <CodeBlock code={String(children).replace(/\n$/, '')} fence={fence} /> : <code className={className}>{children}</code>
}

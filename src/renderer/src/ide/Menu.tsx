// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState, type ReactNode } from 'react'

// A button with a dropdown under it. The one way menus open and close in the app:
// - opens and closes on its button; stays open while the mouse moves to it or away;
// - closes on a pick (a row that is not a heading or greyed out), a click outside, Escape, or leaving the window.
export function Menu({ trigger, align = 'left', className = '', children }: {
  trigger: (m: { open: boolean; toggle: () => void }) => ReactNode
  align?: 'left' | 'right'
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const outside = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) close() }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', esc)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('blur', close)
    }
  }, [open])
  const picked = (e: React.MouseEvent): void => {
    const row = (e.target as HTMLElement).closest('.dropdown > div')
    if (row && !row.classList.contains('dd-head') && !row.classList.contains('off')) setOpen(false)
  }
  return (
    <span ref={box} className={className}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && <div className={'dropdown' + (align === 'right' ? ' right' : '')} onClick={picked}>{children}</div>}
    </span>
  )
}

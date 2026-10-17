// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// Small line icons for the top bar and the left bar (inline SVG, no icon library: nothing new to ship or audit).
// All drawn on the same 24×24 grid, so they look the same size.
const PATHS = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-12 7" /></>,
  play: <path d="M7 5l12 7-12 7z" />,
  review: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M6 8.5V14a4 4 0 0 0 4 4h5.5M18 15.5V10a4 4 0 0 0-4-4H8.5" /></>,
  ticket: <><path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" /><path d="M12 9v6M9 12h6" /></>,
  spark: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />,
  chat: <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />,
  decisions: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
  team: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="17" cy="9.5" r="2.3" /><path d="M16.5 14.6c2.2.2 3.6 1.6 4 4.4" /></>,
  tool: <path d="M15 3.5a5 5 0 0 0-4.7 6.7L3.5 17a2.1 2.1 0 0 0 3 3l6.8-6.8A5 5 0 0 0 20 8.5l-3 3-2.8-.7-.7-2.8 3-3a5 5 0 0 0-1.5-.5z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 5v4h-4" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  tree: <><path d="M5 5h6M9 12h6M9 19h6M7 5v14h2M7 12h2" /></>,
  list: <path d="M5 6h14M5 12h14M5 18h14" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.4" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.4" /></>,
  signin: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9.5 16.5L14 12l-4.5-4.5M14 12H4" />,
  external: <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  lock: <><rect x="6" y="11" width="12" height="9" rx="2" /><path d="M9 11V8a3 3 0 0 1 6 0v3" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  clip: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
} as const
export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }): React.JSX.Element {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>
}

// The fold arrow: one drawn chevron, the same size everywhere (the ▸ ▾ characters render tiny in most fonts).
// Points right when folded, down when open (and for menus that drop down).
export function Chev({ open }: { open: boolean }): React.JSX.Element {
  return <span className={'chev' + (open ? ' open' : '')} aria-hidden="true" />
}

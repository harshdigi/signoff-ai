// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Questions written before the context field packed everything into one line. Shown as a short lead plus points:
// - "Intro. (1) ... (2) ..." -> the intro, then each numbered part;
// - "Commit point 7? A; B. C." (long, with the question first) -> the question, then each ';' or sentence part.
export const unpack = (q: string): { lead: string; points: string[] } => {
  const clean = (xs: string[]): string[] => xs.map((x) => x.trim().replace(/[;.]$/, '')).filter(Boolean)
  const numbered = q.split(/\s*\(\d+\)\s+/)
  if (numbered.length >= 3) return { lead: numbered[0].trim(), points: clean(numbered.slice(1)) }
  const ask = q.indexOf('? ')
  if (q.length > 140 && ask > 0 && ask < 200) return { lead: q.slice(0, ask + 1), points: clean(q.slice(ask + 2).split(/;\s+|(?<=[a-z0-9)])\.\s+(?=[A-Z])/)) }
  return { lead: q, points: [] }
}

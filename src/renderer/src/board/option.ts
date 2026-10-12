// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// "Label :: detail" (options, recommendation, evidence). Older decisions have no detail.
export const split2 = (s: string): [string, string | null] => {
  const i = s.indexOf(' :: ')
  return i < 0 ? [s.trim(), null] : [s.slice(0, i).trim(), s.slice(i + 4).trim()]
}

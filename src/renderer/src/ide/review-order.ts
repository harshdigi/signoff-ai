// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Scoped, ScopedFile, ScopedSet } from './types'

// Code vs tests, and the order files are walked in (the review list, and Prev / Next in the diff).
const TEST = /(^|\/)(spec|specs|test|tests|__tests__)\/|_spec\.rb$|_test\.(rb|py|go)$|(^|\/)test_[^/]+\.py$|\.(test|spec)\.[jt]sx?$/
export const isTest = (path: string): boolean => TEST.test(path)

// The order files are walked in (the list, and Prev / Next): per repo, code then tests, each by path.
export type Entry = { set: ScopedSet; file: ScopedFile }
export function ordered(s: Scoped | null): Entry[] {
  return (s?.groups ?? []).flatMap((set) => {
    const byPath = [...set.files].sort((a, b) => a.path.localeCompare(b.path))
    return [...byPath.filter((f) => !isTest(f.path)), ...byPath.filter((f) => isTest(f.path))].map((file) => ({ set, file }))
  })
}


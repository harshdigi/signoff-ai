// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// The file or folder a permission request is about, when it is outside the folder open in the app.
// Only for tools that name a path (Read, Edit, Write, Glob, Grep, NotebookEdit…); a shell command's paths are not guessed.
// Shown on the card so it is clear a Claude session asks to go there. Nothing is refused because of it.
export function outsidePath(input: Record<string, unknown>, folder: string | null): string | null {
  if (!folder) return null
  const p = [input.file_path, input.notebook_path, input.path].find((v): v is string => typeof v === 'string' && v.startsWith('/'))
  if (!p) return null
  const root = folder.replace(/\/+$/, '')
  return p === root || p.startsWith(root + '/') ? null : p
}

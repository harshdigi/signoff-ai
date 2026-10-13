// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { outsidePath } from '../../renderer/src/chat/approval-scope'

describe('approval card: path outside the open folder', () => {
  it('names a file path outside the open folder; inside, relative, shell commands and no folder give none', () => {
    const open = '/Users/me/Project/'
    expect([
      outsidePath({ file_path: '/Users/me/Downloads/report.csv' }, open),
      outsidePath({ path: '/Users/me/ProjectOther/x' }, open),
      outsidePath({ file_path: '/Users/me/Project/app/a.rb' }, open),
      outsidePath({ path: '/Users/me/Project' }, open),
      outsidePath({ file_path: 'app/a.rb' }, open),
      outsidePath({ command: 'cat /etc/hosts' }, open),
      outsidePath({ file_path: '/tmp/x' }, null)
    ]).toEqual(['/Users/me/Downloads/report.csv', '/Users/me/ProjectOther/x', null, null, null, null, null])
  })
})

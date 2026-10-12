// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { defName, enclosing, impact, kindOf, railsConstant, readHunks } from '../impact'
import { review } from '../workspace'

describe('impact helpers', () => {
  it('finds definition names in Ruby and TypeScript lines', () => {
    expect(['  def email_valid?', '  def self.build(x)', 'class Users::Invite < Base', 'export async function loadUser(id) {', 'export const total = (a) => a', '  render() {', '  if (x) {']
      .map(defName)).toEqual(['email_valid?', 'build', 'Users::Invite', 'loadUser', 'total', 'render', null])
  })

  it('reads changed lines and added/removed definitions from a -U0 diff', () => {
    const h = readHunks('--- a/u.rb\n+++ b/u.rb\n@@ -3,1 +3,2 @@\n-  def valid_email?\n+  def email_valid?\n+    true\n@@ -9,1 +10,0 @@\n-  x\n')
    expect([h.changedNew, [...h.added], [...h.removed]]).toEqual([[3, 4, 10], ['email_valid?'], ['valid_email?']])
  })

  it('names the enclosing method and class, maps Rails constants and classifies files', () => {
    const lines = ['class User', '  def a', '    1', '  end', '  def b', '    2', '  end', 'end']
    expect(enclosing(lines, 6)).toEqual(['b', 'User'])
    expect(railsConstant('app/services/checkout/order_listing_service.rb')).toBe('Checkout::OrderListingService')
    expect(['config/routes.rb', 'app/controllers/x_controller.rb', 'app/jobs/a_job.rb', 'db/migrate/1_x.rb', 'app/services/stripe_webhook_handler.rb', 'lib/a.rb']
      .map(kindOf)).toEqual(['route', 'HTTP endpoint', 'background job', 'migration', 'webhook', 'code'])
  })
})

describe('impact', () => {
  it('finds callers, entry points, specs and flags for a real change', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'impact-')))
    const w = (p: string, s: string): void => {
      mkdirSync(join(root, p, '..'), { recursive: true })
      writeFileSync(join(root, p), s)
    }
    const g = (...a: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' })
    w('Gemfile', "gem 'rspec-rails'")
    w('app/models/user.rb', 'class User\n  def valid_email?\n    true\n  end\nend\n')
    w('app/controllers/users_controller.rb', 'class UsersController\n  def create\n    User.new\n  end\nend\n')
    w('app/jobs/welcome_job.rb', 'class WelcomeJob\n  def perform(u)\n    u.valid_email?\n  end\nend\n')
    w('spec/models/user_spec.rb', 'describe User do\nend\n')
    g('init', '-q', '-b', 'main')
    g('add', '.')
    g('commit', '-qm', 'init')
    w('app/models/user.rb', 'class User\n  validates :email, presence: true\n  def email_valid?\n    true\n  end\nend\n')

    const set = (await review(root, 'uncommitted')).groups[0]
    const i = await impact(set, set.files[0])
    expect(i.path).toBe('app/models/user.rb')
    expect(i.symbols.map((s) => [s.name, s.removed, s.refs.map((r) => `${r.kind} ${r.file}:${r.line}`)])).toEqual([
      ['email_valid?', false, []],
      ['valid_email?', true, ['background job app/jobs/welcome_job.rb:3']],
      ['User', false, ['HTTP endpoint app/controllers/users_controller.rb:3', 'code spec/models/user_spec.rb:1']]
    ])
    expect(i.entryPoints).toEqual([{ file: 'app/jobs/welcome_job.rb', kind: 'background job' }, { file: 'app/controllers/users_controller.rb', kind: 'HTTP endpoint' }])
    expect(i.specs).toEqual(['spec/models/user_spec.rb'])
    expect(i.risks).toEqual([
      'valid_email? was removed or renamed, but 1 place(s) still reference it.',
      'Validation changed: inputs that passed before may now fail, or the reverse.',
      'Reached from background jobs: jobs already queued run the new code with old arguments.'
    ])
  })

  it('marks flow doc anchors on the changed lines and flags the documented flow', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'impact-docs-')))
    const g = (...a: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' })
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib/fee.rb'), 'def fee\n  1\nend\n')
    g('init', '-q')
    g('add', '.')
    g('commit', '-qm', 'i')
    writeFileSync(join(root, 'lib/fee.rb'), 'def fee\n  2\nend\n')
    const set = (await review(root, 'uncommitted')).groups[0]
    const anchors = [
      { doc: 'fees.md', heading: 'Fee', docLine: 3, file: 'lib/fee.rb', start: 1, end: 3 },
      { doc: 'other.md', heading: 'Other', docLine: 9, file: 'lib/fee.rb', start: 10, end: 12 }
    ]
    const i = await impact(set, set.files[0], anchors)
    expect(i.flows).toEqual([
      { doc: 'fees.md', line: 3, heading: 'Fee', anchor: 'lib/fee.rb:1-3', touched: true },
      { doc: 'other.md', line: 9, heading: 'Other', anchor: 'lib/fee.rb:10-12', touched: false }
    ])
    expect(i.risks).toContain('Documented flow changed: fees.md. Check the doc still holds, and update it.')
  })
})

// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveRef } from '../code-search'
import { around, looksLikeRef } from '../../renderer/src/ide/code-ref'

let root: string
let other: string
const repo = (files: Record<string, string>): string => {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'cref-')))
  execFileSync('git', ['init', '-q'], { cwd: r })
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(join(r, p, '..'), { recursive: true })
    writeFileSync(join(r, p), t)
  }
  return r
}
beforeAll(() => {
  root = repo({
    'app/services/acme_order_processor.rb': 'class AcmeOrderProcessor\n  def call; end\n\n  def build_invoice_details\n    fetch_customer!(region_code: x)\n  end\nend\n',
    'app/constants/order_constants.rb': 'module OrderConstants\n  DEFAULT_REGION = "eu"\n  SUPPORTED_REGIONS = [DEFAULT_REGION].freeze\nend\n',
    'app/services/billing/order_processor.rb': 'class Billing::OrderProcessor\n  def build_invoice_details\n  end\nend\n',
    'spec/services/invoice_matrix_spec.rb': 'describe "x" do\nend\n',
    '.claude/rules/billing/orders.md': '# Orders\n'
  })
  other = repo({ 'lib/acme_order_processor.rb': 'class AcmeOrderProcessor\nend\n' })
})

describe('code references', () => {
  it('picks out names worth linking, and leaves plain words alone', () => {
    for (const s of ['AcmeOrderProcessor#build_invoice_details', 'OrderConstants::DEFAULT_REGION', 'SUPPORTED_REGIONS', 'CreatePaymentService', 'fetch_customer!', 'invoice_matrix_spec', '.claude/rules/billing/orders.md', 'app/x.rb:12-30'])
      expect([s, looksLikeRef(s)]).toEqual([s, true])
    for (const s of ['eu', 'us', 'true', 'OK', 'API', 'not_to eq(x)', '422']) expect([s, looksLikeRef(s)]).toEqual([s, false])
  })

  it('finds files, methods (owner breaks ties), constants and classes; the first root wins', async () => {
    expect(await resolveRef([root], '.claude/rules/billing/orders.md')).toEqual({ root, path: '.claude/rules/billing/orders.md', line: 1 })
    expect(await resolveRef([root], 'order_constants.rb:3')).toEqual({ root, path: 'app/constants/order_constants.rb', line: 3 })
    expect(await resolveRef([root], 'invoice_matrix_spec')).toEqual({ root, path: 'spec/services/invoice_matrix_spec.rb', line: 1 })
    expect(await resolveRef([root], 'AcmeOrderProcessor#build_invoice_details')).toEqual({ root, path: 'app/services/acme_order_processor.rb', line: 4 })
    expect(await resolveRef([root], 'Billing::OrderProcessor#build_invoice_details')).toEqual({ root, path: 'app/services/billing/order_processor.rb', line: 2 })
    expect(await resolveRef([root], 'OrderConstants::DEFAULT_REGION')).toEqual({ root, path: 'app/constants/order_constants.rb', line: 2 })
    expect(await resolveRef([other, root], 'AcmeOrderProcessor')).toEqual({ root: other, path: 'lib/acme_order_processor.rb', line: 1 })
    expect(await resolveRef([root], 'region_code')).toBeNull()
    expect(await resolveRef([root], 'missing/file.rb')).toBeNull()
  })

  it('shows a few lines before and more after', () => {
    expect(around('a\nb\nc\nd\ne', 2, 1, 2)).toEqual([{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 3, text: 'c' }, { n: 4, text: 'd' }])
  })
})

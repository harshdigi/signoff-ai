// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// README screenshots, rendered from code with made-up demo data (never your own data):
// 1. builds a throwaway demo project (a "storefront" repo with a gift-card branch) and a fresh demo data folder;
// 2. starts the dev app pointed at that folder (SIGNOFF_USER_DATA) with Chromium's debugging port;
// 3. clicks through the screens over the DevTools protocol and saves docs/screenshots/*.png (2x, dark);
// 4. deletes the demo.
// Run: npm run screenshots   (needs a build: npm run build)
import { execFileSync, spawn } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'screenshots')
const ELECTRON = join(ROOT, 'node_modules', '.bin', 'electron')
const CLI = join(ROOT, 'out', 'cli', 'decide.cjs')
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The real path (macOS: /private/var/... not /var/...), so it matches the folder the CLI records for each session.
const demo = realpathSync(mkdtempSync(join(tmpdir(), 'signoff-demo-')))
const data = join(demo, 'data')
const repo = join(demo, 'storefront')
mkdirSync(data)
mkdirSync(repo)

// ---- 1. the demo project ---------------------------------------------------------------------------------------
const git = (...a) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', ...a], { cwd: repo })
const write = (p, s) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s) }
git('init', '-q', '-b', 'main')
write('app/models/order.rb', `class Order < ApplicationRecord
  has_many :line_items
  belongs_to :customer

  def total_cents
    line_items.sum(&:price_cents)
  end
end
`)
write('app/services/checkout/charge_order.rb', `module Checkout
  # Charges a customer's card for an order.
  class ChargeOrder
    def initialize(order, payment_method)
      @order = order
      @payment_method = payment_method
    end

    def call
      return failure('order already paid') if @order.paid?

      charge = PaymentGateway.charge(@payment_method, @order.total_cents)
      @order.update!(paid_at: Time.current, charge_id: charge.id)
      success(charge)
    end
  end
end
`)
write('config/routes.rb', `Rails.application.routes.draw do
  resources :orders, only: %i[show create]
end
`)
git('add', '-A'); git('commit', '-qm', 'Storefront: orders and checkout')
git('checkout', '-q', '-b', 'ABC-42-gift-cards')
write('app/models/gift_card.rb', `class GiftCard < ApplicationRecord
  belongs_to :customer, optional: true

  validates :code, presence: true, uniqueness: true
  validates :balance_cents, numericality: { greater_than_or_equal_to: 0 }

  def redeem!(amount_cents)
    with_lock do
      raise InsufficientBalance if amount_cents > balance_cents

      update!(balance_cents: balance_cents - amount_cents)
    end
  end
end
`)
write('app/services/checkout/charge_order.rb', `module Checkout
  # Charges an order: gift card balance first, then the customer's card for the rest.
  class ChargeOrder
    def initialize(order, payment_method, gift_card: nil)
      @order = order
      @payment_method = payment_method
      @gift_card = gift_card
    end

    def call
      return failure('order already paid') if @order.paid?

      remaining = @order.total_cents
      if @gift_card
        covered = [@gift_card.balance_cents, remaining].min
        @gift_card.redeem!(covered)
        remaining -= covered
      end

      charge = remaining.positive? ? PaymentGateway.charge(@payment_method, remaining) : nil
      @order.update!(paid_at: Time.current, charge_id: charge&.id, gift_card_cents: @order.total_cents - remaining)
      success(charge)
    end
  end
end
`)
write('spec/services/checkout/charge_order_spec.rb', `RSpec.describe Checkout::ChargeOrder do
  it 'uses the gift card balance before the card' do
    order = create(:order, total_cents: 5_000)
    card = create(:gift_card, balance_cents: 2_000)

    described_class.new(order, payment_method, gift_card: card).call

    expect(card.reload.balance_cents).to eq(0)
    expect(order.reload.gift_card_cents).to eq(2_000)
  end
end
`)
git('add', '-A'); git('commit', '-qm', 'ABC-42 | Gift cards at checkout')

// ---- the demo board, through the app's own CLI ---------------------------------------------------------------
const so = (...a) => execFileSync(ELECTRON, [CLI, ...a], { cwd: repo, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DECISION_IDE_DB: join(data, 'board.db') } }).toString()
const [LEAD, IMPL1, IMPL2, REV, DOCS] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']
so('register', '--session', LEAD, '--ticket', 'ABC-42', '--title', 'Gift cards at checkout', '--description', 'Pay with a gift card balance first, card for the rest')
so('register', '--session', IMPL1, '--ticket', 'ABC-42', '--title', 'Gift card model and redemption')
so('register', '--session', IMPL2, '--ticket', 'ABC-42', '--title', 'Checkout: split payment')
so('register', '--session', REV, '--ticket', 'ABC-42', '--title', 'reviewer')
so('register', '--session', DOCS, '--ticket', 'DOCS', '--title', 'Flow docs')
so('post', '--session', LEAD, '--ticket', 'ABC-42', '--id', 'D1', '--question', 'When a gift card covers only part of the order, what happens to the rest?',
  '--context', 'ChargeOrder now takes an optional gift card and uses its balance first.', '--context', 'Nothing says what to do when the card balance is smaller than the order total.',
  '--option', 'Charge the card for the rest :: one checkout, gift card first, card pays the remainder', '--option', "Ask for another gift card :: customer can stack cards; slower checkout",
  '--option', "Refuse partial cover :: simplest, but customers with small balances can't use them", '--recommend', 'Charge the card for the rest :: matches what customers expect and keeps checkout one step',
  '--evidence', 'app/services/checkout/charge_order.rb:13-18 :: balance first, remainder to the card', '--if-wrong', 'Easy to change before release; after release it changes what customers are charged.')
so('post', '--session', LEAD, '--ticket', 'ABC-42', '--id', 'D2', '--question', 'Can a gift card be used across several orders?', '--option', 'Yes, until the balance is zero :: like a store card', '--option', 'No, one order only :: simpler accounting', '--recommend', 'Yes, until the balance is zero :: customers expect a balance to carry over')
so('answer', '--ticket', 'ABC-42', '--id', 'D2', '--text', 'Yes, until the balance is zero')
so('post', '--session', LEAD, '--ticket', 'ABC-42', '--id', 'D3', '--question', 'Should expired gift cards still show their balance to the customer?', '--context', 'Cards expire after 12 months; the balance stays in the database.', '--option', 'Show it, greyed out :: honest, may cause support tickets', '--option', 'Hide it :: cleaner, but looks like the money vanished', '--recommend', 'Show it, greyed out :: clearer for customers')
so('post', '--session', IMPL1, '--ticket', 'ABC-42', '--id', 'D4', '--question', 'Commit the gift card model on this branch with the message below?', '--action', 'consent',
  '--context', '3 files: gift_card.rb, charge_order.rb, charge_order_spec.rb. Specs pass.', '--recommend', 'Approve :: specs green, change is small',
  '--draft', "ABC-42 | Add gift cards to checkout\n\nCustomers can pay with a gift card balance first and the card for the rest.\nGiftCard#redeem! locks the row, so two checkouts can't spend the same\nbalance twice.")
so('post', '--session', IMPL2, '--ticket', 'ABC-42', '--id', 'D5', '--question', 'Use a row lock when redeeming a gift card?', '--level', 'inform', '--recommend', 'Yes, with_lock :: two checkouts at once must not spend the same balance', '--evidence', 'app/models/gift_card.rb:8-12 :: with_lock around the balance update')
so('test', 'add', '--session', LEAD, '--title', 'Gift card covers the whole order', '--steps', 'Order of 30.00, card with 50.00', '--expected', 'Card balance 20.00, no card charge')
so('test', 'add', '--session', LEAD, '--title', 'Gift card covers part of the order', '--steps', 'Order of 50.00, card with 20.00', '--expected', 'Card balance 0, card charged 30.00')
so('test', 'set', '--session', LEAD, '--idx', '1', '--status', 'pass', '--evidence', 'spec/services/checkout/charge_order_spec.rb:2')
writeFileSync(join(demo, 'review.patch'), ['--- a/app/services/checkout/charge_order.rb', '+++ b/app/services/checkout/charge_order.rb', '@@ -14,1 +14,2 @@', '-        @gift_card.redeem!(covered)', '+        @gift_card.redeem!(covered) if covered.positive?', '+        # a zero-balance card is skipped, not redeemed', ''].join('\n'))
so('propose', '--session', REV, '--ticket', 'ABC-42', '--title', 'Skip zero-balance gift cards', '--patch', join(demo, 'review.patch'), '--summary', 'Redeeming 0 opens a lock for nothing; skip it.', '--file', 'app/services/checkout/charge_order.rb')
write('config/routes.rb', `Rails.application.routes.draw do
  resources :orders, only: %i[show create]
  resources :gift_cards, only: %i[show]
end
`) // one uncommitted change, so the status bar shows work in progress

// The lead's chat, in Claude Code's transcript format.
const t = (m) => `2026-10-13T10:${String(m).padStart(2, '0')}:00.000Z`
const transcript = join(demo, 'lead.jsonl')
writeFileSync(transcript, [
  { type: 'user', uuid: 'u1', timestamp: t(1), message: { role: 'user', content: 'ABC-42: let customers pay with a gift card at checkout. Balance first, card for the rest.' } },
  { type: 'assistant', uuid: 'a1', timestamp: t(2), message: { role: 'assistant', content: [{ type: 'text', text: "I read the checkout flow first. Payment happens in one place, `Checkout::ChargeOrder#call`, which charges the full `Order#total_cents` to the card.\n\n**Plan**\n1. Add a `GiftCard` model with a balance and `redeem!` (row-locked).\n2. Teach `ChargeOrder` to use the gift card balance first, then charge the card for the rest.\n3. Specs for full cover, partial cover and an empty card.\n\nOne thing the ticket doesn't say: what happens when the card covers only part of the order. I posted that as **D1** with a recommendation." }] } },
  { type: 'user', uuid: 'u2', timestamp: t(5), message: { role: 'user', content: 'Go with your recommendation for D1, and split the work: one session for the model, one for checkout, plus a reviewer.' } },
  { type: 'assistant', uuid: 'a2', timestamp: t(6), message: { role: 'assistant', content: [{ type: 'text', text: "Done. The team is running in separate worktrees:\n\n- **Gift card model and redemption**: implementer\n- **Checkout: split payment**: implementer\n- **reviewer**: reads each finished piece\n\nThe model piece is ready; its commit is waiting for your approval as **D4**. I also sent **D3** (expired card balances) to product, since it's a product call, not a code one." }] } },
  { type: 'system', subtype: 'turn_duration', durationMs: 41000, uuid: 's1', timestamp: t(6) }
].map((x) => JSON.stringify(x)).join('\n') + '\n')

// Team links, states, the product question and the workspace: plain SQL on the demo database.
const sql = (q) => execFileSync('sqlite3', [join(data, 'board.db'), q])
sql(`UPDATE sessions SET via='chat';
UPDATE sessions SET state='waiting', mode='default', transcript='${transcript}', workflow='parallel', note='waiting on D1 and D4' WHERE id='${LEAD}';
UPDATE sessions SET state='working', parent_id='${LEAD}', role='implementer' WHERE id IN ('${IMPL1}','${IMPL2}');
UPDATE sessions SET state='waiting', parent_id='${LEAD}', role='reviewer' WHERE id='${REV}';
UPDATE sessions SET state='done', note='3 flow docs written' WHERE id='${DOCS}';
UPDATE decisions SET product_note='Product to confirm the copy and whether support can refund expired balances.', product_at='2026-10-13T15:50:00+05:30' WHERE id='ABC-42/D3';
INSERT INTO settings(key,value) VALUES('workspace', json('{"current":"${repo}","recent":["${repo}"],"trusted":["${repo}"]}')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO settings(key,value) VALUES('app', json('{"docsOffered":["${repo}"],"maxChildren":3}')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`)

// ---- 2. the app, pointed at the demo ---------------------------------------------------------------------------
const env = { ...process.env, SIGNOFF_USER_DATA: data }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(ELECTRON, [ROOT, `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })
const cleanup = () => { try { app.kill() } catch { /* already gone */ } rmSync(demo, { recursive: true, force: true }) }

try {
  // ---- 3. the screens ------------------------------------------------------------------------------------------
  let page
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('renderer/index.html')) } catch { /* not up yet */ }
    if (!page) await sleep(500)
  }
  if (!page) throw new Error('the app did not start')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
  // Clicks the first match, waiting up to 6 s for it to appear (views render after their data loads).
  const click = async (selector, text) => {
    for (let i = 0; i < 30; i++) {
      const r = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) return 'missing'; el.click(); return 'ok' })()`)
      if (r === 'ok') return
      await sleep(200)
    }
    const seen = await js(`(document.querySelector('.session-pane:not([hidden])') || document.body).innerText.slice(0, 600)`)
    throw new Error(`could not click ${selector}${text ? ` "${text}"` : ''}. The pane shows:\n${seen}`)
  }
  const view = (start) => js(`(() => { const b = [...document.querySelectorAll('nav.activity button')].find((e) => (e.title || '').startsWith(${JSON.stringify(start)})); if (b && !b.classList.contains('on')) b.click() })()`)
  const shot = async (name) => { await sleep(1000); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64')); console.log(`saved docs/screenshots/${name}.png`) }

  mkdirSync(OUT, { recursive: true })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  await send('Page.reload')
  await sleep(3500)

  await view('Decisions'); await click('.side-item', 'All decisions')
  await shot('decisions')

  await view('Sessions'); await click('.session-row', 'Gift cards at checkout'); await sleep(1500)
  await click('.session-tabs button', 'Chat')
  await shot('session-chat')

  await click('.session-tabs button', 'Files changed'); await sleep(1200)
  await click('.scopes button', 'Ticket'); await sleep(2000)
  await click('.rv-file', 'charge_order.rb'); await sleep(3000)
  await shot('review-diff')

  await click('.session-tabs button', 'Test plan')
  await shot('test-plan')

  await view('Search')
  await js(`(() => { const i = document.querySelector('.side-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'gift card'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(2500)
  await click('.sr-line'); await sleep(2500)
  await shot('search')

  await view('Workflows')
  await js(`document.querySelectorAll('.wf-how, .wf-pick').forEach((d) => (d.open = true))`)
  await click('.wf-row', 'Implement + review')
  await shot('workflows')
  ws.close()
} finally {
  // ---- 4. nothing left behind ----------------------------------------------------------------------------------
  cleanup()
}

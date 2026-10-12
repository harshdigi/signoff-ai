// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// electron-builder afterPack: node-pty's prebuilt spawn-helper ships without the executable bit (npm drops it),
// and without it every terminal fails with "posix_spawnp failed". Mark each copy executable in the packaged app.
const { chmodSync, existsSync, readdirSync, statSync } = require('fs')
const { join } = require('path')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'spawn-helper') out.push(p)
  }
  return out
}

exports.default = async function afterPack(context) {
  const app = readdirSync(context.appOutDir).find((n) => n.endsWith('.app'))
  const root = app ? join(context.appOutDir, app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty') : join(context.appOutDir, 'resources/app.asar.unpacked/node_modules/node-pty')
  if (!existsSync(root)) throw new Error(`afterPack: node-pty not found in ${root}`)
  const helpers = walk(root)
  if (!helpers.length) throw new Error('afterPack: no node-pty spawn-helper found; terminals would not start')
  for (const h of helpers) chmodSync(h, 0o755)
  console.log(`  • afterPack: made ${helpers.length} node-pty spawn-helper(s) executable`)
}

// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Bundles the decide CLI into out/cli/decide.cjs (run with node). better-sqlite3 stays external (native module).
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { relative } from 'path'

const sqlRaw = {
  name: 'sql-raw',
  setup(b) {
    // The bundle names each module in a comment; a path relative to the project keeps the builder's home folder
    // (/Users/<name>/...) out of the shipped app. The real path rides along in pluginData.
    b.onResolve({ filter: /\.sql\?raw$/ }, (a) => {
      const abs = new URL(a.path.replace('?raw', ''), 'file://' + a.resolveDir + '/').pathname
      return { path: relative(process.cwd(), abs), namespace: 'sql', pluginData: abs }
    })
    b.onLoad({ filter: /.*/, namespace: 'sql' }, (a) => ({ contents: readFileSync(a.pluginData, 'utf8'), loader: 'text' }))
  }
}

await build({
  entryPoints: ['src/cli/decide.ts'], outfile: 'out/cli/decide.cjs', bundle: true, platform: 'node', format: 'cjs',
  target: 'node22', external: ['better-sqlite3'], plugins: [sqlRaw], logLevel: 'warning'
})

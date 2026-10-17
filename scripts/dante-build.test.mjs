import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = resolve(__dirname, 'dante-build.sh')

function createTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'jean-dante-build-test-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'jean-core/src'), { recursive: true })
  mkdirSync(join(dir, 'src-server/src'), { recursive: true })

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'jean', version: '1.0.12' }) + '\n'
  )
  writeFileSync(join(dir, 'jean-core/src/lib.rs'), 'pub fn a() {}\n')
  writeFileSync(join(dir, 'src-server/src/main.rs'), 'fn main() {}\n')

  execFileSync('cp', [scriptPath, join(dir, 'scripts/dante-build.sh')])
  chmodSync(join(dir, 'scripts/dante-build.sh'), 0o755)

  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  execFileSync('git', ['tag', 'v1.0.12'], { cwd: dir })
  return dir
}

test('compute_rust_hash and rust_matches_upstream_tag detect Rust tree modifications', t => {
  const dir = createTempRepo()
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const runHelper = cmd =>
    spawnSync(
      'bash',
      ['-c', `source ./scripts/dante-build.sh && ${cmd}`],
      { cwd: dir, encoding: 'utf8' }
    )

  const h1 = runHelper('compute_rust_hash').stdout.trim()
  assert.match(h1, /^[0-9a-f]{64}$/)
  assert.equal(runHelper('rust_matches_upstream_tag v1.0.12').status, 0)

  // Modify a Rust file in jean-core: hash must change and tag match must fail
  writeFileSync(join(dir, 'jean-core/src/lib.rs'), 'pub fn b() {}\n')
  const h2 = runHelper('compute_rust_hash').stdout.trim()
  assert.notEqual(h1, h2)
  assert.notEqual(runHelper('rust_matches_upstream_tag v1.0.12').status, 0)
})

test('dante-build refuses to clobber a non-empty .dante-build-prev backup directory', t => {
  const dir = createTempRepo()
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  mkdirSync(join(dir, '.dante-build-prev/dist'), { recursive: true })
  writeFileSync(join(dir, '.dante-build-prev/dist/index.html'), '<html></html>')

  const res = spawnSync(join(dir, 'scripts/dante-build.sh'), [], {
    cwd: dir,
    encoding: 'utf8',
  })
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /a previous run left builds in \.dante-build-prev/)
})

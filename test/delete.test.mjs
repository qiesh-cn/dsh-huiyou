import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-sm-'))
process.env.DSH_HOME = home

const plugin = await import('../index.js')

const id = 'session-11111111-2222-3333-4444-555555555555'
const workspace = join(home, 'sessions', '--C-workspace--')
await mkdir(join(workspace, id), { recursive: true })
await writeFile(join(workspace, id, 'session.v4.jsonl.zstd'), 'x'.repeat(2048))
await mkdir(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
await writeFile(
  join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`),
  JSON.stringify({ record: { rows: { title: { val: '测试会话' } } } }),
)

console.log('list before:\n' + (await plugin.listSessions()))
const result = await plugin.deleteSession(id)
console.log('deleted:', result)
console.log('workspace left:', await readdir(workspace))
console.log('trash:', await readdir(join(home, 'session-trash')))
console.log('list after:\n' + (await plugin.listSessions()))

try {
  await plugin.deleteSession(id)
  console.error('SECOND DELETE SHOULD FAIL')
  process.exitCode = 1
} catch (error) {
  console.log('second delete refused:', error.message)
}

try {
  await plugin.deleteSession('../../etc')
  console.error('BAD ID SHOULD FAIL')
  process.exitCode = 1
} catch (error) {
  console.log('bad id refused:', error.message)
}

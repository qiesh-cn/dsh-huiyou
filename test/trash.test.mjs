import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-sm-trash-'))
process.env.DSH_HOME = home
const plugin = await import('../index.js')

const idA = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const idB = 'session-bbbbbbbb-1111-2222-3333-444444444444'
const idC = 'session-cccccccc-1111-2222-3333-444444444444'
const workspace = '--C-ws-example--'
const wsDir = join(home, 'sessions', workspace)
const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
await mkdir(join(wsDir, idA), { recursive: true })
await mkdir(join(wsDir, idB), { recursive: true })
await mkdir(join(wsDir, idC), { recursive: true })
await mkdir(cacheDir, { recursive: true })
await writeFile(join(wsDir, idA, 'log'), 'a'.repeat(1024))
await writeFile(join(wsDir, idB, 'log'), 'b')
await writeFile(join(wsDir, idC, 'log'), 'c')
const cache = (title, cwd) => JSON.stringify({ record: { identity: { cwd }, rows: { title: { val: title } } } })
await writeFile(join(cacheDir, `${idA}.json`), cache('HelloWorld', 'C:\\ws-example'))
await writeFile(join(cacheDir, `${idB}.json`), cache('Second', 'C:\\ws-example'))
await writeFile(join(cacheDir, `${idC}.json`), cache('Legacy', 'C:\\ws-example'))

console.log('slug:', plugin.workspaceSlug('C:\\Users\\example\\Desktop\\Minecraft') === '--C-Users-example-Desktop-Minecraft--')
console.log('slug chinese:', plugin.workspaceSlug('C:\\Users\\example\\Desktop\\Minecraft\\.minecraft\\versions\\示例版本'))

await plugin.deleteSession(idA)
await plugin.deleteSession(idB)
let list = await plugin.listTrash()
console.log('list after delete:', list.map((row) => `${row.title}:${row.days}d:${row.restorable}:${row.sizeText}`).join(' | '))

const restored = await plugin.restoreSession(idA)
console.log('restored:', restored, 'dir:', (await stat(join(wsDir, idA))).isDirectory(), 'cache:', (await stat(join(cacheDir, `${idA}.json`))).isFile())
list = await plugin.listTrash()
console.log('list after restore:', list.map((row) => row.title).join(', '))

await plugin.purgeTrash(idB)
console.log('list after purge:', (await plugin.listTrash()).length)

// Legacy entry: delete idC, then strip meta.json to mimic the old plugin.
await plugin.deleteSession(idC)
for (const entry of await readdir(join(home, 'session-trash'))) {
  await rm(join(home, 'session-trash', entry, 'meta.json'), { force: true })
}
list = await plugin.listTrash()
const legacy = list.find((row) => row.sessionId === idC)
console.log('legacy:', legacy?.title, legacy?.workspace, legacy?.restorable, legacy?.days)
console.log('legacy meta rewritten:', JSON.parse(await readFile(join(home, 'session-trash', list[0].entry, 'meta.json'), 'utf8')).sessionId === idC)
console.log('legacy restored to:', (await plugin.restoreSession(idC)).workspace)

console.log('cleared:', await plugin.clearTrash(), 'remaining:', (await plugin.listTrash()).length)

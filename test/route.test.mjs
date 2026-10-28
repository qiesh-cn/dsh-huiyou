import { Readable } from 'node:stream'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-sm-route-'))
process.env.DSH_HOME = home

const id = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
await mkdir(join(home, 'sessions', 'ws', id), { recursive: true })
await writeFile(join(home, 'sessions', 'ws', id, 'log'), 'x')

const plugin = await import('../index.js')

let route
const commands = []
const fakeWeb = {
  effect: (fn) => fn(),
  webServer: {
    register: (value) => {
      route = value
      return () => {}
    },
  },
}
const ctx = {
  logger: { info: () => {} },
  effect: (fn) => fn(),
  inject: (deps, callback) => {
    if (deps.includes('webServer')) callback(fakeWeb)
    if (deps.includes('commands')) {
      callback({
        effect: (fn) => fn(),
        commands: { register: (definition) => (commands.push(definition), () => {}) },
      })
    }
  },
}
plugin.apply(ctx)

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(value) {
      this.body = value ?? ''
    },
  }
}

async function call(method, headers, payload) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload ?? {}))])
  req.method = method
  req.headers = headers
  const res = response()
  await route.handler(req, res)
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

console.log('route path/kind:', route.path, route.kind)
console.log('bad method:', await call('GET', { 'x-dsh-session-manager': '1' }, {}))
console.log('no marker:', await call('POST', {}, { sessionId: id }))
console.log('bad id:', await call('POST', { 'x-dsh-session-manager': '1' }, { sessionId: '../x' }))
console.log('ok:', await call('POST', { 'x-dsh-session-manager': '1' }, { sessionId: id }))

console.log('commands:', commands.map((entry) => entry.name))
const deleteCommand = commands.find((entry) => entry.name === 'delete-session')
console.log('command current refusal:', await deleteCommand.handler({ rawInput: id, agent: { session: { id } } }))
console.log('command bad input:', await deleteCommand.handler({ rawInput: 'nope', agent: { session: { id: 'other' } } }))

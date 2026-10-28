import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

let registration
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

const primitives = {
  MenuItemButton: function MenuItemButton() {},
  Modal: function Modal() {},
  Button: function Button() {},
  Input: function Input() {},
  Tooltip: function Tooltip() {},
  HoverCard: function HoverCard() {},
  IconTrashOutlineRegular: function IconTrashOutlineRegular() {},
  IconSearchOutlineRegular: function IconSearchOutlineRegular() {},
  IconUnarchiveOutlineRegular: function IconUnarchiveOutlineRegular() {},
  IconWorkspaceTreeOutlineRegular: function IconWorkspaceTreeOutlineRegular() {},
}

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  },
  console,
}
vm.runInNewContext(source, sandbox, { filename: 'client.js' })

console.log('registered id:', registration.id)
const module = registration.factory((specifier) => {
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require: ${specifier}`)
})
console.log('inject:', module.inject.join(', '))

function Original(props) {
  return { type: 'original', props }
}
const entries = [{ component: Original }]
const slots = []
const dictionaries = []
const ctx = {
  effect(fn) {
    return fn()
  },
  locale: {
    register(namespace, values) {
      dictionaries.push({ namespace, values })
      return () => {}
    },
    bind() {
      return (key) => key
    },
  },
  slots: {
    entries(name) {
      return name === 'sidebar.workspaces' ? entries : []
    },
    inject(_name, callback) {
      callback()
    },
    register(options, component) {
      slots.push({ options, component })
      return () => {}
    },
  },
}

module.apply(ctx)
console.log('wrapped:', entries[0].component !== Original)
console.log('slots:', slots.map((entry) => `${entry.options.name}#${entry.options.id}`).join(', '))
console.log('dictionaries:', dictionaries.map((entry) => entry.namespace).join(', '))

const props = { t: (key) => key, wide: true }
const outer = entries[0].component(props)
const shell = outer.type(outer.props)
console.log('shell root:', shell.props.className)
console.log('shell children:', shell.children.length)
const body = shell.children[1]
console.log('body child is original:', body.children[0].type === Original)
console.log('body props forwarded:', body.children[0].props === props)

const menu = slots.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item')
const overlay = slots.find((entry) => entry.options.name === 'shell.overlay')
let menuClosed = false
const menuElement = menu.component({
  sessionId: 'session-11111111-2222-3333-4444-555555555555',
  displayTitle: '测试会话',
  useMenuOpenState: () => [true, (value) => (menuClosed = !value)],
  t: (key) => key,
})
console.log('menu danger:', menuElement.props.danger === true, 'label:', menuElement.children[0])
menuElement.props.onSelect()
console.log('menu closed:', menuClosed)

const dialogElement = overlay.component({ t: (key) => key })
const form = dialogElement.type(dialogElement.props)
console.log('dialog form title:', form.props.title, 'footer children:', form.props.footer.children.length)

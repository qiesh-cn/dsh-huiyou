/**
 * Host half of `@local/dsh-session-manager`.
 *
 * Delete moves a stored Session and its projection cache into
 * `$DSH_HOME/session-trash/<timestamp>-<sessionId>/` and records `meta.json`
 * beside them, so the recycle-bin UI can list, restore, purge, or clear.
 *
 * Browser surface:
 * - `POST /plugins/session-manager/delete`  { sessionId }
 * - `POST /plugins/session-manager/trash`   { action: 'list'|'restore'|'purge'|'clear', sessionId? }
 *
 * Chat surface: `/sessions` and `/delete-session`.
 *
 * The plugin never touches a Session that is still running: the menu archives
 * (and therefore stops) the Session first, and the command refuses to delete
 * the Session that receives the command.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'session-manager'
export const inject = ['webServer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')
const TRASH_ROOT = join(DSH_HOME, 'session-trash')
const PROJECTION_ROOT = join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const WORKSPACE_STATE = join(DSH_HOME, 'storages', 'workspace.json')
const DELETE_ROUTE = '/plugins/session-manager/delete'
const TRASH_ROUTE = '/plugins/session-manager/trash'
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ENTRY_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(session-[0-9a-f-]+)$/

/** @param value - candidate Session id. @returns whether it is one well-formed stored id. */
export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value)
}

/**
 * Locate a stored Session directory across every Workspace folder.
 * @param sessionId - stored Session id.
 * @returns its directory and owning Workspace folder name, or undefined.
 */
export async function locateSession(sessionId) {
  let workspaces
  try {
    workspaces = await readdir(SESSIONS_ROOT, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    const directory = join(SESSIONS_ROOT, workspace.name, sessionId)
    try {
      if ((await stat(directory)).isDirectory()) return { directory, workspace: workspace.name }
    } catch {
      // missing in this Workspace; keep looking
    }
  }
  return undefined
}

/** @param directory - directory whose regular files are summed. @returns total bytes, or 0. */
async function directoryBytes(directory) {
  let total = 0
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    try {
      if (entry.isDirectory()) total += await directoryBytes(path)
      else if (entry.isFile()) total += (await stat(path)).size
    } catch {
      // a file that vanished while walking contributes nothing
    }
  }
  return total
}

/** @param bytes - byte count. @returns a short human-readable size. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** @param sessionId - stored Session id. @returns its recorded title, or undefined. */
async function sessionTitle(sessionId) {
  try {
    const text = await readFile(join(PROJECTION_ROOT, `${sessionId}.json`), 'utf8')
    const parsed = JSON.parse(text)
    const title = parsed?.record?.rows?.title?.val
    return typeof title === 'string' && title.trim().length > 0 ? title : undefined
  } catch {
    return undefined
  }
}

/** @returns the Workspace archive set from the registry state, best effort. */
async function archivedIds() {
  try {
    const parsed = JSON.parse(await readFile(WORKSPACE_STATE, 'utf8'))
    const ids = parsed?.global?.archivedSessionIds
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

/**
 * Encode a canonical Workspace path the way `$DSH_HOME/sessions` folder names do.
 * Kept only for trash entries written before `meta.json` existed.
 * @param path - canonical Workspace directory.
 * @returns the encoded folder name.
 */
export function workspaceSlug(path) {
  let out = ''
  for (const ch of path.replace(/\//g, '\\')) {
    if (ch === ':') continue
    if (ch === '\\') {
      out += '-'
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    out += code >= 0x20 && code <= 0x7e ? ch : `~${code.toString(16).toUpperCase()}`
  }
  return `--${out}--`
}

/** @param name - trash entry folder name. @returns its recorded instant, or undefined. */
function trashedAtFromName(name) {
  const match = ENTRY_NAME.exec(name)
  if (match === null) return undefined
  const value = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Read one trash entry, backfilling `meta.json` for entries created by older
 * plugin versions (which only moved the files).
 * @param entryName - folder name under the trash root.
 * @returns the normalized entry, or undefined when the folder is not ours.
 */
async function readTrashEntry(entryName) {
  if (!ENTRY_NAME.test(entryName)) return undefined
  const entryDir = join(TRASH_ROOT, entryName)
  let names
  try {
    names = await readdir(entryDir)
  } catch {
    return undefined
  }
  let meta
  try {
    meta = JSON.parse(await readFile(join(entryDir, 'meta.json'), 'utf8'))
  } catch {
    meta = undefined
  }
  const sessionId = meta?.sessionId ?? names.find((name) => isSessionId(name))
  if (sessionId === undefined) return undefined
  const cachePath = join(entryDir, `${sessionId}.json`)
  let title = typeof meta?.title === 'string' ? meta.title : undefined
  let workspace = typeof meta?.workspace === 'string' ? meta.workspace : undefined
  let cache
  if (title === undefined || workspace === undefined) {
    try {
      cache = JSON.parse(await readFile(cachePath, 'utf8'))
    } catch {
      cache = undefined
    }
    if (title === undefined) title = cache?.record?.rows?.title?.val
    if (workspace === undefined) {
      const cwd = cache?.record?.identity?.cwd
      if (typeof cwd === 'string' && cwd.length > 0) {
        const slug = workspaceSlug(cwd)
        if (existsSync(join(SESSIONS_ROOT, slug))) workspace = slug
      }
    }
  }
  const trashedAt = typeof meta?.trashedAt === 'number' ? meta.trashedAt : trashedAtFromName(entryName)
  const normalized = {
    entry: entryName,
    entryDir,
    sessionId,
    title: typeof title === 'string' && title.trim().length > 0 ? title : '未命名会话',
    workspace: typeof workspace === 'string' ? workspace : undefined,
    trashedAt: trashedAt ?? Date.now(),
  }
  if (meta === undefined || meta.title === undefined || meta.workspace === undefined) {
    try {
      await writeFile(
        join(entryDir, 'meta.json'),
        JSON.stringify(
          {
            sessionId: normalized.sessionId,
            workspace: normalized.workspace ?? null,
            title: normalized.title,
            trashedAt: normalized.trashedAt,
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch {
      // a read-only trash folder still lists; restore just needs the folder name
    }
  }
  return normalized
}

/**
 * List every trash entry, newest first.
 * @returns normalized entries with size and restorability.
 */
export async function listTrash() {
  let names
  try {
    names = await readdir(TRASH_ROOT)
  } catch {
    return []
  }
  const entries = []
  for (const name of names) {
    const entry = await readTrashEntry(name)
    if (entry === undefined) continue
    const sessionDir = join(entry.entryDir, entry.sessionId)
    const bytes = existsSync(sessionDir) ? await directoryBytes(sessionDir) : 0
    entries.push({
      entry: entry.entry,
      sessionId: entry.sessionId,
      title: entry.title,
      workspace: entry.workspace,
      trashedAt: entry.trashedAt,
      days: Math.max(0, Math.floor((Date.now() - entry.trashedAt) / 86_400_000)),
      size: bytes,
      sizeText: formatBytes(bytes),
      restorable: entry.workspace !== undefined && !entry.workspace.includes('/') && !entry.workspace.includes('\\'),
    })
  }
  entries.sort((a, b) => b.trashedAt - a.trashedAt)
  return entries
}

/** @param sessionId - Session id to find in the trash. @returns its normalized entry. */
async function findTrashEntry(sessionId) {
  let names
  try {
    names = await readdir(TRASH_ROOT)
  } catch {
    return undefined
  }
  for (const name of names) {
    const entry = await readTrashEntry(name)
    if (entry?.sessionId === sessionId) return entry
  }
  return undefined
}

/**
 * Rename with a few short retries: on Windows a Session that was just stopped
 * may still hold its log file open for a moment.
 * @param from - source path.
 * @param to - destination path.
 */
async function renameWithRetry(from, to) {
  let last
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      last = error
      const code = error && typeof error === 'object' ? error.code : undefined
      if (!['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw last
}

/**
 * Delete one stored Session by moving its files into the trash.
 * @param sessionId - stored Session id.
 * @returns where the files went and how many sources were moved.
 * @throws when the id is malformed, unknown, or its files are still locked.
 */
export async function deleteSession(sessionId) {
  if (!isSessionId(sessionId)) throw new Error('会话 ID 格式不正确')
  const found = await locateSession(sessionId)
  const cache = join(PROJECTION_ROOT, `${sessionId}.json`)
  let hasCache = false
  try {
    hasCache = (await stat(cache)).isFile()
  } catch {
    hasCache = false
  }
  if (found === undefined && !hasCache) throw new Error('找不到这个会话，可能已经被删除')

  await mkdir(TRASH_ROOT, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(TRASH_ROOT, `${stamp}-${sessionId}`)
  await mkdir(target, { recursive: false })

  const meta = {
    sessionId,
    workspace: found?.workspace ?? null,
    title: (await sessionTitle(sessionId)) ?? '未命名会话',
    trashedAt: Date.now(),
  }

  let moved = 0
  try {
    if (found !== undefined) {
      await renameWithRetry(found.directory, join(target, sessionId))
      moved += 1
    }
    if (hasCache) {
      await renameWithRetry(cache, join(target, `${sessionId}.json`))
      moved += 1
    }
    await writeFile(join(target, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`无法移走会话文件（可能仍被占用）：${reason}`)
  }
  return { trashedAt: target, moved }
}

/**
 * Restore one trashed Session: put its files back under the recorded
 * Workspace folder and its projection cache back under the storage root.
 * @param sessionId - Session id to restore.
 * @returns the Workspace folder it went back to.
 */
export async function restoreSession(sessionId) {
  if (!isSessionId(sessionId)) throw new Error('会话 ID 格式不正确')
  const entry = await findTrashEntry(sessionId)
  if (entry === undefined) throw new Error('回收站里没有这个会话')
  if (entry.workspace === undefined || entry.workspace.includes('/') || entry.workspace.includes('\\')) {
    throw new Error('缺少原工作区信息，无法自动恢复（可以彻底删除）')
  }
  const destination = join(SESSIONS_ROOT, entry.workspace, sessionId)
  if (existsSync(destination)) throw new Error('原位置已经存在同名会话，无法恢复')

  const sessionDir = join(entry.entryDir, sessionId)
  if (!existsSync(sessionDir)) throw new Error('回收站里的会话文件不见了')
  await mkdir(join(SESSIONS_ROOT, entry.workspace), { recursive: true })
  await renameWithRetry(sessionDir, destination)

  const cacheSource = join(entry.entryDir, `${sessionId}.json`)
  if (existsSync(cacheSource)) {
    await mkdir(PROJECTION_ROOT, { recursive: true })
    const cacheTarget = join(PROJECTION_ROOT, `${sessionId}.json`)
    if (existsSync(cacheTarget)) await rm(cacheTarget, { force: true })
    await renameWithRetry(cacheSource, cacheTarget)
  }
  await rm(entry.entryDir, { recursive: true, force: true })
  return { workspace: entry.workspace }
}

/**
 * Permanently delete one trashed Session.
 * @param sessionId - Session id to purge.
 */
export async function purgeTrash(sessionId) {
  if (!isSessionId(sessionId)) throw new Error('会话 ID 格式不正确')
  const entry = await findTrashEntry(sessionId)
  if (entry === undefined) throw new Error('回收站里没有这个会话')
  await rm(entry.entryDir, { recursive: true, force: true })
}

/** @returns how many trash entries were removed. */
export async function clearTrash() {
  let names
  try {
    names = await readdir(TRASH_ROOT)
  } catch {
    return 0
  }
  let cleared = 0
  for (const name of names) {
    if (!ENTRY_NAME.test(name)) continue
    await rm(join(TRASH_ROOT, name), { recursive: true, force: true })
    cleared += 1
  }
  return cleared
}

/** @returns one line per stored Session, newest first. */
export async function listSessions() {
  const archived = await archivedIds()
  const rows = []
  let workspaces
  try {
    workspaces = await readdir(SESSIONS_ROOT, { withFileTypes: true })
  } catch {
    return '（还没有保存过任何会话）'
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    let sessions
    try {
      sessions = await readdir(join(SESSIONS_ROOT, workspace.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory() || !isSessionId(session.name)) continue
      const directory = join(SESSIONS_ROOT, workspace.name, session.name)
      let updated = 0
      try {
        updated = (await stat(directory)).mtimeMs
      } catch {
        continue
      }
      rows.push({
        id: session.name,
        workspace: workspace.name,
        title: (await sessionTitle(session.name)) ?? '未命名',
        bytes: await directoryBytes(directory),
        updated,
        archived: archived.has(session.name),
      })
    }
  }
  rows.sort((a, b) => b.updated - a.updated)
  if (rows.length === 0) return '（还没有保存过任何会话）'
  const lines = rows.map((row, index) => {
    const when = new Date(row.updated).toLocaleString('zh-CN', { hour12: false })
    return `${String(index + 1)}. ${row.title}${row.archived ? '（已归档）' : ''} · ${formatBytes(row.bytes)} · ${when}\n   ${row.id}`
  })
  return [`共 ${String(rows.length)} 个会话：`, ...lines, '', '删除：/delete-session <会话 ID>'].join('\n')
}

/** @param req - Node request. @param limit - maximum accepted body size. @returns parsed JSON. */
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** @param res - Node response. @param status - HTTP status. @param body - JSON payload. */
function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** @param req - Node request. @param res - Node response. @returns whether this is an admitted POST. */
function admit(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '只接受 POST' })
    return false
  }
  if (req.headers['x-dsh-session-manager'] !== '1') {
    sendJson(res, 403, { ok: false, error: '缺少请求标记' })
    return false
  }
  return true
}

/**
 * Browser-facing delete endpoint.
 * @param ctx - owning Cordis context.
 * @returns the Node request handler.
 */
function deleteHandler(ctx) {
  return async (req, res) => {
    if (!admit(req, res)) return
    let body
    try {
      body = await readJson(req, 16 * 1024)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    try {
      const result = await deleteSession(body?.sessionId)
      ctx.logger.info(`session-manager: moved ${String(body?.sessionId)} to ${result.trashedAt}`)
      sendJson(res, 200, { ok: true, ...result })
    } catch (error) {
      sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/**
 * Re-account a restored Session after a restart: the Workspace registry drops
 * sessions that were missing when it booted, so the restored id is absent from
 * its accounting. Indexing the header restores the path, and attaching writes
 * the id back, which publishes a workspace frame the client follows.
 * @param ctx - owning Cordis context.
 * @param sessionId - restored Session id.
 */
async function reattachRestoredSession(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return undefined
  try {
    const header = await registry.readSessionHeader(sessionId)
    if (header?.cwd === undefined) return undefined
    const workspace = await registry.resolveByPath(header.cwd)
    if (workspace === undefined) return header.cwd
    await workspace.attachSession(sessionId)
    return workspace.path
  } catch (error) {
    ctx.logger.warn(`session-manager: workspace reattach for ${String(sessionId)} failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Browser-facing recycle-bin endpoint: list, restore, purge, clear.
 * @param ctx - owning Cordis context.
 * @returns the Node request handler.
 */
function trashHandler(ctx) {
  return async (req, res) => {
    if (!admit(req, res)) return
    let body
    try {
      body = await readJson(req, 32 * 1024)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    try {
      switch (body?.action) {
        case 'list':
          sendJson(res, 200, { ok: true, sessions: await listTrash() })
          return
        case 'restore': {
          const result = await restoreSession(body?.sessionId)
          const workspacePath = await reattachRestoredSession(ctx, body?.sessionId)
          ctx.logger.info(`session-manager: restored ${String(body?.sessionId)} to ${result.workspace}`)
          sendJson(res, 200, { ok: true, ...result, ...(workspacePath === undefined ? {} : { workspacePath }) })
          return
        }
        case 'purge': {
          await purgeTrash(body?.sessionId)
          ctx.logger.info(`session-manager: purged ${String(body?.sessionId)}`)
          sendJson(res, 200, { ok: true })
          return
        }
        case 'clear': {
          const cleared = await clearTrash()
          ctx.logger.info(`session-manager: cleared ${String(cleared)} trashed session(s)`)
          sendJson(res, 200, { ok: true, cleared })
          return
        }
        default:
          sendJson(res, 400, { ok: false, error: '未知操作' })
      }
    } catch (error) {
      sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/**
 * Mount the Web routes and, when the interaction plane exists, the two slash
 * commands. Every surface calls the same primitives.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (web) => {
    web.effect(() => web.webServer.register({ kind: 'exact', path: DELETE_ROUTE, handler: deleteHandler(ctx) }), 'session-manager: delete route')
    web.effect(() => web.webServer.register({ kind: 'exact', path: TRASH_ROUTE, handler: trashHandler(ctx) }), 'session-manager: trash route')
  })

  ctx.inject(['commands'], (commands) => {
    commands.effect(() => commands.commands.register({
      name: 'sessions',
      description: '列出已保存的会话（含 ID、大小、更新时间）',
      handler: () => ({ kind: 'success', text: listSessions() }),
    }), 'session-manager: /sessions')

    commands.effect(() => commands.commands.register({
      name: 'delete-session',
      description: '删除一个已保存的会话（移入 ~/.dsh/session-trash，可恢复）',
      input: { hint: '<会话 ID>' },
      recordInput: false,
      handler: async ({ rawInput, agent }) => {
        const sessionId = rawInput.trim()
        if (!isSessionId(sessionId)) {
          return { kind: 'error', text: '用法：/delete-session session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx（ID 可用 /sessions 查看）' }
        }
        if (agent?.session?.id === sessionId) {
          return { kind: 'error', text: '不能删除当前正在使用的会话，请先切换到其他会话。' }
        }
        try {
          const result = await deleteSession(sessionId)
          return { kind: 'success', text: `已将会话移入回收站：${result.trashedAt}` }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    }), 'session-manager: /delete-session')
  })
}

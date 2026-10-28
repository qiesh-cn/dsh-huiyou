window.__ModuleLoader__.load({
  id: '@local/dsh-session-manager',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'sessionManager'
    /** Required services: slot registry, locale, Workspace controller, current-Session binding, and the Session catalog. */
    const inject = ['slots', 'locale', 'workspaces', 'uiSession', 'sessions']

    const zh = {
      'menu.delete': '删除会话',
      'dialog.title': '删除会话',
      'dialog.desc': '将「{title}」移入回收站。会话文件仍保存在 ~/.dsh/session-trash 中，需要时可以手动恢复。',
      'dialog.note': '删除后这个会话会从列表中消失。',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除',
      'dialog.pending': '正在删除…',
      'dialog.close': '关闭',
      'dialog.current': '这是当前正在使用的会话。请先切换到其他会话，或新建一个会话后再删除。',
      'trash.title': '回收站',
      'trash.workspace': '工作区',
      'trash.count': '{n} 个',
      'trash.search': '搜索回收站',
      'trash.clear': '清空回收站',
      'trash.loading': '正在读取…',
      'trash.empty': '回收站是空的',
      'trash.noMatch': '没有匹配的会话',
      'trash.today': '今天',
      'trash.days': '{n} 天',
      'trash.restore': '恢复',
      'trash.purge': '彻底删除',
      'trash.restoreUnavailable': '缺少原工作区信息，无法恢复',
      'trash.restored': '已恢复会话',
      'trash.purged': '已彻底删除',
      'trash.cleared': '回收站已清空',
      'trash.clearTitle': '清空回收站',
      'trash.clearDesc': '将永久删除回收站里的 {n} 个会话，无法恢复。',
      'trash.purgeTitle': '彻底删除会话',
      'trash.purgeDesc': '「{title}」会被永久删除，无法恢复。',
      'trash.clearAction': '清空',
      'trash.cancel': '取消',
      'trash.close': '关闭',
      'trash.failed': '操作失败：{message}',
      'hover.deletedToday': '今天移入回收站',
      'hover.deletedDays': '{n} 天前移入回收站',
    }

    const en = {
      'menu.delete': 'Delete session',
      'dialog.title': 'Delete session',
      'dialog.desc': 'Move “{title}” to the trash. Its files remain under ~/.dsh/session-trash and can be restored manually.',
      'dialog.note': 'The session disappears from the list after deletion.',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete',
      'dialog.pending': 'Deleting…',
      'dialog.close': 'Close',
      'dialog.current': 'This is the session you are using. Switch to another session (or start a new one) before deleting it.',
      'trash.title': 'Trash',
      'trash.workspace': 'Workspaces',
      'trash.count': '{n}',
      'trash.search': 'Search trash',
      'trash.clear': 'Empty trash',
      'trash.loading': 'Loading…',
      'trash.empty': 'The trash is empty',
      'trash.noMatch': 'No matching sessions',
      'trash.today': 'today',
      'trash.days': '{n} days',
      'trash.restore': 'Restore',
      'trash.purge': 'Delete permanently',
      'trash.restoreUnavailable': 'The original workspace is unknown; restore is unavailable',
      'trash.restored': 'Session restored',
      'trash.purged': 'Deleted permanently',
      'trash.cleared': 'Trash emptied',
      'trash.clearTitle': 'Empty trash',
      'trash.clearDesc': 'Permanently delete {n} sessions from the trash. This cannot be undone.',
      'trash.purgeTitle': 'Delete session permanently',
      'trash.purgeDesc': '“{title}” will be deleted permanently. This cannot be undone.',
      'trash.clearAction': 'Empty',
      'trash.cancel': 'Cancel',
      'trash.close': 'Close',
      'trash.failed': 'Action failed: {message}',
      'hover.deletedToday': 'Moved to trash today',
      'hover.deletedDays': 'Moved to trash {n} days ago',
    }

    /** Plugin context captured by `apply`; dialogs and the trash view call it. */
    let serviceCtx

    /** Pending confirmation shared by the delete menu row and its overlay dialog. */
    const pending = {
      current: null,
      listeners: new Set(),
      get() {
        return pending.current
      },
      set(value) {
        pending.current = value
        for (const listener of [...pending.listeners]) listener()
      },
      subscribe(listener) {
        pending.listeners.add(listener)
        return () => {
          pending.listeners.delete(listener)
        }
      },
    }

    function usePending() {
      return React.useSyncExternalStore(pending.subscribe, pending.get, pending.get)
    }

    /** Styles for the sidebar switch and its recycle-bin view; injected once. */
    const STYLE_ID = '@local/dsh-session-manager/sidebar.css'
    const CSS = `
.sm-mode-root{display:flex;flex-direction:column;height:100%;min-height:0}
[class*="panelList"]{margin-bottom:4px !important}
.sm-switch-row{flex:none;padding:0 14px 0 2px;margin-bottom:8px}
.sm-switch-item{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:7px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;text-align:left;box-sizing:border-box;transition:color 180ms var(--ds-ease-out, ease), background-color 140ms var(--ds-ease-out, ease)}
.sm-switch-item:hover,.sm-switch-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.sm-switch-item-trash{color:var(--dsw-alias-state-error-primary)}
.sm-switch-item-workspace{color:var(--dsw-alias-state-business-primary)}
.sm-switch-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:22px;color:inherit}
.sm-switch-count{flex:none;color:inherit;opacity:.75;font-size:12px;line-height:18px}
.sm-mode-body{flex:1;min-height:0;overflow:hidden;animation:sm-view-in 240ms cubic-bezier(.2,.7,.2,1)}
@keyframes sm-view-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.sm-mode-body{animation:none}.sm-switch-item{transition:none}}
.sm-mode-body>*{height:100%;min-height:0}
.sm-bin-root{display:flex;flex-direction:column;height:100%;min-height:0}
.sm-bin-head{flex:none;display:flex;align-items:flex-start;gap:5px;height:42px;padding:10px 12px 0 4px;box-sizing:border-box}
.sm-bin-title{font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sm-bin-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.sm-bin-actions{margin-left:auto;display:flex;align-items:center;gap:4px}
.sm-bin-icon{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);padding:0;cursor:pointer}
.sm-bin-icon:hover,.sm-bin-icon:focus-visible{background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}
.sm-bin-icon:disabled{color:var(--dsw-alias-label-caption);background:transparent;cursor:default}
.sm-bin-icon-danger:hover,.sm-bin-icon-danger:focus-visible{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.sm-bin-icon-compact{width:20px;height:20px;border-radius:var(--dsw-radius-xs)}
.sm-bin-search{padding:0 12px 6px 4px;flex:none}
.sm-bin-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:0 12px 8px 0}
.sm-bin-row{display:flex;align-items:center;height:32px;padding:0 8px;border-radius:var(--dsw-radius-sm);flex:none}
.sm-bin-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sm-bin-name{flex:1;min-width:0;font-size:14px;line-height:20px;margin-right:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sm-bin-days{flex:none;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums}
.sm-bin-row-actions{display:none;align-items:center;gap:2px;flex:none}
.sm-bin-row:hover .sm-bin-days{display:none}
.sm-bin-row:hover .sm-bin-row-actions{display:inline-flex}
.sm-hover{display:flex;flex-direction:column;gap:8px}
.sm-hover-title{color:#fff;font-size:14px;line-height:20px;overflow-wrap:break-word}
.sm-hover-meta{color:#cfd3d6;font-size:12px;line-height:16px}
.sm-bin-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center;padding:18px 12px}
.sm-bin-note{padding:0 12px 6px 4px;font-size:11px;line-height:16px;flex:none}
.sm-bin-error{color:var(--dsw-alias-state-error-primary)}
.sm-bin-notice{color:var(--dsw-alias-label-tertiary)}
.sm-danger-text{color:var(--dsw-alias-state-error-primary)}
`

    /**
     * Install the sidebar stylesheet once; return the disposer that removes it.
     * @returns the cleanup function.
     */
    function mountStyles() {
      if (typeof document === 'undefined') return () => {}
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-session-manager'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /**
     * One `sidebar.workspaces.session.menu.item` row.
     * @param props - row identity, owner menu state, and the locale seat.
     * @returns the menu row.
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
      const useMenu = typeof useMenuOpenState === 'function' ? useMenuOpenState : () => [false, () => {}]
      const [, setMenuOpen] = useMenu()
      return h(
        primitives.MenuItemButton,
        {
          danger: true,
          icon: h(primitives.IconTrashOutlineRegular, { size: 14 }),
          onSelect: () => {
            setMenuOpen(false)
            pending.set({ sessionId, title: displayTitle || sessionId })
          },
        },
        t('menu.delete'),
      )
    }

    /**
     * The `shell.overlay` entry: nothing while no confirmation is pending,
     * otherwise one dialog per request (keyed by the Session).
     * @param props - the locale seat.
     * @returns the open dialog, or null.
     */
    function DeleteSessionDialog({ t }) {
      const request = usePending()
      if (request === null) return null
      return h(DeleteSessionDialogForm, { request, t }, request.sessionId)
    }

    /**
     * One request's dialog: archive (which also stops running work) and then
     * ask the Host to move the Session's files into the trash.
     * @param props - the request and the locale seat.
     * @returns the dialog.
     */
    function DeleteSessionDialogForm({ request, t }) {
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      const close = () => {
        if (!busy) pending.set(null)
      }

      const confirm = async () => {
        const current = serviceCtx.uiSession?.current?.getSnapshot?.()?.sessionId
        if (current === request.sessionId) {
          setError(t('dialog.current'))
          return
        }
        setBusy(true)
        setError(null)
        try {
          const removeFromHost = async () => {
            const response = await fetch('/plugins/session-manager/delete', {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'content-type': 'application/json',
                'x-dsh-session-manager': '1',
              },
              body: JSON.stringify({ sessionId: request.sessionId }),
            })
            const body = await response.json().catch(() => ({}))
            return {
              ok: response.ok && body.ok === true,
              error: body.error || `HTTP ${String(response.status)}`,
            }
          }

          let result = await removeFromHost()
          if (!result.ok) {
            // A live Session can keep its log open; stop it, then retry the move.
            try {
              await serviceCtx.workspaces.archiveSession(request.sessionId, { stopActivity: true })
            } catch (_archiveFailure) {
              // Unknown or already archived: the retry reports the real reason.
            }
            await new Promise((resolve) => setTimeout(resolve, 400))
            result = await removeFromHost()
          }
          if (!result.ok) throw new Error(result.error)

          // Drop the row from the catalog directly. Archiving only as a retry
          // fallback means the common path never flashes the session as archived.
          try {
            serviceCtx.sessions.handleSessionRemoved?.(request.sessionId)
          } catch (_catalogFailure) {
            // The files are gone; the next catalog pull settles the list.
          }
          pending.set(null)
          window.dispatchEvent(new CustomEvent('dsh-session-manager:changed'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setBusy(false)
        }
      }

      return h(
        primitives.Modal,
        {
          open: true,
          onClose: close,
          closeLabel: t('dialog.close'),
          title: t('dialog.title'),
          description: t('dialog.desc', { title: request.title }),
          footer: h(
            React.Fragment,
            null,
            h(primitives.Button, { variant: 'outline', disabled: busy, onClick: close }, t('dialog.cancel')),
            h(
              primitives.Button,
              { variant: 'outline', className: 'sm-danger-text', disabled: busy, onClick: confirm },
              busy ? t('dialog.pending') : t('dialog.confirm'),
            ),
          ),
        },
        error !== null
          ? h('div', { role: 'alert', className: 'sm-bin-error', style: { marginTop: '8px' } }, error)
          : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, t('dialog.note')),
      )
    }

    /** @param days - whole days since deletion. @param t - locale seat. @returns the right-side label. */
    function daysLabel(days, t) {
      return days <= 0 ? t('trash.today') : t('trash.days', { n: days })
    }

    /**
     * Call the recycle-bin endpoint.
     * @param payload - `{ action, sessionId? }`.
     * @returns the parsed success body.
     */
    async function trashRequest(payload) {
      const response = await fetch('/plugins/session-manager/trash', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-dsh-session-manager': '1',
        },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok !== true) {
        throw new Error(body.error || `HTTP ${String(response.status)}`)
      }
      return body
    }

    /** Normalize a workspace path for comparison (separator and case tolerant). */
    function workspacePathKey(value) {
      if (typeof value !== 'string' || value === '') return ''
      return value.replace(/\\/g, '/').replace(/\/+$/, '')
    }

    function sameWorkspacePath(left, right) {
      const a = workspacePathKey(left)
      const b = workspacePathKey(right)
      return a !== '' && (a === b || a.toLowerCase() === b.toLowerCase())
    }

    /**
     * Move a restored Session back into its Workspace in the client snapshot.
     * The Host re-attaches it, but the Client's workspace frame may predate the
     * restore; `insertSessionBefore` merges the authoritative row immediately.
     * @param sessionId - restored Session id.
     * @param workspacePath - canonical Workspace path returned by the Host.
     */
    async function regroupRestoredSession(sessionId, workspacePath) {
      const snapshot = serviceCtx?.workspaces?.list?.getSnapshot?.()
      const items = Array.isArray(snapshot?.items) ? snapshot.items : []
      if (items.some((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))) return
      const target = items.find((item) => sameWorkspacePath(item.path, workspacePath))
      if (target === undefined) return
      const first = Array.isArray(target.sessionIds) ? target.sessionIds[0] : undefined
      await serviceCtx.workspaces.insertSessionBefore(
        target.workspaceId,
        sessionId,
        first === sessionId ? undefined : first,
      )
    }

    /**
     * Compact icon button with a tooltip, used by the header and the hover row.
     * @param props - label, disabled/danger flags, click handler, and icon.
     * @returns the button.
     */
    function BinIconButton({ label, disabled, danger, compact, onClick, children }) {
      const classes = ['sm-bin-icon']
      if (danger === true) classes.push('sm-bin-icon-danger')
      if (compact === true) classes.push('sm-bin-icon-compact')
      return h(
        primitives.Tooltip,
        { label, side: 'bottom', align: 'center', delayMs: 300, portal: true },
        h(
          'button',
          {
            type: 'button',
            className: classes.join(' '),
            'aria-label': label,
            disabled,
            onClick,
          },
          children,
        ),
      )
    }

    /**
     * One trashed Session row: title fills the line, age on the right, hover
     * swaps the age for restore / permanent-delete buttons.
     * @param props - row data, locale, busy flag, and the two actions.
     * @returns the row.
     */
    function BinRow({ row, t, busy, onRestore, onPurge }) {
      const when = row.days <= 0 ? t('hover.deletedToday') : t('hover.deletedDays', { n: row.days })
      const anchor = h(
        'div',
        { className: 'sm-bin-row', role: 'listitem' },
        h('span', { className: 'sm-bin-name' }, row.title),
        h('span', { className: 'sm-bin-days' }, daysLabel(row.days, t)),
        h(
          'span',
          { className: 'sm-bin-row-actions' },
          h(
            BinIconButton,
            {
              label: row.restorable ? t('trash.restore') : t('trash.restoreUnavailable'),
              disabled: busy || !row.restorable,
              compact: true,
              onClick: () => onRestore(row),
            },
            h(primitives.IconUnarchiveOutlineRegular, { size: 14 }),
          ),
          h(
            BinIconButton,
            { label: t('trash.purge'), danger: true, disabled: busy, compact: true, onClick: () => onPurge(row) },
            h(primitives.IconTrashOutlineRegular, { size: 14 }),
          ),
        ),
      )
      const content = h(
        'div',
        { className: 'sm-hover' },
        h('div', { className: 'sm-hover-title' }, row.title),
        h('div', { className: 'sm-hover-meta' }, when),
        h('div', { className: 'sm-hover-meta' }, row.sizeText),
      )
      return h(primitives.HoverCard, { anchor, content, openDelayMs: 800, grouped: true })
    }

    /**
     * Confirmation for emptying the whole trash or deleting one entry forever.
     * @param props - the request, locale, busy flag, and the two settlement callbacks.
     * @returns the dialog, or null while idle.
     */
    function BinConfirm({ request, t, busy, onCancel, onConfirm }) {
      if (request === null) return null
      const clear = request.kind === 'clear'
      return h(
        primitives.Modal,
        {
          open: true,
          onClose: onCancel,
          closeLabel: t('trash.close'),
          title: clear ? t('trash.clearTitle') : t('trash.purgeTitle'),
          description: clear
            ? t('trash.clearDesc', { n: request.count })
            : t('trash.purgeDesc', { title: request.row.title }),
          footer: h(
            React.Fragment,
            null,
            h(primitives.Button, { variant: 'outline', disabled: busy, onClick: onCancel }, t('trash.cancel')),
            h(
              primitives.Button,
              { variant: 'outline', className: 'sm-danger-text', disabled: busy, onClick: onConfirm },
              clear ? t('trash.clearAction') : t('trash.purge'),
            ),
          ),
        },
        null,
      )
    }

    /**
     * The sidebar's recycle-bin face: header with search / empty-trash / back,
     * the list, and its confirmations.
     * @param props - locale seat and the back-to-workspaces callback.
     * @returns the view.
     */
    function TrashSidebar({ t }) {
      const [data, setData] = React.useState({ status: 'loading', sessions: [], error: null })
      const [query, setQuery] = React.useState('')
      const [searchOpen, setSearchOpen] = React.useState(false)
      const [confirm, setConfirm] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const body = await trashRequest({ action: 'list' })
          setData({ status: 'ready', sessions: Array.isArray(body.sessions) ? body.sessions : [], error: null })
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : String(failure)
          setData((previous) => ({
            status: previous.status === 'ready' ? 'ready' : 'error',
            sessions: previous.sessions,
            error: message,
          }))
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      React.useEffect(() => {
        if (notice === null) return
        const timer = setTimeout(() => setNotice(null), 3000)
        return () => clearTimeout(timer)
      }, [notice])

      const announce = () => {
        window.dispatchEvent(new CustomEvent('dsh-session-manager:changed'))
      }

      const restore = async (row) => {
        setBusy(true)
        try {
          const restored = await trashRequest({ action: 'restore', sessionId: row.sessionId })
          // Re-pull the catalog now that the files are back, then clear the
          // archive flag so the row reappears without a process restart.
          try {
            await serviceCtx.sessions.refresh()
            // The restored projection cache carries the title; the catalog may
            // have cached a miss while the session sat in the trash.
            await serviceCtx.sessions.refreshProjections?.(row.sessionId)
          } catch (_refreshFailure) {
            // The files are back; a stale catalog only lasts until the next pull.
          }
          try {
            await regroupRestoredSession(row.sessionId, restored?.workspacePath)
          } catch (_regroupFailure) {
            // The Host accounting still wins; a stale client snapshot only
            // shows the row under Ungrouped until the next workspace frame.
          }
          try {
            await serviceCtx.workspaces.unarchiveSession?.(row.sessionId)
          } catch (_unarchiveFailure) {
            // The files are back; a stale archive flag is resolved on the next registry pass.
          }
          await load()
          announce()
          setNotice(t('trash.restored'))
        } catch (failure) {
          setNotice(t('trash.failed', { message: failure instanceof Error ? failure.message : String(failure) }))
        } finally {
          setBusy(false)
        }
      }

      const runConfirm = async () => {
        if (confirm === null) return
        setBusy(true)
        try {
          if (confirm.kind === 'clear') {
            await trashRequest({ action: 'clear' })
            await load()
            announce()
            setNotice(t('trash.cleared'))
          } else {
            await trashRequest({ action: 'purge', sessionId: confirm.row.sessionId })
            await load()
            announce()
            setNotice(t('trash.purged'))
          }
          setConfirm(null)
        } catch (failure) {
          setNotice(t('trash.failed', { message: failure instanceof Error ? failure.message : String(failure) }))
        } finally {
          setBusy(false)
        }
      }

      const term = query.trim().toLowerCase()
      const rows =
        term === ''
          ? data.sessions
          : data.sessions.filter(
              (row) =>
                row.title.toLowerCase().includes(term) ||
                row.sessionId.toLowerCase().includes(term) ||
                (typeof row.workspace === 'string' && row.workspace.toLowerCase().includes(term)),
            )

      const list =
        data.status === 'loading'
          ? h('div', { className: 'sm-bin-empty' }, t('trash.loading'))
          : rows.length === 0
            ? h('div', { className: 'sm-bin-empty' }, data.sessions.length === 0 ? t('trash.empty') : t('trash.noMatch'))
            : rows.map((row) =>
                h(BinRow, {
                  key: row.sessionId,
                  row,
                  t,
                  busy,
                  onRestore: restore,
                  onPurge: (value) => setConfirm({ kind: 'purge', row: value }),
                }),
              )

      return h(
        'div',
        { className: 'sm-bin-root' },
        h(
          'div',
          { className: 'sm-bin-head' },
          h('span', { className: 'sm-bin-title' }, t('trash.title')),
          data.sessions.length > 0 ? h('span', { className: 'sm-bin-count' }, t('trash.count', { n: rows.length })) : null,
          h(
            'div',
            { className: 'sm-bin-actions' },
            h(
              BinIconButton,
              { label: t('trash.search'), onClick: () => setSearchOpen((open) => !open) },
              h(primitives.IconSearchOutlineRegular, { size: 16 }),
            ),
            h(
              BinIconButton,
              {
                label: t('trash.clear'),
                danger: true,
                disabled: data.sessions.length === 0 || busy,
                onClick: () => setConfirm({ kind: 'clear', count: data.sessions.length }),
              },
              h(primitives.IconTrashOutlineRegular, { size: 16 }),
            ),
          ),
        ),
        searchOpen
          ? h(
              'div',
              { className: 'sm-bin-search' },
              h(primitives.Input, {
                type: 'search',
                icon: h(primitives.IconSearchOutlineRegular, { size: 14 }),
                value: query,
                placeholder: t('trash.search'),
                'aria-label': t('trash.search'),
                onChange: (event) => setQuery(event.target.value),
              }),
            )
          : null,
        data.error !== null ? h('div', { className: 'sm-bin-note sm-bin-error', role: 'alert' }, data.error) : null,
        notice !== null ? h('div', { className: 'sm-bin-note sm-bin-notice', role: 'status' }, notice) : null,
        h('div', { className: 'sm-bin-list', role: 'list' }, list),
        h(BinConfirm, { request: confirm, t, busy, onCancel: () => setConfirm(null), onConfirm: runConfirm }),
      )
    }

    /**
     * Replace the workspace browser's rendered component with a two-face switch:
     * the original browser, or the recycle bin. The original keeps every prop the
     * slot resolved for its own registration.
     * @param props - the original component, the props resolved for it, and the locale seat.
     * @returns the active face.
     */
    function SidebarSwitch({ original, originalProps, t }) {
      const [mode, setMode] = React.useState('workspaces')
      const [count, setCount] = React.useState(0)
      React.useEffect(() => {
        let active = true
        const refresh = async () => {
          try {
            const body = await trashRequest({ action: 'list' })
            if (active) setCount(Array.isArray(body.sessions) ? body.sessions.length : 0)
          } catch (_unavailable) {
            // The panel is still usable; the count simply stays hidden.
          }
        }
        void refresh()
        window.addEventListener('dsh-session-manager:changed', refresh)
        return () => {
          active = false
          window.removeEventListener('dsh-session-manager:changed', refresh)
        }
      }, [])

      // The collapsed rail has no room for the switch row; leave it to the shell.
      if (originalProps?.wide === false) return h(original, originalProps)

      const trash = mode === 'trash'
      return h(
        'div',
        { className: 'sm-mode-root' },
        h(
          'div',
          { className: 'sm-switch-row' },
          h(
            'button',
            {
              type: 'button',
              className: trash ? 'sm-switch-item sm-switch-item-workspace' : 'sm-switch-item sm-switch-item-trash',
              onClick: () => setMode(trash ? 'workspaces' : 'trash'),
            },
            h(trash ? primitives.IconWorkspaceTreeOutlineRegular : primitives.IconTrashOutlineRegular, { size: 16 }),
            h('span', { className: 'sm-switch-label' }, trash ? t('trash.workspace') : t('trash.title')),
            trash || count === 0 ? null : h('span', { className: 'sm-switch-count' }, String(count)),
          ),
        ),
        h(
          'div',
          { className: 'sm-mode-body', key: trash ? 'trash' : 'workspaces' },
          trash ? h(TrashSidebar, { t }) : h(original, originalProps),
        ),
      )
    }

    /**
     * Wrap the workspace browser's registration so the sidebar can flip between
     * the workspace list and the recycle bin. Best effort: when the slot does not
     * expose exactly one component, the sidebar is left untouched.
     * @param ctx - plugin context.
     * @param t - locale seat bound to this plugin.
     */
    function attachSidebarSwitch(ctx, t) {
      const tryWrap = () => {
        let entries
        try {
          entries = ctx.slots.entries('sidebar.workspaces')
        } catch (_unsupported) {
          return false
        }
        if (!Array.isArray(entries) || entries.length !== 1) return false
        const entry = entries[0]
        if (entry.__sessionManagerSwitch === true) return true
        const original = entry.component
        if (typeof original !== 'function') return false
        entry.__sessionManagerSwitch = true
        entry.component = function SessionManagerSidebar(props) {
          return h(SidebarSwitch, { original, originalProps: props, t })
        }
        return true
      }

      if (tryWrap()) return
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        if (tryWrap() || attempts > 200) clearInterval(timer)
      }, 25)
      ctx.effect(() => () => clearInterval(timer), 'session-manager: attach retry')
    }

    function apply(ctx) {
      serviceCtx = ctx
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-manager: dictionaries')
      ctx.effect(() => mountStyles(), 'session-manager: sidebar styles')

      const t = ctx.locale.bind(NS)
      attachSidebarSwitch(ctx, t)

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'session-manager.delete',
            order: 500,
            locale: NS,
          },
          DeleteSessionMenuItem,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'session-manager.delete-dialog',
            locale: NS,
          },
          DeleteSessionDialog,
        ),
      )
    }

    return { inject, apply }
  },
})

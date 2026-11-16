import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth, request } from '../../services/auth.js'
import { useChatStore, setSessionPlugin } from '../../services/chat/store.js'
import { setDraftMessagePlugin } from '../../services/chat/drafts.js'
import { usePlugins } from '../../services/plugins/store.js'
import type { Plugin, PluginScope } from '../../services/plugins/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { PluginIcon } from './PluginIcon.js'
import { closePluginMarket, usePluginMarket } from './pluginMarketState.js'
import styles from './PluginMarketDialog.module.css'

type AdminPlugin = Plugin & {
  prompt: string
  defaultEnabled: boolean
  globalEnabled: boolean
}

type MarketPlugin = Plugin & Partial<Pick<AdminPlugin, 'prompt' | 'defaultEnabled' | 'globalEnabled'>>

type FormState = {
  name: string
  command: string
  icon: string
  category: string
  description: string
  prompt: string
  scope: PluginScope
  defaultEnabled: boolean
  enabled: boolean
  featured: boolean
  auto: boolean
  sortOrder: number
}

const FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'featured', label: '推荐' },
  { value: 'study', label: '学习' },
  { value: 'writing', label: '写作' },
  { value: 'office', label: '办公' },
  { value: 'code', label: '编程' },
  { value: 'general', label: '通用' },
  { value: 'enabled', label: '已启用' },
]

const CATEGORY_LABELS: Record<string, string> = {
  study: '学习', writing: '写作', office: '办公', code: '编程', general: '通用',
}

const ICON_KEYS = ['sparkles', 'target', 'book', 'pen', 'translate', 'code', 'list', 'slides', 'doc', 'table', 'puzzle', 'compress']

const emptyForm = (): FormState => ({
  name: '', command: '', icon: 'sparkles', category: 'general', description: '',
  prompt: '', scope: 'conversation', defaultEnabled: true, enabled: true,
  featured: false, auto: false, sortOrder: 100,
})

const formFrom = (plugin: AdminPlugin): FormState => ({
  name: plugin.name, command: plugin.command, icon: plugin.icon, category: plugin.category,
  description: plugin.description, prompt: plugin.prompt, scope: plugin.scope,
  defaultEnabled: plugin.defaultEnabled, enabled: plugin.globalEnabled,
  featured: plugin.featured, auto: plugin.auto, sortOrder: plugin.sortOrder,
})

export const PluginMarketDialog = () => {
  const open = usePluginMarket((state) => state.open)
  return open ? <PluginMarketContent /> : null
}

const PluginMarketContent = () => {
  const user = useAuth((state) => state.user)
  const isAdmin = user?.role === 'admin'
  const initial = usePluginMarket.getState()
  const plugins = usePlugins((state) => state.plugins)
  const loading = usePlugins((state) => state.loading)
  const loadError = usePlugins((state) => state.error)
  const [selectedId, setSelectedId] = useState<string | null>(initial.pluginId)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [manage, setManage] = useState(Boolean(initial.manage && isAdmin))
  const [adminPlugins, setAdminPlugins] = useState<AdminPlugin[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [editing, setEditing] = useState<AdminPlugin | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminPlugin | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadAdmin = useCallback(async () => {
    setAdminLoading(true)
    setAdminError('')
    try {
      const data = await request<{ plugins: AdminPlugin[] }>('/api/admin/plugins')
      setAdminPlugins(data.plugins)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : '插件加载失败')
    } finally {
      setAdminLoading(false)
    }
  }, [])

  useEffect(() => { void usePlugins.getState().load() }, [])
  useEffect(() => {
    if (isAdmin && manage) {void loadAdmin()}
  }, [isAdmin, manage, loadAdmin])

  const source: MarketPlugin[] = manage ? adminPlugins : plugins
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    return source.filter((plugin) => {
      if (filter === 'enabled' && !plugin.enabled) {return false}
      if (filter === 'featured' && !plugin.featured) {return false}
      if (!['all', 'enabled', 'featured'].includes(filter) && plugin.category !== filter) {return false}
      if (!value) {return true}
      return [plugin.name, plugin.command, plugin.description]
        .some((text) => text.toLowerCase().includes(value))
    })
  }, [filter, query, source])
  const selected = selectedId ? source.find((plugin) => plugin.id === selectedId) ?? null : null

  const close = () => {
    if (saving || deleting) {return}
    closePluginMarket()
  }

  const toggleUser = async (plugin: MarketPlugin, enabled: boolean) => {
    try {
      await usePlugins.getState().toggle(plugin.id, enabled)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败')
    }
  }

  const toggleGlobal = async (plugin: MarketPlugin, enabled: boolean) => {
    setAdminPlugins((current) => current.map((item) => item.id === plugin.id
      ? { ...item, enabled, globalEnabled: enabled }
      : item))
    try {
      await request(`/api/admin/plugins/${encodeURIComponent(plugin.id)}`, {
        method: 'PUT', body: JSON.stringify({ enabled }),
      })
      await usePlugins.getState().load()
    } catch (error) {
      setAdminPlugins((current) => current.map((item) => item.id === plugin.id
        ? { ...item, enabled: !enabled, globalEnabled: !enabled }
        : item))
      showToast(error instanceof Error ? error.message : '操作失败')
    }
  }

  const usePlugin = async (plugin: MarketPlugin) => {
    if (manage && plugin.globalEnabled === false) {
      showToast('该插件已全局停用，请先在管理态启用')
      return
    }
    if (!plugin.enabled) {
      try {
        await usePlugins.getState().toggle(plugin.id, true)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '启用插件失败')
        return
      }
    }
    const activeId = useChatStore.getState().activeId
    if (plugin.scope === 'conversation') {
      setSessionPlugin(activeId, plugin.id)
      showToast(`已启用「${plugin.name}」，直接提问即可`)
    } else {
      setDraftMessagePlugin(activeId, plugin.id)
      showToast(`「${plugin.name}」将在下一条消息生效`)
    }
    closePluginMarket()
  }

  const startEdit = (plugin?: AdminPlugin) => {
    setForm(plugin ? formFrom(plugin) : emptyForm())
    setEditing(plugin ?? 'new')
    setFormError('')
  }

  const save = async () => {
    const name = form.name.trim()
    const command = form.command.trim().toLowerCase()
    const prompt = form.prompt.trim()
    if (!name) { setFormError('请填写插件名称'); return }
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(command)) { setFormError('命令只能包含小写字母、数字和短横线，并以字母开头'); return }
    if (!prompt) { setFormError('请填写提示词'); return }
    setSaving(true)
    setFormError('')
    const body = {
      name, command, icon: form.icon, category: form.category,
      description: form.description.trim(), prompt, scope: form.scope,
      defaultEnabled: form.defaultEnabled, enabled: form.enabled,
      featured: form.featured, auto: form.auto, sortOrder: Number(form.sortOrder) || 100,
    }
    try {
      if (editing === 'new') {
        await request('/api/admin/plugins', { method: 'POST', body: JSON.stringify(body) })
      } else if (editing) {
        await request(`/api/admin/plugins/${encodeURIComponent(editing.id)}`, {
          method: 'PUT', body: JSON.stringify(body),
        })
      }
      setEditing(null)
      await loadAdmin()
      await usePlugins.getState().load()
      showToast('插件已保存')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) {return}
    setDeleting(true)
    try {
      await request(`/api/admin/plugins/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
      setDeleteTarget(null)
      if (selectedId === deleteTarget.id) {setSelectedId(null)}
      await loadAdmin()
      await usePlugins.getState().load()
      showToast('插件已删除')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const back = () => {
    if (saving) {return}
    setEditing(null)
    setFormError('')
    if (!editing) {setSelectedId(null)}
  }

  const detailVisible = Boolean(selected || editing)

  return (
    <>
      <Modal
        title={<span>插件广场 <small className={styles.subtitle}>让模型按专业方式完成任务</small></span>}
        closable
        onClose={close}
        className={styles.modal}
        mainClassName={styles.modalMain}
      >
        <div className={styles.layout}>
          {detailVisible ? (
            <div className={styles.detailPane}>
              <button type="button" className={styles.back} onClick={back}>← 返回</button>
              {editing ? (
                <div className={styles.form}>
                  <div className={styles.formHead}>
                    <div>
                      <h3>{editing === 'new' ? '新建插件' : '编辑插件'}</h3>
                      <p>{editing === 'new' ? '插件本质是一条可复用的系统提示词。' : `${editing.name} · /${editing.command}`}</p>
                    </div>
                  </div>
                  <label className={styles.field}>
                    <span>名称</span>
                    <input value={form.name} maxLength={40} placeholder="例如：解题导师"
                      disabled={editing !== 'new' && editing.builtin}
                      onChange={(event) => setForm({ ...form, name: event.target.value })} />
                  </label>
                  <div className={styles.twoCols}>
                    <label className={styles.field}>
                      <span>命令</span>
                      <input value={form.command} maxLength={24} placeholder="例如：solve"
                        disabled={editing !== 'new' && editing.builtin}
                        onChange={(event) => setForm({ ...form, command: event.target.value })} />
                    </label>
                    <label className={styles.field}>
                      <span>分类</span>
                      <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                        {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span>简介</span>
                    <input value={form.description} maxLength={200} placeholder="一句话说明它解决什么问题"
                      onChange={(event) => setForm({ ...form, description: event.target.value })} />
                  </label>
                  <div className={styles.field}>
                    <span>图标</span>
                    <div className={styles.iconPicker}>
                      {ICON_KEYS.map((key) => (
                        <button key={key} type="button" aria-label={key}
                          className={form.icon === key ? `${styles.iconChoice} ${styles.iconActive}` : styles.iconChoice}
                          onClick={() => setForm({ ...form, icon: key })}>
                          <PluginIcon icon={key} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className={styles.field}>
                    <span>提示词</span>
                    <textarea value={form.prompt} rows={9} maxLength={8000}
                      placeholder="描述模型在这个模式下应该如何工作"
                      onChange={(event) => setForm({ ...form, prompt: event.target.value })} />
                  </label>
                  <div className={styles.twoCols}>
                    <label className={styles.field}>
                      <span>生效范围</span>
                      <select value={form.scope} disabled={editing !== 'new' && editing.builtin}
                        onChange={(event) => setForm({ ...form, scope: event.target.value as PluginScope })}>
                        <option value="conversation">整个对话</option>
                        <option value="message">仅下一条消息</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>排序</span>
                      <input type="number" min={0} max={9999} value={form.sortOrder}
                        onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} />
                    </label>
                  </div>
                  <div className={styles.checkRow}>
                    <label><input type="checkbox" checked={form.defaultEnabled}
                      onChange={(event) => setForm({ ...form, defaultEnabled: event.target.checked })} /> 默认启用</label>
                    <label><input type="checkbox" checked={form.enabled}
                      onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> 全局启用</label>
                    <label><input type="checkbox" checked={form.featured}
                      onChange={(event) => setForm({ ...form, featured: event.target.checked })} /> 推荐</label>
                    <label><input type="checkbox" checked={form.auto}
                      onChange={(event) => setForm({ ...form, auto: event.target.checked })} /> 自动匹配</label>
                  </div>
                  {formError ? <p className={styles.error}>{formError}</p> : null}
                  <div className={styles.formActions}>
                    <Button variant="primary" size="m" disabled={saving} onClick={() => void save()}>
                      {saving ? '保存中…' : '保存'}
                    </Button>
                    <Button variant="outlined" size="m" disabled={saving} onClick={() => setEditing(null)}>取消</Button>
                  </div>
                </div>
              ) : selected ? (
                <div className={styles.detail}>
                  <div className={styles.detailHead}>
                    <span className={styles.iconLarge}><PluginIcon icon={selected.icon} /></span>
                    <div className={styles.detailTitle}>
                      <h3>{selected.name}{selected.featured ? <em>推荐</em> : null}{selected.auto ? <em>自动</em> : null}</h3>
                      <code>/{selected.command}</code>
                    </div>
                  </div>
                  <div className={styles.metaRow}>
                    <span>{CATEGORY_LABELS[selected.category] ?? '通用'}</span>
                    <span>{selected.scope === 'message' ? '仅下一条消息' : '整个对话'}</span>
                    {selected.builtin ? <span>内置</span> : null}
                    {selected.auto ? <span>自动匹配</span> : null}
                    {manage && selected.globalEnabled === false ? <span className={styles.off}>已全局停用</span> : null}
                  </div>
                  <p className={styles.detailDesc}>{selected.description}</p>
                  {'prompt' in selected && selected.prompt ? (
                    <div className={styles.promptBox}>
                      <span>提示词</span>
                      <pre>{selected.prompt}</pre>
                    </div>
                  ) : null}
                  <div className={styles.detailActions}>
                    <Button variant="primary" size="m" onClick={() => void usePlugin(selected)}>
                      {selected.scope === 'message' ? '用于下一条消息' : '用于此对话'}
                    </Button>
                    {manage ? (
                      <>
                        <Button variant="outlined" size="m" onClick={() => startEdit(selected as AdminPlugin)}>编辑</Button>
                        {!selected.builtin ? (
                          <Button variant="dangerOutlined" size="m" onClick={() => setDeleteTarget(selected as AdminPlugin)}>删除</Button>
                        ) : null}
                      </>
                    ) : (
                      <label className={styles.switchLabel}>
                        <span className={styles.switch}>
                          <input type="checkbox" checked={selected.enabled}
                            onChange={(event) => void toggleUser(selected, event.target.checked)} />
                          <span />
                        </span>
                        在此账号启用
                      </label>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <aside className={styles.rail}>
                <input className={styles.search} value={query} placeholder="搜索插件或命令"
                  onChange={(event) => setQuery(event.target.value)} />
                <div className={styles.filters}>
                  {FILTERS.map((item) => (
                    <button key={item.value} type="button"
                      className={filter === item.value ? `${styles.filter} ${styles.filterActive}` : styles.filter}
                      onClick={() => setFilter(item.value)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                {isAdmin ? (
                  <div className={styles.adminBox}>
                    <button type="button" className={manage ? `${styles.manageButton} ${styles.manageActive}` : styles.manageButton}
                      onClick={() => { setManage(!manage); setSelectedId(null); setEditing(null) }}>
                      {manage ? '退出管理' : '管理插件'}
                    </button>
                    {manage ? <button type="button" className={styles.createButton} onClick={() => startEdit()}>+ 新建插件</button> : null}
                  </div>
                ) : null}
              </aside>
              <div className={styles.gridPane}>
                {manage && adminLoading ? <p className={styles.state}>正在加载全部插件…</p> : null}
                {manage && adminError ? (
                  <div className={styles.state}>
                    <p>{adminError}</p>
                    <Button variant="outlined" size="s" onClick={() => void loadAdmin()}>重试</Button>
                  </div>
                ) : null}
                {!manage && loading && source.length === 0 ? <p className={styles.state}>正在加载插件…</p> : null}
                {!manage && loadError && source.length === 0 ? (
                  <div className={styles.state}>
                    <p>{loadError}</p>
                    <Button variant="outlined" size="s" onClick={() => void usePlugins.getState().load()}>重试</Button>
                  </div>
                ) : null}
                {filtered.length === 0 && !(manage ? adminLoading : loading) ? (
                  <p className={styles.state}>没有匹配的插件</p>
                ) : (
                  <div className={styles.grid}>
                    {filtered.map((plugin) => (
                      <article key={plugin.id} className={styles.card}>
                        <button type="button" className={styles.cardMain} onClick={() => setSelectedId(plugin.id)}>
                          <span className={styles.iconTile}><PluginIcon icon={plugin.icon} /></span>
                          <span className={styles.cardBody}>
                            <span className={styles.cardTitle}>{plugin.name}{plugin.featured ? <em>推荐</em> : null}{plugin.auto ? <em>自动</em> : null}</span>
                            <code className={styles.command}>/{plugin.command}</code>
                            <span className={styles.desc}>{plugin.description}</span>
                          </span>
                        </button>
                        <div className={styles.cardFoot}>
                          <span className={styles.scope}>{plugin.scope === 'message' ? '仅本次' : '对话'}</span>
                          <label className={styles.switch} aria-label={`启用 ${plugin.name}`}>
                            <input type="checkbox"
                              checked={manage ? plugin.globalEnabled === true : plugin.enabled}
                              onChange={(event) => manage
                                ? void toggleGlobal(plugin, event.target.checked)
                                : void toggleUser(plugin, event.target.checked)} />
                            <span />
                          </label>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
      {deleteTarget ? (
        <Modal
          title="删除插件"
          closable={!deleting}
          onClose={() => { if (!deleting) {setDeleteTarget(null)} }}
          footer={<>
            <Button variant="outlined" size="m" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="danger" size="m" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? '删除中…' : '确认删除'}
            </Button>
          </>}
        >
          <p>将删除「{deleteTarget.name}」（/{deleteTarget.command}），此操作不可撤销。已启用它的用户会失去该插件。</p>
        </Modal>
      ) : null}
    </>
  )
}

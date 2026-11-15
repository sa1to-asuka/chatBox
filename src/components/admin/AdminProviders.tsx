import { useState } from 'react'
import { request } from '../../services/auth.js'
import {
  IconCheckOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './AdminProviders.module.css'

export type AdminProvider = {
  id: string
  name: string
  type: 'openai' | 'anthropic'
  baseUrl: string
  enabled: number
  modelCount: number
}

export const AdminProviders = ({ providers, onChanged }: { providers: AdminProvider[]; onChanged: () => Promise<void> }) => {
  const [form, setForm] = useState({ name: '', type: 'openai' as 'openai' | 'anthropic', baseUrl: 'https://api.deepseek.com', apiKey: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [discovered, setDiscovered] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [providerId, setProviderId] = useState('')
  const [deleting, setDeleting] = useState<AdminProvider | null>(null)
  const resetFeedback = () => { setError(''); setNotice('') }
  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    resetFeedback()
    setBusy('add')
    try {
      await request('/api/admin/providers', { method: 'POST', body: JSON.stringify(form) })
      setNotice('供应商已添加')
      setForm((value) => ({ ...value, name: '', apiKey: '' }))
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加失败')
    } finally { setBusy('') }
  }
  const discover = async (provider: AdminProvider) => {
    resetFeedback()
    setBusy(provider.id)
    try {
      const data = await request<{ models: { id: string; name: string }[] }>(`/api/admin/providers/${provider.id}/discover`, { method: 'POST' })
      setProviderId(provider.id)
      setDiscovered(data.models)
      setSelected(new Set())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '获取模型失败')
    } finally { setBusy('') }
  }
  const importModels = async () => {
    if (!providerId || selected.size === 0) {return}
    setBusy(providerId)
    try {
      const chosen = discovered.filter((model) => selected.has(model.id))
      await request(`/api/admin/providers/${providerId}/import`, {
        method: 'POST', body: JSON.stringify({ models: chosen }),
      })
      setProviderId('')
      setDiscovered([])
      setSelected(new Set())
      setNotice(`已导入 ${chosen.length} 个模型`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败')
    } finally { setBusy('') }
  }
  const remove = async () => {
    if (!deleting) {return}
    setBusy(deleting.id)
    try {
      await request(`/api/admin/providers/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      setNotice('供应商及其模型已删除')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
    } finally { setBusy('') }
  }
  return <div className={styles.wrap}>
    {error ? <p className={styles.error}>{error}</p> : null}
    {notice ? <p className={styles.notice}>{notice}</p> : null}
    <div className={styles.layout}>
      <section className={styles.providers}>
        <div className={styles.sectionHead}><div><h3>已连接供应商</h3><p>上游模型接口与密钥只保存在服务器。</p></div><span>{providers.length} 个</span></div>
        {providers.length === 0 ? <div className={styles.empty}><IconPlusOutline16 /><strong>尚未连接供应商</strong><span>先在右侧添加一个 OpenAI 或 Anthropic 兼容接口。</span></div> : <div className={styles.grid}>
          {providers.map((provider) => <article className={styles.card} key={provider.id}>
            <div className={styles.cardTop}>
              <span className={styles.mark} data-type={provider.type}>{provider.type === 'openai' ? 'O' : 'A'}</span>
              <div><strong>{provider.name}</strong><span>{provider.type === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容'}</span></div>
              <span className={styles.connected}><i />已配置</span>
            </div>
            <p className={styles.url} title={provider.baseUrl}>{provider.baseUrl}</p>
            <div className={styles.cardMeta}><span><IconCheckOutline16 />密钥已保存</span><span>{provider.modelCount} 个模型</span></div>
            <div className={styles.cardActions}>
              <button type="button" className={styles.fetch} disabled={busy === provider.id} onClick={() => void discover(provider)}><IconRefreshOutline16 />{busy === provider.id ? '获取中…' : '获取模型'}</button>
              <button type="button" className={styles.delete} onClick={() => setDeleting(provider)} aria-label={`删除 ${provider.name}`}><IconTrashOutline16 />删除</button>
            </div>
          </article>)}
        </div>}
      </section>
      <form className={styles.form} onSubmit={add}>
        <div className={styles.formHead}><span><IconPlusOutline16 /></span><div><h3>添加供应商</h3><p>API Key 会加密保存，不会返回给浏览器。</p></div></div>
        <label>显示名称<input required maxLength={80} value={form.name} placeholder="例如 DeepSeek 官方" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>接口协议<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as 'openai' | 'anthropic' })}>
          <option value="openai">OpenAI 兼容</option>
          <option value="anthropic">Anthropic 兼容</option>
        </select></label>
        <label>API 基础地址<input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
        <label>API 密钥<input required type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="sk-..." /></label>
        <p className={styles.formHint}>DeepSeek 原生搜索请使用 Anthropic 兼容协议；OpenAI 兼容协议仅支持上游提供的网页搜索参数。</p>
        <button className={styles.primary} disabled={busy === 'add'}>{busy === 'add' ? '正在保存…' : '保存供应商'}</button>
      </form>
    </div>
    {providerId ? <Modal title="选择要导入的模型" closable onClose={() => setProviderId('')} className={styles.importDialog} footer={<>
      <button type="button" className={styles.cancel} onClick={() => setProviderId('')}>取消</button>
      <button type="button" className={styles.primary} disabled={busy === providerId || selected.size === 0} onClick={() => void importModels()}>导入选中模型（{selected.size}）</button>
    </>}>
      <div className={styles.importTools}><button type="button" onClick={() => setSelected(selected.size === discovered.length ? new Set() : new Set(discovered.map((model) => model.id)))}>{selected.size === discovered.length ? '取消全选' : '全选'}</button><span>共 {discovered.length} 个模型</span></div>
      <div className={styles.discovered}>{discovered.map((model) => <label key={model.id}>
        <input type="checkbox" checked={selected.has(model.id)} onChange={() => setSelected((old) => {
          const next = new Set(old)
          if (next.has(model.id)) {next.delete(model.id);} else {next.add(model.id)}
          return next
        })} />
        <span><strong>{model.name}</strong><small>{model.id}</small></span>
        {selected.has(model.id) ? <IconCheckOutline16 /> : null}
      </label>)}</div>
    </Modal> : null}
    {deleting ? <Modal title="删除供应商" closable onClose={() => setDeleting(null)} footer={<>
      <button type="button" className={styles.cancel} onClick={() => setDeleting(null)}>取消</button>
      <button type="button" className={styles.confirmDelete} disabled={busy === deleting.id} onClick={() => void remove()}>删除供应商</button>
    </>}>
      删除「{deleting.name}」会同时移除它下面的 {deleting.modelCount} 个模型。历史聊天和用量记录会保留，但用户将无法再选择这些模型。
    </Modal> : null}
  </div>
}

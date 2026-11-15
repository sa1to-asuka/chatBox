import { useState } from 'react'
import { request } from '../../services/auth.js'
import type { ModelCapabilities, SearchMode } from '../../../shared/types.js'
import {
  IconCheckOutline16,
  IconGlobeLanguageOutline14,
  IconPhotoOutline16,
  IconPlusOutline16,
  IconThinkOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './AdminModels.module.css'

export type AdminModel = {
  id: string
  providerId: string
  provider: string
  providerType: 'openai' | 'anthropic'
  upstreamId: string
  name: string
  premium: boolean
  multiplier: number
  enabled: boolean
  searchMode: SearchMode
  capabilities: ModelCapabilities
}
type ProviderOption = { id: string; name: string; type: 'openai' | 'anthropic' }

export const AdminModels = ({
  models,
  setModels,
  onChanged,
  providers,
}: {
  models: AdminModel[]
  setModels: (models: AdminModel[]) => void
  onChanged: () => Promise<void>
  providers: ProviderOption[]
}) => {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<AdminModel | null>(null)
  const patch = (id: string, change: (model: AdminModel) => AdminModel) =>
    setModels(models.map((model) => model.id === id ? change(model) : model))
  const save = async (model: AdminModel) => {
    setBusy(model.id)
    setError('')
    setNotice('')
    try {
      await request(`/api/admin/models/${model.id}`, { method: 'PATCH', body: JSON.stringify(model) })
      setNotice(`已保存「${model.name}」`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型保存失败')
    } finally { setBusy('') }
  }
  const remove = async () => {
    if (!deleting) {return}
    setBusy(deleting.id)
    try {
      await request(`/api/admin/models/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      setNotice('模型已删除')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
    } finally { setBusy('') }
  }
  return <div className={styles.wrap}>
    {error ? <p className={styles.error}>{error}</p> : null}
    {notice ? <p className={styles.notice}>{notice}</p> : null}
    <div className={styles.intro}><div><h3>模型目录</h3><p>控制用户能看到的模型、分级、倍率与原生联网方式。</p></div><span>{models.length} 个模型</span></div>
    {models.length === 0 ? <div className={styles.empty}><IconPlusOutline16 /><strong>还没有模型</strong><span>前往「供应商」获取模型并导入。</span></div> : <div className={styles.table}>
      <div className={styles.head} aria-hidden>
        <span>模型与模型商</span><span>倍率</span><span>联网方式</span><span>能力</span><span>权限与状态</span><span>操作</span>
      </div>
      {models.map((model) => <div className={styles.row} key={model.id}>
        <div className={styles.identity}>
          <input aria-label={`${model.name} 显示名称`} value={model.name} onChange={(event) => patch(model.id, (item) => ({ ...item, name: event.target.value }))} />
          <input className={styles.upstream} aria-label={`${model.name} 真实模型 ID`} value={model.upstreamId} onChange={(event) => patch(model.id, (item) => ({ ...item, upstreamId: event.target.value }))} />
          <span className={styles.providerInline}>
            <span className={styles.providerMark} data-type={model.providerType}>{model.providerType === 'openai' ? 'O' : 'A'}</span>
            <strong>{model.provider}</strong>
            <small>{model.providerType === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容'}</small>
          </span>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>积分倍率</span>
          <input type="number" min="0.01" step="0.1" value={model.multiplier} onChange={(event) => patch(model.id, (item) => ({ ...item, multiplier: Number(event.target.value) }))} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>联网方式</span>
          <select value={model.searchMode} onChange={(event) => patch(model.id, (item) => ({
            ...item, searchMode: event.target.value as SearchMode,
            capabilities: { ...item.capabilities, search: event.target.value !== 'none' },
          }))}>
            <option value="none">不启用</option>
            {model.providerType === 'openai' ? <option value="openai">OpenAI 搜索</option> : <>
              <option value="anthropic">Anthropic 搜索</option>
              <option value="deepseek">DeepSeek 搜索</option>
            </>}
          </select>
        </label>
        <div className={styles.capabilities}>
          <label title="支持图片输入"><input type="checkbox" checked={model.capabilities.vision} onChange={(event) => patch(model.id, (item) => ({ ...item, capabilities: { ...item.capabilities, vision: event.target.checked } }))} /><IconPhotoOutline16 /><span>图片</span></label>
          <label title="显示深度思考开关"><input type="checkbox" checked={model.capabilities.thinking} onChange={(event) => patch(model.id, (item) => ({ ...item, capabilities: { ...item.capabilities, thinking: event.target.checked } }))} /><IconThinkOutline16 /><span>思考</span></label>
          {model.searchMode !== 'none' ? <span className={styles.searchOn}><IconGlobeLanguageOutline14 />可联网</span> : null}
        </div>
        <div className={styles.status}>
          <label className={styles.switch}><input type="checkbox" checked={model.enabled} onChange={(event) => patch(model.id, (item) => ({ ...item, enabled: event.target.checked }))} /><span /><small>{model.enabled ? '已启用' : '已停用'}</small></label>
          <label className={styles.switch}><input type="checkbox" checked={model.premium} onChange={(event) => patch(model.id, (item) => ({ ...item, premium: event.target.checked }))} /><span /><small>{model.premium ? 'VIP 专享' : '普通模型'}</small></label>
        </div>
        <div className={styles.rowActions}>
          <button type="button" className={styles.save} disabled={busy === model.id} onClick={() => void save(model)}><IconCheckOutline16 />{busy === model.id ? '保存中' : '保存'}</button>
          <button type="button" className={styles.delete} aria-label={`删除 ${model.name}`} title="删除模型" onClick={() => setDeleting(model)}><IconTrashOutline16 /></button>
        </div>
      </div>)}
    </div>}
    {deleting ? <Modal title="删除模型" closable onClose={() => setDeleting(null)} footer={<>
      <button type="button" className={styles.cancel} onClick={() => setDeleting(null)}>取消</button>
      <button type="button" className={styles.confirmDelete} disabled={busy === deleting.id} onClick={() => void remove()}>确认删除</button>
    </>}>
      删除「{deleting.name}」后，用户将无法再选择该模型；历史用量记录不会删除。
    </Modal> : null}
    {providers.length === 0 ? <p className={styles.hint}>提示：先在「供应商」添加接口并获取模型。</p> : null}
  </div>
}

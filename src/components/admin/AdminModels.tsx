import { useEffect, useState } from 'react'
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
import { showToast } from '../base/toastState.js'
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

type AgentConfig = {
  enabled: boolean
  searchBackend: 'bing' | 'mimo' | 'none'
  searchModelId: string | null
  searchStyle: 'auto' | 'json' | 'native'
  presearch: boolean
  maxRounds: number
  maxSearches: number
  maxFiles: number
  deadlineMs: number
}

type AgentModel = {
  id: string
  name: string
  upstreamId: string
  provider: string
  type: string
  premium: boolean
  enabled: boolean
}

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
  const [deleting, setDeleting] = useState<AdminModel | null>(null)
  const [agent, setAgent] = useState<AgentConfig | null>(null)
  const [agentModels, setAgentModels] = useState<AgentModel[]>([])
  const [agentBusy, setAgentBusy] = useState('')
  const [probe, setProbe] = useState('')
  useEffect(() => {
    let active = true
    void request<{ config: AgentConfig; models: AgentModel[] }>('/api/admin/agent')
      .then((data) => {
        if (!active) {return}
        setAgent(data.config)
        setAgentModels(data.models)
      })
      .catch((cause) => { if (active) {showToast(cause instanceof Error ? cause.message : '智能体设置加载失败')} })
    return () => { active = false }
  }, [])
  const saveAgent = async () => {
    if (!agent) {return}
    setAgentBusy('save')
    try {
      const data = await request<{ config: AgentConfig }>('/api/admin/agent', {
        method: 'PUT',
        body: JSON.stringify(agent),
      })
      setAgent(data.config)
      showToast('智能体设置已保存')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setAgentBusy('')
    }
  }
  const probeAgent = async () => {
    setAgentBusy('probe')
    setProbe('')
    try {
      const result = await request<{
        ok: boolean; latencyMs?: number; backend?: string; summary?: string
        sources?: { title: string; url: string }[]; error?: string
      }>('/api/admin/agent/probe', {
        method: 'POST',
        body: JSON.stringify({ query: '2026 年 AI 行业最新动态' }),
      })
      setProbe(result.ok
        ? `联网正常（${result.latencyMs ?? 0}ms，${result.sources?.length ?? 0} 个来源）${result.sources?.[0] ? `：${result.sources[0].title}` : ''}`
        : `联网失败：${result.error ?? '未知错误'}`)
    } catch (cause) {
      setProbe(cause instanceof Error ? cause.message : '测试失败')
    } finally {
      setAgentBusy('')
    }
  }
  const patch = (id: string, change: (model: AdminModel) => AdminModel) =>
    setModels(models.map((model) => model.id === id ? change(model) : model))
  const save = async (model: AdminModel) => {
    setBusy(model.id)
    try {
      await request(`/api/admin/models/${model.id}`, { method: 'PATCH', body: JSON.stringify(model) })
      showToast(`已保存「${model.name}」`)
      await onChanged()
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '模型保存失败')
    } finally { setBusy('') }
  }
  const remove = async () => {
    if (!deleting) {return}
    setBusy(deleting.id)
    try {
      await request(`/api/admin/models/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      showToast('模型已删除')
      await onChanged()
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '删除失败')
    } finally { setBusy('') }
  }
  return <div className={styles.wrap}>
    <div className={styles.intro}><div><h3>模型目录</h3><p>控制用户能看到的模型、分级、倍率与原生联网方式。</p></div><span>{models.length} 个模型</span></div>
    {agent ? <section className={styles.agentCard}>
      <div className={styles.agentHead}>
        <div><h3>智能体联网</h3><p>AI 自动决定何时搜索；公共搜索提供实时网页（Google News 优先，搜狗/Bing 备用），MiMo 可作为结果摘要模型（它本身不执行实时检索）。</p></div>
        <label className={styles.agentToggle}>
          <input type="checkbox" checked={agent.enabled} onChange={(event) => setAgent({ ...agent, enabled: event.target.checked })} />
          <span>启用工具与自动联网</span>
        </label>
        <label className={styles.agentToggle}>
          <input type="checkbox" checked={agent.presearch} onChange={(event) => setAgent({ ...agent, presearch: event.target.checked })} />
          <span>每条消息先自动检索</span>
        </label>
      </div>
      <div className={styles.agentGrid}>
        <label className={styles.agentField}><span>搜索后端</span>
          <select value={agent.searchBackend} onChange={(event) => setAgent({ ...agent, searchBackend: event.target.value as AgentConfig['searchBackend'] })}>
            <option value="bing">公共搜索（Google News + 搜狗/Bing）</option>
            <option value="none">关闭搜索</option>
          </select>
        </label>
        <label className={styles.agentField}><span>摘要模型（可选）</span>
          <select value={agent.searchModelId ?? 'none'} onChange={(event) => setAgent({ ...agent, searchModelId: event.target.value === 'none' ? null : event.target.value })}>
            <option value="none">不使用摘要模型</option>
            {agentModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}
          </select>
        </label>
        <label className={styles.agentField}><span>最大工具轮数</span>
          <input type="number" min="1" max="12" value={agent.maxRounds} onChange={(event) => setAgent({ ...agent, maxRounds: Number(event.target.value) })} />
        </label>
        <label className={styles.agentField}><span>每次最多搜索</span>
          <input type="number" min="1" max="8" value={agent.maxSearches} onChange={(event) => setAgent({ ...agent, maxSearches: Number(event.target.value) })} />
        </label>
      </div>
      <div className={styles.agentActions}>
        <button type="button" className={styles.save} disabled={agentBusy !== ''} onClick={() => void saveAgent()}>{agentBusy === 'save' ? '保存中…' : '保存设置'}</button>
        <button type="button" className={styles.agentProbe} disabled={agentBusy !== ''} onClick={() => void probeAgent()}>{agentBusy === 'probe' ? '测试中…' : '测试联网'}</button>
        {probe ? <span className={styles.probeResult}>{probe}</span> : null}
      </div>
    </section> : null}
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
          <label title="允许模型调用联网/文件工具"><input type="checkbox" checked={model.capabilities.tools !== false} onChange={(event) => patch(model.id, (item) => ({ ...item, capabilities: { ...item.capabilities, tools: event.target.checked } }))} /><span>工具</span></label>
          {model.searchMode !== 'none' ? <span className={styles.searchOn}><IconGlobeLanguageOutline14 />可联网</span> : null}
        </div>
        <div className={styles.status}>
          <button type="button" role="switch" aria-checked={model.enabled} className={styles.switch} onClick={() => patch(model.id, (item) => ({ ...item, enabled: !item.enabled }))}><span /><small>{model.enabled ? '已启用' : '已停用'}</small></button>
          <button type="button" role="switch" aria-checked={model.premium} className={styles.switch} onClick={() => patch(model.id, (item) => ({ ...item, premium: !item.premium }))}><span /><small>{model.premium ? 'VIP 专享' : '普通模型'}</small></button>
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

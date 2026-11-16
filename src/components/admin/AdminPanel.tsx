import { useCallback, useEffect, useState } from 'react'
import { request } from '../../services/auth.js'
import type { PublicUser } from '../../../shared/types.js'
import { AdminModels, type AdminModel } from './AdminModels.js'
import { AdminPrompt } from './AdminPrompt.js'
import { AdminProviders, type AdminProvider } from './AdminProviders.js'
import { AdminUsers } from './AdminUsers.js'
import styles from './AdminPanel.module.css'
type Usage = { requestId: string; username: string; displayName: string; day: string; inputTokens: number; outputTokens: number; searchRequests: number; multiplier: number; charged: number; status: string; estimated: number; model: string }
export const adminTabs = ['概览', '用户', '供应商', '模型', '提示词', '用量'] as const
export type AdminTab = typeof adminTabs[number]
export const AdminPanel = ({ tab }: { tab: AdminTab }) => {
  const [overview, setOverview] = useState<Record<string, number>>({})
  const [users, setUsers] = useState<PublicUser[]>([])
  const [providers, setProviders] = useState<AdminProvider[]>([])
  const [models, setModels] = useState<AdminModel[]>([])
  const [usage, setUsage] = useState<Usage[]>([])
  const [error, setError] = useState('')
    const load = useCallback(async () => {
    try {
      const [summary, userList, providerList, modelList, logs] = await Promise.all([
        request<Record<string, number>>('/api/admin/overview'), request<{ users: PublicUser[] }>('/api/admin/users'),
        request<{ providers: AdminProvider[] }>('/api/admin/providers'), request<{ models: AdminModel[] }>('/api/admin/models'),
        request<{ usage: Usage[] }>('/api/admin/usage'),
      ])
      setOverview(summary); setUsers(userList.users); setProviders(providerList.providers); setModels(modelList.models); setUsage(logs.usage)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') }
  }, [])
  useEffect(() => { void load() }, [load])
  return <div className={styles.panel}>
    {error ? <p className={styles.error}>{error}</p> : null}
    {tab === '概览' ? <><h3>今天，一切尽在掌握。</h3><p className={styles.muted}>积分按北京时间每日重置，未用完的积分不结转。</p><div className={styles.stats}>{[['注册用户', overview.users], ['可用模型', overview.models], ['今日 Tokens', overview.todayTokens], ['今日消耗积分', overview.todayCharged], ['今日联网搜索', overview.todaySearches]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{Number(value ?? 0).toLocaleString()}</strong></div>)}</div><div className={styles.guide}><h4>开始使用</h4><ol><li>在「供应商」添加 OpenAI 或 Anthropic 兼容接口。</li><li>获取模型并勾选导入，再到「模型」设置高级标识、倍率和能力。</li><li>在「用户」提升 VIP 或单独调整每日积分。</li></ol></div></> : null}
    {tab === '用户' ? <AdminUsers users={users} onChanged={load} /> : null}
    {tab === '供应商' ? <AdminProviders providers={providers} onChanged={load} /> : null}
    {tab === '模型' ? <AdminModels models={models} setModels={setModels} onChanged={load} providers={providers} /> : null}
    {tab === '提示词' ? <AdminPrompt /> : null}
    {tab === '用量' ? <div className={styles.tableWrap}><table><thead><tr><th>用户 / 模型</th><th>日期</th><th>输入 / 输出</th><th>搜索</th><th>积分</th><th>状态</th></tr></thead><tbody>{usage.map((item) => <tr key={item.requestId}><td>{item.displayName}<small>{item.model}</small></td><td>{item.day}</td><td>{item.inputTokens.toLocaleString()} / {item.outputTokens.toLocaleString()}{item.estimated ? '（估算）' : ''}</td><td>{item.searchRequests ?? 0}</td><td>{item.charged.toLocaleString()}<small>× {item.multiplier}</small></td><td>{item.status}</td></tr>)}</tbody></table></div> : null}
  </div>
}

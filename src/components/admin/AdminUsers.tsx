import { useState } from 'react'
import { request } from '../../services/auth.js'
import type { PublicUser, Role } from '../../../shared/types.js'
import { IconPlusOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './AdminUsers.module.css'

const initialForm = {
  username: '', displayName: '', password: '', role: 'user' as Role,
  dailyQuota: '', unlimited: false, disabled: false,
}

export const AdminUsers = ({ users, onChanged }: { users: PublicUser[]; onChanged: () => Promise<void> }) => {
  const [form, setForm] = useState(initialForm)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const update = async (user: PublicUser, patch: object) => {
    setBusy(user.id)
    setError('')
    try {
      await request(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setNotice('用户设置已保存')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally { setBusy('') }
  }
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusy('create')
    try {
      const dailyQuota = form.dailyQuota.trim() === '' ? null : Number(form.dailyQuota)
      await request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, dailyQuota }),
      })
      setNotice(`已创建用户 ${form.username}`)
      setForm(initialForm)
      setCreating(false)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建用户失败')
    } finally { setBusy('') }
  }
  return <div className={styles.wrap}>
    {error ? <p className={styles.error}>{error}</p> : null}
    {notice ? <p className={styles.notice}>{notice}</p> : null}
    <div className={styles.intro}>
      <div><h3>用户管理</h3><p>创建账号，并管理角色、VIP、每日积分与停用状态。</p></div>
      <button type="button" className={styles.createButton} onClick={() => { setForm(initialForm); setCreating(true) }}>
        <IconPlusOutline16 />新建用户
      </button>
    </div>
    <div className={styles.table}>
      <div className={styles.head} aria-hidden>
        <span>用户</span><span>身份</span><span>每日积分</span><span>额度类型</span><span>账号状态</span><span>今日已用</span>
      </div>
      {users.map((user) => <div className={styles.row} key={user.id}>
        <div className={styles.identity}>
          <span className={styles.avatar}>{[...user.displayName][0]?.toUpperCase()}</span>
          <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>身份</span>
          <select value={user.role} disabled={busy === user.id} onChange={(event) => void update(user, { role: event.target.value })}>
            <option value="user">普通用户</option><option value="vip">VIP 用户</option><option value="admin">管理员</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>每日积分</span>
          <input type="number" min="0" defaultValue={user.dailyQuota} disabled={busy === user.id} onBlur={(event) => {
            const value = Number(event.target.value)
            if (Number.isSafeInteger(value) && value >= 0 && value !== user.dailyQuota) {void update(user, { dailyQuota: value })}
          }} />
        </label>
        <label className={styles.switch}><input type="checkbox" checked={user.unlimited} disabled={busy === user.id} onChange={(event) => void update(user, { unlimited: event.target.checked })} /><span />{user.unlimited ? '不限量' : '按额度'}</label>
        <label className={styles.switch}><input type="checkbox" checked={!user.disabled} disabled={busy === user.id} onChange={(event) => void update(user, { disabled: !event.target.checked })} /><span />{user.disabled ? '已停用' : '正常'}</label>
        <div className={styles.used}><b>{user.unlimited ? user.quotaUsed.toLocaleString() : user.quotaUsed.toLocaleString()}</b>{user.unlimited ? <small>不限量 · 实际已用</small> : <small>剩余 {(user.dailyQuota - user.quotaUsed - user.quotaReserved).toLocaleString()}</small>}</div>
      </div>)}
    </div>
    {users.length === 0 ? <p className={styles.empty}>还没有用户，点击右上角“新建用户”。</p> : null}
    <p className={styles.hint}>管理员/普通用户角色变化、停用或改密后，旧登录会话会立即失效。创建管理员请谨慎。</p>
    {creating ? <Modal title="新建用户" closable onClose={() => !busy && setCreating(false)} footer={<>
      <button type="button" className={styles.cancel} onClick={() => setCreating(false)}>取消</button>
      <button type="button" className={styles.primary} disabled={busy === 'create'} onClick={() => {
        const formElement = document.getElementById('admin-create-user-form') as HTMLFormElement | null
        formElement?.requestSubmit()
      }}>{busy === 'create' ? '创建中…' : '创建用户'}</button>
    </>}>
      <form id="admin-create-user-form" className={styles.form} onSubmit={(event) => void create(event)}>
        <div className={styles.formGrid}>
          <label>用户名<input required maxLength={32} autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="用于登录" /></label>
          <label>显示名称<input required maxLength={40} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="对话中显示" /></label>
          <label>初始密码<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="至少 8 个字符" /></label>
          <label>用户身份<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
            <option value="user">普通用户</option><option value="vip">VIP 用户</option><option value="admin">管理员</option>
          </select></label>
          <label>每日积分<input type="number" min="0" value={form.dailyQuota} onChange={(event) => setForm({ ...form, dailyQuota: event.target.value })} placeholder="留空使用角色默认值" /></label>
          <label className={styles.checkbox}><input type="checkbox" checked={form.unlimited} onChange={(event) => setForm({ ...form, unlimited: event.target.checked })} />不限量积分</label>
        </div>
        <p className={styles.formHint}>创建后请将初始密码安全地交给用户；用户可在账户菜单中修改密码。</p>
      </form>
    </Modal> : null}
  </div>
}

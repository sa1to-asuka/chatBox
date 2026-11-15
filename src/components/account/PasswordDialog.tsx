import { useState } from 'react'
import { request } from '../../services/auth.js'
import { Modal } from '../base/Modal.js'
import styles from './PasswordDialog.module.css'

export const PasswordDialog = ({ onClose }: { onClose: () => void }) => {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    setPending(true)
    setError('')
    try {
      await request('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
      setDone(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '修改失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }
  return <Modal title="修改密码" closable onClose={onClose}>
    {done ? <div className={styles.done}><p>密码已更新，其他设备上的旧登录已失效。</p><button onClick={onClose}>完成</button></div> : <form className={styles.form} onSubmit={submit}>
      <p>修改后，当前设备会保持登录，其他设备需要重新登录。</p>
      <label>当前密码<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label>新密码<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 个字符" /></label>
      <label>确认新密码<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <button className={styles.primary} disabled={pending}>{pending ? '正在保存…' : '保存新密码'}</button>
    </form>}
  </Modal>
}

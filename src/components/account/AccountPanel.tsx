import { useEffect, useRef, useState } from 'react'
import { logout, refreshUser, useAuth } from '../../services/auth.js'
import { navigate } from '../../services/navigation.js'
import { beijingResetAt } from '../../../shared/types.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconDataOutline16,
  IconFolderOutline16,
  IconLogoutOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import { PasswordDialog } from './PasswordDialog.js'
import styles from './AccountPanel.module.css'

const roleLabel = (role: string) => role === 'admin' ? '管理员' : role === 'vip' ? 'VIP 用户' : '普通用户'
const resetLabel = () => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
}).format(beijingResetAt())

export const AccountPanel = () => {
  const user = useAuth((state) => state.user)
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) {return}
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setSubmenu(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setSubmenu(false)
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  if (!user) { return null }
  const remaining = Math.max(0, user.dailyQuota - user.quotaUsed - user.quotaReserved)
  const openAccount = () => {
    const next = !open
    setOpen(next)
    setSubmenu(false)
    if (next) { void refreshUser() }
  }
  const run = (action: () => void) => {
    setOpen(false)
    setSubmenu(false)
    action()
  }
  return <>
    <div className={styles.account} ref={rootRef}>
      <button type="button" className={styles.profile} aria-expanded={open} aria-haspopup="dialog" onClick={openAccount}>
        <span className={styles.avatar}>{[...user.displayName][0]?.toUpperCase()}</span>
        <span className={styles.name}>
          <strong>{user.displayName}</strong>
          <span className={styles.subline}>
            <span className={styles.username}>@{user.username}</span>
            <em className={styles.role}>{roleLabel(user.role)}</em>
          </span>
        </span>
        <span className={open ? styles.chevronOpen : styles.chevron}><IconChevronDownOutline14 /></span>
      </button>
      {open ? <div className={styles.popover} role="dialog" aria-label="账户与额度">
        <div className={styles.quotaHead}>
          <span>{user.unlimited ? '今日已用' : '今日剩余'}</span>
          <strong>{user.unlimited ? user.quotaUsed.toLocaleString() : remaining.toLocaleString()}</strong>
          <small>{user.unlimited ? '积分不限量' : '积分'}</small>
        </div>
        <div className={styles.metrics}>
          <div><span>今日已用</span><b>{user.quotaUsed.toLocaleString()}</b></div>
          <div><span>生成中预留</span><b>{user.quotaReserved.toLocaleString()}</b></div>
          <div><span>每日额度</span><b>{user.unlimited ? '不限量' : user.dailyQuota.toLocaleString()}</b></div>
          <div><span>重置时间</span><b>{resetLabel()}</b></div>
        </div>
        <div className={submenu ? `${styles.actions} ${styles.actionsOpen}` : styles.actions}>
          <button type="button" className={styles.actionTrigger} aria-expanded={submenu} onClick={() => setSubmenu((value) => !value)}>
            <IconSettingsOutline16 />
            <span>账户操作</span>
            <span className={styles.actionArrow}><IconChevronRightOutline14 /></span>
          </button>
          <div className={styles.submenu} role="menu">
            {user.role === 'admin' ? <button type="button" role="menuitem" onClick={() => run(() => navigate('/admin'))}><IconSettingsOutline16 />管理后台</button> : null}
            <button type="button" role="menuitem" onClick={() => run(() => navigate('/usage'))}><IconDataOutline16 />积分与用量</button>
            <button type="button" role="menuitem" onClick={() => run(() => navigate('/files'))}><IconFolderOutline16 />文件管理</button>
            <button type="button" role="menuitem" onClick={() => run(() => setPasswordOpen(true))}><IconSettingsOutline16 />修改密码</button>
            <button type="button" role="menuitem" className={styles.logoutAction} onClick={() => run(() => void logout())}><IconLogoutOutline16 />退出登录</button>
          </div>
        </div>
      </div> : null}
    </div>
    {passwordOpen ? <PasswordDialog onClose={() => setPasswordOpen(false)} /> : null}
  </>
}

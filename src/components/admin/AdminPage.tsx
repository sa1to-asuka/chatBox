import { useState } from 'react'
import { logout, useAuth } from '../../services/auth.js'
import { navigate } from '../../services/navigation.js'
import { AdminPanel, adminTabs, type AdminTab } from './AdminPanel.js'
import { IconArrowLeftOutline16, IconRightUpOutline14 } from '../base/icons.js'
import styles from './AdminPage.module.css'

const descriptions: Record<AdminTab, string> = {
  概览: '今天的服务状态与使用概况',
  用户: '创建用户、管理角色、VIP 与每日积分',
  供应商: '连接并维护兼容的模型接口',
  模型: '控制展示、倍率与能力声明',
  提示词: '调整所有对话的基础行为与输出约束',
  用量: '查看最近的模型调用与结算',
}

export const AdminPage = () => {
  const user = useAuth((state) => state.user)
  const [tab, setTab] = useState<AdminTab>('概览')
  if (!user || user.role !== 'admin') {return null}
  return <div className={styles.page}>
    <aside className={styles.rail}>
      <button className={styles.brand} onClick={() => navigate('/')} aria-label="返回 Chatbox">
        <span className={styles.logo}>C</span>
        <span><strong>Chatbox</strong><small>ADMIN CONSOLE</small></span>
      </button>
      <p className={styles.navLabel}>管理工作区</p>
      <nav className={styles.nav} aria-label="管理后台导航">
        {adminTabs.map((item, index) => <button key={item} className={tab === item ? styles.active : ''} onClick={() => setTab(item)}>
          <span className={styles.index}>0{index + 1}</span>{item}
          {tab === item ? <span className={styles.dot} /> : null}
        </button>)}
      </nav>
      <div className={styles.railFoot}>
        <button className={styles.back} onClick={() => navigate('/')}><IconArrowLeftOutline16 />返回聊天</button>
        <div className={styles.identity}>
          <span className={styles.avatar}>{[...user.displayName][0]?.toUpperCase()}</span>
          <span><strong>{user.displayName}</strong><small>@{user.username} · 管理员</small></span>
        </div>
        <button className={styles.logout} onClick={() => void logout()}>退出登录</button>
      </div>
    </aside>
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <span>CHATBOX / 管理后台</span>
        <button onClick={() => navigate('/')}>打开聊天<IconRightUpOutline14 /></button>
      </header>
      <div className={styles.content}>
        <div className={styles.heading}>
          <p>CONTROL CENTER</p>
          <div><h1>{tab}</h1><span>{descriptions[tab]}</span></div>
        </div>
        <AdminPanel tab={tab} />
      </div>
    </main>
  </div>
}

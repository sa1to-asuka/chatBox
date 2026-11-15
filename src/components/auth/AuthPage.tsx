import { useEffect, useState } from 'react'
import { login } from '../../services/auth.js'
import { IconRightUpOutline14 } from '../base/icons.js'
import styles from './AuthPage.module.css'

export const AuthPage = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let alive = true
    fetch('/api/auth/config')
      .then((response) => response.ok ? response.json() as Promise<{ registration?: unknown }> : null)
      .then((data) => {
        if (alive && data?.registration === true) {setRegistrationOpen(true)}
      })
      .catch(() => { /* 公开注册不可用时保持关闭 */ })
    return () => { alive = false }
  }, [])
  useEffect(() => { if (!registrationOpen) {setMode('login')} }, [registrationOpen])
  useEffect(() => { setError('') }, [mode])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError('')
    try { await login(mode, username.trim(), displayName.trim() || username.trim(), password) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请稍后重试') }
    finally { setPending(false) }
  }
  return <main className={styles.page}>
    <section className={styles.intro}>
      <div className={styles.brand}><span className={styles.logo}>C</span>Chatbox</div>
      <div className={styles.introCopy}>
        <p className={styles.eyebrow}>YOUR QUIET AI WORKSPACE</p>
        <h1>把灵感，<br />聊成答案。</h1>
        <p>一个专注、轻盈的 AI 工作空间。<br />文字、图片与代码，都在这里自然衔接。</p>
      </div>
      <p className={styles.footnote}>由你掌控的私有智能助手</p>
    </section>
    <section className={styles.formArea}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.mobileBrand}><span className={styles.logo}>C</span>Chatbox</div>
        <p className={styles.kicker}>欢迎回来</p>
        <h2>{mode === 'login' ? '继续你的对话' : '创建你的账号'}</h2>
        <p className={styles.subtitle}>{mode === 'login' ? '登录后即可使用已开放的 AI 模型' : '注册后，每天都可以获得免费使用积分'}</p>
        {registrationOpen ? <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? styles.active : ''} onClick={() => setMode('login')}>登录</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? styles.active : ''} onClick={() => setMode('register')}>注册</button>
        </div> : null}
        <label>用户名<input autoComplete="username" required maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用于登录的用户名" /></label>
        {mode === 'register' ? <label>显示名称<input autoComplete="nickname" required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="对话中显示的名字" /></label> : null}
        <label>密码<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? '至少 8 个字符' : '输入你的密码'} /></label>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <button className={styles.submit} disabled={pending}>{pending ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}<span className={styles.submitIcon} aria-hidden><IconRightUpOutline14 /></span></button>
        <p className={styles.hint}>登录即表示你同意妥善使用本服务。<br />账号密码仅保存在本站服务器，不会发送给模型供应商。{registrationOpen ? null : <><br />公开注册已关闭，如需账号请联系管理员。</>}</p>
      </form>
    </section>
  </main>
}

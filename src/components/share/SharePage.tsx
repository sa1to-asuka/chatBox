import { useEffect, useState } from 'react'
import { IconLinkOutline16 } from '../base/icons.js'
import { Markdown } from '../markdown/Markdown.js'
import styles from './SharePage.module.css'

type SharedSource = { url: string; title: string }
type SharedMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  files?: { id: string; name: string; isImage: boolean }[]
  sources?: SharedSource[]
  createdAt: number
}
type SharedData = {
  title: string
  snapshot: { title: string; messages: SharedMessage[] }
  createdAt: number
}

export const SharePage = ({ token }: { token: string }) => {
  const [data, setData] = useState<SharedData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const value = await response.json() as SharedData & { error?: string }
        if (!response.ok) {throw new Error(value.error ?? '分享不存在')}
        if (!cancelled) {
          setData(value)
          document.title = `${value.title || '分享的对话'} · Chatbox`
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {setError(cause instanceof Error ? cause.message : '分享不存在或已撤销')}
      })
    return () => { cancelled = true }
  }, [token])
  return <main className={styles.page} data-print-root>
    <header className={styles.header} data-print-hide>
      <a className={styles.brand} href="/"><span className={styles.logo}>C</span>Chatbox</a>
      <span className={styles.viewOnly}>只读分享</span>
      <button type="button" onClick={() => window.print()}>打印 / PDF</button>
    </header>
    <div className={styles.content}>
      {error ? <div className={styles.error}><h1>无法打开分享</h1><p>{error}</p><a href="/">前往 Chatbox</a></div> : null}
      {!error && !data ? <p className={styles.loading}>正在加载分享…</p> : null}
      {data ? <>
        <div className={styles.heading}>
          <p>SHARED CONVERSATION</p>
          <h1>{data.title || '未命名对话'}</h1>
          <span>{new Date(data.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
        </div>
        <article className={styles.messages}>
          {data.snapshot.messages.map((message) => message.role === 'user'
            ? <section key={message.id} className={styles.user}>
                {message.files?.length ? <div className={styles.files}>{message.files.map((file) => file.isImage
                  ? <a key={file.id} href={`/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer"><img src={`/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(file.id)}`} alt={file.name} loading="lazy" /></a>
                  : <span key={file.id} className={styles.fileName}>{file.name}</span>)}</div> : null}
                {message.content ? <p className={styles.userText}>{message.content}</p> : null}
              </section>
            : <section key={message.id} className={styles.assistant}>
                <div className={styles.assistantHead}><span className={styles.miniLogo}>C</span>Chatbox</div>
                <Markdown content={message.content} loading={false} cacheKey={`${message.id}-shared`} disableLink={false} shareToken={token} />
                {message.sources?.length ? <div className={styles.sources}><span><IconLinkOutline16 />来源</span>{message.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>)}</div> : null}
              </section>)}
        </article>
        <footer className={styles.footer}><span>由 Chatbox 分享 · 内容由 AI 生成</span><a href="/">打开 Chatbox</a></footer>
      </> : null}
    </div>
  </main>
}

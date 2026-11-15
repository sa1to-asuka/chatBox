import { useEffect, useRef, useState } from 'react'
import { request } from '../../services/auth.js'
import { selectSession } from '../../services/chat/store.js'
import { IconSearchOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { closeGlobalSearch, useGlobalSearch } from './globalSearchState.js'
import styles from './SessionSearch.module.css'

type Match = { messageId: string; role: string; snippet: string; createdAt: number }
type Result = {
  id: string
  title: string
  updatedAt: number
  pinned: boolean
  folderId: string | null
  matches: Match[]
}

const reveal = (messageId: string) => {
  let tries = 0
  const timer = window.setInterval(() => {
    const element = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
    if (element) {
      window.clearInterval(timer)
      element.scrollIntoView({ block: 'center', behavior: 'smooth' })
      element.classList.add('chat-search-hit')
      window.setTimeout(() => element.classList.remove('chat-search-hit'), 2200)
    } else if (++tries > 60) {
      window.clearInterval(timer)
    }
  }, 100)
}

export const SessionSearch = () => {
  const open = useGlobalSearch((state) => state.open)
  return open ? <SessionSearchContent /> : null
}

const SessionSearchContent = () => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const value = query.trim()
    if (!value) {
      setResults([])
      setLoading(false)
      setError('')
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      request<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(value)}&limit=30`, { signal: controller.signal })
        .then((data) => {
          setResults(data.results)
          setActive(0)
          setError('')
        })
        .catch((cause) => {
          if (!controller.signal.aborted) {setError(cause instanceof Error ? cause.message : '搜索失败')}
        })
        .finally(() => {
          if (!controller.signal.aborted) {setLoading(false)}
        })
    }, 240)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const choose = (result: Result) => {
    closeGlobalSearch()
    selectSession(result.id)
    if (result.matches[0]?.messageId) {reveal(result.matches[0].messageId)}
  }

  return <Modal title="搜索对话" closable className={styles.dialog} mainClassName={styles.main} onClose={closeGlobalSearch}>
    <div className={styles.searchBox}>
      <IconSearchOutline16 />
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索标题或聊天内容"
        aria-label="搜索标题或聊天内容"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((value) => Math.min(results.length - 1, value + 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((value) => Math.max(0, value - 1))
          } else if (event.key === 'Enter' && results[active]) {
            event.preventDefault()
            choose(results[active])
          }
        }}
      />
      <kbd>Ctrl K</kbd>
    </div>
    <div className={styles.results} role="listbox" aria-label="搜索结果">
      {loading ? <p className={styles.state}>正在搜索…</p> : null}
      {!loading && error ? <p className={styles.error}>{error}</p> : null}
      {!loading && !error && !query.trim() ? <p className={styles.state}>输入关键词，搜索所有对话的标题和内容。</p> : null}
      {!loading && !error && query.trim() && results.length === 0 ? <p className={styles.state}>没有找到相关对话</p> : null}
      {results.map((result, index) => <button
        key={result.id}
        type="button"
        role="option"
        aria-selected={active === index}
        className={index === active ? styles.active : ''}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(result)}
      >
        <span className={styles.resultTop}><strong>{result.title || '未命名对话'}</strong><small>{new Date(result.updatedAt).toLocaleDateString('zh-CN')}</small></span>
        {result.matches.slice(0, 2).map((match) => <span key={match.messageId} className={styles.snippet}>{match.snippet}</span>)}
        {result.matches.length === 0 ? <span className={styles.snippet}>标题匹配</span> : null}
      </button>)}
    </div>
  </Modal>
}

import { useCallback, useEffect, useState } from 'react'
import { request } from '../../services/auth.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './AdminPrompt.module.css'

type PromptPayload = {
  prompt: string
  enabled: boolean
  defaultPrompt: string
  estimatedTokens: number
}

export const AdminPrompt = () => {
  const [prompt, setPrompt] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [tokens, setTokens] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const apply = (data: PromptPayload) => {
    setPrompt(data.prompt)
    setEnabled(data.enabled)
    setDefaultPrompt(data.defaultPrompt)
    setTokens(data.estimatedTokens)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      apply(await request<PromptPayload>('/api/admin/prompt'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!prompt.trim()) {
      setError('基础提示词不能为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      apply(await request<PromptPayload>('/api/admin/prompt', {
        method: 'PUT',
        body: JSON.stringify({ prompt, enabled }),
      }))
      showToast('基础提示词已保存')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setSaving(true)
    setError('')
    try {
      apply(await request<PromptPayload>('/api/admin/prompt/reset', { method: 'POST' }))
      showToast('已恢复默认提示词')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {return <p className={styles.state}>正在读取提示词…</p>}

  return (
    <div className={styles.wrap}>
      <section className={styles.intro}>
        <div>
          <h3>基础提示词</h3>
          <p>叠加在每次对话的最前面，决定模型如何理解意图、如何解题和输出。插件提示词会追加在它之后。</p>
        </div>
        <label className={styles.switch}>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span />
          {enabled ? '已启用' : '已关闭'}
        </label>
      </section>

      <label className={styles.editor}>
        <span>提示词内容</span>
        <textarea
          value={prompt}
          maxLength={12000}
          rows={16}
          spellCheck={false}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>

      <div className={styles.meta}>
        <span>{prompt.length.toLocaleString()} / 12,000 字</span>
        <span>约 {tokens.toLocaleString()} 输入 tokens / 次</span>
        <span>每次请求都会计入额度，请保持简洁</span>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.actions}>
        <Button variant="primary" size="l" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存提示词'}
        </Button>
        <Button variant="outlined" size="l" disabled={saving || prompt === defaultPrompt} onClick={() => void reset()}>
          恢复默认
        </Button>
      </div>

      <details className={styles.defaultBox}>
        <summary>查看默认提示词</summary>
        <pre>{defaultPrompt}</pre>
      </details>
    </div>
  )
}

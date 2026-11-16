import { useTranslate } from '../../i18n/index.js'
import { memo, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import Prism from 'prismjs'
import {
  getHighlightLang,
  isHighlightLoaded,
  loadHighlight,
} from '../../services/markdown/highlight.js'
import { IconCheckOutline16, IconCopyOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'
import { MermaidDiagram } from './MermaidDiagram.js'
import { SvgBlock } from './SvgBlock.js'
import { OfficeArtifact } from '../office/OfficeArtifact.js'
import { HtmlBlock } from './HtmlBlock.js'
import { officeKind } from '../../services/office/protocol.js'
import styles from './CodeBlock.module.css'

type CodeBlockProps = {
  code: string
  infostring: string
  loading?: boolean
  shareToken?: string
  /** 代码块 info 的附加参数，如 filename="…" sheet="…" */
  meta?: string
}

/** 代码块标题栏：左侧语言名，右侧复制 */
const CodeInfoRow = ({
  code,
  infostring,
  showDiagram,
  onToggleDiagram,
  left,
}: {
  code: string
  infostring: string
  showDiagram: boolean
  onToggleDiagram?: () => void
  left?: ReactNode
}) => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.container}>
      {left ?? (onToggleDiagram ? (
        <div className="md-code-block-switch" aria-label={t('mermaidSwitchLabel')}>
          <button
            type="button"
            className={styles.button}
            aria-pressed={showDiagram}
            onClick={() => !showDiagram && onToggleDiagram()}
          >
            {t('mermaidDiagram')}
          </button>
          <button
            type="button"
            className={styles.button}
            aria-pressed={!showDiagram}
            onClick={() => showDiagram && onToggleDiagram()}
          >
            {t('mermaidCode')}
          </button>
        </div>
      ) : (
        <span className={styles.name}>{infostring}</span>
      ))}
      <button
        type="button"
        className={styles.button}
        onClick={async () => {
          if (!(await copyText(code))) {
            showToast({ key: 'copyFailed' })
            return
          }
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        <span>{t(copied ? 'copied' : 'copy')}</span>
      </button>
    </div>
  )
}

const deckKind = (infostring: string, code: string): 'pptx' | null => {
  const language = infostring.trim().toLowerCase()
  if (language && language !== 'json') {return null}
  if (!/"slides"\s*:/.test(code)) {return null}
  try {
    const value = JSON.parse(code) as { slides?: unknown }
    return Array.isArray(value.slides) && value.slides.length > 0 ? 'pptx' : null
  } catch {
    return null
  }
}

/** Office 代码块走下载卡片；其余语言保持原有代码高亮。 */
export const CodeBlock = memo(function CodeBlock(props: CodeBlockProps) {
  const directKind = officeKind(props.infostring)
  const kind = directKind ?? deckKind(props.infostring, props.code)
  if (kind) {
    return <OfficeArtifact
      kind={kind}
      code={props.code}
      meta={props.meta}
      loading={props.loading}
      autoSave={!directKind && !props.shareToken}
    />
  }
  const language = props.infostring.trim().toLowerCase()
  if (language === 'html' || language === 'htm') {
    return <HtmlBlock code={props.code} loading={props.loading} />
  }
  return <CodeBlockImpl {...props} />
})

/** 代码块：语言包按需加载，不支持或尚未加载的语言按纯文本显示 */
const CodeBlockImpl = memo(function CodeBlockImpl({
  code,
  infostring,
  loading = false,
  shareToken,
}: CodeBlockProps) {
  const language = infostring.toLowerCase()
  const isMermaid = language === 'mermaid'
  const isSvg = language === 'svg' || ((!language || language === 'xml' || language === 'html') && /<svg[\s>]/i.test(code) && code.trim().length < 300_000)
  const [showDiagram, setShowDiagram] = useState(true)
  // 语言包注册在全局 Prism 上，每次渲染直接判断；加载完成后触发一次重渲染
  const rerender = useReducer((n: number) => n + 1, 0)[1]
  const lang = getHighlightLang(infostring)
  const loaded = lang !== null && isHighlightLoaded(lang)
  useEffect(() => {
    if (lang === null || loaded) {
      return
    }
    let unmounted = false
    loadHighlight(lang).then(() => {
      if (!unmounted) {
        rerender()
      }
    })
    return () => {
      unmounted = true
    }
  }, [lang, loaded, rerender])
  const renderedHtml = useMemo(() => {
    const name = lang !== null && loaded ? lang : 'plaintext'
    return Prism.highlight(code, Prism.languages[name], name)
  }, [code, lang, loaded])
  return (
    <div className="md-code-block">
      <div className="md-code-block-banner">
        <CodeInfoRow
          code={code}
          infostring={infostring}
          showDiagram={showDiagram}
          onToggleDiagram={isMermaid ? () => setShowDiagram((show) => !show) : undefined}
          left={isSvg ? <div className={styles.switcher}>
            <button type="button" className={styles.button} aria-pressed={showDiagram} onClick={() => setShowDiagram(true)}>预览</button>
            <button type="button" className={styles.button} aria-pressed={!showDiagram} onClick={() => setShowDiagram(false)}>源码</button>
          </div> : undefined}
        />
      </div>
      {isMermaid && showDiagram ? (
        <MermaidDiagram code={code} loading={loading} />
      ) : isSvg && showDiagram && !loading ? (
        <SvgBlock code={code} shareToken={shareToken} />
      ) : (
        <pre dangerouslySetInnerHTML={{ __html: renderedHtml }}></pre>
      )}
    </div>
  )
})

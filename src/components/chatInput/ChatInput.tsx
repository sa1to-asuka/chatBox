import clsx from 'clsx'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  IconGlobeLanguageOutline14,
  IconPluginOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  compactSession,
  flushSession,
  newChat,
  sendFileTask,
  sendMessage,
  setSessionPlugin,
  stopReply,
  useChatStore,
} from '../../services/chat/store.js'
import {
  addDraftFiles,
  clearDraft,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftMessagePlugin,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { enabledPlugins, usePlugins } from '../../services/plugins/store.js'
import { detectAutoPlugin, parseSlashCommand, slashQuery } from '../../services/plugins/slash.js'
import { detectFileTaskFormat, isWorkspaceSource } from '../../services/workspace/intent.js'
import type { Plugin } from '../../services/plugins/types.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { isImage, resolveMimeType, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import { ModelPicker } from './ModelPicker.js'
import { AttachmentPicker } from './AttachmentPicker.js'
import { useModels } from '../../services/models.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { openPluginMarket } from '../plugins/pluginMarketState.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'
import { PluginChip } from './PluginChip.js'
import { SlashMenu, type SlashItem } from './SlashMenu.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const selectedModel = useModels((state) => state.models.find((model) => model.id === state.selected))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  const listboxId = useId()
  const plugins = usePlugins((state) => state.plugins)
  const session = useChatStore((state) => sessionId === null ? undefined : state.sessionCache[sessionId])
  const conversationPluginId = session?.pluginId ?? draft.pluginId ?? null
  const conversationPlugin = plugins.find((plugin) => plugin.id === conversationPluginId)
  const messagePlugin = plugins.find((plugin) => plugin.id === draft.messagePluginId)
  const fileTaskFormat = attachments.length === 1 && isWorkspaceSource(attachments[0].file.name)
    ? detectFileTaskFormat(text)
    : null
  const autoPlugin = conversationPlugin || messagePlugin || fileTaskFormat ? null : detectAutoPlugin(plugins, text)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [compactOpen, setCompactOpen] = useState(false)
  const [compactTarget, setCompactTarget] = useState<string | null>(null)
  const [compactCount, setCompactCount] = useState(0)
  const [compacting, setCompacting] = useState(false)
  const [compactError, setCompactError] = useState('')

  const menuItems = useMemo<SlashItem[]>(() => {
    const query = menuQuery.trim().toLowerCase()
    const matches = (value: string) => !query || value.toLowerCase().includes(query)
    const commands: SlashItem[] = [
      { key: 'command-skills', kind: 'command' as const, command: 'skills', name: '插件广场', description: '浏览、启用或管理插件', icon: 'puzzle' },
      { key: 'command-compact', kind: 'command' as const, command: 'compact', name: '压缩上下文', description: '把早期消息折叠成摘要，继续当前对话', icon: 'compress' },
      { key: 'command-clear', kind: 'command' as const, command: 'clear', name: '新对话', description: '清空当前上下文，原对话保留在历史中', icon: 'sparkles' },
    ].filter((item) => matches(item.command) || matches(item.name) || matches(item.description))
    const pluginItems = enabledPlugins(plugins)
      .filter((plugin) => matches(plugin.command) || matches(plugin.name) || matches(plugin.description))
      .map((plugin): SlashItem => ({
        key: `plugin-${plugin.id}`,
        kind: 'plugin',
        command: plugin.command,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon,
        scope: plugin.scope,
      }))
    return [...commands, ...pluginItems]
  }, [menuQuery, plugins])

  const updateMenu = (value: string) => {
    if (composingRef.current) {return}
    const query = slashQuery(value)
    if (query === null) {
      setMenuOpen(false)
      setMenuQuery('')
      setActiveIndex(-1)
      return
    }
    setMenuOpen(true)
    setMenuQuery(query)
    setActiveIndex(query ? 0 : -1)
  }

  const applyPlugin = (plugin: Plugin) => {
    if (plugin.scope === 'conversation') {
      setSessionPlugin(sessionId, plugin.id)
      showToast(`已启用「${plugin.name}」，直接提问即可`)
    } else {
      setDraftMessagePlugin(sessionId, plugin.id)
      showToast(`「${plugin.name}」将在下一条消息生效`)
    }
  }

  const openCompact = () => {
    if (!sessionId) {
      showToast('当前还没有可压缩的对话')
      return
    }
    if (streaming) {
      showToast('请先停止生成')
      return
    }
    if (!session) {
      showToast('会话还在加载，请稍后再试')
      return
    }
    const compacted = new Set(session.compactedIds ?? [])
    const count = getVisibleMessages(session).filter((message) => !compacted.has(message.id)).length
    if (count <= 8) {
      showToast('对话太短，无需压缩')
      return
    }
    setCompactTarget(sessionId)
    setCompactCount(count)
    setCompactError('')
    setCompactOpen(true)
  }

  const confirmCompact = async () => {
    if (!compactTarget || compactTarget !== sessionId) {
      setCompactOpen(false)
      return
    }
    setCompacting(true)
    setCompactError('')
    try {
      const result = await compactSession(compactTarget)
      setCompactOpen(false)
      showToast(`已压缩 ${result.compactedIds.length} 条早期消息`)
    } catch (error) {
      setCompactError(error instanceof Error ? error.message : '压缩失败，请稍后重试')
    } finally {
      setCompacting(false)
    }
  }

  const runCommand = (command: 'clear' | 'compact' | 'skills') => {
    if (command === 'skills') {
      openPluginMarket()
      return
    }
    if (command === 'compact') {
      openCompact()
      return
    }
    if (sessionId) {
      stopReply(sessionId)
      void flushSession(sessionId)
    }
    clearDraft(sessionId)
    clearDraft(null)
    newChat()
    closeMobileSider()
  }

  const selectItem = (item: SlashItem) => {
    setMenuOpen(false)
    setMenuQuery('')
    setActiveIndex(-1)
    if (item.kind === 'command') {
      setText('')
      runCommand(item.command as 'clear' | 'compact' | 'skills')
      return
    }
    const plugin = plugins.find((entry) => entry.command === item.command)
    if (!plugin) {return}
    applyPlugin(plugin)
    if (/^\/[^\s]*$/.test(getDraft(sessionId).text)) {setText('')}
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
  }

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    if (!selectedModel) {
      showToast('当前没有可用模型，请联系管理员配置模型')
      return
    }
    if (!selectedModel.capabilities.vision && files.some((file) => isImage(resolveMimeType(file)))) {
      showToast('当前模型不支持图片，请切换支持视觉的模型')
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  useEffect(() => {
    if (selectedModel && !selectedModel.capabilities.thinking && thinking) {setThinking(false)}
    if (selectedModel && !selectedModel.capabilities.search && search) {setSearch(false)}
  }, [selectedModel, thinking, search])

  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady && Boolean(selectedModel)

  const send = () => {
    if (!selectedModel) {
      showToast('当前没有可用模型，请联系管理员配置模型')
      return
    }
    if (useChatStore.getState().importingHistory || voice.status !== 'idle') {
      return
    }
    const parsed = parseSlashCommand(getDraft(sessionId).text, plugins)
    if (parsed) {
      if (parsed.kind === 'local') {
        setText('')
        setMenuOpen(false)
        runCommand(parsed.command)
        return
      }
      if (parsed.plugin.scope === 'conversation') {
        setSessionPlugin(sessionId, parsed.plugin.id)
      } else {
        setDraftMessagePlugin(sessionId, parsed.plugin.id)
      }
      if (!parsed.rest) {
        setText('')
        setMenuOpen(false)
        showToast(parsed.plugin.scope === 'message'
          ? `「${parsed.plugin.name}」将在下一条消息生效`
          : `已启用「${parsed.plugin.name}」，直接提问即可`)
        return
      }
      setText(parsed.rest)
      setMenuOpen(false)
    }
    if (fileTaskFormat) {
      if (!prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)) {
        return
      }
      if (!ensureApiKey() || !sendFileTask(sessionId, fileTaskFormat)) {
        return
      }
      stopReadAloud()
      if (isMobile) {
        textareaRef.current?.blur()
      } else {
        textareaRef.current?.focus()
      }
      return
    }
    if (!prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <>
      <div
        ref={wrapperRef}
        className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        {conversationPlugin || messagePlugin || autoPlugin || fileTaskFormat ? (
          <div className={styles.pluginBar}>
            {conversationPlugin ? (
              <PluginChip
                plugin={conversationPlugin}
                scope="conversation"
                enabled={conversationPlugin.enabled}
                onRemove={() => setSessionPlugin(sessionId, null)}
                onOpen={() => openPluginMarket(conversationPlugin.id)}
              />
            ) : null}
            {messagePlugin ? (
              <PluginChip
                plugin={messagePlugin}
                scope="message"
                enabled={messagePlugin.enabled}
                onRemove={() => setDraftMessagePlugin(sessionId, null)}
                onOpen={() => openPluginMarket(messagePlugin.id)}
              />
            ) : null}
            {autoPlugin ? (
              <button
                type="button"
                className={styles.autoChip}
                title="根据提示词自动匹配，点击可固定为对话插件"
                onClick={() => applyPlugin(autoPlugin)}
              >
                <span className={styles.autoDot} />
                自动：{autoPlugin.name}
              </button>
            ) : null}
            {fileTaskFormat ? (
              <span className={styles.autoChip}>
                <span className={styles.autoDot} />
                将生成 {fileTaskFormat === 'docx' ? 'Word' : fileTaskFormat === 'xlsx' ? 'Excel' : fileTaskFormat === 'pptx' ? 'PPT' : 'PDF'} 文件
              </span>
            ) : null}
          </div>
        ) : null}
        <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
        <div className={styles.textareaWrapper}>
          <textarea
            ref={textareaRef}
            className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
            placeholder={t('chatInputPlaceholderChat')}
            rows={2}
            // 移动端不自动聚焦，避免一打开就弹出键盘
            autoFocus={!isMobile}
            disabled={importingHistory}
            value={text}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? listboxId : undefined}
            aria-activedescendant={menuOpen && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
            onChange={(event) => {
              setText(event.target.value)
              updateMenu(event.target.value)
            }}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false
              updateMenu(event.currentTarget.value)
            }}
            onBlur={() => {
              if (menuOpen) {
                setMenuOpen(false)
                setActiveIndex(-1)
              }
            }}
            onMouseDown={(event) => {
              // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
              if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onKeyDown={(event) => {
              if (menuOpen && !event.nativeEvent.isComposing) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveIndex(menuItems.length ? (activeIndex + 1) % menuItems.length : -1)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveIndex(menuItems.length ? (activeIndex <= 0 ? menuItems.length - 1 : activeIndex - 1) : -1)
                  return
                }
                if (event.key === 'Home') {
                  event.preventDefault()
                  setActiveIndex(menuItems.length ? 0 : -1)
                  return
                }
                if (event.key === 'End') {
                  event.preventDefault()
                  setActiveIndex(menuItems.length ? menuItems.length - 1 : -1)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMenuOpen(false)
                  setActiveIndex(-1)
                  return
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && activeIndex >= 0 && menuItems[activeIndex]) {
                  event.preventDefault()
                  selectItem(menuItems[activeIndex])
                  return
                }
                if (event.key === 'Enter') {
                  // 查询为空或没有匹配项时，不误触第一个命令
                  event.preventDefault()
                  setMenuOpen(false)
                  return
                }
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length > 0) {
                event.preventDefault()
                acceptFiles(files)
              }
            }}
          />
          {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          <div className={styles.mirror} aria-hidden>
            {`${text}\n`}
          </div>
        </div>
        <div className={styles.functionRow}>
          {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
          <div ref={togglesRef} className={styles.toggles}>
            <ModelPicker />
            {selectedModel?.capabilities.thinking ? <Tooltip content={t('deactivatedThinkTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, thinking && styles.selected)}
                aria-label={t('thinkingSwitch')}
                aria-pressed={thinking}
                onClick={() => setThinking(!thinking)}
              >
                <IconThinkOutline14 />
                <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
              </button>
            </Tooltip> : null}
            {selectedModel?.capabilities.search ? <Tooltip content={t('search')}>
              <button
                type="button"
                className={clsx(styles.toggle, search && styles.selected)}
                aria-label={t('search')}
                aria-pressed={search}
                onClick={() => setSearch(!search)}
              >
                <IconGlobeLanguageOutline14 />
                <span className={styles.toggleLabel}>{t('search')}</span>
              </button>
            </Tooltip> : null}
          </div>
          <div className={styles.right}>
            <button
              type="button"
              className={styles.slashButton}
              aria-label="打开命令菜单"
              title="命令"
              onClick={() => {
                setMenuOpen(true)
                setMenuQuery('')
                setActiveIndex(-1)
                requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
              }}
            >
              <IconPluginOutline16 />
            </button>
            <AttachmentPicker onFiles={acceptFiles} disabled={importingHistory} />
            {streaming && sessionId ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('chatInputStopButtonTooltip')}
                onClick={() => {
                  stopReadAloud()
                  stopReply(sessionId)
                }}
              >
                <IconStopFill16 />
              </button>
            ) : (
              <button
                type="button"
                className={clsx(styles.sendButton, !canSend && styles.disabled)}
                aria-label={t('send')}
                aria-disabled={!canSend}
                onClick={send}
              >
                <IconSendOutline16 />
              </button>
            )}
          </div>
        </div>
        {dragging ? <DragMask /> : null}
      </div>
      <SlashMenu
        open={menuOpen}
        anchorRef={wrapperRef}
        items={menuItems}
        activeIndex={activeIndex}
        listboxId={listboxId}
        onActiveIndex={setActiveIndex}
        onSelect={selectItem}
        onClose={() => {
          setMenuOpen(false)
          setActiveIndex(-1)
        }}
      />
      {compactOpen ? (
        <Modal
          title="压缩上下文"
          closable={!compacting}
          onClose={() => {
            if (!compacting) {
              setCompactOpen(false)
              setCompactError('')
            }
          }}
          footer={<>
            <Button
              variant="outlined"
              size="m"
              disabled={compacting}
              onClick={() => {
                setCompactOpen(false)
                setCompactError('')
              }}
            >
              取消
            </Button>
            <Button variant="primary" size="m" disabled={compacting} onClick={() => void confirmCompact()}>
              {compacting ? '压缩中…' : '开始压缩'}
            </Button>
          </>}
        >
          <div className={styles.compactBody}>
            <p>将把当前对话的早期内容压缩成摘要，保留最近的消息。原始消息仍保留，可展开查看。</p>
            <p className={styles.compactMeta}>当前 {compactCount} 条消息，将保留最近 6 条，其余压缩为摘要 · 使用 {selectedModel?.name ?? '当前模型'}</p>
            <p className={styles.compactNote}>压缩会调用一次模型并消耗少量积分，请确认后再继续。</p>
            {compactError ? <p className={styles.compactError}>{compactError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

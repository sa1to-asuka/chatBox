import { Fragment, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { RefObject } from 'react'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { PluginIcon } from '../plugins/PluginIcon.js'
import type { PluginScope } from '../../services/plugins/types.js'
import styles from './SlashMenu.module.css'

export type SlashItem = {
  key: string
  kind: 'command' | 'plugin'
  command: string
  name: string
  description: string
  icon: string
  scope?: PluginScope
}

export const SlashMenu = ({
  open,
  anchorRef,
  items,
  activeIndex,
  listboxId,
  onActiveIndex,
  onSelect,
  onClose,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  items: SlashItem[]
  activeIndex: number
  listboxId: string
  onActiveIndex: (index: number) => void
  onSelect: (item: SlashItem) => void
  onClose: () => void
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const { floatingRef, position } = useAnchoredPosition<HTMLElement, HTMLDivElement>(open, {
    side: 'top',
    align: 'start',
    offset: 8,
    maxHeight: 320,
    measureKey: `${items.length}:${items.map((item) => item.key).join(',')}`,
    visualViewport: true,
  }, anchorRef)
  useDismiss(open, [anchorRef, menuRef], onClose, { captureEscape: true })

  useEffect(() => {
    if (!open || activeIndex < 0) {return}
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open) {return null}

  return createPortal(
    <div
      ref={(node) => {
        menuRef.current = node
        floatingRef.current = node
      }}
      className={styles.menu}
      role="listbox"
      id={listboxId}
      style={position
        ? { top: position.top, left: position.left, maxHeight: position.maxHeight, visibility: 'visible' }
        : { visibility: 'hidden' }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? <div className={styles.empty}>没有匹配的命令或插件</div> : null}
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index === 0 && item.kind === 'command' ? <div className={styles.groupLabel}>命令</div> : null}
          {item.kind === 'plugin' && (index === 0 || items[index - 1]?.kind !== 'plugin')
            ? <div className={styles.groupLabel}>插件</div>
            : null}
          <button
            type="button"
            role="option"
            id={`${listboxId}-${index}`}
            data-index={index}
            aria-selected={index === activeIndex}
            className={index === activeIndex ? `${styles.item} ${styles.active}` : styles.item}
            onMouseEnter={() => onActiveIndex(index)}
            onClick={() => onSelect(item)}
          >
            <span className={styles.icon}><PluginIcon icon={item.icon} /></span>
            <span className={styles.body}>
              <span className={styles.name}>
                {item.name}
                <code>/{item.command}</code>
              </span>
              <span className={styles.desc}>{item.description}</span>
            </span>
            {item.scope ? (
              <span className={styles.badge}>{item.scope === 'message' ? '仅本次' : '对话'}</span>
            ) : null}
          </button>
        </Fragment>
      ))}
      {items.length > 0 ? <div className={styles.footer}><span>↑↓ 选择</span><span>Enter 确认</span><span>Esc 关闭</span></div> : null}
    </div>,
    document.body
  )
}

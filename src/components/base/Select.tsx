import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from './icons.js'
import styles from './Select.module.css'

export type SelectOption<T extends string> = {
  value: T
  label: string
  lang?: string
  hint?: string
  badge?: string
  disabled?: boolean
}

/**
 * 胶囊形选择器：支持普通 pill 和紧凑 ghost 两种触发器。
 * 菜单选中项右侧打勾；支持方向键、Home/End、Enter、Esc，点外部关闭。
 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  className,
  disabled = false,
  variant = 'pill',
  loading = false,
  emptyText,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  variant?: 'pill' | 'ghost'
  loading?: boolean
  emptyText?: string
}) => {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])
  const current = options.find((option) => option.value === value)
  // 菜单贴右侧展开，最多 320px 高，超出在菜单内滚动
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { align: 'end', maxHeight: 320, minSpace: 160 })
  // Esc 只关菜单，不让外层弹窗一起关闭
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const enabledIndexes = options.flatMap((option, index) => option.disabled ? [] : [index])
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
  const openMenu = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1)
    setOpen(true)
  }
  const choose = (option: SelectOption<T>) => {
    if (option.disabled) {return}
    setOpen(false)
    onChange(option.value)
  }
  const move = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) {return}
    const currentIndex = enabledIndexes.indexOf(activeIndex)
    const next = currentIndex < 0
      ? enabledIndexes[direction === 1 ? 0 : enabledIndexes.length - 1]
      : enabledIndexes[(currentIndex + direction + enabledIndexes.length) % enabledIndexes.length]
    setActiveIndex(next)
  }
  useEffect(() => {
    if (open && activeIndex >= 0) {optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })}
  }, [open, activeIndex])

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, variant === 'ghost' && styles.ghost, open && styles.open, className)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled || loading}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault()
            openMenu()
            return
          }
          if (!open) {return}
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            move(event.key === 'ArrowDown' ? 1 : -1)
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            setActiveIndex(event.key === 'Home' ? enabledIndexes[0] ?? -1 : enabledIndexes.at(-1) ?? -1)
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            const option = options[activeIndex]
            if (option) {choose(option)}
          }
        }}
      >
        {current ? (
          <span className={styles.value}>
            <span className={styles.label} lang={current.lang}>{current.label}</span>
            {current.badge ? <span className={styles.badge}>{current.badge}</span> : null}
            {current.hint ? <span className={styles.hint}>{current.hint}</span> : null}
          </span>
        ) : (
          <span className={styles.placeholder}>{loading ? '载入中…' : placeholder}</span>
        )}
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && !disabled
        ? createPortal(
            <div
              ref={floatingRef}
              id={listboxId}
              className={styles.menu}
              style={position ?? undefined}
              role="listbox"
              aria-label={ariaLabel}
            >
              {loading ? <div className={styles.empty}>正在加载…</div> : null}
              {!loading && options.length === 0 ? <div className={styles.empty}>{emptyText ?? '暂无选项'}</div> : null}
              {options.map((option, index) => (
                <div
                  key={option.value}
                  ref={(element) => { optionRefs.current[index] = element }}
                  id={`${listboxId}-${index}`}
                  role="option"
                  lang={option.lang}
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled}
                  className={clsx(styles.option, option.value === value && styles.selected, option.disabled && styles.optionDisabled, index === activeIndex && styles.active)}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  <span className={styles.optionMain}>
                    <span className={styles.optionLabel}>{option.label}</span>
                    {option.badge ? <span className={styles.badge}>{option.badge}</span> : null}
                    {option.hint ? <span className={styles.hint}>{option.hint}</span> : null}
                  </span>
                  {option.value === value ? <IconCheckOutline16 /> : null}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

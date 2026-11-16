import clsx from 'clsx'
import { IconCloseOutline16 } from '../base/icons.js'
import { PluginIcon } from '../plugins/PluginIcon.js'
import type { Plugin } from '../../services/plugins/types.js'
import styles from './PluginChip.module.css'

export const PluginChip = ({
  plugin,
  scope,
  enabled,
  onRemove,
  onOpen,
}: {
  plugin: Plugin
  scope: 'conversation' | 'message'
  enabled: boolean
  onRemove: () => void
  onOpen: () => void
}) => (
  <span className={clsx(styles.chip, !enabled && styles.disabled)}>
    <button type="button" className={styles.main} title={plugin.description} onClick={onOpen}>
      <span className={styles.icon}><PluginIcon icon={plugin.icon} /></span>
      <span className={styles.label}>
        {scope === 'message' ? '本次' : '对话'}：{plugin.name}
      </span>
    </button>
    <button
      type="button"
      className={styles.remove}
      aria-label={`移除插件 ${plugin.name}`}
      onClick={onRemove}
    >
      <IconCloseOutline16 />
    </button>
  </span>
)

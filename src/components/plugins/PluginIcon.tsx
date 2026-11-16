import type { ComponentType } from 'react'
import {
  IconBookOutline16,
  IconCodeOutline16,
  IconCompressOutline16,
  IconDocOutline16,
  IconListOutline16,
  IconPenOutline16,
  IconPluginOutline16,
  IconSlidesOutline16,
  IconSparklesOutline16,
  IconTableOutline16,
  IconTargetOutline16,
  IconTranslateOutline16,
} from '../base/icons.js'

const icons: Record<string, ComponentType> = {
  sparkles: IconSparklesOutline16,
  target: IconTargetOutline16,
  book: IconBookOutline16,
  pen: IconPenOutline16,
  translate: IconTranslateOutline16,
  code: IconCodeOutline16,
  list: IconListOutline16,
  slides: IconSlidesOutline16,
  doc: IconDocOutline16,
  table: IconTableOutline16,
  puzzle: IconPluginOutline16,
  compress: IconCompressOutline16,
}

export const PluginIcon = ({ icon }: { icon: string }) => {
  const Icon = icons[icon] ?? IconSparklesOutline16
  return <Icon />
}

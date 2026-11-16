export type PluginScope = 'conversation' | 'message'

export type Plugin = {
  id: string
  name: string
  command: string
  icon: string
  category: string
  description: string
  scope: PluginScope
  featured: boolean
  builtin: boolean
  auto: boolean
  enabled: boolean
  sortOrder: number
}

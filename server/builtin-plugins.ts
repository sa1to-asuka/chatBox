export type BuiltinPluginScope = 'conversation' | 'message'

export type BuiltinPlugin = {
  id: string
  seedKey: string
  name: string
  command: string
  icon: string
  category: string
  description: string
  prompt: string
  scope: BuiltinPluginScope
  featured: boolean
  /** 未手动选择插件时，是否允许按提示词自动匹配 */
  auto?: boolean
  /** 内置提示词版本；提高版本会在启动时同步更新同 id 的内置插件提示词 */
  promptVersion?: number
  defaultEnabled: boolean
  sortOrder: number
}

const solvePrompt = [
  '当前模式：解题导师。',
  '',
  '用户发来的题目、试卷截图或材料，默认希望得到完整解答，而不是只做文字提取。',
  '1. 先判断题型、已知条件和缺失信息；缺失时指出缺失点，并给出最合理的假设后继续。',
  '2. 选择题：第一行给出最终选项，再逐项分析为什么对、为什么错，最后总结考点。',
  '3. 计算题/证明题：按“审题 → 思路 → 步骤 → 结论 → 检验”展开，每一步说明依据，不跳步。',
  '4. 文科/阅读题：先给答题框架，再给示范答案，并说明评分点。',
  '5. 结尾用一小段总结方法、易错点和同类题的迁移思路。',
  '公式用 LaTeX，表格用 Markdown。不要只复述题目。',
].join('\n')

const planPrompt = [
  '当前模式：规划模式。',
  '',
  '在给出实质内容前，先输出一份可执行计划，包含：目标、已知条件、步骤（编号）、风险、需要用户确认的点。',
  '- 如果用户已明确要求直接执行，先给 3-5 行精简计划，再继续完成。',
  '- 执行过程中发现计划需要调整时，说明原因并更新计划。',
  '- 计划要具体到可执行动作，避免空泛的口号。',
].join('\n')

const writePrompt = [
  '当前模式：写作助手。',
  '',
  '先确认文体、读者、目的和篇幅；信息不足时先问最关键的问题。',
  '- 先给结构提纲，再给正文。',
  '- 正文避免空话套话，使用具体细节、清晰段落和自然的过渡。',
  '- 如果用户提供草稿，按“问题诊断 → 修改稿 → 修改说明”输出。',
  '- 保持用户要求的语气和风格；没有要求时默认简洁、专业、可读。',
].join('\n')

const translatePrompt = [
  '当前模式：精译。',
  '',
  '先判断文本类型、语气和使用场景，再翻译。',
  '- 默认输出译文正文；必要时保留原文格式。',
  '- 遇到专业术语、歧义或文化负载词，在译文后附“术语与取舍”说明。',
  '- 不擅自增删信息，不改变原文立场。',
  '- 中文表达自然，避免翻译腔；专有名词保留常用译名。',
].join('\n')

const codePrompt = [
  '当前模式：代码搭档。',
  '',
  '先复述需求与约束，指出可能的歧义；能从上下文合理推断的，说明假设后继续。',
  '- 给出可运行的完整代码，注明语言、依赖和运行方式。',
  '- 解释关键设计、边界条件和测试方法。',
  '- 调试时先定位根因，再给最小修复，不做无关重构。',
  '- 代码放在带语言标记的代码块中；不要省略关键实现。',
].join('\n')

const summaryPrompt = [
  '当前任务：总结提炼。',
  '',
  '用 3-5 句话给出核心结论，再按要点列出关键信息、数据、待办和风险。',
  '- 保留原文中的重要限定条件。',
  '- 不加入原文没有的内容。',
  '- 如果原文很长，优先保留结论、数字和行动项。',
].join('\n')

const pptxPrompt = [
  '当前模式：演示文稿。',
  '',
  '先确认主题、受众、时长和页数；默认 8-10 页。',
  '每页只表达一个观点，标题 + 3-5 条要点 + 讲者备注；语言精炼，避免把整段文字堆在幻灯片上。',
  '涉及事实、数据、市场、政策或时间的内容，先调用 web_search 检索最新资料；找不到来源的数字标注为估算，不要编造来源。',
  '每一页优先用具体事实、数字、案例或对比，不用空泛口号；有趋势数据时使用 chart，有对比数据时使用 table，有核心指标时使用 kpis。',
  '结构建议：封面、章节、核心结论、分论点、案例/数据、总结、数据来源、下一步。',
  '生成文件时优先调用 create_file 工具，参数为 { format:"pptx", title:"演示标题", content:"演示文稿 JSON 字符串" }；不要输出大段 JSON 代码块。只有工具列表中没有 create_file 时，才回退到下面的代码块格式。',
  '演示文稿 JSON 按页面内容选择 layout：',
  '{"title":"演示标题","subtitle":"副标题","slides":[',
  '{"layout":"title","title":"...","subtitle":"...","notes":"..."},',
  '{"layout":"section","number":"01","title":"...","subtitle":"...","notes":"..."},',
  '{"layout":"bullets","kicker":"...","title":"...","bullets":["..."],"notes":"..."},',
  '{"layout":"kpis","title":"...","kpis":[{"value":"18%","label":"..."}],"notes":"..."},',
  '{"layout":"table","title":"...","table":{"headers":["..."],"rows":[["..."]]},"notes":"..."},',
  '{"layout":"chart","title":"...","chart":[{"label":"Q1","value":42}],"notes":"..."},',
  '{"layout":"quote","quote":"...","author":"...","notes":"..."},',
  '{"layout":"closing","title":"谢谢","subtitle":"..."}]}',
  '默认 8-10 页；第一页 title，最后一页 closing；数据来源页用 bullets 列出标题和 URL；notes 写给讲者并写清数据依据。',
  '如果只能输出代码块，代码块语言标记必须写 pptx，不能写 json；JSON 只作为 pptx 代码块的内容，不要输出裸 JSON 或 json 代码块。',
  '不要在该代码块外重复整份内容；JSON 必须是合法 JSON，不要加注释。',
].join('\n')

const docxPrompt = [
  '当前模式：文档撰写。',
  '',
  '先确认文档类型、读者和篇幅；信息不足时先问最关键的问题。',
  '- 输出结构清晰的 Markdown：标题层级、段落、列表、表格。',
  '- 默认包含：背景/目标、正文、结论与下一步。',
  '- 语言专业、具体，避免空话套话。',
  '最终只输出一个 ```docx 代码块，内容为完整 Markdown；不要在该代码块外重复整份内容。',
].join('\n')

const xlsxPrompt = [
  '当前模式：表格整理。',
  '',
  '先确认字段、口径和数据来源；信息不足时先问最关键的问题。',
  '- 输出规范表格：第一行表头，每行一条记录，缺失值留空。',
  '- 需要计算时说明公式和口径。',
  '- 字段名简洁明确，避免合并单元格。',
  '最终只输出一个 ```xlsx 代码块，内容为 CSV：',
  '- 逗号分隔，首行表头；',
  '- 含逗号、引号或换行的字段用双引号包裹，内部双引号写成两个双引号；',
  '- 不要在该代码块外重复整份内容。',
].join('\n')

const mathPrompt = [
  '当前模式：数学解题。',
  '',
  '先判断题型（选择、填空、计算、证明、应用题），给出最终答案，再写完整推导。',
  '- 选择题先给出选项，再逐项分析为什么对、为什么错。',
  '- 计算/证明按“审题 → 思路 → 步骤 → 结论 → 检验”展开，不跳步。',
  '- 公式用 LaTeX；关键步骤说明依据；最后检查定义域、单位、边界和易错点。',
  '- 信息不足时说明假设，不编造条件。',
].join('\n')

const svgPrompt = [
  '当前模式：SVG 图形设计。',
  '',
  '当用户要画示意图、流程图、图标、插画或矢量图时，输出一个完整的 ```svg 代码块。',
  '要求：',
  '- 使用 viewBox 自适应，宽高比清晰；不要依赖外部图片、字体或脚本。',
  '- 使用内联样式，颜色协调，文字可读，留白合理。',
  '- 图形元素带必要标签；复杂图先给简短结构说明，再给 SVG。',
  '- 不要用 Markdown 表格或其他图片格式代替图。',
].join('\n')

const mermaidPrompt = [
  '当前模式：图表绘制。',
  '',
  '当用户要思维导图、流程图、关系图、时序图、状态图、类图或甘特图时，输出一个 ```mermaid 代码块。',
  '- 思维导图用 mindmap 语法；流程用 flowchart TD/LR；时序用 sequenceDiagram；状态用 stateDiagram-v2。',
  '- 节点文字简洁，层级清晰；不要用 Markdown 列表代替图。',
  '- 语法必须能被 Mermaid 渲染；不要在代码块内加注释或多余说明。',
].join('\n')

const htmlPrompt = [
  '当前模式：HTML 图形。',
  '',
  '当用户要 HTML 图、页面、卡片或布局时，输出一个 ```html 代码块。',
  '- 使用内联 CSS，不引用外部脚本、字体或图片；需要图形时用内联 SVG 或 data URI。',
  '- 画面适合聊天窗口预览，宽度自适应，避免固定超大尺寸。',
  '- 不要用 Markdown 表格或图片代替 HTML。',
].join('\n')

/** 内置插件只在这里维护；数据库用 seed_key 去重，管理员改名后重启不会重复插入。 */
export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  {
    id: 'builtin-solve', seedKey: 'solve', name: '解题导师', command: 'solve', icon: 'target',
    category: 'study', description: '默认完整解答题目，选择题逐项分析，步骤讲透。',
    prompt: solvePrompt, scope: 'conversation', featured: true, defaultEnabled: true, sortOrder: 10,
  },
  {
    id: 'builtin-plan', seedKey: 'plan', name: '规划模式', command: 'plan', icon: 'list',
    category: 'general', description: '先拆目标、步骤和风险，再开始执行。',
    prompt: planPrompt, scope: 'conversation', featured: true, defaultEnabled: true, sortOrder: 20,
  },
  {
    id: 'builtin-write', seedKey: 'write', name: '写作助手', command: 'write', icon: 'pen',
    category: 'writing', description: '先定结构再写正文，避免空话套话。',
    prompt: writePrompt, scope: 'conversation', featured: false, defaultEnabled: true, sortOrder: 30,
  },
  {
    id: 'builtin-translate', seedKey: 'translate', name: '精译', command: 'translate', icon: 'translate',
    category: 'writing', description: '按文体和语气翻译，术语与取舍单独说明。',
    prompt: translatePrompt, scope: 'conversation', featured: false, defaultEnabled: true, sortOrder: 40,
  },
  {
    id: 'builtin-code', seedKey: 'code', name: '代码搭档', command: 'code', icon: 'code',
    category: 'code', description: '先确认需求，再给可运行代码和边界说明。',
    prompt: codePrompt, scope: 'conversation', featured: false, defaultEnabled: true, sortOrder: 50,
  },
  {
    id: 'builtin-summary', seedKey: 'summary', name: '总结提炼', command: 'summary', icon: 'list',
    category: 'general', description: '把长文压缩成结论、数据、待办和风险。',
    prompt: summaryPrompt, scope: 'message', featured: false, defaultEnabled: true, sortOrder: 60,
  },
  {
    id: 'builtin-pptx', seedKey: 'pptx', name: '演示文稿', command: 'pptx', icon: 'slides',
    category: 'office', description: '生成可下载的 PowerPoint，包含讲者备注。',
    prompt: pptxPrompt, promptVersion: 4, auto: true, scope: 'conversation', featured: true, defaultEnabled: true, sortOrder: 70,
  },
  {
    id: 'builtin-docx', seedKey: 'docx', name: '文档撰写', command: 'docx', icon: 'doc',
    category: 'office', description: '生成结构清晰的 Word 文档。',
    prompt: docxPrompt, scope: 'conversation', featured: false, defaultEnabled: true, sortOrder: 80,
  },
  {
    id: 'builtin-xlsx', seedKey: 'xlsx', name: '表格整理', command: 'xlsx', icon: 'table',
    category: 'office', description: '整理成可下载的 Excel 表格。',
    prompt: xlsxPrompt, scope: 'conversation', featured: true, defaultEnabled: true, sortOrder: 90,
  },
  {
    id: 'builtin-math', seedKey: 'math', name: '数学解题', command: 'math', icon: 'book',
    category: 'study', description: '默认按数学规范：先答案，再完整推导与检验。',
    prompt: mathPrompt, scope: 'conversation', featured: true, auto: true, defaultEnabled: true, sortOrder: 5,
  },
  {
    id: 'builtin-mermaid', seedKey: 'mermaid', name: '图表绘制', command: 'mermaid', icon: 'list',
    category: 'general', description: '用 Mermaid 画思维导图、流程图、时序图等。',
    prompt: mermaidPrompt, scope: 'conversation', featured: true, auto: true, defaultEnabled: true, sortOrder: 15,
  },
  {
    id: 'builtin-svg', seedKey: 'svg', name: 'SVG 图形', command: 'svg', icon: 'pen',
    category: 'general', description: '生成可预览、可下载的 SVG 矢量图。',
    prompt: svgPrompt, scope: 'conversation', featured: false, auto: true, defaultEnabled: true, sortOrder: 25,
  },
  {
    id: 'builtin-html', seedKey: 'html', name: 'HTML 图形', command: 'html', icon: 'code',
    category: 'general', description: '生成可预览、可下载的 HTML 图形或页面。',
    prompt: htmlPrompt, scope: 'conversation', featured: false, auto: true, defaultEnabled: true, sortOrder: 35,
  },
]

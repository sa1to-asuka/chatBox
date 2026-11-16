export type AutoSkillRule = { command: string; pattern: RegExp }

/**
 * 服务端和客户端共用的自动技能规则，避免两处正则漂移。
 * 顺序即优先级：明确的 SVG 需求优先；Office 生成优先于“流程图/数学”等通用词。
 */
export const AUTO_SKILL_RULES: readonly AutoSkillRule[] = [
  {
    command: 'svg',
    pattern: /\bsvg\b[^。！？\n]{0,12}(?:画|绘制|设计|生成|制作)|(?:画|绘制|设计|生成|制作)[^。！？\n]{0,12}\bsvg\b|(?:画|绘制|设计|生成|制作)[^。！？\n]{0,12}(?:矢量图|矢量|插画|图标|示意图)/i,
  },
  {
    command: 'pptx',
    pattern: /(?:做|制作|生成|设计|写|整理|输出|弄|来|搞)(?:一|个|份|套|一套)?[^。！？\n]{0,16}(?:ppt|pptx|幻灯片|演示文稿|演示|slides?|keynote)|(?:ppt|pptx|幻灯片|演示文稿|演示|slides?|keynote)[^。！？\n]{0,10}(?:做|制作|生成|设计|写|整理|输出)/i,
  },
  {
    command: 'mermaid',
    pattern: /思维导图|脑图|流程图|关系图|时序图|状态图|类图|甘特图|mermaid/i,
  },
  {
    command: 'math',
    pattern: /数学|方程|函数|几何|三角|微积分|概率|统计|选择题|求导|积分|证明|解方程|不等式|数列|向量|sin|cos|tan|log|√|∑|∫|\d\s*[+\-*/×÷=]\s*\d/i,
  },
  {
    command: 'html',
    pattern: /\bhtml\b[^。！？\n]{0,12}(?:画|绘制|设计|生成|制作|写)|(?:画|绘制|设计|生成|制作|写)[^。！？\n]{0,12}\bhtml\b|(?:画|绘制|设计|生成|制作|写)[^。！？\n]{0,12}(?:网页|页面|卡片|布局|前端)/i,
  },
]

export const detectAutoSkillCommand = (text: string): string | null => {
  if (/^\s*\//.test(text)) return null
  for (const rule of AUTO_SKILL_RULES) {
    if (rule.pattern.test(text)) return rule.command
  }
  return null
}

import { spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildPptSvgSlides, parsePptDeck } from './ppt-layouts.js'

const RENDER_SCRIPT = String.raw`import json
import os
import sys
from pathlib import Path

home = Path(os.environ['PPTMASTER_HOME']).resolve()
sys.path.insert(0, str(home / 'scripts'))
from svg_to_pptx.pptx_package.builder import create_pptx_with_native_svg

project = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
svg_files = sorted((project / 'svg_output').glob('*.svg'))
if not svg_files:
    raise SystemExit('no SVG slides')
notes_path = project / 'notes.json'
notes = json.loads(notes_path.read_text('utf-8')) if notes_path.exists() else None
ok = create_pptx_with_native_svg(
    svg_files,
    output,
    resource_root=project,
    canvas_format='ppt169',
    pptx_structure='flat',
    notes=notes,
    verbose=False,
)
if not ok or not output.exists():
    raise SystemExit('PPT Master conversion failed')
`

const pythonPath = () => process.env.PPTMASTER_PYTHON?.trim() || ''
const skillHome = () => process.env.PPTMASTER_HOME?.trim() || ''

export const pptMasterAvailable = () => Boolean(pythonPath() && skillHome())

/**
 * 用 PPT Master 的原生 SVG → DrawingML 转换器生成 PPTX。
 * 不可用时返回 false，由调用方回退到 PptxGenJS。
 */
export const renderWithPptMaster = async (
  content: string,
  title: string,
  dir: string,
  outputPath: string
): Promise<boolean> => {
  const python = pythonPath()
  const home = skillHome()
  if (!python || !home) return false
  try {
    const deck = parsePptDeck(content, title)
    const slides = buildPptSvgSlides(deck)
    if (!slides.length) return false
    const svgDir = path.join(dir, 'svg_output')
    await mkdir(svgDir, { recursive: true })
    const notes: Record<string, string> = {}
    for (const slide of slides) {
      await writeFile(path.join(svgDir, `${slide.name}.svg`), slide.svg, 'utf8')
      if (slide.notes) notes[slide.name] = slide.notes
    }
    await writeFile(path.join(dir, 'notes.json'), JSON.stringify(notes), 'utf8')
    const scriptPath = path.join(dir, 'render_pptmaster.py')
    await writeFile(scriptPath, RENDER_SCRIPT, 'utf8')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [scriptPath, dir, outputPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 180_000,
        killSignal: 'SIGKILL',
        env: { ...process.env, PPTMASTER_HOME: home },
      })
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 8000) stderr += chunk.toString('utf8')
      })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim().slice(-1200) || `PPT Master exited with ${code ?? 'unknown'}`))
      })
    })
    const info = await stat(outputPath)
    return info.size > 0
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[ppt-master] fallback to PptxGenJS:', message)
    }
    return false
  }
}

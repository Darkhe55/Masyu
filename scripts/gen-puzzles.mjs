/**
 * 题库写入器（珍珠 Masyu）
 *
 * 调用 scripts/gen-config.mjs 的 generatePuzzles()，把结果写进
 * src/game/puzzles-data.ts（board = 圆圈编码，solution = 回路边编码）。
 *
 * 用法：npm run gen
 */
import { writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const CONFIG_FILE = path.resolve('scripts/gen-config.mjs')

let items = []
let generatorName = ''

if (existsSync(CONFIG_FILE)) {
  const cfg = await import(`./gen-config.mjs?t=${Date.now()}`)
  if (cfg && typeof cfg.generatePuzzles === 'function') {
    items = (await cfg.generatePuzzles()) || []
    generatorName = cfg.NAME || '自定义生成器'
  }
} else {
  console.warn('[gen] 未找到 scripts/gen-config.mjs，将生成空题库。')
}

for (const p of items) {
  if (!p || typeof p.id !== 'string' || !p.name || !p.width || !p.height) {
    throw new Error('[gen] 无效的题面条目：' + JSON.stringify(p))
  }
  if (typeof p.board !== 'string' || p.board.length !== p.width * p.height) {
    throw new Error(`[gen] ${p.id} 的 board 长度不等于 ${p.width}×${p.height}`)
  }
  if (typeof p.solution !== 'string' || p.solution.length === 0) {
    throw new Error(`[gen] ${p.id} 缺少参考解 solution`)
  }
}

const lines = []
lines.push('/* 自动生成，勿手改。运行 npm run gen 重新生成。 */')
lines.push('export interface RawPuzzle {')
lines.push('  id: string')
lines.push('  name: string')
lines.push('  width: number')
lines.push('  height: number')
lines.push(`  difficulty: 'easy' | 'medium' | 'hard' | 'custom'`)
lines.push('  series: string')
lines.push('  /** 题面编码串：每格 . 空 / w 白圈 / b 黑圈（长度 = 宽×高） */')
lines.push('  board: string')
lines.push('  /** 参考解编码串：每条边 1 连线 / 0 不连（长度 = 边数） */')
lines.push('  solution?: string')
lines.push('}')
lines.push('')
lines.push('export const RAW_PUZZLES: RawPuzzle[] = [')
for (const p of items) {
  lines.push(
    `  { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, width: ${p.width}, height: ${p.height}, difficulty: ${JSON.stringify(p.difficulty)}, series: ${JSON.stringify(p.series || 'builtin')}, board: ${JSON.stringify(p.board)}, solution: ${JSON.stringify(p.solution || '')} },`,
  )
}
lines.push(']')
lines.push('')
writeFileSync(DATA_FILE, lines.join('\n'))
console.log(
  `[gen] 写入 ${DATA_FILE}：${items.length} 题${generatorName ? '（' + generatorName + '）' : ''}`,
)

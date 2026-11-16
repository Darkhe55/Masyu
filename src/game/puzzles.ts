/**
 * 珍珠（Masyu）—— 题库 / 自定义题板
 */

import type { GameState, Puzzle } from '../core/types.ts'
import { RAW_PUZZLES, type RawPuzzle } from './puzzles-data.ts'
import { IMPORTED_PUZZLES } from './imported-puzzles.ts'
import {
  asMasyuPuzzle,
  CIRCLE_BLACK,
  CIRCLE_NONE,
  CIRCLE_WHITE,
  decodeCircles,
  decodeSolution,
  encodeCircles,
  MAX_CUSTOM_SIZE,
  type MasyuPuzzle,
  type MasyuState,
} from './types.ts'
import { createEmptyState, getTopology } from './state.ts'
import { countSolutions } from './solver.ts'
import { validateMasyu } from './validate.ts'

export function decodePuzzle(raw: RawPuzzle): MasyuPuzzle | null {
  if (raw.width < 2 || raw.height < 2) return null
  if (raw.width > MAX_CUSTOM_SIZE || raw.height > MAX_CUSTOM_SIZE) return null
  const circles = decodeCircles(raw.board, raw.width * raw.height)
  if (!circles) return null
  return {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    circles,
  }
}

/** 内置题库 + 识图导入题库（imported-puzzles.ts 由 scripts/import-image.mjs 追加） */
const ALL_RAW: RawPuzzle[] = [...RAW_PUZZLES, ...IMPORTED_PUZZLES]

export const builtinPuzzles: Puzzle[] = ALL_RAW.map(decodePuzzle).filter(
  (p): p is MasyuPuzzle => p !== null,
)

/** 参考解：只保留“连线”的边，其余留空（显示解时画面干净） */
export function getReferenceSolution(id: string): GameState | null {
  const raw = ALL_RAW.find((p) => p.id === id)
  if (!raw || typeof raw.solution !== 'string' || !raw.solution) return null
  const puzzle = decodePuzzle(raw)
  if (!puzzle) return null
  const topo = getTopology(puzzle.width, puzzle.height)
  const edges = decodeSolution(raw.solution, topo.edgeCount)
  if (!edges) return null
  const state: MasyuState = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    edges,
    cursor: 0,
  }
  const check = validateMasyu(state, puzzle)
  if (!check.solved) return null
  return state
}

/* ────────────────────────── 自定义题板 ────────────────────────── */

/**
 * 从编辑器网格（无 / 白 / 黑）构造 Masyu 题面。
 * 值：null 或 0 = 空；1 = 白圈；2 = 黑圈。
 */
export function makeCustomPuzzle(
  w: number,
  h: number,
  grid: Array<number | null>,
  existingId?: string,
): MasyuPuzzle {
  const width = Math.max(2, Math.min(MAX_CUSTOM_SIZE, Math.round(w)))
  const height = Math.max(2, Math.min(MAX_CUSTOM_SIZE, Math.round(h)))
  const circles = new Array<number>(width * height).fill(CIRCLE_NONE)
  for (let i = 0; i < circles.length && i < grid.length; i++) {
    const v = grid[i]
    if (v === CIRCLE_WHITE) circles[i] = CIRCLE_WHITE
    else if (v === CIRCLE_BLACK) circles[i] = CIRCLE_BLACK
  }
  return {
    id: existingId ?? `masyu-custom-${width}x${height}-${Date.now()}`,
    name: `自定义 · ${width}×${height}`,
    width,
    height,
    difficulty: 'custom',
    circles,
  }
}

export function encodeCustomPuzzle(p: Puzzle): Record<string, unknown> {
  const mp = asMasyuPuzzle(p)
  return { board: encodeCircles(mp.circles ?? []) }
}

export function decodeCustomPuzzle(record: Record<string, unknown>): MasyuPuzzle | null {
  const width = typeof record.width === 'number' ? Math.round(record.width) : 0
  const height = typeof record.height === 'number' ? Math.round(record.height) : 0
  if (width < 2 || height < 2 || width > MAX_CUSTOM_SIZE || height > MAX_CUSTOM_SIZE) return null
  const board = typeof record.board === 'string' ? record.board : ''
  const circles = decodeCircles(board, width * height)
  if (!circles) return null
  return {
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : `自定义 · ${width}×${height}`,
    width,
    height,
    difficulty: 'custom',
    circles,
  }
}

export interface CustomVerify {
  ok: boolean
  message: string
}

/** 自定义题唯一解校验（保存 / 求解时给玩家看） */
export function verifyCustomPuzzle(p: Puzzle): CustomVerify {
  const mp = asMasyuPuzzle(p)
  const circles = mp.circles ?? []
  let count = 0
  for (let i = 0; i < circles.length; i++) {
    if (circles[i] === CIRCLE_WHITE || circles[i] === CIRCLE_BLACK) count++
  }
  if (count === 0) {
    return { ok: false, message: '题面没有圆圈：这样的盘面有很多解，不算一道题' }
  }
  const result = countSolutions(mp, 2, 80_000, 1200)
  if (result.timedOut) {
    return {
      ok: false,
      message: `唯一解校验超时（搜索 ${result.nodes} 节点），暂时无法确认`,
    }
  }
  if (result.count === 0) {
    return { ok: false, message: '无解：这些白圈/黑圈凑不出合法回路' }
  }
  if (result.count === 1) {
    return { ok: true, message: `已确认唯一解（搜索 ${result.nodes} 节点）` }
  }
  return { ok: false, message: '至少能找到 2 个解：这道题不唯一' }
}

/** 新建一个空盘（编辑器重生成时用） */
export function emptyCustomState(p: Puzzle): MasyuState {
  return createEmptyState(p)
}

export { encodeCircles, decodeCircles }



/**
 * 珍珠（Masyu）—— 回溯求解器
 *
 * 先用 rules.propagate 把能推的全推掉；推不满时按「候选连法最少的格子」分支，
 * 每次分支把该格的 4 条边一次性定死（2 连 2 断），再传播。
 *
 * 同一个搜索骨架同时用于：
 *   - solvePuzzle：找出一个解（显示解 / 提示 / 自定义题求解）
 *   - countSolutions：数解（自定义题唯一解校验）
 */

import type { GameState, Puzzle } from '../core/types.ts'
import {
  asMasyuPuzzle,
  CIRCLE_BLACK,
  CIRCLE_WHITE,
  CONFIG_MASKS,
  DIR_BITS,
  EDGE_OFF,
  EDGE_ON,
  type MasyuState,
} from './types.ts'
import { getTopology } from './state.ts'
import { propagate } from './rules.ts'
import { validateMasyu } from './validate.ts'

export interface MasyuSolveResult {
  solved: boolean
  solution: GameState | null
  nodes: number
  timedOut: boolean
}

export interface MasyuCountResult {
  count: number
  capped: boolean
  nodes: number
  timedOut: boolean
  first: GameState | null
  second: GameState | null
}

const DEFAULT_NODES = 200_000
const DEFAULT_TIMEOUT_MS = 4000

function snapshot(puzzle: Puzzle, edges: Int8Array): MasyuState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    edges: Array.from(edges, (v) => (v === EDGE_ON ? EDGE_ON : v === EDGE_OFF ? EDGE_OFF : 0)),
    cursor: 0,
  }
}

function applyConfig(edges: Int8Array, cellEdges: Int32Array, cell: number, configIndex: number): void {
  const cfg = CONFIG_MASKS[configIndex]!
  for (let d = 0; d < 4; d++) {
    const e = cellEdges[cell * 4 + d]!
    if (e < 0) continue
    edges[e] = cfg & DIR_BITS[d]! ? EDGE_ON : EDGE_OFF
  }
}

function popcountSmall(mask: number): number {
  let n = 0
  for (let i = 0; i < 7; i++) if (mask & (1 << i)) n++
  return n
}

interface SearchOptions {
  limit: number
  maxNodes: number
  timeBudgetMs: number
}

function search(
  puzzle: Puzzle,
  options: SearchOptions,
): { count: number; first: GameState | null; second: GameState | null; nodes: number; timedOut: boolean } {
  const p = asMasyuPuzzle(puzzle)
  const topo = getTopology(p.width, p.height)
  const deadline = options.timeBudgetMs > 0 ? Date.now() + options.timeBudgetMs : 0
  let nodes = 0
  let timedOut = false
  let count = 0
  let first: GameState | null = null
  let second: GameState | null = null

  const dfs = (edges: Int8Array): void => {
    if (count >= options.limit || timedOut) return
    nodes++
    if (nodes > options.maxNodes || (deadline > 0 && Date.now() > deadline)) {
      timedOut = true
      return
    }
    const res = propagate(p, edges)
    if (!res.ok) return
    if (res.solved) {
      const state = snapshot(p, res.edges)
      if (validateMasyu(state, p).solved) {
        count++
        if (!first) first = state
        else if (!second) second = state
      }
      return
    }

    // MRV：挑可选连法最少的格子
    let bestCell = -1
    let bestCount = 99
    for (let cell = 0; cell < topo.cellCount; cell++) {
      const n = popcountSmall(res.masks[cell]!)
      if (n > 1 && n < bestCount) {
        bestCount = n
        bestCell = cell
        if (n === 2) break
      }
    }
    if (bestCell < 0) return

    const mask = res.masks[bestCell]!
    for (let ci = 0; ci < CONFIG_MASKS.length; ci++) {
      if (!(mask & (1 << ci))) continue
      const next = res.edges.slice()
      applyConfig(next, topo.cellEdge, bestCell, ci)
      dfs(next)
      if (count >= options.limit || timedOut) return
    }
  }

  dfs(new Int8Array(topo.edgeCount))
  return { count, first, second, nodes, timedOut }
}

/** 找一个解 */
export function solvePuzzle(
  puzzle: Puzzle,
  maxNodes = DEFAULT_NODES,
  timeBudgetMs = DEFAULT_TIMEOUT_MS,
): MasyuSolveResult {
  const result = search(puzzle, { limit: 1, maxNodes, timeBudgetMs })
  return {
    solved: result.count > 0 && result.first !== null,
    solution: result.first,
    nodes: result.nodes,
    timedOut: result.timedOut && result.count === 0,
  }
}

/** 数解（最多 limit 个）；用于自定义题唯一解校验 */
export function countSolutions(
  puzzle: Puzzle,
  limit = 2,
  maxNodes = 120_000,
  timeBudgetMs = 1500,
): MasyuCountResult {
  const result = search(puzzle, { limit, maxNodes, timeBudgetMs })
  return {
    count: result.count,
    capped: result.count >= limit,
    nodes: result.nodes,
    timedOut: result.timedOut && result.count < limit,
    first: result.first,
    second: result.second,
  }
}

/** 只有白/黑圆圈的题面（空圆圈的盘面解不唯一，给个友好提示） */
export function circleCount(puzzle: Puzzle): number {
  const p = asMasyuPuzzle(puzzle)
  let n = 0
  for (let i = 0; i < p.circles.length; i++) {
    if (p.circles[i] === CIRCLE_WHITE || p.circles[i] === CIRCLE_BLACK) n++
  }
  return n
}


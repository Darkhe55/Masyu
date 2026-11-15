/**
 * 珍珠（Masyu）—— 盘面校验
 *
 * 只根据「连了线的边」判断（未定 / 叉都视作没有线）：
 *   - 每个圆圈格：度数必须是 2；白圈必须直行且两侧至少一侧转弯；黑圈必须转弯且两侧都直行；
 *   - 所有格子：度数只能是 0 或 2，不能有断头 / 分叉；
 *   - 连线的格子必须恰好连成一个闭合回路。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types.ts'
import {
  asMasyuPuzzle,
  asMasyuState,
  CIRCLE_BLACK,
  CIRCLE_WHITE,
  DIR_BITS,
  EDGE_ON,
  type CircleIssue,
  type MasyuState,
  type MasyuValidation,
} from './types.ts'
import { cellDegrees, cellLoopMask, getTopology, type Topology } from './state.ts'

const STRAIGHT_MASKS = [(DIR_BITS[0]! | DIR_BITS[2]!), (DIR_BITS[1]! | DIR_BITS[3]!)] as const

export function validateMasyu(state: GameState, puzzle: Puzzle): MasyuValidation {
  const p = asMasyuPuzzle(puzzle)
  const s = asMasyuState(state)
  const topo = getTopology(p.width, p.height)
  const degree = cellDegrees(s, topo)

  const badCircles: CircleIssue[] = []
  const unusedCircles: number[] = []
  const openCells: number[] = []
  const branchCells: number[] = []

  for (let cell = 0; cell < topo.cellCount; cell++) {
    const d = degree[cell]!
    if (d === 1) openCells.push(cell)
    else if (d >= 3) branchCells.push(cell)
  }

  let whiteIssues = 0
  let blackIssues = 0

  for (let cell = 0; cell < topo.cellCount; cell++) {
    const circle = p.circles[cell] ?? 0
    if (circle !== CIRCLE_WHITE && circle !== CIRCLE_BLACK) continue
    const d = degree[cell]!
    const mask = cellLoopMask(s, topo, cell)
    const issues: string[] = []

    if (d === 0) {
      unusedCircles.push(cell)
      issues.push('回路没有经过这个圆圈')
    } else if (d !== 2) {
      issues.push(`圆圈处连了 ${d} 条线（应为 2 条）`)
    } else if (circle === CIRCLE_WHITE) {
      if (countStraightDirections(mask) !== 1) issues.push('白圈必须直行（两条线要相对）')
      else if (!whiteNeighborTurns(s, topo, cell, mask)) issues.push('白圈两侧至少要有 1 格转弯')
    } else {
      if (countTurnDirections(mask) !== 1) issues.push('黑圈必须转弯（两条线要垂直）')
      else if (!blackNeighborsStraight(s, topo, cell, mask)) issues.push('黑圈两侧都必须直行')
    }

    if (issues.length) {
      badCircles.push({ cell, kind: circle as 1 | 2, issues })
      // “未经过”单独统计，不重复算成“规则不对”
      if (d !== 0) {
        if (circle === CIRCLE_WHITE) whiteIssues++
        else blackIssues++
      }
    }
  }

  // 连通分量：只有所有相关格子度数都是 2 时，每个分量才是一个闭合环
  const parent = new Int32Array(topo.cellCount).fill(-1)
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) root = parent[root]!
    while (parent[x] !== root) {
      const next = parent[x]!
      parent[x] = root
      x = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  let onEdges = 0
  const onCellsSet = new Set<number>()
  const componentEdges = new Map<number, number[]>()
  for (let e = 0; e < topo.edgeCount; e++) {
    if (s.edges[e] !== EDGE_ON) continue
    onEdges++
    const a = topo.edgeA[e]!
    const b = topo.edgeB[e]!
    onCellsSet.add(a)
    onCellsSet.add(b)
    if (parent[a] === -1) parent[a] = a
    if (parent[b] === -1) parent[b] = b
    union(a, b)
  }
  for (let e = 0; e < topo.edgeCount; e++) {
    if (s.edges[e] !== EDGE_ON) continue
    const root = find(topo.edgeA[e]!)
    let list = componentEdges.get(root)
    if (!list) {
      list = []
      componentEdges.set(root, list)
    }
    list.push(e)
  }

  const noDegreeProblem = openCells.length === 0 && branchCells.length === 0
  const loops = noDegreeProblem ? componentEdges.size : 0
  const extraLoopEdges: number[] = []
  if (loops > 1) {
    let largestRoot = -1
    let largest = -1
    for (const [root, list] of componentEdges) {
      if (list.length > largest) {
        largest = list.length
        largestRoot = root
      }
    }
    for (const [root, list] of componentEdges) {
      if (root === largestRoot) continue
      for (const e of list) extraLoopEdges.push(e)
    }
  }

  const solved =
    badCircles.length === 0 &&
    unusedCircles.length === 0 &&
    openCells.length === 0 &&
    branchCells.length === 0 &&
    loops === 1

  return {
    solved,
    badCircles,
    unusedCircles,
    openCells,
    branchCells,
    loops,
    onCells: onCellsSet.size,
    onEdges,
    extraLoopEdges,
    whiteIssues,
    blackIssues,
  }
}

function countStraightDirections(mask: number): number {
  let n = 0
  for (let d = 0; d < 4; d++) if (mask & DIR_BITS[d]!) n++
  if (n !== 2) return 0
  return STRAIGHT_MASKS.some((m) => (mask & m) === m) ? 1 : 0
}

function countTurnDirections(mask: number): number {
  let n = 0
  for (let d = 0; d < 4; d++) if (mask & DIR_BITS[d]!) n++
  if (n !== 2) return 0
  return STRAIGHT_MASKS.some((m) => (mask & m) === m) ? 0 : 1
}

/** 白圈：两侧路径邻格至少一侧必须是转弯 */
function whiteNeighborTurns(
  state: MasyuState,
  topo: Topology,
  cell: number,
  mask: number,
): boolean {
  for (let d = 0; d < 4; d++) {
    if (!(mask & DIR_BITS[d]!)) continue
    const nb = topo.cellNeighbor[cell * 4 + d]!
    if (nb < 0) continue
    if (countTurnDirections(cellLoopMask(state, topo, nb)) === 1) return true
  }
  return false
}

/** 黑圈：两侧路径邻格都必须直行 */
function blackNeighborsStraight(
  state: MasyuState,
  topo: Topology,
  cell: number,
  mask: number,
): boolean {
  for (let d = 0; d < 4; d++) {
    if (!(mask & DIR_BITS[d]!)) continue
    const nb = topo.cellNeighbor[cell * 4 + d]!
    if (nb < 0) return false
    if (countStraightDirections(cellLoopMask(state, topo, nb)) !== 1) return false
  }
  return true
}

/** 状态栏片段 */
export function statusBits(result: ValidationResult): string[] {
  const r = result as MasyuValidation
  const bits: string[] = []
  const unused = r.unusedCircles?.length ?? 0
  if (unused > 0) bits.push(`${unused} 个圆圈未经过`)
  const ruleBroken = (r.whiteIssues ?? 0) + (r.blackIssues ?? 0)
  if (ruleBroken > 0) {
    const parts: string[] = []
    if ((r.whiteIssues ?? 0) > 0) parts.push(`白圈 ${r.whiteIssues}`)
    if ((r.blackIssues ?? 0) > 0) parts.push(`黑圈 ${r.blackIssues}`)
    bits.push(`${ruleBroken} 个圆圈规则不对（${parts.join(' / ')}）`)
  }
  if ((r.openCells?.length ?? 0) > 0) bits.push(`${r.openCells.length} 个断头（线没有连回去）`)
  if ((r.branchCells?.length ?? 0) > 0) bits.push(`${r.branchCells.length} 处三岔口`)
  if ((r.loops ?? 0) > 1) bits.push(`出现了 ${r.loops} 个独立环（应只有 1 个）`)
  if (!bits.length) {
    if ((r.onEdges ?? 0) === 0) bits.push('还没有画线：点击两个相邻格子之间的位置画线')
    else bits.push('回路还没有闭合')
  }
  return bits
}



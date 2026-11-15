/**
 * 珍珠（Masyu）—— 状态 / 拓扑 / 序列化
 *
 * 拓扑（棋盘宽高 → 边与格子的邻接关系）按宽高缓存，
 * 规则传播、校验、求解器共用同一份结构，避免重复计算。
 */

import {
  edgeCells,
  edgeCount,
  horizontalEdgeCount,
  horizontalEdgeIndex,
  verticalEdgeIndex,
} from '../core/board.ts'
import type { GameState, Move, Puzzle } from '../core/types.ts'
import {
  asMasyuPuzzle,
  asMasyuState,
  CIRCLE_BLACK,
  CIRCLE_WHITE,
  DIR_BITS,
  EDGE_OFF,
  EDGE_ON,
  EDGE_UNKNOWN,
  MAX_CUSTOM_SIZE,
  type MasyuState,
} from './types.ts'

export interface Topology {
  w: number
  h: number
  cellCount: number
  edgeCount: number
  /** 边两端格子索引 */
  edgeA: Int32Array
  edgeB: Int32Array
  edgeHorizontal: Uint8Array
  /** 每格 4 条邻边（方向下标 0=N 1=E 2=S 3=W，-1 = 无） */
  cellEdge: Int32Array
  /** 每格 4 个相邻格（-1 = 无） */
  cellNeighbor: Int32Array
}

const topoCache = new Map<string, Topology>()

/** 方向下标 → 格子坐标偏移（x,y） */
export const DIR_DELTA: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

export function getTopology(w: number, h: number): Topology {
  const key = `${w}x${h}`
  const cached = topoCache.get(key)
  if (cached) return cached

  const cellCount = w * h
  const total = edgeCount(w, h)
  const edgeA = new Int32Array(total)
  const edgeB = new Int32Array(total)
  const edgeHorizontal = new Uint8Array(total)
  for (let e = 0; e < total; e++) {
    const pair = edgeCells(e, w, h)
    if (!pair) {
      edgeA[e] = -1
      edgeB[e] = -1
      continue
    }
    edgeA[e] = pair.a
    edgeB[e] = pair.b
    edgeHorizontal[e] = pair.horizontal ? 1 : 0
  }

  const cellEdge = new Int32Array(cellCount * 4).fill(-1)
  const cellNeighbor = new Int32Array(cellCount * 4).fill(-1)
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const cell = cy * w + cx
      // N
      if (cy > 0) {
        cellEdge[cell * 4 + 0] = verticalEdgeIndex(w, h, cx, cy - 1)
        cellNeighbor[cell * 4 + 0] = cell - w
      }
      // E
      if (cx < w - 1) {
        cellEdge[cell * 4 + 1] = horizontalEdgeIndex(w, cx, cy)
        cellNeighbor[cell * 4 + 1] = cell + 1
      }
      // S
      if (cy < h - 1) {
        cellEdge[cell * 4 + 2] = verticalEdgeIndex(w, h, cx, cy)
        cellNeighbor[cell * 4 + 2] = cell + w
      }
      // W
      if (cx > 0) {
        cellEdge[cell * 4 + 3] = horizontalEdgeIndex(w, cx - 1, cy)
        cellNeighbor[cell * 4 + 3] = cell - 1
      }
    }
  }

  const topo: Topology = {
    w,
    h,
    cellCount,
    edgeCount: total,
    edgeA,
    edgeB,
    edgeHorizontal,
    cellEdge,
    cellNeighbor,
  }
  topoCache.set(key, topo)
  return topo
}

export function topologyFor(puzzle: Puzzle): Topology {
  return getTopology(puzzle.width, puzzle.height)
}

/** 水平 / 竖直边的数量 */
export { horizontalEdgeCount }

/* ────────────────────────── 建盘 / 读取 / 序列化 ────────────────────────── */

export function createEmptyState(puzzle: Puzzle): MasyuState {
  const topo = topologyFor(puzzle)
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    edges: new Array<number>(topo.edgeCount).fill(EDGE_UNKNOWN),
    cursor: topo.edgeCount > 0 ? 0 : -1,
  }
}

export function cloneState(state: GameState): MasyuState {
  const s = asMasyuState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    edges: s.edges.slice(),
    cursor: s.cursor ?? 0,
  }
}

export function edgeValueAt(state: GameState, index: number): number {
  const s = asMasyuState(state)
  return s.edges[index] ?? EDGE_UNKNOWN
}

/** 左键循环：未定 → 连线 → 未定；叉 → 连线 */
export function cycleEdgeValue(current: number): number {
  if (current === EDGE_ON) return EDGE_UNKNOWN
  return EDGE_ON
}

/** 右键：叉 ↔ 未定；已有连线时改成叉 */
export function crossEdgeValue(current: number): number {
  return current === EDGE_OFF ? EDGE_UNKNOWN : EDGE_OFF
}

export function applyMove(state: GameState, move: Move): void {
  const s = asMasyuState(state)
  if (move.index < 0 || move.index >= s.edges.length) return
  s.edges[move.index] = move.to
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asMasyuState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    edges: s.edges.slice(),
    updatedAt: Date.now(),
  }
}

export function deserializeState(data: Record<string, unknown>): MasyuState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = Math.round(data.width)
  const h = Math.round(data.height)
  if (w < 1 || h < 1 || w > MAX_CUSTOM_SIZE || h > MAX_CUSTOM_SIZE) return null
  const topo = getTopology(w, h)
  const raw = data.edges
  if (!Array.isArray(raw) || raw.length !== topo.edgeCount) return null
  const edges = new Array<number>(topo.edgeCount).fill(EDGE_UNKNOWN)
  for (let i = 0; i < topo.edgeCount; i++) {
    const v = Number(raw[i])
    if (v !== EDGE_UNKNOWN && v !== EDGE_ON && v !== EDGE_OFF) return null
    edges[i] = v
  }
  return {
    puzzleId: data.puzzleId,
    width: w,
    height: h,
    edges,
    cursor: topo.edgeCount > 0 ? 0 : -1,
  }
}

/* ────────────────────────── 回路遍历辅助 ────────────────────────── */

/** 每格连线度数 */
export function cellDegrees(state: GameState, topo: Topology): Int8Array {
  const s = asMasyuState(state)
  const deg = new Int8Array(topo.cellCount)
  for (let e = 0; e < topo.edgeCount; e++) {
    if (s.edges[e] !== EDGE_ON) continue
    const a = topo.edgeA[e]!
    const b = topo.edgeB[e]!
    if (a >= 0) deg[a] = deg[a]! + 1
    if (b >= 0) deg[b] = deg[b]! + 1
  }
  return deg
}

/** 某格连出去的方向位（用于判断直行 / 转弯） */
export function cellLoopMask(state: GameState, topo: Topology, cell: number): number {
  const s = asMasyuState(state)
  let mask = 0
  for (let d = 0; d < 4; d++) {
    const e = topo.cellEdge[cell * 4 + d]!
    if (e >= 0 && s.edges[e] === EDGE_ON) mask |= DIR_BITS[d]!
  }
  return mask
}

/** 格子行列标签（1 起） */
export function cellLabel(puzzle: Puzzle, cell: number): string {
  const x = cell % puzzle.width
  const y = Math.floor(cell / puzzle.width)
  return `第 ${y + 1} 行第 ${x + 1} 列`
}

/** 圆圈格列表（0 起） */
export function circleCells(puzzle: Puzzle): number[] {
  const p = asMasyuPuzzle(puzzle)
  const out: number[] = []
  for (let i = 0; i < p.circles.length; i++) {
    if (p.circles[i] === CIRCLE_WHITE || p.circles[i] === CIRCLE_BLACK) out.push(i)
  }
  return out
}

/* ────────────────────────── 键盘光标 ────────────────────────── */

/** 边中点在“格子中心坐标系”里的坐标（格子中心为整数点） */
function edgeMidpoint(w: number, h: number, edge: number): { x: number; y: number } | null {
  const pair = edgeCells(edge, w, h)
  if (!pair) return null
  const ax = pair.a % w
  const ay = Math.floor(pair.a / w)
  const bx = pair.b % w
  const by = Math.floor(pair.b / w)
  return { x: (ax + bx) / 2, y: (ay + by) / 2 }
}

/**
 * 方向键移动键盘光标：
 * 在给定方向（左上右下）的半平面里找中点最近的一条边。
 */
export function moveCursor(
  puzzle: Puzzle,
  current: number,
  dir: 'up' | 'down' | 'left' | 'right',
): number {
  const { width: w, height: h } = puzzle
  const topo = getTopology(w, h)
  if (topo.edgeCount === 0) return -1
  if (current < 0 || current >= topo.edgeCount) current = 0
  const from = edgeMidpoint(w, h, current)
  if (!from) return current
  const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
  const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0

  let best = -1
  let bestScore = Infinity
  for (let e = 0; e < topo.edgeCount; e++) {
    if (e === current) continue
    const mid = edgeMidpoint(w, h, e)
    if (!mid) continue
    const vx = mid.x - from.x
    const vy = mid.y - from.y
    // 必须在目标方向的半平面内（留一点容差）
    const along = vx * dx + vy * dy
    if (along <= 0.08) continue
    // 垂直方向的偏移要小，避免跳到奇怪的位置
    const lateral = Math.abs(vx * dy - vy * dx)
    if (lateral > 1.35) continue
    const score = along + lateral * 1.6
    if (score < bestScore - 1e-9) {
      bestScore = score
      best = e
    }
  }
  return best >= 0 ? best : current
}

/** 竖直边索引（渲染时给外部复用） */
export { verticalEdgeIndex }


/**
 * 珍珠（Masyu）—— 类型 / 常量 / 编码
 *
 * 棋盘是 w×h 个格子，每条候选边连接两个相邻格子的中心：
 *   水平边：y*(w-1)+x       连接 (x,y)-(x+1,y)
 *   竖直边：h*(w-1)+y*w+x   连接 (x,y)-(x,y+1)
 * 与 src/core/board.ts 的边索引约定完全一致。
 *
 * 边取值：0 = 未定；1 = 连线；2 = 叉（排除）。
 * 圆圈取值：0 = 无；1 = 白圈；2 = 黑圈。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types.ts'

/** 自定义题板最大边长 */
export const MAX_CUSTOM_SIZE = 20

export const EDGE_UNKNOWN = 0
export const EDGE_ON = 1
export const EDGE_OFF = 2

export const CIRCLE_NONE = 0
export const CIRCLE_WHITE = 1
export const CIRCLE_BLACK = 2

/** 方向位：北 1 / 东 2 / 南 4 / 西 8 */
export const DIR_N = 1
export const DIR_E = 2
export const DIR_S = 4
export const DIR_W = 8

/** 方向下标 0..3 对应的位 */
export const DIR_BITS = [DIR_N, DIR_E, DIR_S, DIR_W] as const
/** 方向下标 → 反方向下标 */
export const OPPOSITE_DIR = [2, 3, 0, 1] as const

/**
 * 7 种格内连法：空、直行(NS / EW)、转弯(NE / NW / SE / SW)。
 * CONFIG_MASKS[i] 是该连法用到的方向位（空 = 0）。
 */
export const CONFIG_MASKS = [0, DIR_N | DIR_S, DIR_E | DIR_W, DIR_N | DIR_E, DIR_N | DIR_W, DIR_S | DIR_E, DIR_S | DIR_W] as const
/** 直行连法的配置位集合（第 1、2 种） */
export const STRAIGHT_BITS = (1 << 1) | (1 << 2)
/** 转弯连法的配置位集合（第 3~6 种） */
export const TURN_BITS = 0x7f & ~STRAIGHT_BITS
/** 全部 7 种连法 */
export const ALL_CONFIG_BITS = 0x7f

/** 每个方向位 → 包含该方向的连法配置位集合 */
export const CONFIG_HAS_DIR: number[] = DIR_BITS.map((bit) => {
  let mask = 0
  for (let i = 0; i < CONFIG_MASKS.length; i++) {
    if (CONFIG_MASKS[i]! & bit) mask |= 1 << i
  }
  return mask
})

export interface MasyuPuzzle extends Puzzle {
  /** 每格圆圈：0 无 / 1 白 / 2 黑 */
  circles: number[]
}

export interface MasyuState extends GameState {
  /** 每条候选边：0 未定 / 1 连线 / 2 叉 */
  edges: number[]
  /** 键盘光标所在边索引（只影响界面，不写进存档） */
  cursor: number
}

export interface CircleIssue {
  cell: number
  kind: 1 | 2
  issues: string[]
}

export interface MasyuValidation extends ValidationResult {
  solved: boolean
  /** 圆圈规则不满足的格子 */
  badCircles: CircleIssue[]
  /** 完全没被回路经过的圆圈格 */
  unusedCircles: number[]
  /** 只有 1 条连线的格子（断头 / 线头没有连回去） */
  openCells: number[]
  /** 有 3 条及以上连线的格子（分叉） */
  branchCells: number[]
  /** 闭合环的数量（全部格子度数为 2 时才有意义） */
  loops: number
  /** 回路经过的格子数 / 连线数 */
  onCells: number
  onEdges: number
  /** 多环时，除最大环以外的其它环的边（渲染成红色） */
  extraLoopEdges: number[]
  /** 白圈 / 黑圈规则错误数（状态栏汇总用） */
  whiteIssues: number
  blackIssues: number
}

export function asMasyuPuzzle(p: Puzzle): MasyuPuzzle {
  return p as MasyuPuzzle
}

export function asMasyuState(s: GameState): MasyuState {
  return s as MasyuState
}

/* ────────────────────────── 题面 / 答案编码 ────────────────────────── */

/** 圆圈编码：'.' 空 / 'w' 白 / 'b' 黑 */
export function encodeCircles(circles: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < circles.length; i++) {
    const v = circles[i]!
    out += v === CIRCLE_WHITE ? 'w' : v === CIRCLE_BLACK ? 'b' : '.'
  }
  return out
}

export function decodeCircles(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected).fill(CIRCLE_NONE)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '.' || ch === '0' || ch === '_') continue
    if (ch === 'w' || ch === 'W' || ch === '1') out[i] = CIRCLE_WHITE
    else if (ch === 'b' || ch === 'B' || ch === '2') out[i] = CIRCLE_BLACK
    else return null
  }
  return out
}

/** 参考解编码：'1' 连线 / '0' 不连（长度 = 边数） */
export function encodeSolution(edges: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < edges.length; i++) out += edges[i] === EDGE_ON ? '1' : '0'
  return out
}

export function decodeSolution(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected).fill(EDGE_UNKNOWN)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '1') out[i] = EDGE_ON
    else if (ch === '0') out[i] = EDGE_UNKNOWN
    else return null
  }
  return out
}

/** 每格基础可用连法（受圆圈类型限制） */
export function baseConfigBits(circle: number): number {
  if (circle === CIRCLE_WHITE) return STRAIGHT_BITS
  if (circle === CIRCLE_BLACK) return TURN_BITS
  return ALL_CONFIG_BITS
}


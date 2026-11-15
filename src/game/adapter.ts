/**
 * ════════════════════════════════════════════════════════════════════
 *  珍珠（Masyu）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态：每条候选边（相邻两格之间）0 未定 / 1 连线 / 2 叉。
 * 交互：左键画线/取消，右键标叉，拖拽连续画线；
 *       方向键移动光标，空格/回车画线，X/Backspace 标叉。
 */

import { playDrop, playPluck } from '../core/audio.ts'
import type {
  BoardKeyContext,
  CustomSupport,
  GameAdapter,
  GameState,
  HitTarget,
  LogicPlan,
  Move,
  Puzzle,
  SolveResult,
  ValidationResult,
} from '../core/types.ts'
import { planLogicSolve } from './logic.ts'
import {
  builtinPuzzles,
  decodeCustomPuzzle,
  encodeCustomPuzzle,
  getReferenceSolution,
  makeCustomPuzzle,
  verifyCustomPuzzle,
} from './puzzles.ts'
import { hitTest, metricsFor, renderBoard } from './render.ts'
import { countSolutions, solvePuzzle } from './solver.ts'
import {
  applyMove,
  cloneState,
  createEmptyState,
  crossEdgeValue,
  cycleEdgeValue,
  deserializeState,
  moveCursor,
  serializeState,
} from './state.ts'
import {
  asMasyuPuzzle,
  asMasyuState,
  CIRCLE_BLACK,
  CIRCLE_WHITE,
  EDGE_ON,
  EDGE_UNKNOWN,
  MAX_CUSTOM_SIZE,
} from './types.ts'
import { statusBits, validateMasyu } from './validate.ts'

const meta = {
  title: '珍珠（Masyu）',
  tagline: '画一条经过所有圆圈的闭合回路：白圈直行、黑圈转弯',
  footerNote:
    '规则：在相邻两格之间画线，所有线连成一条不交叉、不分叉的闭合回路。回路经过每个圆圈：白圈处必须直行，且相邻两格至少一侧要转弯；黑圈处必须转弯，且相邻两格都要直行。回路可以经过没有圆圈的格子。题目唯一解。',
  storageKeyPrefix: 'masyu',
  customIdPrefix: 'masyu-custom-',
  customMinW: 2,
  customMinH: 2,
  customMaxW: MAX_CUSTOM_SIZE,
  customMaxH: MAX_CUSTOM_SIZE,
  targetKind: 'edge' as const,
  interactionHint:
    '<kbd>左键</kbd> 在相邻格之间画线 / 点已画的线取消 · <kbd>右键</kbd> 标叉 / 取消叉',
}

/* ────────────────────────── 状态读写 ────────────────────────── */

function valueAt(state: GameState, index: number): number {
  return asMasyuState(state).edges[index] ?? EDGE_UNKNOWN
}

function cycleValue(state: GameState, target: HitTarget): number {
  return cycleEdgeValue(valueAt(state, target.index))
}

function rightClickValue(state: GameState, target: HitTarget): number {
  return crossEdgeValue(valueAt(state, target.index))
}

function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

/* ────────────────────────── 校验 ────────────────────────── */

function validate(state: GameState, puzzle: Puzzle): ValidationResult {
  return validateMasyu(state, puzzle)
}

/* ────────────────────────── 提示 / 求解 ────────────────────────── */

/**
 * 提示一格：优先补一条缺的线；如果玩家画了不该画的线，先帮他擦掉。
 */
function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asMasyuState(state)
  const sol = asMasyuState(solution)
  for (let e = 0; e < s.edges.length; e++) {
    if (sol.edges[e] === EDGE_ON && s.edges[e] !== EDGE_ON) {
      return { index: e, from: s.edges[e] ?? EDGE_UNKNOWN, to: EDGE_ON }
    }
  }
  for (let e = 0; e < s.edges.length; e++) {
    if (sol.edges[e] !== EDGE_ON && s.edges[e] === EDGE_ON) {
      return { index: e, from: EDGE_ON, to: EDGE_UNKNOWN }
    }
  }
  return null
}

function solvePuzzleForApp(puzzle: Puzzle, maxNodes?: number): SolveResult {
  const result = solvePuzzle(puzzle, maxNodes ?? 250_000, 5000)
  return {
    solved: result.solved,
    solution: result.solution,
    nodes: result.nodes,
    timedOut: result.timedOut,
  }
}

/* ────────────────────────── 键盘 ────────────────────────── */

function handleBoardKey(
  e: KeyboardEvent,
  state: GameState,
  puzzle: Puzzle,
  ctx: BoardKeyContext,
): boolean {
  if (ctx.busy()) return false
  const s = asMasyuState(state)
  const cursor = s.cursor ?? 0
  const key = e.key

  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    e.preventDefault()
    const dir =
      key === 'ArrowUp'
        ? 'up'
        : key === 'ArrowDown'
          ? 'down'
          : key === 'ArrowLeft'
            ? 'left'
            : 'right'
    const next = moveCursor(puzzle, cursor, dir)
    if (next >= 0 && next !== cursor) {
      s.cursor = next
      ctx.render()
    }
    return true
  }

  if (key === ' ' || key === 'Enter') {
    e.preventDefault()
    if (cursor < 0 || cursor >= s.edges.length) return true
    const from = s.edges[cursor] ?? EDGE_UNKNOWN
    const to = cycleEdgeValue(from)
    if (from !== to) ctx.apply({ index: cursor, from, to })
    return true
  }

  if (key === 'x' || key === 'X' || key === 'Backspace' || key === 'Delete') {
    e.preventDefault()
    if (cursor < 0 || cursor >= s.edges.length) return true
    const from = s.edges[cursor] ?? EDGE_UNKNOWN
    const to = crossEdgeValue(from)
    if (from !== to) ctx.apply({ index: cursor, from, to })
    return true
  }

  return false
}

/* ────────────────────────── 自定义题板 ────────────────────────── */

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: [null, CIRCLE_WHITE, CIRCLE_BLACK],
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit === 1) return CIRCLE_WHITE
    if (digit === 2) return CIRCLE_BLACK
    return undefined
  },
  cellLabel: (v) => (v === CIRCLE_WHITE ? '○' : v === CIRCLE_BLACK ? '●' : ''),
  cellClass: (v) =>
    v === CIRCLE_WHITE ? 'circle-white' : v === CIRCLE_BLACK ? 'circle-black' : '',
  hint: '点击循环：空 → 白圈 → 黑圈；键盘 1 = 白圈，2 = 黑圈，0 / Backspace 清空。保存或求解时会校验唯一解。',
  toGrid: (p) => {
    const mp = asMasyuPuzzle(p)
    if (!Array.isArray(mp.circles) || mp.circles.length !== p.width * p.height) return null
    return {
      width: p.width,
      height: p.height,
      grid: Array.from(mp.circles, (v) =>
        v === CIRCLE_WHITE ? CIRCLE_WHITE : v === CIRCLE_BLACK ? CIRCLE_BLACK : null,
      ),
    }
  },
  makePuzzle: (w, h, grid, existingId) => makeCustomPuzzle(w, h, grid, existingId),
  encodePuzzle: (p) => encodeCustomPuzzle(p),
  decodePuzzle: (record) => decodeCustomPuzzle(record),
  verifyPuzzle: (p) => verifyCustomPuzzle(p),
}

/* ────────────────────────── 音效 ────────────────────────── */

function playForMove(move: Move, streak: number): void {
  if (move.to === EDGE_ON && move.from === EDGE_UNKNOWN) playPluck(streak)
  else playDrop(streak)
}

/** 导出给测试脚本用 */
export const customVerify = verifyCustomPuzzle
export const customCountSolutions = countSolutions

/* ────────────────────────── 组装 ────────────────────────── */

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,

  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,

  validate,
  statusBits,

  metricsFor,
  renderBoard,
  hitTest,

  planLogicSolve(puzzle: Puzzle, state: GameState): LogicPlan {
    return planLogicSolve(puzzle, state)
  },

  solvePuzzle: solvePuzzleForApp,
  firstHintMove,
  handleBoardKey,
  custom,
  playForMove,
}



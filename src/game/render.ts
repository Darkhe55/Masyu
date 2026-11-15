/**
 * 珍珠（Masyu）—— 渲染 / 命中
 *
 * 画面：格心小点 + 白/黑圆圈 + 绿色回路；错误位置标红（圆圈环、断头、分叉、多余环）。
 * 命中：按「边中点最近」判定，点到圆圈中心附近不会误画线。
 *
 * 连线的 SVG 元素带 data-index=边索引，模板的弦振特效会用它做动画。
 */

import { cellCenter, edgeCells, squareMetrics } from '../core/board.ts'
import type { BoardMetrics, GameState, HitTarget, Puzzle } from '../core/types.ts'
import {
  asMasyuPuzzle,
  asMasyuState,
  CIRCLE_BLACK,
  CIRCLE_WHITE,
  EDGE_OFF,
  EDGE_ON,
  type MasyuValidation,
} from './types.ts'
import { getTopology } from './state.ts'

export function cellSizeFor(puzzle: Puzzle): number {
  const maxSide = Math.max(puzzle.width, puzzle.height)
  if (maxSide <= 5) return 64
  if (maxSide <= 7) return 56
  if (maxSide <= 10) return 48
  if (maxSide <= 14) return 42
  return 36
}

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const cell = cellSizeFor(puzzle)
  const pad = Math.round(cell * 0.55)
  return squareMetrics(puzzle.width, puzzle.height, { cell, pad, targetKind: 'edge' })
}

interface EdgeLine {
  x1: number
  y1: number
  x2: number
  y2: number
  mx: number
  my: number
}

function edgeLineOf(m: BoardMetrics, w: number, h: number, edge: number): EdgeLine | null {
  const pair = edgeCells(edge, w, h)
  if (!pair) return null
  const a = cellCenter(m, pair.a)
  const b = cellCenter(m, pair.b)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: MasyuValidation,
  _colorGrid?: unknown,
): string {
  const p = asMasyuPuzzle(puzzle)
  const s = asMasyuState(state)
  const m = metricsFor(p)
  const topo = getTopology(p.width, p.height)
  const cell = m.cell
  const extraLoop = new Set(result.extraLoopEdges ?? [])
  const badCircleCells = new Set((result.badCircles ?? []).map((b) => b.cell))
  const openCells = new Set(result.openCells ?? [])
  const branchCells = new Set(result.branchCells ?? [])

  const parts: string[] = []
  parts.push(
    `<svg class="board-svg" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">`,
  )
  parts.push(
    `<rect class="board-bg" x="${m.padLeft ?? m.pad}" y="${m.padTop ?? m.pad}" width="${p.width * cell}" height="${p.height * cell}" rx="${Math.round(cell * 0.22)}" fill="#fbf8f1" stroke="#e6dfd0" />`,
  )

  // 格心小点
  for (let i = 0; i < topo.cellCount; i++) {
    const c = cellCenter(m, i)
    parts.push(
      `<circle class="masyu-dot" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(cell * 0.032).toFixed(2)}" />`,
    )
  }

  // 连线
  const lineWidth = (cell * 0.14).toFixed(2)
  for (let e = 0; e < topo.edgeCount; e++) {
    const val = s.edges[e]
    if (val !== EDGE_ON) continue
    const line = edgeLineOf(m, p.width, p.height, e)
    if (!line) continue
    const cls = `edge-on${extraLoop.has(e) ? ' bad-loop' : ''}`
    parts.push(
      `<line class="${cls}" data-index="${e}" x1="${line.x1.toFixed(2)}" y1="${line.y1.toFixed(2)}" x2="${line.x2.toFixed(2)}" y2="${line.y2.toFixed(2)}" stroke-width="${lineWidth}" />`,
    )
  }

  // 叉（玩家标注的排除）
  const mark = (cell * 0.11).toFixed(2)
  for (let e = 0; e < topo.edgeCount; e++) {
    if (s.edges[e] !== EDGE_OFF) continue
    const line = edgeLineOf(m, p.width, p.height, e)
    if (!line) continue
    parts.push(
      `<g class="edge-off-group" data-index="${e}">
        <line class="edge-off-mark" x1="${(line.mx - Number(mark)).toFixed(2)}" y1="${(line.my - Number(mark)).toFixed(2)}" x2="${(line.mx + Number(mark)).toFixed(2)}" y2="${(line.my + Number(mark)).toFixed(2)}" stroke-width="${(cell * 0.075).toFixed(2)}" />
        <line class="edge-off-mark" x1="${(line.mx - Number(mark)).toFixed(2)}" y1="${(line.my + Number(mark)).toFixed(2)}" x2="${(line.mx + Number(mark)).toFixed(2)}" y2="${(line.my - Number(mark)).toFixed(2)}" stroke-width="${(cell * 0.075).toFixed(2)}" />
      </g>`,
    )
  }

  // 圆圈
  const rWhite = cell * 0.3
  const rBlack = cell * 0.28
  for (let i = 0; i < topo.cellCount; i++) {
    const circle = p.circles[i] ?? 0
    if (circle !== CIRCLE_WHITE && circle !== CIRCLE_BLACK) continue
    const c = cellCenter(m, i)
    const bad = badCircleCells.has(i) ? ' bad' : ''
    if (circle === CIRCLE_WHITE) {
      parts.push(
        `<circle class="masyu-white${bad}" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${rWhite.toFixed(2)}" />`,
      )
    } else {
      parts.push(
        `<circle class="masyu-black${bad}" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${rBlack.toFixed(2)}" />`,
      )
    }
  }

  // 断头 / 分叉标记
  for (const cellIndex of openCells) {
    const c = cellCenter(m, cellIndex)
    parts.push(
      `<circle class="masyu-error-dot" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(cell * 0.11).toFixed(2)}" />`,
    )
  }
  for (const cellIndex of branchCells) {
    const c = cellCenter(m, cellIndex)
    parts.push(
      `<circle class="masyu-error-ring" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(cell * 0.2).toFixed(2)}" fill="none" stroke="var(--error)" stroke-width="${(cell * 0.07).toFixed(2)}" />`,
    )
  }

  // 键盘光标
  const cursor = s.cursor ?? -1
  if (!result.solved && cursor >= 0 && cursor < topo.edgeCount) {
    const line = edgeLineOf(m, p.width, p.height, cursor)
    if (line) {
      const val = s.edges[cursor]
      const tone = val === EDGE_ON ? 'var(--loop)' : val === EDGE_OFF ? 'var(--x)' : 'var(--accent)'
      parts.push(
        `<circle class="masyu-cursor" cx="${line.mx.toFixed(2)}" cy="${line.my.toFixed(2)}" r="${(cell * 0.2).toFixed(2)}" stroke="${tone}" />`,
      )
    }
  }

  parts.push('</svg>')
  return parts.join('')
}

/** 边命中：取中点最近的一条边 */
export function hitTest(
  m: BoardMetrics,
  puzzle: Puzzle,
  x: number,
  y: number,
): HitTarget | null {
  const topo = getTopology(puzzle.width, puzzle.height)
  if (topo.edgeCount === 0) return null
  const cw = m.cellW ?? m.cell
  const ch = m.cellH ?? m.cell
  const tolerance = Math.min(cw, ch) * 0.36
  let best = -1
  let bestDist = Infinity
  for (let e = 0; e < topo.edgeCount; e++) {
    const line = edgeLineOf(m, puzzle.width, puzzle.height, e)
    if (!line) continue
    const d = Math.hypot(x - line.mx, y - line.my)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
  }
  if (best < 0) return null
  if (bestDist > tolerance) {
    // 鼠标正好点在圆圈上时给出对应的格子，避免手滑画线（只用于状态提示，不改盘面）
    return null
  }
  return { index: best, kind: 'edge' }
}





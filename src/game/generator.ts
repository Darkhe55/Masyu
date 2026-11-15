/**
 * 珍珠（Masyu）—— 内置题库生成器
 *
 * 思路（保证「唯一解 + 逻辑可推完」）：
 *   1. 用 backbite 随机游走生成一条「哈密顿回路」——回路穿过盘面的全部（或除 1 格外的）
 *      格子。这样盘面几乎被回路填满，很难在空白区域绕出第二条解，唯一解概率高得多；
 *   2. 在回路上找所有「白圈 / 黑圈」合法位置；
 *   3. 先用「全部合法圆圈」跑规则传播（含反证规则）：能推满 ⇒ 这组线索唯一确定回路；
 *   4. 贪心删线索：删掉后仍能推满就保留删除；
 *   5. 最后用回溯求解器独立数解，确认 countSolutions === 1；
 *   6. 结果写进 puzzles-data.ts（scripts/gen-puzzles.mjs）。
 */

import { horizontalEdgeIndex, verticalEdgeIndex } from '../core/board.ts'
import { getTopology } from './state.ts'
import { propagate } from './rules.ts'
import { countSolutions } from './solver.ts'
import {
  CIRCLE_BLACK,
  CIRCLE_NONE,
  CIRCLE_WHITE,
  EDGE_ON,
  encodeCircles,
  encodeSolution,
  type MasyuPuzzle,
  type MasyuState,
} from './types.ts'
import { validateMasyu } from './validate.ts'

export interface GeneratedEntry {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard'
  series: string
  board: string
  solution: string
}

interface SizeSpec {
  w: number
  h: number
  difficulty: 'easy' | 'medium' | 'hard'
  /** 最少线索数 */
  minClues: number
  /** 生成尝试次数上限 */
  attempts: number
}

const SIZE_SPECS: SizeSpec[] = [
  { w: 5, h: 5, difficulty: 'easy', minClues: 5, attempts: 120 },
  { w: 6, h: 6, difficulty: 'easy', minClues: 6, attempts: 120 },
  { w: 7, h: 7, difficulty: 'medium', minClues: 6, attempts: 240 },
  { w: 8, h: 8, difficulty: 'medium', minClues: 7, attempts: 320 },
  { w: 9, h: 9, difficulty: 'medium', minClues: 8, attempts: 900 },
  { w: 10, h: 10, difficulty: 'hard', minClues: 8, attempts: 1200 },
]

const DIFFICULTY_LABEL = { easy: '入门', medium: '进阶', hard: '挑战' } as const

/* ────────────────────────── 随机数 ────────────────────────── */

function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(list: T[], rng: () => number): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/* ────────────────────────── 哈密顿回路 ────────────────────────── */

function gridNeighbors(w: number, h: number, cell: number): number[] {
  const x = cell % w
  const y = Math.floor(cell / w)
  const out: number[] = []
  if (x > 0) out.push(cell - 1)
  if (x < w - 1) out.push(cell + 1)
  if (y > 0) out.push(cell - w)
  if (y < h - 1) out.push(cell + w)
  return out
}

/**
 * backbite 随机游走生成哈密顿回路。
 * 奇数格盘面（如 5×5）不存在哈密顿回路，就把蛇形路径的最后一格空出来，
 * 得到一条覆盖 n-1 格的回路（剩下一格不经过，符合 Masyu 规则）。
 */
function randomHamiltonianCycle(
  w: number,
  h: number,
  rng: () => number,
): { cycle: number[]; excluded: number } | null {
  const n = w * h
  const path: number[] = []
  for (let y = 0; y < h; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < w; x++) path.push(y * w + x)
    } else {
      for (let x = w - 1; x >= 0; x--) path.push(y * w + x)
    }
  }
  let excluded = -1
  if (n % 2 === 1) excluded = path.pop()!

  const position = new Map<number, number>()
  for (let i = 0; i < path.length; i++) position.set(path[i]!, i)

  const endpointsAdjacent = (): boolean => {
    const a = path[0]!
    const b = path[path.length - 1]!
    return gridNeighbors(w, h, a).includes(b)
  }

  const rebuildPosition = (): void => {
    position.clear()
    for (let i = 0; i < path.length; i++) position.set(path[i]!, i)
  }

  const maxSteps = Math.min(6000, n * 60)
  for (let step = 0; step < maxSteps; step++) {
    if (endpointsAdjacent()) return { cycle: path.slice(), excluded }
    const left = rng() < 0.5
    const endpoint = left ? path[0]! : path[path.length - 1]!
    const options = gridNeighbors(w, h, endpoint).filter((u) => position.has(u))
    if (!options.length) continue
    const u = options[Math.floor(rng() * options.length)]!
    const j = position.get(u)!
    const last = path.length - 1
    if (left) {
      // 端点 p0 与 pj 相邻：新路径 = pn..pj, p0, p1, ..., p(j-1)
      if (j < 1) continue
      const reversedTail = path.slice(j).reverse() // pn..pj
      const newPath = [...reversedTail, path[0]!, ...path.slice(1, j)]
      if (newPath.length !== path.length) continue
      path.splice(0, path.length, ...newPath)
      rebuildPosition()
    } else {
      // 端点 pn 与 pj 相邻：新路径 = p0..pj, pn, p(n-1), ..., p(j+1)
      if (j > last - 1) continue
      const newPath = [...path.slice(0, j + 1), ...path.slice(j + 1).reverse()]
      if (newPath.length !== path.length) continue
      path.splice(0, path.length, ...newPath)
      rebuildPosition()
    }
  }
  return null
}

/** 回路（格子序列）→ 每条边 0/1 */
function cycleToEdges(w: number, h: number, cycle: number[]): number[] {
  const topo = getTopology(w, h)
  const edges = new Array<number>(topo.edgeCount).fill(0)
  const edgeOf = (a: number, b: number): number => {
    const ax = a % w
    const ay = Math.floor(a / w)
    const bx = b % w
    const by = Math.floor(b / w)
    if (ay === by) return horizontalEdgeIndex(w, Math.min(ax, bx), ay)
    return verticalEdgeIndex(w, h, ax, Math.min(ay, by))
  }
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i]!
    const b = cycle[(i + 1) % cycle.length]!
    edges[edgeOf(a, b)] = 1
  }
  return edges
}

/* ────────────────────────── 线索候选 ────────────────────────── */

interface ClueCandidate {
  cell: number
  kind: 1 | 2
}

function loopCellMask(
  edges: number[],
  topo: ReturnType<typeof getTopology>,
  cell: number,
): number {
  const bits = [1, 2, 4, 8]
  let mask = 0
  for (let d = 0; d < 4; d++) {
    const e = topo.cellEdge[cell * 4 + d]!
    if (e >= 0 && edges[e]) mask |= bits[d]!
  }
  return mask
}

function isStraight(mask: number): boolean {
  return mask === 5 || mask === 10
}

function isTurn(mask: number): boolean {
  return mask !== 5 && mask !== 10 && mask !== 0
}

/** 回路上的合法圆圈位置（白圈需 直行+邻格转弯；黑圈需 转弯+两邻格直行） */
function findCandidates(w: number, h: number, edges: number[]): ClueCandidate[] {
  const topo = getTopology(w, h)
  const masks = new Array<number>(topo.cellCount).fill(0)
  for (let cell = 0; cell < topo.cellCount; cell++) masks[cell] = loopCellMask(edges, topo, cell)
  const out: ClueCandidate[] = []
  for (let cell = 0; cell < topo.cellCount; cell++) {
    const mask = masks[cell]!
    if (mask === 0) continue
    if (isStraight(mask)) {
      let turnNeighbor = false
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue
        const nb = topo.cellNeighbor[cell * 4 + d]!
        if (nb >= 0 && isTurn(masks[nb]!)) turnNeighbor = true
      }
      if (turnNeighbor) out.push({ cell, kind: CIRCLE_WHITE })
    } else if (isTurn(mask)) {
      let ok = true
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue
        const nb = topo.cellNeighbor[cell * 4 + d]!
        if (nb < 0 || !isStraight(masks[nb]!)) ok = false
      }
      if (ok) out.push({ cell, kind: CIRCLE_BLACK })
    }
  }
  return out
}

/* ────────────────────────── 推满 / 唯一 ────────────────────────── */

function buildPuzzle(
  w: number,
  h: number,
  clues: Iterable<ClueCandidate>,
  id = 'probe',
): MasyuPuzzle {
  const circles = new Array<number>(w * h).fill(CIRCLE_NONE)
  for (const c of clues) circles[c.cell] = c.kind
  return { id, name: 'probe', width: w, height: h, difficulty: 'custom', circles }
}

function stateFromEdges(puzzle: MasyuPuzzle, edges: ArrayLike<number>): MasyuState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    edges: Array.from(edges, (v) => (v ? 1 : 0)),
    cursor: 0,
  }
}

/** 规则传播（含反证）能否推满，且推出来的正是这条回路 */
function logicComplete(puzzle: MasyuPuzzle, reference: number[]): boolean {
  const topo = getTopology(puzzle.width, puzzle.height)
  const res = propagate(puzzle, new Array<number>(topo.edgeCount).fill(0), {
    probe: true,
    timeBudgetMs: 8000,
  })
  if (!res.ok || !res.solved) return false
  for (let e = 0; e < topo.edgeCount; e++) {
    if ((res.edges[e] === EDGE_ON ? 1 : 0) !== (reference[e] ? 1 : 0)) return false
  }
  return validateMasyu(stateFromEdges(puzzle, reference), puzzle).solved
}

/** 贪心删线索：删掉后仍能规则推满就保留删除 */
function reduceClues(
  w: number,
  h: number,
  candidates: ClueCandidate[],
  reference: number[],
  rng: () => number,
  minClues: number,
): ClueCandidate[] {
  let active = candidates.slice()
  for (let round = 0; round < 2; round++) {
    for (const candidate of shuffled(active, rng)) {
      if (active.length <= minClues) return active
      if (!active.includes(candidate)) continue
      const trial = active.filter((c) => c !== candidate)
      if (trial.filter((c) => c.kind === CIRCLE_BLACK).length < 1) continue
      const puzzle = buildPuzzle(w, h, trial)
      if (logicComplete(puzzle, reference)) active = trial
    }
  }
  return active
}

/* ────────────────────────── 单题生成 ────────────────────────── */

function generateOne(
  spec: SizeSpec,
  rng: () => number,
): { clues: ClueCandidate[]; edges: number[] } | null {
  const { w, h } = spec
  const generated = randomHamiltonianCycle(w, h, rng)
  if (!generated) return null
  const edges = cycleToEdges(w, h, generated.cycle)
  const candidates = findCandidates(w, h, edges)
  if (candidates.length < spec.minClues + 2) return null
  const blacks = candidates.filter((c) => c.kind === CIRCLE_BLACK).length
  const whites = candidates.length - blacks
  if (blacks < 2 || whites < 3) return null

  // 全部合法圆圈的题面必须能被规则推满（否则这条回路做不出唯一解）
  const allPuzzle = buildPuzzle(w, h, candidates)
  if (!logicComplete(allPuzzle, edges)) return null

  const reduced = reduceClues(w, h, candidates, edges, rng, spec.minClues)
  if (reduced.length < spec.minClues) return null
  const finalPuzzle = buildPuzzle(w, h, reduced)
  if (!logicComplete(finalPuzzle, edges)) return null

  // 独立复核：回溯求解器必须只找到一个解
  const counted = countSolutions(finalPuzzle, 2, 300_000, 6000)
  if (counted.timedOut || counted.count !== 1) return null

  return { clues: reduced, edges }
}

/* ────────────────────────── 生成入口 ────────────────────────── */

export function generateBuiltins(seed = 20261115): GeneratedEntry[] {
  const rng = createRng(seed)
  const out: GeneratedEntry[] = []
  for (const spec of SIZE_SPECS) {
    let made: { clues: ClueCandidate[]; edges: number[] } | null = null
    for (let attempt = 0; attempt < spec.attempts && !made; attempt++) {
      made = generateOne(spec, rng)
    }
    if (!made) {
      throw new Error(`[gen] 生成 ${spec.w}×${spec.h} 失败（已尝试 ${spec.attempts} 次）`)
    }
    const circles = new Array<number>(spec.w * spec.h).fill(CIRCLE_NONE)
    for (const c of made.clues) circles[c.cell] = c.kind
    const label = DIFFICULTY_LABEL[spec.difficulty]
    out.push({
      id: `masyu-${spec.w}x${spec.h}`,
      name: `珍珠 · ${label} ${spec.w}×${spec.h}`,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: 'builtin',
      board: encodeCircles(circles),
      solution: encodeSolution(made.edges),
    })
    console.log(
      `[gen] ${spec.w}×${spec.h} · 线索 ${made.clues.length}（白 ${made.clues.filter((c) => c.kind === CIRCLE_WHITE).length} / 黑 ${made.clues.filter((c) => c.kind === CIRCLE_BLACK).length}）`,
    )
  }
  return out
}


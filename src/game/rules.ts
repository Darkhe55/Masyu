/**
 * 珍珠（Masyu）—— 规则传播
 *
 * 把每格可能的「连法」写成 7 种：空 + 2 种直行 + 4 种转弯（见 types.ts）。
 * 传播只用逻辑上必然成立的推理：
 *
 *   规则 1 圆圈：白圈只能直行 / 黑圈只能转弯；
 *   规则 2 度数：每格只能没有线或者正好两条线；
 *   规则 3 邻格：白圈两侧至少一侧转弯；黑圈两侧都必须直行；
 *   规则 4 回路：不能提前闭合、闭合后其余位置只能留空、不能出现分叉；
 *   规则 5 反证：某条边「连上」或「不连」会让局部规则直接矛盾，则该边必为另一值。
 *
 * 规则 5 是标准的「失败文字探测」：它不猜答案，只是把假设代入规则系统，
 * 由矛盾反推出必然结论，所以仍然是严格的逻辑推导（用于内置题「逻辑推完」）。
 */

import {
  ALL_CONFIG_BITS,
  baseConfigBits,
  CIRCLE_BLACK,
  CIRCLE_WHITE,
  CONFIG_HAS_DIR,
  CONFIG_MASKS,
  DIR_BITS,
  EDGE_OFF,
  EDGE_ON,
  EDGE_UNKNOWN,
  OPPOSITE_DIR,
  STRAIGHT_BITS,
  TURN_BITS,
  type MasyuPuzzle,
} from './types.ts'
import { cellLabel, getTopology, type Topology } from './state.ts'

/* ────────────────────────── 结果类型 ────────────────────────── */

export interface Deduction {
  edge: number
  from: number
  to: number
  rule: number
  label: string
}

export interface PropagateOptions {
  /** 记录推导步骤（逻辑回放用） */
  record?: boolean
  /** 是否启用「反证」规则（规则 5）；内置题靠它推满 */
  probe?: boolean
  /** 最多迭代轮数，防止死循环 */
  maxSteps?: number
  /** 超时（毫秒），用于求解器/自定义题校验 */
  timeBudgetMs?: number
}

export interface PropagateResult {
  edges: Int8Array
  ok: boolean
  deductions: Deduction[]
  masks: Uint8Array
  solved: boolean
  saturated: boolean
  steps: number
  contradiction: string | null
}

export const RULE_CIRCLE = 1
export const RULE_DEGREE = 2
export const RULE_NEIGHBOR = 3
export const RULE_LOOP = 4
export const RULE_PROBE = 5

const DIR_NAMES = ['上', '右', '下', '左'] as const

function ruleForCell(puzzle: MasyuPuzzle, cell: number): number {
  const circle = puzzle.circles[cell] ?? 0
  return circle === CIRCLE_WHITE || circle === CIRCLE_BLACK ? RULE_CIRCLE : RULE_DEGREE
}

function labelForEdge(puzzle: MasyuPuzzle, cell: number, dir: number, to: number): string {
  const circle = puzzle.circles[cell] ?? 0
  const pos = cellLabel(puzzle, cell)
  const side = DIR_NAMES[dir]
  const conn = to === EDGE_ON ? '必须连线' : '不能连线'
  if (circle === CIRCLE_WHITE) return `${pos} 是白圈：只能直行，${side}侧${conn}`
  if (circle === CIRCLE_BLACK) return `${pos} 是黑圈：必须转弯，${side}侧${conn}`
  return `${pos} 的连法只剩这一种，${side}侧${conn}`
}

/* ────────────────────────── 掩码计算 ────────────────────────── */

function configAllowedByNeighbors(
  topo: Topology,
  masks: Uint8Array,
  cell: number,
  configIndex: number,
  circle: number,
): boolean {
  const cfg = CONFIG_MASKS[configIndex]!
  if (cfg === 0) return true
  if (circle === CIRCLE_WHITE) {
    // 直行：两侧路径邻格至少一侧转弯（且转弯必须用上通向本格的边）
    let anyTurn = false
    for (let d = 0; d < 4; d++) {
      if (!(cfg & DIR_BITS[d]!)) continue
      const nb = topo.cellNeighbor[cell * 4 + d]!
      if (nb < 0) return false
      const need = CONFIG_HAS_DIR[OPPOSITE_DIR[d]!]!
      if (masks[nb]! & TURN_BITS & need) anyTurn = true
    }
    return anyTurn
  }
  // 黑圈：转弯，两侧路径邻格都必须直行
  let count = 0
  for (let d = 0; d < 4; d++) {
    if (!(cfg & DIR_BITS[d]!)) continue
    count++
    const nb = topo.cellNeighbor[cell * 4 + d]!
    if (nb < 0) return false
    const need = CONFIG_HAS_DIR[OPPOSITE_DIR[d]!]!
    if (!(masks[nb]! & STRAIGHT_BITS & need)) return false
  }
  return count === 2
}

/** 计算每格允许的连法掩码；返回 false 表示出现矛盾 */
function computeMasks(
  puzzle: MasyuPuzzle,
  topo: Topology,
  base: Uint8Array,
  edges: Int8Array,
  masks: Uint8Array,
): boolean {
  const cellCount = topo.cellCount
  for (let cell = 0; cell < cellCount; cell++) {
    let mask = base[cell]!
    for (let d = 0; d < 4; d++) {
      const e = topo.cellEdge[cell * 4 + d]!
      if (e < 0) {
        mask &= ~CONFIG_HAS_DIR[d]!
        continue
      }
      const st = edges[e]!
      if (st === EDGE_ON) mask &= CONFIG_HAS_DIR[d]!
      else if (st === EDGE_OFF) mask &= ~CONFIG_HAS_DIR[d]! & ALL_CONFIG_BITS
    }
    if (mask === 0) return false
    masks[cell] = mask
  }

  let changed = true
  while (changed) {
    changed = false
    for (let cell = 0; cell < cellCount; cell++) {
      const circle = puzzle.circles[cell] ?? 0
      if (circle !== CIRCLE_WHITE && circle !== CIRCLE_BLACK) continue
      let mask = masks[cell]!
      for (let ci = 0; ci < CONFIG_MASKS.length; ci++) {
        const bit = 1 << ci
        if (!(mask & bit)) continue
        if (!configAllowedByNeighbors(topo, masks, cell, ci, circle)) {
          mask &= ~bit
          changed = true
        }
      }
      if (mask === 0) return false
      masks[cell] = mask
    }
  }
  return true
}

/* ────────────────────────── 全局回路约束 ────────────────────────── */

function componentRoot(parent: Int32Array, x: number): number {
  let root = x
  while (parent[root] !== root) root = parent[root]!
  while (parent[x] !== root) {
    const next = parent[x]!
    parent[x] = root
    x = next
  }
  return root
}

interface ComponentInfo {
  cells: number
  degreeSum: number
  endpoints: number
  circles: number
}

function applyLoopRules(
  puzzle: MasyuPuzzle,
  topo: Topology,
  edges: Int8Array,
  setEdge: (e: number, to: number) => boolean,
): { changed: boolean; contradiction: string | null } {
  const cellCount = topo.cellCount
  const degree = new Int8Array(cellCount)
  const parent = new Int32Array(cellCount).fill(-1)
  let onEdges = 0

  for (let e = 0; e < topo.edgeCount; e++) {
    if (edges[e] !== EDGE_ON) continue
    const a = topo.edgeA[e]!
    const b = topo.edgeB[e]!
    onEdges++
    degree[a] = degree[a]! + 1
    degree[b] = degree[b]! + 1
    if (parent[a] === -1) parent[a] = a
    if (parent[b] === -1) parent[b] = b
    const ra = componentRoot(parent, a)
    const rb = componentRoot(parent, b)
    if (ra !== rb) parent[rb] = ra
    if (degree[a] > 2 || degree[b] > 2) {
      return { changed: false, contradiction: '同一格连出了 3 条以上线（分叉）' }
    }
  }
  if (onEdges === 0) return { changed: false, contradiction: null }

  const totalCircles = countCircles(puzzle)
  const infos = new Map<number, ComponentInfo>()
  for (let cell = 0; cell < cellCount; cell++) {
    if (parent[cell] === -1) continue
    const root = componentRoot(parent, cell)
    let info = infos.get(root)
    if (!info) {
      info = { cells: 0, degreeSum: 0, endpoints: 0, circles: 0 }
      infos.set(root, info)
    }
    info.cells++
    info.degreeSum += degree[cell]!
    if (degree[cell] === 1) info.endpoints++
    const c = puzzle.circles[cell] ?? 0
    if (c === CIRCLE_WHITE || c === CIRCLE_BLACK) info.circles++
  }

  let changed = false
  let closedComponents = 0
  let closedInfo: ComponentInfo | null = null
  for (const info of infos.values()) {
    if (info.degreeSum === info.cells * 2) {
      closedComponents++
      closedInfo = info
    }
  }

  if (closedComponents > 1) {
    return { changed: false, contradiction: '已经出现多个闭合回路（答案只能有一个环）' }
  }

  if (closedInfo) {
    if (closedInfo.circles !== totalCircles) {
      return { changed: false, contradiction: '闭合回路没有经过所有圆圈' }
    }
    for (let e = 0; e < topo.edgeCount; e++) {
      if (edges[e] === EDGE_UNKNOWN) {
        if (setEdge(e, EDGE_OFF)) changed = true
      }
    }
    return { changed, contradiction: null }
  }

  // 未闭合：同一段路径内部相连的未定边必然不能连（会形成分叉/多环）
  for (let e = 0; e < topo.edgeCount; e++) {
    if (edges[e] !== EDGE_UNKNOWN) continue
    const a = topo.edgeA[e]!
    const b = topo.edgeB[e]!
    if (parent[a] === -1 || parent[b] === -1) continue
    if (componentRoot(parent, a) !== componentRoot(parent, b)) continue
    const info = infos.get(componentRoot(parent, a))!
    const validClose = info.endpoints === 2 && degree[a] === 1 && degree[b] === 1
    if (!validClose) {
      if (setEdge(e, EDGE_OFF)) changed = true
    }
  }

  return { changed, contradiction: null }
}

function countCircles(puzzle: MasyuPuzzle): number {
  let n = 0
  for (let i = 0; i < puzzle.circles.length; i++) {
    const c = puzzle.circles[i] ?? 0
    if (c === CIRCLE_WHITE || c === CIRCLE_BLACK) n++
  }
  return n
}

/* ────────────────────────── 局部传播 ────────────────────────── */

interface LocalResult {
  ok: boolean
  solved: boolean
  contradiction: string | null
  steps: number
}

interface LocalContext {
  puzzle: MasyuPuzzle
  topo: Topology
  base: Uint8Array
  masks: Uint8Array
  edges: Int8Array
  record: boolean
  deductions: Deduction[]
  deadline: number
}

function normalizeEdges(initial: ArrayLike<number>, total: number): Int8Array {
  const edges = new Int8Array(total)
  for (let i = 0; i < total; i++) {
    const v = Number(initial[i] ?? 0)
    edges[i] = v === EDGE_ON ? EDGE_ON : v === EDGE_OFF ? EDGE_OFF : EDGE_UNKNOWN
  }
  return edges
}

function setEdgeRecorded(ctx: LocalContext, e: number, to: number, rule: number, label: string): boolean {
  const from = ctx.edges[e]!
  if (from === to) return false
  ctx.edges[e] = to
  if (ctx.record) ctx.deductions.push({ edge: e, from, to, rule, label })
  return true
}

/** 从当前边状态出发反复应用规则 1~4 到不动点 */
function localFixpoint(ctx: LocalContext, maxSteps: number): LocalResult {
  const { puzzle, topo, base, edges, masks } = ctx
  let steps = 0
  for (let iter = 0; iter < maxSteps; iter++) {
    if (ctx.deadline > 0 && Date.now() > ctx.deadline) break
    if (!computeMasks(puzzle, topo, base, edges, masks)) {
      return { ok: false, solved: false, contradiction: '圆圈/度数约束出现矛盾', steps }
    }

    let changed = false
    for (let cell = 0; cell < topo.cellCount; cell++) {
      const mask = masks[cell]!
      for (let d = 0; d < 4; d++) {
        const e = topo.cellEdge[cell * 4 + d]!
        if (e < 0 || edges[e] !== EDGE_UNKNOWN) continue
        const hasDir = CONFIG_HAS_DIR[d]!
        if ((mask & hasDir) === 0) {
          if (
            setEdgeRecorded(
              ctx,
              e,
              EDGE_OFF,
              ruleForCell(puzzle, cell),
              labelForEdge(puzzle, cell, d, EDGE_OFF),
            )
          ) {
            changed = true
          }
        } else if ((mask & ~hasDir & ALL_CONFIG_BITS) === 0) {
          if (
            setEdgeRecorded(
              ctx,
              e,
              EDGE_ON,
              ruleForCell(puzzle, cell),
              labelForEdge(puzzle, cell, d, EDGE_ON),
            )
          ) {
            changed = true
          }
        }
      }
    }
    if (changed) {
      steps++
      continue
    }

    const loopResult = applyLoopRules(puzzle, topo, edges, (e, to) => {
      const from = edges[e]!
      if (from === to) return false
      edges[e] = to
      if (ctx.record) {
        ctx.deductions.push({
          edge: e,
          from,
          to,
          rule: RULE_LOOP,
          label:
            to === EDGE_OFF
              ? '回路约束：这条线不能连（会提前闭合或形成分叉）'
              : '回路约束：这条线必须连（才能连成回路）',
        })
      }
      return true
    })
    if (loopResult.contradiction) {
      return { ok: false, solved: false, contradiction: loopResult.contradiction, steps }
    }
    if (loopResult.changed) {
      steps++
      continue
    }
    break
  }

  if (!computeMasks(puzzle, topo, base, edges, masks)) {
    return { ok: false, solved: false, contradiction: '圆圈/度数约束出现矛盾', steps }
  }
  let solved = true
  for (let e = 0; e < topo.edgeCount; e++) {
    if (edges[e] === EDGE_UNKNOWN) {
      solved = false
      break
    }
  }
  return { ok: true, solved, contradiction: null, steps }
}

/* ────────────────────────── 反证（失败文字探测） ────────────────────────── */

function probeStep(ctx: LocalContext, maxSteps: number): boolean {
  const { topo, edges } = ctx
  let forced = false
  for (let e = 0; e < topo.edgeCount; e++) {
    if (edges[e] !== EDGE_UNKNOWN) continue
    if (ctx.deadline > 0 && Date.now() > ctx.deadline) return forced

    // 假设连线 → 矛盾，则必然不连
    const onEdges = edges.slice()
    onEdges[e] = EDGE_ON
    const onCtx: LocalContext = {
      ...ctx,
      edges: onEdges,
      masks: new Uint8Array(topo.cellCount),
      record: false,
      deductions: [],
    }
    const onResult = localFixpoint(onCtx, maxSteps)
    if (!onResult.ok) {
      setEdgeRecorded(ctx, e, EDGE_OFF, RULE_PROBE, probeLabel(topo, e, false))
      forced = true
      const again = localFixpoint(ctx, maxSteps)
      if (!again.ok || again.solved) return true
      continue
    }

    // 假设不连 → 矛盾，则必然连线
    const offEdges = edges.slice()
    offEdges[e] = EDGE_OFF
    const offCtx: LocalContext = {
      ...ctx,
      edges: offEdges,
      masks: new Uint8Array(topo.cellCount),
      record: false,
      deductions: [],
    }
    const offResult = localFixpoint(offCtx, maxSteps)
    if (!offResult.ok) {
      setEdgeRecorded(
        ctx,
        e,
        EDGE_ON,
        RULE_PROBE,
        probeLabel(topo, e, true),
      )
      forced = true
      const again = localFixpoint(ctx, maxSteps)
      if (!again.ok || again.solved) return true
    }
  }
  return forced
}

/** 反证提示：第 r 行第 c 列与第 r2 行第 c2 列之间的边 */
function probeLabel(topo: Topology, edge: number, mustConnect: boolean): string {
  const a = topo.edgeA[edge]!
  const b = topo.edgeB[edge]!
  const pos = (cell: number) =>
    `第 ${Math.floor(cell / topo.w) + 1} 行第 ${(cell % topo.w) + 1} 列`
  return mustConnect
    ? `反证：${pos(a)} 与 ${pos(b)} 之间的线若不连会矛盾，所以必须连上`
    : `反证：${pos(a)} 与 ${pos(b)} 之间的线若连上会矛盾，所以必须排除`
}

/* ────────────────────────── 主入口 ────────────────────────── */

export function propagate(
  puzzle: MasyuPuzzle,
  initial: ArrayLike<number>,
  opts: PropagateOptions = {},
): PropagateResult {
  const topo = getTopology(puzzle.width, puzzle.height)
  const total = topo.edgeCount
  const edges = normalizeEdges(initial, total)
  const base = new Uint8Array(topo.cellCount)
  for (let cell = 0; cell < topo.cellCount; cell++) {
    base[cell] = baseConfigBits(puzzle.circles[cell] ?? 0)
  }
  const masks = new Uint8Array(topo.cellCount)
  const deductions: Deduction[] = []
  const deadline = opts.timeBudgetMs ? Date.now() + opts.timeBudgetMs : 0
  const maxSteps = opts.maxSteps ?? 4000
  const ctx: LocalContext = {
    puzzle,
    topo,
    base,
    masks,
    edges,
    record: opts.record === true,
    deductions,
    deadline,
  }

  const local = localFixpoint(ctx, maxSteps)
  let ok = local.ok
  let solved = local.solved
  let steps = local.steps
  let contradiction = local.contradiction

  if (ok && !solved && opts.probe) {
    for (let round = 0; round < 4000 && ok && !solved; round++) {
      if (deadline > 0 && Date.now() > deadline) break
      const forced = probeStep(ctx, maxSteps)
      if (!forced) break
      steps++
      solved = true
      for (let e = 0; e < total; e++) {
        if (edges[e] === EDGE_UNKNOWN) {
          solved = false
          break
        }
      }
      if (!computeMasks(puzzle, topo, base, edges, masks)) {
        ok = false
        contradiction = '反证后出现约束矛盾'
      }
    }
  }

  return {
    edges,
    ok,
    deductions,
    masks: masks.slice(),
    solved: ok && solved,
    saturated: ok,
    steps,
    contradiction,
  }
}


/**
 * 珍珠（Masyu）题库审计
 *
 * 直接 import src/game/*.ts（Node 24 原生去类型），逐题检查：
 *   1. 编码格式（id / 尺寸 / 圆圈串 / 解串长度）；
 *   2. 参考解合法（validateMasyu.solved）；
 *   3. 从空盘出发能用规则传播推满，且推出来的就是参考解（可逻辑推完）；
 *   4. 真正数解唯一（回溯求解器 countSolutions === 1）。
 *
 * 用法：npm run check
 */
import { RAW_PUZZLES } from '../src/game/puzzles-data.ts'
import { decodePuzzle } from '../src/game/puzzles.ts'
import { getTopology } from '../src/game/state.ts'
import { propagate } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'
import { validateMasyu } from '../src/game/validate.ts'
import { decodeSolution, EDGE_ON } from '../src/game/types.ts'

const MIN_PUZZLES = 6
const MIN_DISTINCT_SIZES = 6

let errors = 0
let warnings = 0
const ids = new Set()
const sizes = new Set()

if (RAW_PUZZLES.length < MIN_PUZZLES) {
  console.error(`[check] 题库只有 ${RAW_PUZZLES.length} 题，至少需要 ${MIN_PUZZLES} 题`)
  errors++
}

for (const raw of RAW_PUZZLES) {
  const where = raw.id || '(无 id)'
  if (!raw.id || typeof raw.id !== 'string') {
    console.error(`[check] ${where} 缺 id`)
    errors++
    continue
  }
  if (ids.has(raw.id)) {
    console.error(`[check] 重复 id: ${raw.id}`)
    errors++
  }
  ids.add(raw.id)

  if (!raw.name) {
    console.error(`[check] ${raw.id} 缺 name`)
    errors++
  }
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height) || raw.width < 2 || raw.height < 2) {
    console.error(`[check] ${raw.id} 宽高非法: ${raw.width}×${raw.height}`)
    errors++
    continue
  }
  if (!['easy', 'medium', 'hard', 'custom'].includes(raw.difficulty)) {
    console.error(`[check] ${raw.id} 难度非法: ${raw.difficulty}`)
    errors++
  }

  const puzzle = decodePuzzle(raw)
  if (!puzzle) {
    console.error(`[check] ${raw.id} 题面编码非法（board 长度应为 ${raw.width}×${raw.height}）`)
    errors++
    continue
  }
  sizes.add(`${raw.width}x${raw.height}`)

  const topo = getTopology(raw.width, raw.height)
  const solutionEdges = decodeSolution(raw.solution, topo.edgeCount)
  if (!solutionEdges) {
    console.error(`[check] ${raw.id} 参考解编码非法（长度应为边数 ${topo.edgeCount}）`)
    errors++
    continue
  }
  const reference = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    edges: solutionEdges,
    cursor: 0,
  }

  // 2) 参考解合法
  const refCheck = validateMasyu(reference, puzzle)
  if (!refCheck.solved) {
    console.error(
      `[check] ${raw.id} 参考解不合法: 断头 ${refCheck.openCells.length} / 分叉 ${refCheck.branchCells.length} / 环 ${refCheck.loops} / 圆圈错 ${refCheck.badCircles.length}`,
    )
    errors++
    continue
  }

  // 3) 规则传播可推满
  const empty = new Array(topo.edgeCount).fill(0)
  const propped = propagate(puzzle, empty, { probe: true, timeBudgetMs: 8000 })
  let logicOk = propped.ok && propped.solved
  if (logicOk) {
    for (let e = 0; e < topo.edgeCount; e++) {
      const want = solutionEdges[e] === EDGE_ON ? 1 : 0
      const got = propped.edges[e] === EDGE_ON ? 1 : 0
      if (want !== got) {
        logicOk = false
        break
      }
    }
  }
  if (!logicOk) {
    console.error(`[check] ${raw.id} 规则传播推不满（无法保证可逻辑解完）`)
    errors++
    continue
  }

  // 4) 唯一解
  const counted = countSolutions(puzzle, 2, 300_000, 10_000)

  if (counted.timedOut) {
    console.warn(`[check] ${raw.id} 唯一解检查超时（${counted.nodes} 节点）`)
    warnings++
    errors++
    continue
  }
  if (counted.count !== 1) {
    console.error(`[check] ${raw.id} 解不唯一：找到 ${counted.count} 个`)
    errors++
    continue
  }

  let circles = 0
  let whites = 0
  let blacks = 0
  for (const v of puzzle.circles) {
    if (v === 1) whites++
    if (v === 2) blacks++
    if (v !== 0) circles++
  }
  const loopEdges = solutionEdges.filter((v) => v === EDGE_ON).length
  console.log(
    `[check] ${raw.id} ${raw.width}×${raw.height} · 圆圈 ${circles}（白 ${whites} 黑 ${blacks}）· 回路 ${loopEdges} 边 · 参考解 OK · 规则推满 OK · 唯一解 OK（${counted.nodes} 节点）`,
  )
}

if (sizes.size < MIN_DISTINCT_SIZES) {
  console.error(`[check] 只有 ${sizes.size} 种尺寸，至少需要 ${MIN_DISTINCT_SIZES} 种不同尺寸`)
  errors++
}

console.log(
  `[check] 共 ${RAW_PUZZLES.length} 题 / ${sizes.size} 种尺寸，错误 ${errors}，警告 ${warnings}`,
)
if (RAW_PUZZLES.length === 0) console.warn('[check] 题库为空，请先运行 npm run gen。')
if (errors > 0) process.exitCode = 1


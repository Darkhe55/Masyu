/**
 * 珍珠（Masyu）—— 逻辑解题回放
 *
 * 相位 1：在快照上跑规则传播，把每一步“必然成立”的连线记成 PlaybackFrame；
 * 相位 2：框架逐帧回放（core/playback.ts）。
 *
 * 回放只画「连上的线」：规则推导出的大量“排除”不占帧，画面更干净；
 * 如果玩家盘面上有画错的线（传播出矛盾），或规则推不满，
 * 就用求解器补全，并把剩下的连线作为「回溯补全」帧。
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types.ts'
import { asMasyuPuzzle, asMasyuState, EDGE_ON, EDGE_UNKNOWN, type MasyuState } from './types.ts'
import { propagate } from './rules.ts'
import { solvePuzzle } from './solver.ts'

const RULE_SEARCH = 9

export function planLogicSolve(puzzle: Puzzle, state: GameState): LogicPlan {
  const p = asMasyuPuzzle(puzzle)
  const s = asMasyuState(state)
  const result = s.edges.slice()
  const frames: PlaybackFrame[] = []
  let streak = 0

  const push = (edge: number, from: number, to: number, rule: number, label: string): void => {
    if (from === to) return
    streak++
    frames.push({ rule, label, move: { index: edge, from, to }, streak })
    result[edge] = to
  }

  const res = propagate(p, result, { record: true, probe: true, timeBudgetMs: 3000 })

  if (!res.ok) {
    // 玩家盘面有画错的线：用求解器给出最终回路，顺便擦掉错线
    const solved = solvePuzzle(p, 200_000, 3000)
    if (!solved.solved || !solved.solution) {
      return { puzzleId: p.id, frames: [], finalState: null, ruleSteps: 0, saturated: false }
    }
    const solution = asMasyuState(solved.solution).edges
    for (let e = 0; e < solution.length; e++) {
      const want = solution[e] === EDGE_ON ? EDGE_ON : EDGE_UNKNOWN
      const cur = result[e] ?? EDGE_UNKNOWN
      if (cur === want) continue
      push(
        e,
        cur,
        want,
        RULE_SEARCH,
        want === EDGE_ON ? '回溯补全：这段线最终必须连上' : '回溯补全：这段线画错了，要擦掉',
      )
    }
    return {
      puzzleId: p.id,
      frames,
      finalState: { ...s, edges: result.slice() } as MasyuState,
      ruleSteps: frames.length,
      saturated: false,
    }
  }

  // 只回放“连线”推导（排除不占帧）
  for (const d of res.deductions) {
    if (d.to !== EDGE_ON) continue
    push(d.edge, result[d.edge] ?? EDGE_UNKNOWN, EDGE_ON, d.rule, d.label)
  }

  if (!res.solved) {
    const solved = solvePuzzle(p, 200_000, 4000)
    if (solved.solved && solved.solution) {
      const solution = asMasyuState(solved.solution).edges
      for (let e = 0; e < solution.length; e++) {
        if (solution[e] !== EDGE_ON) continue
        const cur = result[e] ?? EDGE_UNKNOWN
        if (cur === EDGE_ON) continue
        push(e, cur, EDGE_ON, RULE_SEARCH, '回溯补全：这段线最终必须连上')
      }
    }
  }

  return {
    puzzleId: p.id,
    frames,
    finalState: { ...s, edges: result.slice() } as MasyuState,
    ruleSteps: frames.length,
    saturated: res.solved,
  }
}




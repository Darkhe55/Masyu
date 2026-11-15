/**
 * 珍珠（Masyu）题库生成入口
 *
 * 真正的生成逻辑在 src/game/generator.ts（用规则传播 + 求解器保证唯一解、可逻辑推完）。
 * 这个文件只是 scripts/gen-puzzles.mjs 的薄封装。
 */

export const NAME = 'Masyu 珍珠生成器'

export async function generatePuzzles() {
  const { generateBuiltins } = await import('../src/game/generator.ts')
  return generateBuiltins()
}

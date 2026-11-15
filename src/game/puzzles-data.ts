/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串：每格 . 空 / w 白圈 / b 黑圈（长度 = 宽×高） */
  board: string
  /** 参考解编码串：每条边 1 连线 / 0 不连（长度 = 边数） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "masyu-5x5", name: "珍珠 · 入门 5×5", width: 5, height: 5, difficulty: "easy", series: "builtin", board: "...w...ww..w.w......b.w..", solution: "1111011100110101111010001110001110110010" },
  { id: "masyu-6x6", name: "珍珠 · 入门 6×6", width: 6, height: 6, difficulty: "easy", series: "builtin", board: "b...w.....w...w.....w.w...w.w.....w.", solution: "111110111101111011110111111111100001110000100001110000100001" },
  { id: "masyu-7x7", name: "珍珠 · 进阶 7×7", width: 7, height: 7, difficulty: "medium", series: "builtin", board: "...w.w.w...w..b....w..w.b.w..w...w.........w..w..", solution: "101111010111110111110111110011110101111110111000110010000010001100100000111011000010" },
  { id: "masyu-8x8", name: "珍珠 · 进阶 8×8", width: 8, height: 8, difficulty: "medium", series: "builtin", board: "..w..w...w....w....w..w.w.w.w.w.b.........w.w.w.w...w.w.......w.", solution: "1110111110101110110110110011110101110011110101111111111110011001001001001100100110011100001000011111000010000001" },
  { id: "masyu-9x9", name: "珍珠 · 进阶 9×9", width: 9, height: 9, difficulty: "medium", series: "builtin", board: "...w...w.ww.....w.....ww........w..w.wbw...w.w..w...w....w.w.............ww...w..", solution: "101111110011011100100011000100100011010001110100101100101010010111101110111000001110011000111111101111001011110010111100001011011011101100110010" },
  { id: "masyu-10x10", name: "珍珠 · 挑战 10×10", width: 10, height: 10, difficulty: "hard", series: "builtin", board: "b.......w.w.w....ww..wb..w......w...w.w.....w...w..b......w..w..w.w..b.w..b..wb..bw.wb...w......w...", solution: "111111111011110111001100111000101111010111111011011111001001111001100110011110100111111101100000000111000110001110110001111100000010000000011101100000111011000111000110111000000111" },
]

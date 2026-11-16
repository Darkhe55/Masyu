/**
 * 珍珠（Masyu）题面图片导入（自动识图）
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--size N | --width W --height H]
 *                                  [--name 名称] [--id ID] [--series builtin]
 *                                  [--append] [--verify] [--dry] [--map 0=w,1=b]
 *
 * 识图原理：
 *   1. Playwright + Edge 打开图片到 canvas，取像素；
 *   2. 暗像素连通域 = 圆圈；按填充率区分「白圈（空心环）」和「黑圈（实心盘）」；
 *   3. 用所有圆圈中心拟合格点间距（最小二乘），把圆圈落到 (列, 行)；
 *   4. 生成题库格式：board 每格 '.' 空 / 'w' 白圈 / 'b' 黑圈；
 *   5. --append 写入 src/game/imported-puzzles.ts（不会被 npm run gen 覆盖）；
 *   6. --verify 用项目求解器检查唯一解（大图可能超时，只警告不失败）。
 *
 * 识别不可靠时可用 --map 人工指定两类圆圈的映射（0=空心环、1=实心盘），
 * 或用 --size/--width/--height 覆盖棋盘尺寸。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { build as esbuild } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  return process.argv[i + 1] ?? fallback
}
function has(name) {
  return process.argv.includes(name)
}

const imageArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!imageArg) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--size N | --width W --height H] [--name 名称] [--id ID] [--append] [--verify] [--dry] [--map 0=w,1=b]',
  )
  process.exit(1)
}
const imagePath = path.resolve(process.cwd(), imageArg)
if (!existsSync(imagePath)) {
  console.error(`[import] 找不到图片：${imagePath}`)
  process.exit(1)
}

const sizeOpt = Number(arg('--size', '0')) || 0
const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const name = arg('--name', path.basename(imagePath, path.extname(imagePath)))
const id = arg('--id', `masyu-import-${Date.now().toString(36)}`)
const series = arg('--series', '导入')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')

// --map：把「检测出的符号类别」映射到题目字符。类别 0=空心环，1=实心盘
const DEFAULT_MAP = { 0: 'w', 1: 'b' }
const symbolMap = { ...DEFAULT_MAP }
const mapArg = arg('--map', '')
if (mapArg) {
  for (const pair of mapArg.split(',')) {
    const [k, v] = pair.split('=')
    if (k === undefined || v === undefined) continue
    const key = Number(k)
    if ((key === 0 || key === 1) && (v === 'w' || v === 'b')) symbolMap[key] = v
  }
}

/* ───────────────────────── 识图（浏览器内） ───────────────────────── */

const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const analyzed = await page.evaluate(async (url) => {
  const img = new Image()
  img.src = url
  await img.decode()
  const W = img.naturalWidth
  const H = img.naturalHeight
  const cv = document.getElementById('c')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, W, H).data
  const lum = (x, y) => {
    const i = (y * W + x) * 4
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
  }

  // 1) 暗像素连通域
  const seen = new Uint8Array(W * H)
  const blobs = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      if (seen[k] || lum(x, y) >= 110) continue
      let n = 0
      let sx = 0
      let sy = 0
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      const st = [[x, y]]
      seen[k] = 1
      while (st.length) {
        const [cx, cy] = st.pop()
        n++
        sx += cx
        sy += cy
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const nk = ny * W + nx
          if (seen[nk] || lum(nx, ny) >= 110) continue
          seen[nk] = 1
          st.push([nx, ny])
        }
      }
      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      // 圆圈：近正方形、尺寸在合理范围
      if (bw >= 9 && bh >= 9 && bw <= 40 && bh <= 40 && Math.abs(bw - bh) <= Math.max(3, bw * 0.2)) {
        const fill = n / (bw * bh)
        blobs.push({ cx: sx / n, cy: sy / n, w: bw, h: bh, n, fill })
      }
    }
  }
  return { W, H, blobs }
}, dataUrl)
await browser.close()

const { W, H, blobs } = analyzed
if (!blobs.length) {
  console.error('[import] 没有识别到任何圆圈，请确认图片是珍珠（Masyu）题面')
  process.exit(1)
}

/**
 * 用最小二乘把一串坐标拟合到等距格点，返回间距、原点、最大残差。
 * 先按 6px 容差做 1D 聚类，避免「同一列多个圆心」把最近邻距离变成 0。
 */
function fitLattice(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  const clusters = []
  for (const v of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && v - last.max <= 6) {
      last.items.push(v)
      last.max = v
      last.avg = last.items.reduce((s, x) => s + x, 0) / last.items.length
    } else clusters.push({ items: [v], avg: v, min: v, max: v })
  }
  const centers = clusters.map((c) => c.avg)
  const diffs = []
  for (let i = 1; i < centers.length; i++) diffs.push(centers[i] - centers[i - 1])
  diffs.sort((a, b) => a - b)
  if (!diffs.length) throw new Error('圆圈排列不足以拟合网格间距')
  let s = diffs[Math.floor(diffs.length / 2)]
  let x0 = centers[0]
  let resid = Infinity
  for (let iter = 0; iter < 40; iter++) {
    const pts = centers.map((v) => [Math.round((v - x0) / s), v]).filter(([i]) => i >= -2 && i <= 1e3)
    const n = pts.length
    const idx = pts.map((p) => p[0])
    const si = idx.reduce((a, b) => a + b, 0)
    const sv = pts.reduce((a, p) => a + p[1], 0)
    const sii = idx.reduce((a, b) => a + b * b, 0)
    const siv = idx.reduce((a, b, i) => a + b * pts[i][1], 0)
    const den = n * sii - si * si
    if (!den) break
    const nextS = (n * siv - si * sv) / den
    const nextX0 = (sv - nextS * si) / n
    if (!Number.isFinite(nextS) || !Number.isFinite(nextX0) || nextS <= 0) break
    if (nextS < s * 0.9 || nextS > s * 1.1) break
    s = nextS
    x0 = nextX0
    let r = 0
    for (const [i, v] of pts) r = Math.max(r, Math.abs(v - (x0 + i * s)))
    if (r > resid - 0.01 && iter > 3) break
    resid = r
  }
  const idx = centers.map((v) => Math.round((v - x0) / s))
  return { s, origin: x0, minIdx: Math.min(...idx), maxIdx: Math.max(...idx), resid, cells: centers.length }
}

const latX = fitLattice(blobs.map((b) => b.cx))
const latY = fitLattice(blobs.map((b) => b.cy))
const sX = (latX.s + latY.s) / 2
const sY = sX

let nCols = widthOpt || sizeOpt || latX.maxIdx - latX.minIdx + 1
let nRows = heightOpt || sizeOpt || latY.maxIdx - latY.minIdx + 1

if (latX.resid > sX * 0.18 || latY.resid > sY * 0.18) {
  console.warn(
    `[import] 警告：圆圈中心与格点残差较大（x ${latX.resid.toFixed(1)}px / y ${latY.resid.toFixed(1)}px），可以用 --width/--height 覆盖尺寸`,
  )
}

if (nCols < 2 || nRows < 2) {
  console.error(`[import] 棋盘尺寸识别失败：${nCols}×${nRows}`)
  process.exit(1)
}

const board = new Array(nCols * nRows).fill('.')
let circles = 0
const occupied = new Map()
let maxResid = 0
for (const b of blobs) {
  const col = Math.round((b.cx - latX.origin) / sX) - latX.minIdx
  const row = Math.round((b.cy - latY.origin) / sY) - latY.minIdx
  const rx = Math.abs(b.cx - (latX.origin + (col + latX.minIdx) * sX))
  const ry = Math.abs(b.cy - (latY.origin + (row + latY.minIdx) * sY))
  maxResid = Math.max(maxResid, rx, ry)
  if (col < 0 || row < 0 || col >= nCols || row >= nRows) continue
  const i = row * nCols + col
  if (occupied.has(i)) {
    console.warn(`[import] 警告：格子 (${col},${row}) 上识别到两个圆圈，取先出现的一个`)
    continue
  }
  const kind = b.fill >= 0.62 ? 1 : 0
  occupied.set(i, kind)
  board[i] = symbolMap[kind]
  circles++
}

console.log(
  `[import] ${path.basename(imagePath)}：${W}×${H}，格距 ${sX.toFixed(2)}px，` +
    `棋盘 ${nCols}×${nRows}，识别 ${circles} 个圆圈（白 ${board.filter((c) => c === 'w').length} / 黑 ${board.filter((c) => c === 'b').length}）`,
)
console.log(`[import] 圆心最大偏差 ${maxResid.toFixed(1)}px，格点拟合残差 ${latX.resid.toFixed(1)}px`)

if (circles < 2) {
  console.error('[import] 圆圈太少，无法作为珍珠题面')
  process.exit(1)
}

/* 预览 */
const chars = { '.': '·', w: '○', b: '●' }
console.log('[import] 题面预览（○ 白圈 / ● 黑圈）：')
for (let y = 0; y < nRows; y++) {
  console.log('  ' + board.slice(y * nCols, y * nCols + nCols).map((c) => chars[c] ?? c).join(' '))
}

/* ───────────────────────── 校验求解 ───────────────────────── */

if (verify) {
  const bundleFile = path.join(ROOT, 'node_modules', '.cache', 'import-verify-masyu.mjs')
  await esbuild({
    absWorkingDir: ROOT,
    stdin: {
      contents: `
        export { countSolutions } from './src/game/solver.ts'
        export { getReferenceSolution } from './src/game/puzzles.ts'
      `,
      resolveDir: ROOT,
      sourcefile: 'import-verify-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundleFile,
    logLevel: 'silent',
  })
  const { countSolutions } = await import(pathToFileURL(bundleFile).href)
  const puzzle = {
    id,
    name,
    width: nCols,
    height: nRows,
    difficulty: 'custom',
    circles: board.map((c) => (c === 'w' ? 1 : c === 'b' ? 2 : 0)),
  }
  const t0 = Date.now()
  const area = nCols * nRows
  const budget = area > 400 ? 6_000_000 : 2_000_000
  const res = countSolutions(puzzle, 2, budget, area > 400 ? 30_000 : 8_000)
  const ms = Date.now() - t0
  if (res.timedOut) {
    console.warn(
      `[import] 唯一性检查超时（${res.nodes} 节点 / ${ms}ms），无法确认唯一解；大尺寸题属于正常情况`,
    )
  } else if (res.count === 0) {
    console.error('[import] 识别结果无解：圆圈识别可能有误（可用 --map 交换黑白圈重试）')
    if (!dry) process.exit(1)
  } else if (res.count >= 2) {
    console.warn(`[import] 识别结果至少 ${res.count} 个解（节点 ${res.nodes} / ${ms}ms），题面可能不唯一`)
  } else {
    console.log(`[import] 唯一解检查通过（${res.nodes} 节点 / ${ms}ms）`)
  }
}

if (dry) {
  console.log('[import] --dry：仅识别，不写入。')
  process.exit(0)
}

/* ───────────────────────── 写入题库 ───────────────────────── */

const boardStr = board.join('')
if (!append) {
  console.log('[import] 预览模式（未写入）。board 编码：')
  console.log(JSON.stringify(boardStr))
  console.log('[import] 加 --append 可写入 src/game/imported-puzzles.ts')
  process.exit(0)
}

const file = path.join(ROOT, 'src/game/imported-puzzles.ts')
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${nCols}, height: ${nRows}, difficulty: "custom", series: ${JSON.stringify(series)}, board: ${JSON.stringify(boardStr)} },\n`
if (!existsSync(file)) {
  writeFileSync(
    file,
    `/* 由 scripts/import-image.mjs 追加，npm run gen 不会覆盖。 */\nimport type { RawPuzzle } from './puzzles-data.ts'\n\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]\n`,
  )
} else {
  let text = readFileSync(file, 'utf8')
  if (text.includes('IMPORTED_PUZZLES: RawPuzzle[] = []')) {
    text = text.replace('IMPORTED_PUZZLES: RawPuzzle[] = []', `IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]`)
  } else {
    const marker = text.lastIndexOf('\n]')
    if (marker < 0) throw new Error('imported-puzzles.ts 格式异常，找不到数组结尾')
    text = text.slice(0, marker + 1) + entry + text.slice(marker + 1)
  }
  writeFileSync(file, text)
}
console.log(`[import] 已写入 ${file}`)

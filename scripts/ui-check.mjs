/**
 * 珍珠（Masyu）浏览器冒烟测试（Playwright + 本机 Edge）
 *
 * 覆盖：
 *   1. 页面启动、内置题库 6 题、标题/棋盘
 *   2. 鼠标：逐边点击画线解出第一题；单击取消；右键标叉/取消；拖拽连续画线
 *   3. 键盘：方向键移动光标、空格切换连线、X 标叉、Backspace 取消、撤销
 *   4. 错误高亮：画错线后检查按钮给出中文提示 + 红色断头标记
 *   5. 提示一格、清空、逻辑解题回放（内置题规则推满）
 *   6. 自定义题板：改尺寸、放白/黑圈、保存到题库、编辑回填、两步确认删除
 *   7. 全程收集 pageerror，截图写入 output/playwright/
 *
 * 用法：先 `npm run dev`（端口 5215），再 `npm run ui-check`。
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { PORT } from './_port.mjs'

const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}/`
const SHOT_DIR = path.resolve('output/playwright')
mkdirSync(SHOT_DIR, { recursive: true })

// 测试从干净的题库/进度开始（只动本项目的 data/）
const DATA_DIR = path.resolve('data')
mkdirSync(DATA_DIR, { recursive: true })
writeFileSync(path.join(DATA_DIR, 'library.json'), '[]')
writeFileSync(path.join(DATA_DIR, 'progress.json'), '{}')
writeFileSync(path.join(DATA_DIR, 'last-puzzle.json'), 'null')

const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

let pageErrors = 0
page.on('pageerror', (e) => {
  pageErrors++
  console.log('PAGEERROR', e.message)
})
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE-ERROR', msg.text())
})

const results = []
const ok = (name, detail = '') => {
  results.push({ name, pass: true, detail })
  console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`)
}
const fail = (name, detail = '') => {
  results.push({ name, pass: false, detail })
  console.log(`✘ ${name}${detail ? ' — ' + detail : ''}`)
}

const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true })
}

/* ────────────────── 页面内工具 ────────────────── */

const sessionInfo = () =>
  page.evaluate(() => {
    const s = window.__game.getSession()
    return s
      ? {
          puzzleId: s.puzzle.id,
          name: s.puzzle.name,
          width: s.puzzle.width,
          height: s.puzzle.height,
          edges: s.state.edges.slice(),
          cursor: s.state.cursor,
        }
      : null
  })

const validateNow = () =>
  page.evaluate(() => {
    const s = window.__game.getSession()
    if (!s) return null
    return window.__game.adapter.validate(s.state, s.puzzle)
  })

const referenceEdges = () =>
  page.evaluate(() => {
    const s = window.__game.getSession()
    if (!s) return null
    const sol = window.__game.adapter.getReferenceSolution(s.puzzle.id)
    return sol ? sol.edges.slice() : null
  })

const edgeMidClient = async (edge) => {
  return page.evaluate((edgeIndex) => {
    const game = window.__game
    const s = game.getSession()
    if (!s) return null
    const { puzzle } = s
    const m = game.adapter.metricsFor(puzzle)
    const w = puzzle.width
    const h = puzzle.height
    const cw = m.cellW ?? m.cell
    const ch = m.cellH ?? m.cell
    const ox = m.originX ?? m.pad
    const oy = m.originY ?? m.pad
    const center = (cell) => ({
      x: ox + (cell % w) * cw + cw / 2,
      y: oy + Math.floor(cell / w) * ch + ch / 2,
    })
    const hCount = w > 1 ? h * (w - 1) : 0
    let a
    let b
    if (edgeIndex < hCount) {
      const y = Math.floor(edgeIndex / (w - 1))
      const x = edgeIndex % (w - 1)
      a = y * w + x
      b = a + 1
    } else {
      const v = edgeIndex - hCount
      const y = Math.floor(v / w)
      const x = v % w
      a = y * w + x
      b = a + w
    }
    const ca = center(a)
    const cb = center(b)
    const svg = document.querySelector('svg.board-svg')
    const ctm = svg.getScreenCTM()
    const pt = svg.createSVGPoint()
    pt.x = (ca.x + cb.x) / 2
    pt.y = (ca.y + cb.y) / 2
    const sp = pt.matrixTransform(ctm)
    return { x: sp.x, y: sp.y }
  }, edge)
}

const clickEdge = async (edge, options = {}) => {
  const pos = await edgeMidClient(edge)
  if (!pos) throw new Error('无法计算边坐标：' + edge)
  await page.mouse.click(pos.x, pos.y, options)
  await page.waitForTimeout(20)
}

const statusText = async () => ((await page.locator('#status').textContent()) ?? '').trim()

const loadFirstPuzzle = async () => {
  const builtin = page.locator('.puzzle-item', { hasText: '珍珠 ·' }).first()
  if ((await builtin.count()) > 0) await builtin.click()
  else await page.locator('.puzzle-item').first().click()
  await page.waitForTimeout(150)
}

const libraryCount = async () => (await page.locator('.puzzle-item').count())

/* ────────────────── 启动 ────────────────── */

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('#app[data-booted="1"]', { timeout: 20_000 })
await page.waitForSelector('svg.board-svg', { timeout: 20_000 })
await page.waitForTimeout(200)

const title = await page.title()
if (title.includes('珍珠') && title.includes('Masyu')) ok('页面标题', title)
else fail('页面标题', title)

const builtinCount = await page.locator('.puzzle-item').count()
if (builtinCount >= 6) ok('内置题库', `${builtinCount} 题`)
else fail('内置题库', `只有 ${builtinCount} 题`)

await shot('01-initial.png')

/* ────────────────── 鼠标交互 ────────────────── */

await loadFirstPuzzle()
let info = await sessionInfo()
const ref = await referenceEdges()
if (info && ref) ok('加载第一题', `${info.name} ${info.width}×${info.height}`)
else fail('加载第一题')

// 单击画线 / 再点取消
const firstOn = ref.indexOf(1)
await clickEdge(firstOn)
info = await sessionInfo()
if (info.edges[firstOn] === 1) ok('鼠标左键画线')
else fail('鼠标左键画线', `edge=${info.edges[firstOn]}`)
await clickEdge(firstOn)
info = await sessionInfo()
if (info.edges[firstOn] === 0) ok('鼠标左键取消线')
else fail('鼠标左键取消线', `edge=${info.edges[firstOn]}`)

// 右键标叉 / 取消
const firstOff = ref.indexOf(0)
await clickEdge(firstOff, { button: 'right' })
info = await sessionInfo()
if (info.edges[firstOff] === 2) ok('鼠标右键标叉')
else fail('鼠标右键标叉', `edge=${info.edges[firstOff]}`)
await clickEdge(firstOff, { button: 'right' })
info = await sessionInfo()
if (info.edges[firstOff] === 0) ok('鼠标右键取消叉')
else fail('鼠标右键取消叉', `edge=${info.edges[firstOff]}`)

// 拖拽连续画线（从一条边拖到相邻的另一条边）
const dragPair = []
for (let e = 0; e < ref.length && dragPair.length < 2; e++) {
  if (ref[e] === 1) dragPair.push(e)
}
const dragFrom = await edgeMidClient(dragPair[0])
const dragTo = await edgeMidClient(dragPair[1])
await page.mouse.move(dragFrom.x, dragFrom.y)
await page.mouse.down()
await page.mouse.move(dragFrom.x + 12, dragFrom.y + 12, { steps: 4 })
await page.mouse.move(dragTo.x, dragTo.y, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(80)
info = await sessionInfo()
const draggedCount = dragPair.filter((e) => info.edges[e] === 1).length
if (draggedCount >= 1) ok('鼠标拖拽连续画线', `${draggedCount}/2`)
else fail('鼠标拖拽连续画线')

/* ────────────────── 键盘交互 ────────────────── */

await page.locator('#btn-clear').click()
await page.waitForTimeout(80)
info = await sessionInfo()
const cursor0 = info.cursor
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(30)
info = await sessionInfo()
if (info.cursor !== cursor0) ok('键盘方向键移动光标', `${cursor0} → ${info.cursor}`)
else fail('键盘方向键移动光标')

const kbEdge = info.cursor
await page.keyboard.press('Space')
await page.waitForTimeout(30)
info = await sessionInfo()
if (info.edges[kbEdge] === 1) ok('键盘空格画线')
else fail('键盘空格画线')
await page.keyboard.press('x')
await page.waitForTimeout(30)
info = await sessionInfo()
if (info.edges[kbEdge] === 2) ok('键盘 X 标叉')
else fail('键盘 X 标叉', `edge=${info.edges[kbEdge]}`)
await page.keyboard.press('Backspace')
await page.waitForTimeout(30)
info = await sessionInfo()
if (info.edges[kbEdge] === 0) ok('键盘 Backspace 取消叉')
else fail('键盘 Backspace 取消叉', `edge=${info.edges[kbEdge]}`)

// 撤销 / 重做
await page.keyboard.press('Space')
await page.waitForTimeout(30)
await page.locator('#btn-undo').click()
await page.waitForTimeout(60)
info = await sessionInfo()
if (info.edges[kbEdge] === 0) ok('撤销')
else fail('撤销', `edge=${info.edges[kbEdge]}`)
await page.locator('#btn-redo').click()
await page.waitForTimeout(60)
info = await sessionInfo()
if (info.edges[kbEdge] === 1) ok('重做')
else fail('重做', `edge=${info.edges[kbEdge]}`)

/* ────────────────── 错误高亮 / 检查 ────────────────── */

await page.locator('#btn-clear').click()
await page.waitForTimeout(60)
const wrongEdge = ref.indexOf(0)
await clickEdge(wrongEdge)
await page.locator('#btn-check').click()
await page.waitForTimeout(120)
const errStatus = await statusText()
const errDots = await page.locator('.masyu-error-dot').count()
if (errDots > 0 && /断头|分叉|回路|圆圈/.test(errStatus)) {
  ok('错误高亮 + 中文提示', errStatus)
} else {
  fail('错误高亮 + 中文提示', `dots=${errDots} status=${errStatus}`)
}
await shot('02-error-highlight.png')

/* ────────────────── 提示一格 ────────────────── */

await page.locator('#btn-clear').click()
await page.waitForTimeout(60)
await page.locator('#btn-hint').click()
await page.waitForTimeout(120)
info = await sessionInfo()
const hintOn = info.edges.filter((v) => v === 1).length
if (hintOn >= 1) ok('提示一格', `已补 ${hintOn} 条线`)
else fail('提示一格')

/* ────────────────── 鼠标解完整题 ────────────────── */

await page.locator('#btn-clear').click()
await page.waitForTimeout(60)
const solutionEdges = []
for (let e = 0; e < ref.length; e++) if (ref[e] === 1) solutionEdges.push(e)
for (const e of solutionEdges) await clickEdge(e)
await page.waitForTimeout(200)
const solveStatus = await statusText()
const solvedResult = await validateNow()
if (solvedResult?.solved) ok('鼠标解出整题', solveStatus)
else fail('鼠标解出整题', solveStatus)
await shot('03-solved.png')

/* ────────────────── 显示解 / 随机抽题 / 缩放 / 音效 / 大棋盘 ────────────────── */

await page.locator('#btn-clear').click()
await page.waitForTimeout(60)
await page.locator('#btn-solve').click()
await page.waitForTimeout(400)
const solutionResult = await validateNow()
if (solutionResult?.solved) ok('显示解', await statusText())
else fail('显示解', await statusText())

const idBefore = (await sessionInfo())?.puzzleId
await page.locator('#btn-random').click()
await page.waitForTimeout(200)
const idAfter = (await sessionInfo())?.puzzleId
if (idAfter && idAfter !== idBefore) ok('随机抽题', `${idBefore} → ${idAfter}`)
else fail('随机抽题', `${idBefore} → ${idAfter}`)

await page.locator('#zoom-in').click()
await page.waitForTimeout(80)
const zoomLabel = ((await page.locator('#zoom-label').textContent()) ?? '').trim()
if (zoomLabel !== '100%') ok('画布缩放', zoomLabel)
else fail('画布缩放', zoomLabel)
await page.locator('#zoom-reset').click()
await page.waitForTimeout(60)

await page.locator('#btn-mute').click()
await page.waitForTimeout(60)
const muteText = ((await page.locator('#btn-mute').textContent()) ?? '').trim()
if (muteText.includes('关')) ok('音效开关', muteText)
else fail('音效开关', muteText)
await page.locator('#btn-mute').click()

const bigPuzzle = page.locator('.puzzle-item', { hasText: '10×10' }).first()
if ((await bigPuzzle.count()) > 0) {
  await bigPuzzle.click()
  await page.waitForTimeout(250)
  const bigInfo = await sessionInfo()
  const bigEdges = await page.locator('svg.board-svg line.edge-on').count()
  if (bigInfo?.width === 10 && bigInfo?.height === 10)
    ok('10×10 内置题加载', `${bigInfo.width}×${bigInfo.height} 盘面 / 当前连线 ${bigEdges}`)
  else fail('10×10 内置题加载', JSON.stringify({ w: bigInfo?.width, h: bigInfo?.height }))
} else {
  fail('10×10 内置题存在')
}

// 回到第一题，准备逻辑回放
await loadFirstPuzzle()

/* ────────────────── 逻辑解题回放 ────────────────── */

await page.locator('#btn-clear').click()
await page.waitForTimeout(80)
await page.locator('#btn-logic').click()
const deadline = Date.now() + 40_000
let logicDone = false
while (Date.now() < deadline) {
  await page.waitForTimeout(250)
  const st = await statusText()
  if (/逻辑解题完成|回放完毕|逻辑规则暂无新推演/.test(st)) {
    logicDone = true
    break
  }
}
const logicResult = await validateNow()
if (logicDone && logicResult?.solved) {
  ok('逻辑解题回放', await statusText())
} else if (logicDone) {
  // 回放结束但盘面未解出，也接受（说明规则没推满），但记录
  fail('逻辑解题回放（未解出）', await statusText())
} else {
  fail('逻辑解题回放（超时）', await statusText())
}
await shot('04-logic-playback.png')

/* ────────────────── 自定义题板 ────────────────── */

const beforeCustom = await libraryCount()
await page.locator('#btn-custom').click()
await page.waitForTimeout(100)
await page.locator('#custom-w').fill('6')
await page.locator('#custom-h').fill('6')
await page.locator('#custom-regen').click()
await page.waitForTimeout(120)
const cellCount = await page.locator('.custom-cell').count()
if (cellCount === 36) ok('自定义题板 6×6 网格')
else fail('自定义题板 6×6 网格', `cells=${cellCount}`)

// 点出白圈 / 黑圈
await page.locator('.custom-cell[data-i="7"]').click()
await page.locator('.custom-cell[data-i="7"]').click()
await page.locator('.custom-cell[data-i="8"]').click()
const whiteCount = await page.locator('.custom-cell.circle-white').count()
const blackCount = await page.locator('.custom-cell.circle-black').count()
if (whiteCount >= 1 && blackCount >= 1) ok('自定义题板放白圈/黑圈', `白 ${whiteCount} 黑 ${blackCount}`)
else fail('自定义题板放白圈/黑圈', `白 ${whiteCount} 黑 ${blackCount}`)
await shot('05-custom-editor.png')

// 保存到题库
await page.locator('#custom-save').click()
await page.waitForTimeout(800)
const afterSave = await libraryCount()
const saveMsg = ((await page.locator('#custom-msg').textContent()) ?? '').trim()
if (afterSave === beforeCustom + 1) ok('自定义题保存到题库', saveMsg)
else fail('自定义题保存到题库', `count ${beforeCustom} → ${afterSave}；${saveMsg}`)

const storeFile = path.resolve('data/library.json')
let savedId = ''
if (existsSync(storeFile)) {
  try {
    const lib = JSON.parse(readFileSync(storeFile, 'utf8'))
    const last = lib[lib.length - 1]
    savedId = last?.id ?? ''
    if (savedId.startsWith('masyu-custom-')) ok('自定义题写入 data/library.json', savedId)
    else fail('自定义题写入 data/library.json', JSON.stringify(last))
  } catch (err) {
    fail('自定义题写入 data/library.json', String(err))
  }
} else {
  fail('自定义题写入 data/library.json', '文件不存在')
}

// 刷新页面：确认自定义题持久化（下次启动仍在题库里）
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('#app[data-booted="1"]', { timeout: 20_000 })
await page.waitForTimeout(300)
const afterReload = await libraryCount()
if (afterReload === afterSave) ok('刷新后自定义题仍在题库', `${afterReload} 题`)
else fail('刷新后自定义题仍在题库', `${afterSave} → ${afterReload}`)

// 编辑回填
const editBtn = page.locator('.puzzle-act[data-edit]').first()
if ((await editBtn.count()) > 0) {
  await editBtn.click()
  await page.waitForTimeout(150)
  const editCells = await page.locator('.custom-cell').count()
  const editMsg = ((await page.locator('#custom-msg').textContent()) ?? '').trim()
  if (editCells === 36 && /正在编辑/.test(editMsg)) ok('自定义题编辑回填', editMsg)
  else fail('自定义题编辑回填', `cells=${editCells} msg=${editMsg}`)
  await page.locator('.custom-cell[data-i="20"]').click()
  await page.locator('#custom-save').click()
  await page.waitForTimeout(700)
  const afterEdit = await libraryCount()
  if (afterEdit === afterSave) ok('编辑保存覆盖原题（数量不变）')
  else fail('编辑保存覆盖原题（数量不变）', `${afterSave} → ${afterEdit}`)
  await page.locator('#custom-close').click()
  await page.waitForTimeout(120)
} else {
  fail('自定义题编辑按钮存在')
}

// 两步确认删除
if ((await page.locator('.puzzle-act[data-del]').count()) > 0) {
  const del = page.locator('.puzzle-act[data-del]').first()
  await del.click()
  await page.waitForTimeout(120)
  const confirmText = ((await del.textContent()) ?? '').trim()
  const afterOneClick = await libraryCount()
  if (confirmText === '确认' && afterOneClick === afterSave) ok('删除需要二次确认（第一次只变确认）')
  else fail('删除二次确认', `text=${confirmText} count=${afterOneClick}`)
  await del.click()
  await page.waitForTimeout(200)
  const afterDelete = await libraryCount()
  if (afterDelete === afterSave - 1) ok('二次确认后删除自定义题')
  else fail('二次确认后删除自定义题', `count=${afterDelete}`)
} else {
  fail('自定义题删除按钮存在')
}

await shot('06-custom-after-delete.png')

/* ────────────────── 汇总 ────────────────── */

const passed = results.filter((r) => r.pass).length
const failed = results.length - passed
console.log(`\n通过 ${passed}/${results.length}，失败 ${failed}，pageErrors ${pageErrors}`)
await browser.close()

// 关掉浏览器后再清空 data/，避免 pagehide 落盘又写回进度
writeFileSync(path.join(DATA_DIR, 'library.json'), '[]')
writeFileSync(path.join(DATA_DIR, 'progress.json'), '{}')
writeFileSync(path.join(DATA_DIR, 'last-puzzle.json'), 'null')

if (failed > 0 || pageErrors > 0) process.exitCode = 1








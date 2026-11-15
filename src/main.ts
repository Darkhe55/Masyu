/**
 * 模板入口 —— 每个新游戏只需保持这个文件不变
 * （或者把 adapter 换成你自己的实现）。
 */

import './core/styles.css'
import { createApp } from './core/app'
import { adapter } from './game/adapter'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('no #app')

createApp(root, adapter)
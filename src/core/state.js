// 全局响应式状态：帧列表、帧率、选区、导入源、导出配置
import { reactive, watch } from 'vue'
import { nextId } from './util.js'

export const state = reactive({
  // 帧：{ id, name, canvas, w, h, edited }
  frames: [],
  fps: 12,
  loop: true,
  // 导入源信息（步骤1）
  source: {
    kind: null,        // 'video' | 'gif' | 'image' | 'zip' | 'demo' | 'project'
    fileName: '',
    videoUrl: '',
    duration: 0,
    width: 0,
    height: 0,
    objectUrls: [],
  },
  // 当前选中帧 id 集合
  selection: new Set(),
  // 编辑器当前帧
  editingIndex: -1,
  // 步骤面板折叠
  stepsUnlocked: true,

  // 提取设置
  extract: {
    mode: 'fps',        // fps | interval | count | all
    fps: 12,
    interval: 0.1,
    count: 30,
    startTime: 0,
    endTime: 0,         // 0 = 到结尾
    maxFrames: 1200,
  },

  busy: null,           // { text, progress(0-1), cancel? } 全局忙状态
})

// toast / confirm
export const ui = reactive({
  toasts: [],
  confirmState: null,   // { title, body, danger, resolve }
  shortcutsOpen: false,
})

export function toast(text, type = 'info', ms = 2600) {
  const id = nextId()
  ui.toasts.push({ id, text, type })
  setTimeout(() => {
    const i = ui.toasts.findIndex(t => t.id === id)
    if (i >= 0) ui.toasts.splice(i, 1)
  }, ms)
}

export function confirmDialog({ title = '确认', body = '', danger = false }) {
  return new Promise(resolve => {
    ui.confirmState = { title, body, danger, resolve }
  })
}

// ---- 帧管理 ----
export function addFrame(canvas, name = '') {
  const f = { id: nextId(), name: name || `帧 ${state.frames.length + 1}`, canvas, w: canvas.width, h: canvas.height, edited: false }
  state.frames.push(f)
  return f
}

export function insertFrameAt(index, canvas, name = '') {
  const f = { id: nextId(), name: name || `帧 ${index + 1}`, canvas, w: canvas.width, h: canvas.height, edited: false }
  state.frames.splice(index, 0, f)
  return f
}

export function removeFrames(ids) {
  const set = ids instanceof Set ? ids : new Set(ids)
  state.frames = state.frames.filter(f => !set.has(f.id))
  state.selection.clear()
}

export function clearFrames() {
  state.frames.forEach(f => { f.canvas = null })
  state.frames = []
  state.selection.clear()
}

export function maxFrameSize() {
  let w = 0, h = 0
  for (const f of state.frames) { w = Math.max(w, f.w); h = Math.max(h, f.h) }
  return { w, h }
}

export function resetSource() {
  state.source.objectUrls.forEach(u => URL.revokeObjectURL(u))
  state.source.objectUrls = []
  state.source.kind = null
  state.source.fileName = ''
  state.source.videoUrl = ''
  state.source.duration = 0
  state.source.width = 0
  state.source.height = 0
}

// 持久化轻量配置
const CFG_KEY = 'framesnip-cfg'
watch(() => state.fps, v => {
  try { localStorage.setItem(CFG_KEY, JSON.stringify({ fps: v })) } catch (e) { /* ignore */ }
})
try {
  const saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null')
  if (saved && saved.fps) state.fps = saved.fps
} catch (e) { /* ignore */ }

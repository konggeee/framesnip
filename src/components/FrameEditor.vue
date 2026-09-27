<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { state, ui, toast } from '../core/state.js'
import { rgbToHex, hexToRgb, clamp } from '../core/util.js'
import { inpaintAsync } from '../core/inpaintClient.js'
import { loadSegmentator, segmentPerson, applyPersonMask } from '../core/segment.js'

const emit = defineEmits(['close'])

const fi = computed(() => state.editingIndex)
const frame = computed(() => state.frames[fi.value])

const workCanvas = ref(null)   // 工作画布（编辑副本）
let workCtx = null

// 视图状态
const zoom = ref(4)
const panX = ref(0)
const panY = ref(0)
const wrapEl = ref(null)
const canvasEl = ref(null)

// 工具
const tool = ref('brush') // brush eraser fill picker wand watermark
const brushSize = ref(6)
const brushHardness = ref(80)
const brushAlpha = ref(100)
const brushColor = ref('#5b5bd6')
const colorHistory = ref([])
const fillTolerance = ref(24)
const wandTolerance = ref(24)
const wandContiguous = ref(true)
const wandMode = ref('transparent') // transparent | color

// 水印清除（涂抹层 + 修复参数）
const maskCanvas = ref(null)   // 涂抹层画布（与工作画布同尺寸，红色 = 待修复）
let maskCtx = null
const maskDirty = ref(false)
const inpaintRadius = ref(5)
const wmScope = ref('current')
const wmBusy = ref(false)

// 智能抠图
const cutout = ref({ invert: false, feather: 2, scope: 'current' })
const cutBusy = ref(false)
const modelState = ref('idle') // idle loading ready

// 智能操作面板
const panel = ref('none') // none chroma replace alpha inpaint cutout
const chroma = ref({ target: '#3ad054', tolerance: 60, despill: 60, scope: 'current' })
const replace = ref({ target: '#ffffff', tolerance: 30, to: '#ff0000', keepShade: true, scope: 'current' })
const alphaOp = ref({ low: 40, high: 180, scope: 'current' })

// 撤销
const undoStack = []
const redoStack = []
const historyInfo = ref('')

const frameCount = computed(() => state.frames.length)
const dims = computed(() => workCanvas.value ? `${workCanvas.value.width}×${workCanvas.value.height}` : '')

function cloneFrameCanvas(f) {
  const c = document.createElement('canvas')
  c.width = f.w; c.height = f.h
  c.getContext('2d').drawImage(f.canvas, 0, 0)
  return c
}

function loadFrame(i) {
  const f = state.frames[i]
  if (!f) return
  workCanvas.value = cloneFrameCanvas(f)
  workCtx = workCanvas.value.getContext('2d', { willReadFrequently: true })
  // 涂抹层随帧：尺寸一致时保留（固定水印可跨帧复用），不一致则重置
  if (!maskCanvas.value || maskCanvas.value.width !== f.w || maskCanvas.value.height !== f.h) {
    const mc = document.createElement('canvas')
    mc.width = f.w; mc.height = f.h
    maskCanvas.value = mc
    maskCtx = mc.getContext('2d', { willReadFrequently: true })
    maskDirty.value = false
  }
  undoStack.length = 0
  redoStack.length = 0
  historyInfo.value = ''
  nextTick(renderToScreen)
}

function renderToScreen() {
  const el = canvasEl.value
  if (!el || !workCanvas.value) return
  if (el.width !== workCanvas.value.width || el.height !== workCanvas.value.height) {
    el.width = workCanvas.value.width
    el.height = workCanvas.value.height
  }
  const ctx = el.getContext('2d')
  ctx.clearRect(0, 0, el.width, el.height)
  ctx.drawImage(workCanvas.value, 0, 0)
  if (maskCanvas.value && maskDirty.value && tool.value === 'watermark') {
    ctx.globalAlpha = 0.45
    ctx.drawImage(maskCanvas.value, 0, 0)
    ctx.globalAlpha = 1
  }
}

function pushUndo() {
  undoStack.push(workCtx.getImageData(0, 0, workCanvas.value.width, workCanvas.value.height))
  if (undoStack.length > 20) undoStack.shift()
  redoStack.length = 0
  historyInfo.value = `可撤销 ${undoStack.length} 步`
}
function undo() {
  if (!undoStack.length) return
  redoStack.push(workCtx.getImageData(0, 0, workCanvas.value.width, workCanvas.value.height))
  workCtx.putImageData(undoStack.pop(), 0, 0)
  renderToScreen()
  historyInfo.value = `可撤销 ${undoStack.length} 步`
}
function redo() {
  if (!redoStack.length) return
  undoStack.push(workCtx.getImageData(0, 0, workCanvas.value.width, workCanvas.value.height))
  workCtx.putImageData(redoStack.pop(), 0, 0)
  renderToScreen()
}

// ---- 视图：缩放平移 ----
function fitZoom() {
  const wrap = wrapEl.value
  if (!wrap || !workCanvas.value) return
  const z = Math.min((wrap.clientWidth - 40) / workCanvas.value.width, (wrap.clientHeight - 40) / workCanvas.value.height)
  zoom.value = clamp(z, 0.05, 64)
  centerPan()
}
function centerPan() {
  const wrap = wrapEl.value
  if (!wrap) return
  panX.value = (wrap.clientWidth - workCanvas.value.width * zoom.value) / 2
  panY.value = (wrap.clientHeight - workCanvas.value.height * zoom.value) / 2
}
function setZoom(z, cx, cy) {
  const wrap = wrapEl.value
  const old = zoom.value
  zoom.value = clamp(z, 0.05, 64)
  if (cx != null) {
    panX.value = cx - (cx - panX.value) * (zoom.value / old)
    panY.value = cy - (cy - panY.value) * (zoom.value / old)
  }
}
function onWheel(e) {
  e.preventDefault()
  const rect = wrapEl.value.getBoundingClientRect()
  setZoom(zoom.value * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - rect.left, e.clientY - rect.top)
}
const pixelated = computed(() => zoom.value >= 3)

// ---- 坐标换算 ----
function toPixel(e) {
  const el = canvasEl.value
  const rect = el.getBoundingClientRect()
  return {
    x: Math.floor((e.clientX - rect.left) * (el.width / rect.width)),
    y: Math.floor((e.clientY - rect.top) * (el.height / rect.height)),
  }
}

// ---- 绘制交互 ----
let drawing = false
let lastPos = null
let panning = false
let panStart = null
let pickCb = null  // 面板取色回调

function onPointerDown(e) {
  const el = canvasEl.value
  if (!el) return
  el.setPointerCapture(e.pointerId)
  if (e.button === 1 || spaceDown.value) {
    panning = true
    panStart = { x: e.clientX - panX.value, y: e.clientY - panY.value }
    return
  }
  const p = toPixel(e)
  if (pickCb) {
    const d = workCtx.getImageData(clamp(p.x, 0, el.width - 1), clamp(p.y, 0, el.height - 1), 1, 1).data
    const hex = rgbToHex(d[0], d[1], d[2])
    pickCb(hex)
    pickCb = null
    return
  }
  if (tool.value === 'picker') {
    const d = workCtx.getImageData(clamp(p.x, 0, el.width - 1), clamp(p.y, 0, el.height - 1), 1, 1).data
    setColor(rgbToHex(d[0], d[1], d[2]))
  } else if (tool.value === 'fill') {
    pushUndo()
    floodFill(p.x, p.y, fillTolerance.value)
    renderToScreen()
  } else if (tool.value === 'wand') {
    pushUndo()
    applyWand(p.x, p.y)
    renderToScreen()
  } else {
    drawing = true
    lastPos = p
    if (tool.value !== 'watermark') pushUndo()
    stamp(p.x, p.y)
    renderToScreen()
  }
}
function onPointerMove(e) {
  if (panning) {
    panX.value = e.clientX - panStart.x
    panY.value = e.clientY - panStart.y
    return
  }
  if (!drawing) return
  const p = toPixel(e)
  // 插值
  const steps = Math.max(1, Math.ceil(Math.hypot(p.x - lastPos.x, p.y - lastPos.y) / Math.max(1, brushSize.value * 0.25)))
  for (let i = 1; i <= steps; i++) {
    stamp(lastPos.x + (p.x - lastPos.x) * i / steps, lastPos.y + (p.y - lastPos.y) * i / steps)
  }
  lastPos = p
  renderToScreen()
}
function onPointerUp() {
  drawing = false
  panning = false
}

function stamp(x, y) {
  if (tool.value === 'watermark') { stampMask(x, y); return }
  const r = Math.max(0.5, brushSize.value / 2)
  workCtx.save()
  if (tool.value === 'eraser') {
    workCtx.globalCompositeOperation = 'destination-out'
    workCtx.globalAlpha = 1
    workCtx.fillStyle = '#fff'
  } else {
    const { r: cr, g: cg, b: cb } = hexToRgb(brushColor.value)
    workCtx.globalCompositeOperation = 'source-over'
    workCtx.globalAlpha = brushAlpha.value / 100
    const hardness = clamp(brushHardness.value / 100, 0.01, 1)
    const g = workCtx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${cr},${cg},${cb},1)`)
    g.addColorStop(hardness, `rgba(${cr},${cg},${cb},1)`)
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
    workCtx.fillStyle = g
  }
  workCtx.beginPath()
  workCtx.arc(x, y, r, 0, Math.PI * 2)
  workCtx.fill()
  workCtx.restore()
}

// ---- 油漆桶 / 魔棒（扫描线泛洪） ----
function colorDist(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3])
}
function getPixels() { return workCtx.getImageData(0, 0, workCanvas.value.width, workCanvas.value.height) }

function floodMask(img, x0, y0, tolerance) {
  const { width: w, height: h, data: d } = img
  const seed = [(d[(y0 * w + x0) * 4]), d[(y0 * w + x0) * 4 + 1], d[(y0 * w + x0) * 4 + 2], d[(y0 * w + x0) * 4 + 3]]
  const tol = tolerance * 4 + 4
  const mask = new Uint8Array(w * h)
  const stack = [y0 * w + x0]
  while (stack.length) {
    const idx = stack.pop()
    if (mask[idx]) continue
    const o = idx * 4
    if (colorDist([d[o], d[o + 1], d[o + 2], d[o + 3]], seed) > tol) continue
    mask[idx] = 1
    const x = idx % w, y = (idx / w) | 0
    if (x > 0) stack.push(idx - 1)
    if (x < w - 1) stack.push(idx + 1)
    if (y > 0) stack.push(idx - w)
    if (y < h - 1) stack.push(idx + w)
  }
  return mask
}

function floodFill(x0, y0, tolerance) {
  const img = getPixels()
  let mask
  try { mask = floodMask(img, clamp(x0, 0, img.width - 1), clamp(y0, 0, img.height - 1), tolerance) } catch (e) { return }
  const { r, g, b } = hexToRgb(brushColor.value)
  const a = Math.round(brushAlpha.value / 100 * 255)
  const d = img.data
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const o = i * 4
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a
  }
  workCtx.putImageData(img, 0, 0)
}

function applyWand(x0, y0) {
  const img = getPixels()
  const { width: w, height: h, data: d } = img
  let mask
  if (wandContiguous.value) {
    mask = floodMask(img, clamp(x0, 0, w - 1), clamp(y0, 0, h - 1), wandTolerance.value)
  } else {
    const o0 = (clamp(y0, 0, h - 1) * w + clamp(x0, 0, w - 1)) * 4
    const seed = [d[o0], d[o0 + 1], d[o0 + 2], d[o0 + 3]]
    const tol = wandTolerance.value * 4 + 4
    mask = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      if (colorDist([d[o], d[o + 1], d[o + 2], d[o + 3]], seed) <= tol) mask[i] = 1
    }
  }
  if (wandMode.value === 'transparent') {
    for (let i = 0; i < mask.length; i++) if (mask[i]) d[i * 4 + 3] = 0
  } else {
    const { r, g, b } = hexToRgb(brushColor.value)
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue
      const o = i * 4
      d[o] = r; d[o + 1] = g; d[o + 2] = b
    }
  }
  workCtx.putImageData(img, 0, 0)
}

// ---- 智能面板操作（可应用到全部帧） ----
function hexAt(x, y, srcCtx) {
  const d = srcCtx.getImageData(x, y, 1, 1).data
  return rgbToHex(d[0], d[1], d[2])
}

function beginPick(cb) {
  pickCb = cb
  toast('请在画布上点击取样颜色', 'info', 1600)
}

function applyChroma(targetFrames) {
  const { r: tr, g: tg, b: tb } = hexToRgb(chroma.value.target)
  const tol = chroma.value.tolerance
  const despill = chroma.value.despill / 100
  for (const f of targetFrames) {
    const ctx = f.getContext('2d', { willReadFrequently: true })
    const img = ctx.getImageData(0, 0, f.width, f.height)
    const d = img.data
    for (let o = 0; o < d.length; o += 4) {
      const dist = Math.abs(d[o] - tr) + Math.abs(d[o + 1] - tg) + Math.abs(d[o + 2] - tb)
      if (dist <= tol) {
        d[o + 3] = 0
      } else if (despill > 0 && d[o + 1] > d[o] && d[o + 1] > d[o + 2]) {
        // 去绿边：压低绿色优势
        const max = Math.max(d[o], d[o + 2])
        d[o + 1] = Math.round(d[o + 1] * (1 - despill) + max * despill)
      }
    }
    ctx.putImageData(img, 0, 0)
  }
}

function applyReplace(targetFrames) {
  const { r: tr, g: tg, b: tb } = hexToRgb(replace.value.target)
  const { r: nr, g: ng, b: nb } = hexToRgb(replace.value.to)
  const tol = replace.value.tolerance * 3 + 3
  for (const f of targetFrames) {
    const ctx = f.getContext('2d', { willReadFrequently: true })
    const img = ctx.getImageData(0, 0, f.width, f.height)
    const d = img.data
    for (let o = 0; o < d.length; o += 4) {
      const dist = Math.abs(d[o] - tr) + Math.abs(d[o + 1] - tg) + Math.abs(d[o + 2] - tb)
      if (dist <= tol) {
        if (replace.value.keepShade) {
          const lumT = (tr * 0.299 + tg * 0.587 + tb * 0.114) || 1
          const lum = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114)
          const k = clamp(lum / lumT, 0, 2)
          d[o] = clamp(nr * k, 0, 255); d[o + 1] = clamp(ng * k, 0, 255); d[o + 2] = clamp(nb * k, 0, 255)
        } else {
          d[o] = nr; d[o + 1] = ng; d[o + 2] = nb
        }
      }
    }
    ctx.putImageData(img, 0, 0)
  }
}

function applyAlphaOp(targetFrames) {
  const low = alphaOp.value.low, high = alphaOp.value.high
  for (const f of targetFrames) {
    const ctx = f.getContext('2d', { willReadFrequently: true })
    const img = ctx.getImageData(0, 0, f.width, f.height)
    const d = img.data
    for (let o = 3; o < d.length; o += 4) {
      const a = d[o]
      if (a < low) d[o] = 0
      else if (a > high) d[o] = 255
      else d[o] = Math.round((a - low) / Math.max(1, high - low) * 255)
    }
    ctx.putImageData(img, 0, 0)
  }
}

function scopeFrames(scope) {
  if (scope === 'all') {
    // 当前帧作用于工作画布（保存时统一写回），其余帧直接作用于存储画布，
    // 避免保存时 workCanvas 副本覆盖掉已应用的效果
    const out = []
    for (let i = 0; i < state.frames.length; i++) {
      out.push(i === fi.value ? workCanvas.value : state.frames[i].canvas)
    }
    return out
  }
  return [workCanvas.value]
}

function runChroma() {
  if (chroma.value.scope === 'all') pushUndo()
  applyChroma(scopeFrames(chroma.value.scope))
  if (chroma.value.scope !== 'all') renderToScreen()
  toast(chroma.value.scope === 'all' ? '已应用到全部帧' : '已应用到当前帧', 'ok')
  if (chroma.value.scope === 'all') {
    state.frames.forEach(f => { f.edited = true; f.rev = (f.rev || 0) + 1 })
    renderToScreen()
  } else markEdited()
}

function runReplace() {
  if (replace.value.scope === 'all') pushUndo()
  applyReplace(scopeFrames(replace.value.scope))
  if (replace.value.scope === 'all') {
    state.frames.forEach(f => { f.edited = true; f.rev = (f.rev || 0) + 1 })
    renderToScreen()
  } else renderToScreen()
  toast(replace.value.scope === 'all' ? '已应用到全部帧' : '已应用到当前帧', 'ok')
  if (replace.value.scope !== 'all') markEdited()
}

function runAlphaOp() {
  if (alphaOp.value.scope === 'all') pushUndo()
  applyAlphaOp(scopeFrames(alphaOp.value.scope))
  if (alphaOp.value.scope === 'all') {
    state.frames.forEach(f => { f.edited = true; f.rev = (f.rev || 0) + 1 })
    renderToScreen()
  } else renderToScreen()
  toast(alphaOp.value.scope === 'all' ? '已应用到全部帧' : '已应用到当前帧', 'ok')
  if (alphaOp.value.scope !== 'all') markEdited()
}

function markEdited() {
  const f = frame.value
  if (f) { f.edited = true; f.rev = (f.rev || 0) + 1 }
}

// ---- 去水印（涂抹 → Telea 修复） ----
function selectWatermark() {
  tool.value = 'watermark'
  panel.value = 'inpaint'
  if (brushSize.value < 16) brushSize.value = 40
  if (maskDirty.value) toast('继续涂抹或直接点击「开始清除」', 'info', 1600)
}

function stampMask(x, y) {
  if (!maskCtx) return
  maskCtx.save()
  maskCtx.fillStyle = '#ff2d2d'
  maskCtx.beginPath()
  maskCtx.arc(x, y, Math.max(1, brushSize.value / 2), 0, Math.PI * 2)
  maskCtx.fill()
  maskCtx.restore()
  maskDirty.value = true
}

function clearMask() {
  if (!maskCtx) return
  maskCtx.clearRect(0, 0, maskCanvas.value.width, maskCanvas.value.height)
  maskDirty.value = false
  renderToScreen()
}

// 把涂抹层按目标画布尺寸提取为修复 mask（0/1）
function extractMaskFor(target) {
  const w = target.width, h = target.height
  const mc = document.createElement('canvas')
  mc.width = w; mc.height = h
  const ctx = mc.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(maskCanvas.value, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(w * h)
  let count = 0
  for (let i = 0; i < mask.length; i++) {
    if (d[i * 4] > 127) { mask[i] = 1; count++ }
  }
  return { mask, count }
}

async function runInpaint() {
  if (wmBusy.value) return
  if (!maskDirty.value) return toast('先用「去水印笔」在水印处涂抹', 'warn')
  const targets = scopeFrames(wmScope.value)
  const all = wmScope.value === 'all'
  pushUndo() // 当前帧可撤销
  wmBusy.value = true
  state.busy = { text: all ? `清除水印 0/${targets.length}` : '清除水印中…', progress: 0 }
  let failCount = 0
  try {
    for (let k = 0; k < targets.length; k++) {
      const f = targets[k]
      if (f.width !== maskCanvas.value.width || f.height !== maskCanvas.value.height) continue
      const { mask, count } = extractMaskFor(f)
      if (!count || count >= f.width * f.height) { failCount++; continue }
      const ctx = f.getContext('2d', { willReadFrequently: true })
      const img = ctx.getImageData(0, 0, f.width, f.height)
      const fixed = await inpaintAsync(img, mask, inpaintRadius.value)
      ctx.putImageData(fixed, 0, 0)
      if (all) state.busy.progress = (k + 1) / targets.length
      else state.busy.progress = 1
    }
    if (all) {
      state.frames.forEach(f => { f.edited = true; f.rev = (f.rev || 0) + 1 })
      clearMask() // 全部帧已按同一位置处理完
    } else {
      markEdited()
    }
    renderToScreen()
    toast(failCount ? `已清除，其中 ${failCount} 帧尺寸不符已跳过` : (all ? '已清除全部帧水印' : '水印已清除，可切到下一帧继续'), 'ok')
  } catch (e) {
    toast('清除水印失败：' + e.message, 'error')
  } finally {
    wmBusy.value = false
    state.busy = null
  }
}

// ---- 智能抠图（人物分割 → 背景透明） ----
async function runCutout() {
  if (cutBusy.value) return
  cutBusy.value = true
  if (modelState.value !== 'ready') {
    modelState.value = 'loading'
    toast('首次使用需加载本地人物分割模型（约 12MB）…', 'info', 3200)
  }
  try {
    await loadSegmentator()
    modelState.value = 'ready'
  } catch (e) {
    modelState.value = 'idle'
    cutBusy.value = false
    toast('模型加载失败：' + e.message, 'error', 4000)
    return
  }
  const targets = scopeFrames(cutout.value.scope)
  const all = cutout.value.scope === 'all'
  pushUndo()
  state.busy = { text: `智能抠图 0/${targets.length}`, progress: 0 }
  let skipped = 0
  try {
    for (let k = 0; k < targets.length; k++) {
      const f = targets[k]
      const mask = await segmentPerson(f)
      const r = applyPersonMask(f, mask, { invert: cutout.value.invert, feather: cutout.value.feather })
      if (!r.applied) skipped++
      state.busy.text = `智能抠图 ${k + 1}/${targets.length}`
      state.busy.progress = (k + 1) / targets.length
    }
    const done = targets.length - skipped
    if (!done) {
      toast('未检测到人物，画面保持不变（该功能适用于包含人物的视频/图片）', 'warn', 4200)
    } else {
      if (all) {
        state.frames.forEach(f => { f.edited = true; f.rev = (f.rev || 0) + 1 })
      } else {
        markEdited()
      }
      renderToScreen()
      const tip = skipped ? `，${skipped} 帧未检测到人物已跳过` : ''
      toast(all ? `已对 ${done} 帧抠出人物${tip}` : '已抠出人物（背景透明）', 'ok')
    }
  } catch (e) {
    toast('智能抠图失败：' + e.message, 'error', 4000)
  } finally {
    cutBusy.value = false
    state.busy = null
  }
}

// ---- 颜色历史 ----
function setColor(hex) {
  brushColor.value = hex
  if (!colorHistory.value.includes(hex)) {
    colorHistory.value.unshift(hex)
    if (colorHistory.value.length > 10) colorHistory.value.pop()
  }
}

// ---- 保存 / 导航 ----
function save() {
  const f = frame.value
  if (!f) return
  const src = workCanvas.value
  const c = document.createElement('canvas')
  c.width = src.width; c.height = src.height
  c.getContext('2d').drawImage(src, 0, 0)
  f.canvas = c
  f.w = c.width; f.h = c.height
  f.edited = true
  f.rev = (f.rev || 0) + 1
  toast('已保存到帧', 'ok', 1400)
}

function nav(d) {
  const next = fi.value + d
  if (next < 0 || next >= frameCount.value) return
  state.editingIndex = next
}

watch(fi, () => { if (fi.value >= 0) loadFrame(fi.value) })
watch(tool, () => renderToScreen())

// ---- 键盘 ----
const spaceDown = ref(false)
function onKey(e) {
  if (e.target.tagName === 'INPUT') return
  if (e.code === 'Space') { spaceDown.value = true; e.preventDefault() }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    if (e.key === 'y') { e.preventDefault(); redo() }
    if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(zoom.value * 1.2) }
    if (e.key === '-') { e.preventDefault(); setZoom(zoom.value / 1.2) }
    return
  }
  if (e.key === 'b') tool.value = 'brush'
  if (e.key === 'e') tool.value = 'eraser'
  if (e.key === 'g') tool.value = 'fill'
  if (e.key === 'i') tool.value = 'picker'
  if (e.key === 'm') tool.value = 'wand'
  if (e.key === 'w') selectWatermark()
  if (e.key === '[') brushSize.value = Math.max(1, brushSize.value - 2)
  if (e.key === ']') brushSize.value = Math.min(200, brushSize.value + 2)
  if (e.key === '0') fitZoom()
  if (e.key === '1') { zoom.value = 1; centerPan() }
  if (e.key === 'ArrowLeft') nav(-1)
  if (e.key === 'ArrowRight') nav(1)
}
function onKeyUp(e) { if (e.code === 'Space') spaceDown.value = false }

onMounted(() => {
  loadFrame(fi.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  nextTick(fitZoom)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<template>
  <div class="editor-overlay">
    <!-- 顶部工具栏 -->
    <div class="ed-toolbar">
      <div class="ed-tools">
        <button class="small" :class="{ primary: tool === 'brush' }" title="画笔 (B)" @click="tool = 'brush'">画笔</button>
        <button class="small" :class="{ primary: tool === 'eraser' }" title="橡皮 (E)" @click="tool = 'eraser'">橡皮</button>
        <button class="small" :class="{ primary: tool === 'fill' }" title="油漆桶 (G)" @click="tool = 'fill'">填充</button>
        <button class="small" :class="{ primary: tool === 'picker' }" title="吸管 (I)" @click="tool = 'picker'">吸管</button>
        <button class="small" :class="{ primary: tool === 'wand' }" title="魔棒 (M)" @click="tool = 'wand'">魔棒</button>
        <button class="small" :class="{ primary: tool === 'watermark' }" title="去水印笔：涂抹后智能修复 (W)" @click="selectWatermark">去水印笔</button>
        <span class="ed-sep"></span>
        <input v-model="brushColor" type="color" style="width:32px;height:26px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff" @change="setColor(brushColor)">
        <div v-if="colorHistory.length" class="ed-history">
          <span v-for="c in colorHistory" :key="c" class="swatch" :style="{ background: c }" :title="c" @click="brushColor = c"></span>
        </div>
        <span class="ed-sep"></span>
        <span class="muted small-label">大小</span>
        <input v-model.number="brushSize" type="range" min="1" max="120" style="width:90px">
        <span class="muted small-label">{{ brushSize }}</span>
        <template v-if="tool === 'brush'">
          <span class="muted small-label">硬度</span>
          <input v-model.number="brushHardness" type="range" min="1" max="100" style="width:70px">
          <span class="muted small-label">不透明度</span>
          <input v-model.number="brushAlpha" type="range" min="1" max="100" style="width:70px">
        </template>
        <template v-if="tool === 'fill'">
          <span class="muted small-label">容差</span>
          <input v-model.number="fillTolerance" type="range" min="0" max="120" style="width:90px">
          <span class="muted small-label">{{ fillTolerance }}</span>
        </template>
        <template v-if="tool === 'wand'">
          <span class="muted small-label">容差</span>
          <input v-model.number="wandTolerance" type="range" min="0" max="120" style="width:80px">
          <span class="muted small-label">{{ wandTolerance }}</span>
          <label class="muted small-label" style="display:flex;align-items:center;gap:3px">
            <input v-model="wandContiguous" type="checkbox"> 连续
          </label>
          <div class="seg">
            <button :class="{ on: wandMode === 'transparent' }" @click="wandMode = 'transparent'">变透明</button>
            <button :class="{ on: wandMode === 'color' }" @click="wandMode = 'color'">换色</button>
          </div>
        </template>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="small" @click="ui.shortcutsOpen = true">⌨ 快捷键</button>
        <button class="small danger" @click="emit('close')">取消</button>
        <button class="small primary" @click="save(); emit('close')">保存并关闭</button>
      </div>
    </div>

    <!-- 主体 -->
    <div class="ed-main">
      <div class="ed-canvas-wrap" ref="wrapEl" @wheel="onWheel">
        <div
          class="ed-canvas-holder"
          :style="{ transform: `translate(${panX}px, ${panY}px)` }"
        >
          <canvas
            ref="canvasEl"
            class="ed-canvas"
            :class="{ pixelated }"
            :style="{ width: (workCanvas ? workCanvas.width * zoom : 0) + 'px', height: (workCanvas ? workCanvas.height * zoom : 0) + 'px' }"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          ></canvas>
        </div>
        <div class="ed-hint">滚轮缩放 · 空格+拖动平移 · 当前 {{ zoom.toFixed(1) }}x</div>
      </div>

      <!-- 右侧面板 -->
      <div class="ed-panel">
        <div class="seg" style="margin-bottom:10px">
          <button :class="{ on: panel === 'none' }" @click="panel = 'none'">基础</button>
          <button :class="{ on: panel === 'chroma' }" @click="panel = 'chroma'">色键抠图</button>
          <button :class="{ on: panel === 'replace' }" @click="panel = 'replace'">换色</button>
          <button :class="{ on: panel === 'alpha' }" @click="panel = 'alpha'">Alpha 阈值</button>
          <button :class="{ on: panel === 'inpaint' }" @click="panel = 'inpaint'">去水印</button>
          <button :class="{ on: panel === 'cutout' }" @click="panel = 'cutout'">智能抠图</button>
        </div>

        <template v-if="panel === 'chroma'">
          <div class="form-row">
            <label>目标色</label>
            <input v-model="chroma.target" type="color" style="width:38px;height:28px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff">
            <button class="small" @click="beginPick(hex => { chroma.target = hex })">从画布取样</button>
          </div>
          <div class="form-row">
            <label>容差</label>
            <input v-model.number="chroma.tolerance" type="range" min="0" max="400" style="flex:1">
            <span class="slider-val">{{ chroma.tolerance }}</span>
          </div>
          <div class="form-row">
            <label>去边缘（despill）</label>
            <input v-model.number="chroma.despill" type="range" min="0" max="100" style="flex:1">
            <span class="slider-val">{{ chroma.despill }}%</span>
          </div>
          <div class="form-row">
            <label>应用范围</label>
            <div class="seg">
              <button :class="{ on: chroma.scope === 'current' }" @click="chroma.scope = 'current'">当前帧</button>
              <button :class="{ on: chroma.scope === 'all' }" @click="chroma.scope = 'all'">全部帧</button>
            </div>
          </div>
          <button class="primary" @click="runChroma">应用色键</button>
          <div class="hint" style="margin-top:6px">适合抠除绿幕/纯色背景；despill 用于压制残留的绿色边缘</div>
        </template>

        <template v-if="panel === 'replace'">
          <div class="form-row">
            <label>目标色</label>
            <input v-model="replace.target" type="color" style="width:38px;height:28px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff">
            <button class="small" @click="beginPick(hex => { replace.target = hex })">取样</button>
          </div>
          <div class="form-row">
            <label>替换为</label>
            <input v-model="replace.to" type="color" style="width:38px;height:28px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff">
          </div>
          <div class="form-row">
            <label>容差</label>
            <input v-model.number="replace.tolerance" type="range" min="0" max="120" style="flex:1">
            <span class="slider-val">{{ replace.tolerance }}</span>
          </div>
          <div class="form-row">
            <label>保留明暗</label>
            <label class="muted" style="display:flex;gap:4px;align-items:center">
              <input v-model="replace.keepShade" type="checkbox"> 按原亮度缩放新颜色
            </label>
          </div>
          <div class="form-row">
            <label>应用范围</label>
            <div class="seg">
              <button :class="{ on: replace.scope === 'current' }" @click="replace.scope = 'current'">当前帧</button>
              <button :class="{ on: replace.scope === 'all' }" @click="replace.scope = 'all'">全部帧</button>
            </div>
          </div>
          <button class="primary" @click="runReplace">应用换色</button>
        </template>

        <template v-if="panel === 'alpha'">
          <div class="form-row">
            <label>下阈值</label>
            <input v-model.number="alphaOp.low" type="range" min="0" max="254" style="flex:1">
            <span class="slider-val">{{ alphaOp.low }}</span>
          </div>
          <div class="form-row">
            <label>上阈值</label>
            <input v-model.number="alphaOp.high" type="range" min="1" max="255" style="flex:1">
            <span class="slider-val">{{ alphaOp.high }}</span>
          </div>
          <div class="hint">低于下阈值的像素变全透明，高于上阈值变全不透明，中间线性过渡。适合把半透明边缘二值化。</div>
          <div class="form-row">
            <label>应用范围</label>
            <div class="seg">
              <button :class="{ on: alphaOp.scope === 'current' }" @click="alphaOp.scope = 'current'">当前帧</button>
              <button :class="{ on: alphaOp.scope === 'all' }" @click="alphaOp.scope = 'all'">全部帧</button>
            </div>
          </div>
          <button class="primary" @click="runAlphaOp">应用阈值</button>
        </template>

        <template v-if="panel === 'inpaint'">
          <div class="hint" style="margin-bottom:6px">
            先用顶部 <b>去水印笔</b>（快捷键 W）涂抹水印区域（红色叠加显示），再点击下方按钮，由修复算法根据周围画面智能填补。
          </div>
          <div class="form-row">
            <label>去水印笔</label>
            <button class="small" :class="{ primary: tool === 'watermark' }" @click="selectWatermark">{{ tool === 'watermark' ? '涂抹中…' : '选中涂抹' }}</button>
            <button class="small" :disabled="!maskDirty" @click="clearMask">清空涂抹</button>
          </div>
          <div class="form-row">
            <label>修复半径</label>
            <input v-model.number="inpaintRadius" type="range" min="2" max="12" style="flex:1">
            <span class="slider-val">{{ inpaintRadius }}px</span>
          </div>
          <div class="form-row">
            <label>应用范围</label>
            <div class="seg">
              <button :class="{ on: wmScope === 'current' }" @click="wmScope = 'current'">当前帧</button>
              <button :class="{ on: wmScope === 'all' }" @click="wmScope = 'all'">全部帧</button>
            </div>
          </div>
          <button class="primary" :disabled="wmBusy || !maskDirty" @click="runInpaint">{{ wmBusy ? '清除中…' : '✨ 开始清除水印' }}</button>
          <div class="hint" style="margin-top:6px">
            「全部帧」会把同一涂抹位置应用到所有帧，适合固定位置的水印/台标；修复在后台线程进行，不卡界面。
          </div>
        </template>

        <template v-if="panel === 'cutout'">
          <div class="hint" style="margin-bottom:6px">
            AI 识别人物轮廓，一键把人物单独抠出（背景变透明），导出 GIF / PNG 时即为透明底。画面中需包含人物。
          </div>
          <div class="form-row">
            <label>保留内容</label>
            <div class="seg">
              <button :class="{ on: !cutout.invert }" @click="cutout.invert = false">人物</button>
              <button :class="{ on: cutout.invert }" @click="cutout.invert = true">背景</button>
            </div>
          </div>
          <div class="form-row">
            <label>边缘羽化</label>
            <input v-model.number="cutout.feather" type="range" min="0" max="6" style="flex:1">
            <span class="slider-val">{{ cutout.feather }}px</span>
          </div>
          <div class="form-row">
            <label>应用范围</label>
            <div class="seg">
              <button :class="{ on: cutout.scope === 'current' }" @click="cutout.scope = 'current'">当前帧</button>
              <button :class="{ on: cutout.scope === 'all' }" @click="cutout.scope = 'all'">全部帧</button>
            </div>
          </div>
          <button class="primary" :disabled="cutBusy" @click="runCutout">
            {{ cutBusy ? (modelState === 'loading' ? '模型加载中…' : '抠图中…') : '🧍 开始抠图' }}
          </button>
          <div class="hint" style="margin-top:6px">
            模型内置于本工具、全程离线运行；首次使用需加载约 12MB，之后由浏览器缓存。人物与背景颜色接近时边缘可能残留，可调大羽化缓解。
          </div>
        </template>

        <template v-if="panel === 'none'">
          <div class="hint">
            基础工具：画笔 / 橡皮 / 油漆桶 / 吸管 / 魔棒 / 去水印笔。<br>
            色键抠图、换色、Alpha 阈值、去水印、智能抠图（人物）在上方标签中，均支持一键应用到全部帧。
          </div>
        </template>
      </div>
    </div>

    <!-- 底部栏 -->
    <div class="ed-bottom">
      <div style="display:flex;gap:8px;align-items:center">
        <button class="small" :disabled="!undoStack.length" @click="undo">↩ 撤销</button>
        <button class="small" :disabled="!redoStack.length" @click="redo">↪ 重做</button>
        <span class="hint">{{ historyInfo }}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="small" :disabled="fi <= 0" @click="nav(-1)">◀ 上一帧</button>
        <span class="muted">第 {{ fi + 1 }} / {{ frameCount }} 帧 · {{ dims }}</span>
        <button class="small" :disabled="fi >= frameCount - 1" @click="nav(1)">下一帧 ▶</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="small" @click="setZoom(zoom / 1.2)">－</button>
        <button class="small" @click="fitZoom">适应</button>
        <button class="small" @click="setZoom(zoom * 1.2)">＋</button>
        <button class="small" @click="save()">应用（不关闭）</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
  position: fixed; inset: 0; z-index: 120; background: #23262f;
  display: flex; flex-direction: column;
}
.ed-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 14px; background: #2b2f3d; flex-wrap: wrap;
}
.ed-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ed-tools :deep(button.small) { background: #383d4e; border-color: #4a5064; color: #e6e8f0; }
.ed-tools :deep(button.small.primary) { background: var(--accent); border-color: var(--accent); color: #fff; }
.ed-sep { width: 1px; height: 20px; background: #4a5064; margin: 0 2px; }
.ed-history { display: flex; gap: 4px; }
.swatch { width: 18px; height: 18px; border-radius: 4px; cursor: pointer; border: 1px solid rgba(255,255,255,.25); }
.small-label { font-size: 12px; color: #aab0c0; }
.ed-tools :deep(input[type=range]) { accent-color: var(--accent); }

.ed-main { flex: 1; display: flex; min-height: 0; }
.ed-canvas-wrap {
  flex: 1; position: relative; overflow: hidden; background: #1b1e28;
  background-image: radial-gradient(#2a2e3c 1px, transparent 1px);
  background-size: 22px 22px;
}
.ed-canvas-holder { position: absolute; left: 0; top: 0; }
.ed-canvas { display: block; touch-action: none; cursor: crosshair;
  background-image:
    linear-gradient(45deg, #c8ccda 25%, transparent 25%),
    linear-gradient(-45deg, #c8ccda 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #c8ccda 75%),
    linear-gradient(-45deg, transparent 75%, #c8ccda 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-color: #eceef4;
}
.ed-canvas.pixelated { image-rendering: pixelated; }
.ed-hint {
  position: absolute; left: 12px; bottom: 10px; color: #8f96ab; font-size: 12px;
  background: rgba(20,23,32,.7); padding: 3px 10px; border-radius: 6px; pointer-events: none;
}
.ed-panel {
  flex: 0 0 280px; background: #2b2f3d; color: #dfe2ec; padding: 14px;
  overflow: auto;
}
.ed-panel :deep(.form-row > label:first-child) { color: #aab0c0; width: 110px; }
.ed-panel :deep(button.small) { background: #383d4e; border-color: #4a5064; color: #e6e8f0; }
.ed-panel :deep(button.primary) { background: var(--accent); border-color: var(--accent); color: #fff; width: 100%; }
.ed-panel :deep(.hint) { color: #8f96ab; }
.ed-panel :deep(.seg) { background: #383d4e; }
.ed-panel :deep(.seg button) { color: #aab0c0; }
.ed-panel :deep(.seg button.on) { background: #23262f; color: #fff; }

.ed-bottom {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 14px; background: #2b2f3d; flex-wrap: wrap;
}
.ed-bottom :deep(button.small) { background: #383d4e; border-color: #4a5064; color: #e6e8f0; }
.ed-bottom :deep(button.small.primary) { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>

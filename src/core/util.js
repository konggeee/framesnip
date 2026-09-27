// 通用工具函数
let _id = 1
export const nextId = () => _id++

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

export function formatBytes(n) {
  if (n == null || isNaN(n)) return '-'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

export function formatTime(sec) {
  if (sec == null || isNaN(sec)) return '0:00.0'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return m + ':' + s.toFixed(1).padStart(4, '0')
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 8000)
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

// 从任意图像源（ImageBitmap/canvas/VideoFrame）拷贝到独立 canvas
export function snapshotCanvas(src, w, h) {
  const c = makeCanvas(w ?? src.width, h ?? src.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

export async function blobToImageBitmap(blob) {
  return createImageBitmap(blob)
}

// 简易事件总线（用于进度回调）
export function makeProgress(report) {
  let last = 0
  return (p, text) => {
    const now = performance.now()
    if (now - last > 60 || p >= 1) {
      last = now
      report && report(p, text)
    }
  }
}

// 十六进制颜色 <-> rgba
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const v = parseInt(m[1], 16)
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

// 生成带序号的文件名：prefix_0001.png
export function frameFileName(prefix, index, digits = 4, ext = 'png') {
  return `${prefix}_${String(index + 1).padStart(digits, '0')}.${ext}`
}

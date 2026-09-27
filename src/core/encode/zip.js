// PNG 序列 ZIP 导出：jszip（MIT）封装
import JSZip from 'jszip'
import { frameFileName } from '../util.js'

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png')
  })
}

export async function encodeZip(frames, { prefix = 'frame', digits = 4, scale = 1, onProgress } = {}) {
  const zip = new JSZip()
  const dir = zip.folder('frames') || zip
  for (let i = 0; i < frames.length; i++) {
    let c = frames[i]
    if (scale !== 1) c = scaleCanvas(c, c.width * scale, c.height * scale)
    const blob = await canvasToPngBlob(c)
    dir.file(frameFileName(prefix, i, digits), blob)
    onProgress && onProgress((i + 1) / frames.length, `打包 ${i + 1}/${frames.length}`)
  }
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    meta => onProgress && onProgress(1, `压缩 ${meta.percent.toFixed(0)}%`),
  )
  return blob
}

export function scaleCanvas(src, w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

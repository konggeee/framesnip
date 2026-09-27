// 精灵图（图集）合成
import { makeCanvas } from '../util.js'

export function buildSheet(frames, { cols = 0, padding = 0, margin = 0, bgColor = '' } = {}) {
  if (!frames.length) throw new Error('没有可导出的帧')
  const n = frames.length
  const autoCols = cols > 0 ? cols : Math.ceil(Math.sqrt(n))
  const colsN = Math.min(n, autoCols)
  const rowsN = Math.ceil(n / colsN)
  const fw = frames[0].width, fh = frames[0].height
  const W = margin * 2 + colsN * fw + (colsN - 1) * padding
  const H = margin * 2 + rowsN * fh + (rowsN - 1) * padding
  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d')
  if (bgColor) {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, W, H)
  }
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / colsN), c = i % colsN
    const x = margin + c * (fw + padding)
    const y = margin + r * (fh + padding)
    ctx.drawImage(frames[i], x, y)
  }
  return { canvas, cols: colsN, rows: rowsN, frameW: fw, frameH: fh }
}

// 图像操作：旋转 / 翻转 / 缩放 / 适配布局（拉伸、适应、填充）
import { makeCanvas } from './util.js'

export function rotate90(src, clockwise = true) {
  const c = makeCanvas(src.height, src.width)
  const ctx = c.getContext('2d')
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

export function flip(src, horizontal = true) {
  const c = makeCanvas(src.width, src.height)
  const ctx = c.getContext('2d')
  ctx.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height)
  ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1)
  ctx.drawImage(src, 0, 0)
  return c
}

// 适配：把任意尺寸帧绘制到统一画布
// mode: stretch（拉伸）/ contain（适应留边）/ cover（填充裁剪）
export function fitToCanvas(src, W, H, mode = 'contain', bgColor = '') {
  const c = makeCanvas(W, H)
  const ctx = c.getContext('2d')
  if (bgColor) {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, W, H)
  }
  if (mode === 'stretch') {
    ctx.drawImage(src, 0, 0, W, H)
    return c
  }
  const scale = mode === 'cover'
    ? Math.max(W / src.width, H / src.height)
    : Math.min(W / src.width, H / src.height)
  const dw = src.width * scale, dh = src.height * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh)
  return c
}

export function scaleAll(frames, factor) {
  return frames.map(f => {
    const c = makeCanvas(Math.max(1, Math.round(f.width * factor)), Math.max(1, Math.round(f.height * factor)))
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(f, 0, 0, c.width, c.height)
    return c
  })
}

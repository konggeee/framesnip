// GIF 导出：gifenc（MIT）封装，支持透明阈值 / 全局或逐帧调色板 / 循环
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export async function encodeGif(frames, { fps = 12, loop = true, maxColors = 256, alphaThreshold = 128, transparent = true, perFramePalette = false, onProgress } = {}) {
  if (!frames.length) throw new Error('没有可导出的帧')
  const W = frames[0].width, H = frames[0].height
  const delay = Math.max(2, Math.round(100 / fps))
  const gif = GIFEncoder()

  const rgbs = []
  for (const f of frames) rgbs.push(getRgba(f))

  let globalPalette = null
  if (!perFramePalette) globalPalette = buildGlobalPalette(rgbs, maxColors, transparent)

  for (let i = 0; i < rgbs.length; i++) {
    const rgba = rgbs[i]
    let palette = globalPalette
    if (perFramePalette) palette = buildPalette(rgba, maxColors, transparent)
    if (!palette) throw new Error('调色板生成失败')

    let index = applyPalette(rgba, palette)
    if (transparent) {
      index = index.slice()
      const d = rgba
      for (let p = 3; p < d.length; p += 4) {
        if (d[p] < alphaThreshold) index[p >> 2] = palette.length - 1 // 保留的透明槽位
      }
    }
    gif.writeFrame(index, W, H, {
      palette,
      delay,
      repeat: i === 0 ? (loop ? 0 : -1) : undefined,
      transparent,
      transparentIndex: transparent ? palette.length - 1 : 0,
      dispose: transparent ? 2 : 0,
      first: i === 0,
    })
    onProgress && onProgress((i + 1) / rgbs.length, `编码 ${i + 1}/${rgbs.length} 帧`)
  }

  gif.finish()
  const bytes = gif.bytes()
  return new Blob([bytes], { type: 'image/gif' })
}

function getRgba(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data
}

// 采样部分帧生成全局调色板
function buildGlobalPalette(rgbs, maxColors, transparent) {
  const step = Math.max(1, Math.ceil(rgbs.length / 8))
  const parts = []
  for (let i = 0; i < rgbs.length; i += step) parts.push(rgbs[i])
  const merged = mergeOpaque(parts, 200000, transparent)
  return buildPaletteFrom(merged, maxColors, transparent)
}

function buildPalette(rgba, maxColors, transparent) {
  const sample = mergeOpaque([rgba], 120000, transparent)
  return buildPaletteFrom(sample, maxColors, transparent)
}

// 取不透明像素做量化样本（拼接 + 抽稀）
function mergeOpaque(rgbs, cap, transparent) {
  const total = rgbs.reduce((n, d) => n + d.length / 4, 0)
  const stride = Math.max(1, Math.ceil(total / cap))
  const out = []
  for (const d of rgbs) {
    const n = d.length / 4
    for (let p = 0; p < n; p += stride) {
      if (transparent && d[p * 4 + 3] < 128) continue
      out.push(d[p * 4], d[p * 4 + 1], d[p * 4 + 2], 255)
    }
  }
  if (out.length < 16) out.push(0, 0, 0, 255, 255, 255, 255, 255)
  return new Uint8Array(out)
}

function buildPaletteFrom(sampleRgba, maxColors, transparent) {
  const reserve = transparent ? 1 : 0
  const n = Math.max(2, Math.min(256 - reserve, maxColors))
  const base = quantize(sampleRgba, n)
  if (!base || !base.length) return null
  const palette = base.map(c => Array.isArray(c) ? c : [c >> 16 & 255, c >> 8 & 255, c & 255])
  if (palette.length > 256 - reserve) palette.length = 256 - reserve
  if (transparent) palette.push([0, 0, 0]) // 透明槽位（GIF 只存索引，颜色无所谓）
  return palette
}

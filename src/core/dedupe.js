// 智能去重：降采样后比较相邻帧差异，差异低于阈值的帧移除
import { makeCanvas } from './util.js'

const GW = 32, GH = 32

function signature(canvas) {
  const c = makeCanvas(GW, GH)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(canvas, 0, 0, GW, GH)
  return ctx.getImageData(0, 0, GW, GH).data
}

function diff(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    // 考虑 alpha：双方有一方透明即计入大差异
    const aa = a[i + 3], ba = b[i + 3]
    if ((aa < 128) !== (ba < 128)) { sum += 3; continue }
    sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 765
  }
  return sum / (a.length / 4)
}

// 返回 { keepFlags: boolean[], removed, kept }，与"上一个保留帧"链式比较
export function analyzeDedupe(frames, threshold = 0.01, onProgress) {
  const sigs = frames.map((f, i) => {
    const s = signature(f)
    onProgress && onProgress(0.7 * (i + 1) / frames.length, `分析 ${i + 1}/${frames.length}`)
    return s
  })
  const keepFlags = new Array(frames.length).fill(true)
  let last = 0
  for (let i = 1; i < frames.length; i++) {
    if (diff(sigs[i], sigs[last]) < threshold) keepFlags[i] = false
    else last = i
  }
  const removed = keepFlags.filter(k => !k).length
  onProgress && onProgress(1, '完成')
  return { keepFlags, removed, kept: frames.length - removed }
}

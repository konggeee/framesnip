// 循环查找：在帧序列中寻找衔接最平滑的子区间（可用于裁剪出无缝循环动画）
import { makeCanvas } from './util.js'

const GW = 24, GH = 24

function graySig(canvas) {
  const c = makeCanvas(GW, GH)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(canvas, 0, 0, GW, GH)
  const d = ctx.getImageData(0, 0, GW, GH).data
  const g = new Float32Array(GW * GH)
  for (let i = 0; i < g.length; i++) {
    g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255
  }
  return g
}

function sigDiff(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

// 返回候选 [{ start, end, score }]，score 越小衔接越平滑
export function findLoops(frames, { minLen = 4, maxCandidates = 3, onProgress } = {}) {
  const n = frames.length
  if (n < minLen * 2) return []
  const sigs = frames.map(f => graySig(f))
  const maxP = Math.min(Math.floor(n / 2), 300)
  const minP = Math.min(minLen, maxP)

  // 每个周期 p：cost[i] = diff(i, i+p)；找 cost 连续低的最长窗口
  const candidates = []
  for (let p = minP; p <= maxP; p++) {
    const cost = new Float32Array(n - p)
    let sum = 0
    for (let i = 0; i < n - p; i++) {
      cost[i] = sigDiff(sigs[i], sigs[i + p])
      sum += cost[i]
    }
    const mean = sum / (n - p)
    const thr = mean * 0.85 // 比均值明显低的区段视为平滑
    let s = -1
    for (let i = 0; i <= n - p; i++) {
      const low = i < n - p && cost[i] <= thr
      if (low && s < 0) s = i
      if ((!low || i === n - p) && s >= 0) {
        const e = (low ? i : i - 1) + p // 窗口终点（含）
        const len = e - s + 1
        if (len >= minLen) {
          let cs = 0
          for (let k = s; k + p <= e; k++) cs += cost[k]
          const score = cs / Math.max(1, e - s - p + 1)
          candidates.push({ start: s, end: e, score, period: p })
        }
        s = -1
      }
    }
    onProgress && onProgress((p - minP + 1) / (maxP - minP + 1), `扫描周期 ${p}/${maxP}`)
  }
  if (!candidates.length) return []

  // 去重：按分数排序，跳过与已选候选高度重叠的区间
  candidates.sort((a, b) => a.score - b.score || (b.end - b.start) - (a.end - a.start))
  const picked = []
  for (const c of candidates) {
    if (picked.some(p => Math.max(p.start, c.start) < Math.min(p.end, c.end) + 2)) continue
    picked.push(c)
    if (picked.length >= maxCandidates) break
  }
  return picked
}

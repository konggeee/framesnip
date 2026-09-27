// Telea (2004) 快速行进法（Fast Marching Method）图像修复
// 与 OpenCV cv2.inpaint(INPAINT_TELEA) 同源算法的纯 JS 实现：
// 从待修复区域边界由外向内按距离场顺序推进，每个像素用
// 「传播方向 × 空间距离 × 图像平坦度」加权的已知邻域颜色合成填充。
//
// teleaInpaint(imageData, mask, radius) —— 就地修复 imageData 中 mask>0 的像素
//   mask: Uint8Array(w*h)，>0 表示该像素需要修复
//   radius: 合成邻域半径（像素），越大越平滑、越慢

export function teleaInpaint(imageData, mask, radius = 5) {
  const w = imageData.width, h = imageData.height
  const data = imageData.data
  const n = w * h
  const R = Math.max(1, Math.round(radius))

  const UNKNOWN = 0   // 待修复（mask 内部）
  const BAND = 1      // 演化前沿（窄带）
  const KNOWN = 2     // 已知 / 已修复

  const flags = new Uint8Array(n)
  const T = new Float32Array(n)   // 到达时间（距离场）
  const INF = 1e6

  // 预计算亮度梯度幅值（lev 权重：平坦区域优先）
  const levMag = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const l = x > 0 ? i - 1 : i, r = x < w - 1 ? i + 1 : i
      const u = y > 0 ? i - w : i, d = y < h - 1 ? i + w : i
      const lum = k => data[k * 4] * 0.299 + data[k * 4 + 1] * 0.587 + data[k * 4 + 2] * 0.114
      const gx = lum(r) - lum(l), gy = lum(d) - lum(u)
      levMag[i] = Math.sqrt(gx * gx + gy * gy)
    }
  }

  // 状态初始化
  for (let i = 0; i < n; i++) {
    if (mask[i]) { flags[i] = UNKNOWN; T[i] = INF }
    else { flags[i] = KNOWN; T[i] = 0 }
  }

  // ---- 二叉最小堆（按 T 排序，T 入堆后不变，无需 decrease-key） ----
  const heapIdx = new Int32Array(n + 1)
  let heapSize = 0
  function heapPush(idx) {
    let c = ++heapSize
    heapIdx[c] = idx
    while (c > 1) {
      const p = c >> 1
      if (T[heapIdx[p]] <= T[heapIdx[c]]) break
      const t = heapIdx[p]; heapIdx[p] = heapIdx[c]; heapIdx[c] = t
      c = p
    }
  }
  function heapPop() {
    const top = heapIdx[1]
    heapIdx[1] = heapIdx[heapSize--]
    let p = 1
    for (;;) {
      const l = p << 1, r = l + 1
      let m = p
      if (l <= heapSize && T[heapIdx[l]] < T[heapIdx[m]]) m = l
      if (r <= heapSize && T[heapIdx[r]] < T[heapIdx[m]]) m = r
      if (m === p) break
      const t = heapIdx[p]; heapIdx[p] = heapIdx[m]; heapIdx[m] = t
      p = m
    }
    return top
  }

  // 初始窄带：紧贴 mask 的外缘已知像素
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (flags[i] !== KNOWN) continue
      const touch =
        (x > 0 && flags[i - 1] === UNKNOWN) ||
        (x < w - 1 && flags[i + 1] === UNKNOWN) ||
        (y > 0 && flags[i - w] === UNKNOWN) ||
        (y < h - 1 && flags[i + w] === UNKNOWN)
      if (touch) { flags[i] = BAND; heapPush(i) }
    }
  }

  // eikonal 方程单轴解：a/b 为该轴两侧邻居，返回此轴方向的最小到达时间
  function solveAxis(a, b) {
    const fa = flags[a] !== UNKNOWN, fb = flags[b] !== UNKNOWN
    if (fa && fb) {
      const r1 = T[a], r2 = T[b]
      const s = (r1 + r2) / 2
      const disc = 1 - (r1 - r2) * (r1 - r2) / 4
      return disc > 0 ? s + Math.sqrt(disc) : 1 + Math.min(r1, r2)
    }
    if (fa) return T[a] + 1
    if (fb) return T[b] + 1
    return INF
  }

  function solveT(i, x, y) {
    let sol = INF
    if (x > 0 && x < w - 1) sol = Math.min(sol, solveAxis(i - 1, i + 1))
    if (y > 0 && y < h - 1) sol = Math.min(sol, solveAxis(i - w, i + w))
    if (sol === INF) {
      if (x > 0) sol = Math.min(sol, T[i - 1] !== INF && flags[i - 1] !== UNKNOWN ? T[i - 1] + 1 : INF)
      if (x < w - 1) sol = Math.min(sol, flags[i + 1] !== UNKNOWN ? T[i + 1] + 1 : INF)
      if (y > 0) sol = Math.min(sol, flags[i - w] !== UNKNOWN ? T[i - w] + 1 : INF)
      if (y < h - 1) sol = Math.min(sol, flags[i + w] !== UNKNOWN ? T[i + w] + 1 : INF)
    }
    return sol
  }

  // 距离场梯度（中心差分，未知侧退化为单侧），写入共享临时变量
  let gTx = 0, gTy = 0
  function gradT(i, x, y) {
    gTx = 0; gTy = 0
    const has = k => flags[k] !== UNKNOWN
    if (x > 0 && x < w - 1) {
      const l = has(i - 1), r = has(i + 1)
      if (l && r) gTx = (T[i + 1] - T[i - 1]) / 2
      else if (l) gTx = T[i] - T[i - 1]
      else if (r) gTx = T[i + 1] - T[i]
    } else if (x === 0 && w > 1 && has(i + 1)) gTx = T[i + 1] - T[i]
    else if (x === w - 1 && has(i - 1)) gTx = T[i] - T[i - 1]
    if (y > 0 && y < h - 1) {
      const u = has(i - w), d = has(i + w)
      if (u && d) gTy = (T[i + w] - T[i - w]) / 2
      else if (u) gTy = T[i] - T[i - w]
      else if (d) gTy = T[i + w] - T[i]
    } else if (y === 0 && h > 1 && has(i + w)) gTy = T[i + w] - T[i]
    else if (y === h - 1 && has(i - w)) gTy = T[i] - T[i - w]
  }

  function inpaintPixel(i, x, y) {
    gradT(i, x, y)
    const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R)
    const y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R)
    let sr = 0, sg = 0, sb = 0, sa = 0, sw = 0
    for (let yy = y0; yy <= y1; yy++) {
      const rowOff = yy * w
      for (let xx = x0; xx <= x1; xx++) {
        const j = rowOff + xx
        if (flags[j] === UNKNOWN) continue
        const rx = xx - x, ry = yy - y
        const len2 = rx * rx + ry * ry
        if (len2 === 0) continue
        const len = Math.sqrt(len2)
        // dir: 与修复波前传播方向的一致性
        const dir = Math.abs(rx * gTx + ry * gTy) / len
        // dst: 空间距离衰减
        const dst = 1 / (len2 * len)
        // lev: 图像平坦区域优先（等照度线延续）
        const lev = 1 / (1 + levMag[j])
        const wgt = dir * dst * lev
        if (wgt <= 0) continue
        const o = j * 4
        sr += wgt * data[o]
        sg += wgt * data[o + 1]
        sb += wgt * data[o + 2]
        sa += wgt * data[o + 3]
        sw += wgt
      }
    }
    if (sw > 0) {
      const o = i * 4
      data[o] = sr / sw
      data[o + 1] = sg / sw
      data[o + 2] = sb / sw
      data[o + 3] = sa / sw
    }
  }

  // ---- 主循环：波前从 mask 边界向内推进 ----
  while (heapSize > 0) {
    const i = heapPop()
    flags[i] = KNOWN
    const x = i % w, y = (i / w) | 0
    const extend = j => {
      if (flags[j] !== UNKNOWN) return
      const jx = j % w, jy = (j / w) | 0
      T[j] = solveT(j, jx, jy)
      flags[j] = BAND
      inpaintPixel(j, jx, jy)
      heapPush(j)
    }
    if (x > 0) extend(i - 1)
    if (x < w - 1) extend(i + 1)
    if (y > 0) extend(i - w)
    if (y < h - 1) extend(i + w)
  }
}

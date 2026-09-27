// 智能人物抠图：基于 MediaPipe Selfie Segmentation（模型与 wasm 均自托管于
// public/mediapipe/，运行时零外网依赖，首次使用后由浏览器缓存）。
// 分割出的人物 mask 会转成 Alpha 通道写回帧画布，实现「背景一键透明」。
import { makeCanvas } from './util.js'

const BASE = import.meta.env.BASE_URL + 'mediapipe/'
let ssInstance = null
let loadPromise = null

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('模型脚本加载失败：' + src))
    document.head.appendChild(s)
  })
}

// 加载分割器（幂等）。首次约需下载 12MB 本地资源并初始化 wasm。
export function loadSegmentator() {
  if (ssInstance) return Promise.resolve(ssInstance)
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    await loadScript(BASE + 'selfie_segmentation.js')
    const Ctor = window.SelfieSegmentation
    if (!Ctor) throw new Error('SelfieSegmentation 未定义（资源不完整）')
    const ss = new Ctor({ locateFile: (file) => BASE + file })
    // modelSelection: 1 = landscape 模型（256×256，细节更好）；0 = 通用（144×256，更快）
    ss.setOptions({ modelSelection: 1 })
    ss.onResults(() => {})
    await ss.initialize()
    ssInstance = ss
    return ss
  })()
  loadPromise.catch(() => { loadPromise = null })
  return loadPromise
}

export function segmentorReady() {
  return !!ssInstance
}

// 对一张图像执行人物分割，返回 mask 画布（人物≈白、背景≈黑，尺寸同输入）
export async function segmentPerson(imageSource) {
  const ss = await loadSegmentator()
  return new Promise((resolve, reject) => {
    let settled = false
    ss.onResults((res) => {
      if (settled) return
      settled = true
      try { resolve(res.segmentationMask) } catch (e) { reject(e) }
    })
    Promise.resolve(ss.send({ image: imageSource })).catch((e) => {
      if (settled) return
      settled = true
      reject(new Error('分割推理失败：' + ((e && e.message) || e)))
    })
  })
}

// ---- 可分离盒式模糊（用于 mask 羽化） ----
function boxBlur(src, w, h, r) {
  if (r <= 0) return src
  const tmp = new Float32Array(src.length)
  const win = r * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win
      const add = src[row + Math.min(w - 1, x + r + 1)]
      const sub = src[row + Math.max(0, x - r)]
      acc += add - sub
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc / win
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x]
      const sub = tmp[Math.max(0, y - r) * w + x]
      acc += add - sub
    }
  }
  return src
}

// 把人物 mask 应用为帧的 Alpha 通道（就地修改 frameCanvas）
// opts.invert: true = 抠掉人物保留背景；feather: 边缘羽化像素
// 返回 { applied, personRatio }：画面中未检测到人物（占比 < 1%）时不修改，applied=false
export function applyPersonMask(frameCanvas, maskSource, { invert = false, feather = 2 } = {}) {
  const w = frameCanvas.width, h = frameCanvas.height

  // mask 统一转成帧尺寸的灰度数组（分割结果一般同尺寸，此处兜底缩放）
  const mc = makeCanvas(w, h)
  const mctx = mc.getContext('2d', { willReadFrequently: true })
  mctx.drawImage(maskSource, 0, 0, w, h)
  const md = mctx.getImageData(0, 0, w, h).data

  const n = w * h
  const gray = new Float32Array(n)
  let personPixels = 0
  for (let i = 0; i < n; i++) gray[i] = md[i * 4]

  // 柔化阈值：清理 mask 边缘噪点，再按羽化半径做边缘过渡
  const LOW = 70, HIGH = 200
  for (let i = 0; i < n; i++) {
    const v = gray[i]
    const t = v <= LOW ? 0 : v >= HIGH ? 255 : ((v - LOW) / (HIGH - LOW)) * 255
    gray[i] = t
    if (t > 127) personPixels++
  }

  // 未检测到人物：mask 几乎全空，应用只会把整帧变透明——保护跳过
  const personRatio = personPixels / n
  if (personRatio < 0.01) return { applied: false, personRatio }

  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, w, h)
  if (feather > 0) boxBlur(gray, w, h, Math.round(feather))

  const d = img.data
  for (let i = 0; i < n; i++) {
    let a = gray[i]
    if (invert) a = 255 - a
    d[i * 4 + 3] = (d[i * 4 + 3] * a) / 255
  }
  ctx.putImageData(img, 0, 0)
  return { applied: true, personRatio }
}

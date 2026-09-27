// 导入与解码管线：视频抽帧 / GIF / 图片 / ZIP / 精灵图切分 / 演示视频生成
import JSZip from 'jszip'
import { makeCanvas, snapshotCanvas, sleep } from './util.js'

export const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v']
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']

export function fileKind(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (ext === 'gif') return 'gif'
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (ext === 'zip') return 'zip'
  return 'unknown'
}

// 根据提取设置计算目标时间点
export function computeTimes(settings, start, end, sourceFps = 30) {
  const times = []
  const cap = settings.maxFrames || 1200
  if (settings.mode === 'count') {
    const n = Math.max(1, Math.min(settings.count, cap))
    for (let k = 0; k < n; k++) times.push(start + ((end - start) * k) / n)
  } else {
    let step
    if (settings.mode === 'interval') step = Math.max(0.01, settings.interval)
    else if (settings.mode === 'all') step = 1 / Math.max(1, sourceFps)
    else step = 1 / Math.max(0.1, settings.fps)
    for (let t = start; t < end - 1e-4 && times.length < cap; t += step) times.push(t)
  }
  return times
}

// ---------- 主路径：<video> 逐时间点 seek 解码（浏览器原生解码，兼容性最好） ----------
export async function probeVideo(url) {
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.preload = 'metadata'
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('读取视频信息超时')), 15000)
    video.onloadedmetadata = () => { clearTimeout(to); resolve() }
    video.onerror = () => { clearTimeout(to); reject(new Error('浏览器无法解码该视频')) }
  })
  return {
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
    fps: 30,
  }
}

export async function extractFramesSeek(url, settings, { onProgress, shouldCancel }) {
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'

  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('视频加载超时')), 30000)
    video.onloadedmetadata = () => { clearTimeout(to); resolve() }
    video.onerror = () => { clearTimeout(to); reject(new Error('浏览器无法解码该视频')) }
  })

  const W = video.videoWidth
  const H = video.videoHeight
  if (!W || !H) throw new Error('无法读取视频尺寸')
  const dur = video.duration
  const start = Math.max(0, settings.startTime || 0)
  const end = settings.endTime > 0 ? Math.min(settings.endTime, dur - 0.001) : dur - 0.001
  const times = computeTimes(settings, start, end)
  if (!times.length) throw new Error('未计算出任何抽帧时间点，请检查参数')

  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  const frames = []

  for (let i = 0; i < times.length; i++) {
    if (shouldCancel && shouldCancel()) break
    const t = times[i]
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => { cleanup(); reject(new Error('seek 超时，视频可能损坏')) }, 10000)
      const onSeeked = () => { cleanup(); resolve() }
      const cleanup = () => { clearTimeout(to); video.removeEventListener('seeked', onSeeked) }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = Math.min(t, dur - 0.001)
    })
    ctx.drawImage(video, 0, 0, W, H)
    frames.push(snapshotCanvas(canvas))
    onProgress && onProgress((i + 1) / times.length, `已解码 ${i + 1}/${times.length} 帧`)
  }
  return frames
}

// ---------- 快速路径：mp4box.js 解封装 + WebCodecs 解码 ----------
// 仅对 MP4/M4V 生效；任何一步失败都由调用方回退到 seek 路径
export async function extractFramesMp4(file, settings, { onProgress, shouldCancel }) {
  if (typeof VideoDecoder === 'undefined') throw new Error('浏览器不支持 WebCodecs')
  const MP4Box = (await import('mp4box')).default
  const { DataStream } = await import('mp4box')

  const buf = await file.arrayBuffer()
  buf.fileStart = 0
  const mp4 = MP4Box.createFile()

  let track_id = null
  const samples = []
  mp4.onSamples = (id, user, smps) => {
    if (id === track_id) samples.push(...smps)
  }

  const trackReady = new Promise((resolve, reject) => {
    mp4.onReady = info => {
      const t = info.tracks.find(t => t.type === 'video' || t.video)
      if (!t) return reject(new Error('文件中没有视频轨'))
      track_id = t.id
      // onReady 在 appendBuffer 解析过程中同步触发：
      // 此刻设置提取选项并 start()，让已解析样本立即经 onSamples 发出
      mp4.setExtractionOptions(t.id, null, { nb_samples: Infinity })
      mp4.start()
      resolve(t)
    }
    mp4.onError = e => reject(new Error('MP4 解析失败: ' + e))
  })

  try { mp4.appendBuffer(buf) } catch (e) { throw new Error('MP4 解析失败: ' + e.message) }
  const track = await trackReady
  try { mp4.flush() } catch (e) { /* 忽略收尾错误 */ }
  if (!samples.length) throw new Error('未能提取样本')
  return decodeWithWebCodecs(mp4, DataStream, track, samples, settings, { onProgress, shouldCancel })
}

async function decodeWithWebCodecs(mp4, DataStream, track, samples, settings, { onProgress, shouldCancel }) {
  const timescale = track.timescale || 1000
  const trackCodec = track.codec || ''
  const W = track.track_width, H = track.track_height
  if (!W || !H) throw new Error('无法读取视频轨尺寸')

  const durSec = samples.reduce((m, s) => Math.max(m, (s.cts + s.duration) / timescale), 0)
  const srcFps = samples.length / Math.max(0.04, durSec)
  const start = Math.max(0, settings.startTime || 0)
  const end = settings.endTime > 0 ? Math.min(settings.endTime, durSec - 0.001) : durSec - 0.001
  const times = computeTimes(settings, start, end, srcFps)
  if (!times.length) throw new Error('未计算出任何抽帧时间点')

  // 编码描述（avcC/hvcC/av1C/vpcC）
  let entry = null
  try {
    const t = mp4.getTrackById(track.id)
    entry = t.mdia.minf.stbl.stsd.entries[0]
  } catch (e) { /* ignore */ }
  let description
  if (entry) {
    const box = entry.avcC || entry.hvcC || entry.av1C || entry.vpcC || entry.dvcC
    if (box) {
      try {
        const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN)
        box.write(stream)
        description = new Uint8Array(stream.buffer, 8, stream.buffer.byteLength - 8)
      } catch (e) { /* ignore */ }
    }
  }

  const codec = trackCodec || (entry && entry.avcC ? 'avc1.640028' : 'vp09.00.10.08')
  const out = []
  let decodeErr = null
  let seq = 0

  const decoder = new VideoDecoder({
    output: vf => {
      // 匹配最近的目标时间点
      const t = vf.timestamp / 1e6
      while (seq < times.length && times[seq] < t - 1e-6) seq++
      if (seq < times.length && Math.abs(times[seq] - t) <= 0.5 / Math.max(1, srcFps)) {
        const c = makeCanvas(vf.displayWidth, vf.displayHeight)
        c.getContext('2d').drawImage(vf, 0, 0)
        out.push(c)
        seq++
        onProgress && onProgress(Math.min(0.98, out.length / times.length), `已解码 ${out.length} 帧`)
      }
      vf.close()
    },
    error: e => { decodeErr = e },
  })

  const config = { codec, optimizeForLatency: true }
  if (description) config.description = description
  if (W && H) { config.codedWidth = W; config.codedHeight = H }
  const decSupport = await VideoDecoder.isConfigSupported(config).catch(() => null)
  if (!decSupport || !decSupport.supported) throw new Error('浏览器不支持该编码: ' + codec)

  decoder.configure(config)

  for (const s of samples) {
    if (decodeErr) break
    if (shouldCancel && shouldCancel()) break
    if (!s.data) continue
    const chunk = new EncodedVideoChunk({
      type: s.is_sync ? 'key' : 'delta',
      timestamp: Math.round((s.cts / timescale) * 1e6),
      duration: Math.round((s.duration / timescale) * 1e6),
      data: s.data,
    })
    decoder.decode(chunk)
    // 防止解码队列积压
    if (decoder.decodeQueueSize > 120) await new Promise(r => setTimeout(r, 0))
  }
  await decoder.flush().catch(() => {})
  decoder.close()
  if (decodeErr && !out.length) throw new Error('WebCodecs 解码失败: ' + decodeErr.message)
  if (!out.length) throw new Error('未解出任何帧')
  return out
}

// ---------- GIF 解码（ImageDecoder） ----------
export async function decodeGif(file, { onProgress, shouldCancel }) {
  if (typeof ImageDecoder === 'undefined') throw new Error('浏览器不支持 ImageDecoder，无法解析动图')
  const data = await file.arrayBuffer()
  const dec = new ImageDecoder({ data, type: 'image/gif' })
  await dec.tracks.ready
  const track = dec.tracks.selectedTracks[0]
  const n = track.frameCount
  const frames = []
  for (let i = 0; i < n; i++) {
    if (shouldCancel && shouldCancel()) break
    const { image } = await dec.decode({ frameIndex: i })
    const c = makeCanvas(image.displayWidth || image.width, image.displayHeight || image.height)
    c.getContext('2d').drawImage(image, 0, 0)
    image.close()
    frames.push(c)
    onProgress && onProgress((i + 1) / n, `已解码 ${i + 1}/${n} 帧`)
  }
  return frames
}

// ---------- 图片 / ZIP ----------
export async function decodeImage(file) {
  const bmp = await createImageBitmap(file)
  return snapshotCanvas(bmp)
}

export async function decodeZip(file, { onProgress, shouldCancel }) {
  const zip = await JSZip.loadAsync(file)
  const names = Object.keys(zip.files)
    .filter(n => {
      const f = zip.files[n]
      if (f.dir) return false
      const ext = (n.split('.').pop() || '').toLowerCase()
      return IMAGE_EXT.includes(ext) && !n.split('/').pop().startsWith('.')
    })
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
  if (!names.length) throw new Error('压缩包中没有图片')
  const frames = []
  for (let i = 0; i < names.length; i++) {
    if (shouldCancel && shouldCancel()) break
    const blob = await zip.files[names[i]].async('blob')
    try {
      frames.push(await decodeImage(blob))
    } catch (e) { /* 跳过坏图 */ }
    onProgress && onProgress((i + 1) / names.length, `已解压 ${i + 1}/${names.length} 张`)
  }
  if (!frames.length) throw new Error('压缩包中的图片均无法解码')
  return frames
}

// ---------- 精灵图切分 ----------
export function splitSpriteSheet(src, { rows, cols, order = 'row', trim = false, alphaThreshold = 8 }) {
  const W = src.width, H = src.height
  const cw = Math.floor(W / cols), ch = Math.floor(H / rows)
  if (cw < 1 || ch < 1) throw new Error('行列数超出图片尺寸')
  const cells = []
  const sctx = src.getContext('2d')
  const imgData = sctx.getImageData(0, 0, W, H)

  for (let i = 0; i < rows * cols; i++) {
    const r = order === 'row' ? Math.floor(i / cols) : i % rows
    const c = order === 'row' ? i % cols : Math.floor(i / rows)
    const x0 = c * cw, y0 = r * ch
    let cell = cropCanvas(imgData, W, x0, y0, cw, ch)
    if (trim) cell = trimCanvas(cell, alphaThreshold)
    if (cell && cell.canvas.width > 0 && cell.canvas.height > 0) cells.push(cell.canvas)
  }
  return cells
}

function cropCanvas(imgData, srcW, x0, y0, w, h) {
  const c = makeCanvas(w, h)
  const out = c.getContext('2d').createImageData(w, h)
  const d = imgData.data, o = out.data
  for (let y = 0; y < h; y++) {
    const srcRow = ((y0 + y) * srcW + x0) * 4
    o.set(d.subarray(srcRow, srcRow + w * 4), y * w * 4)
  }
  c.getContext('2d').putImageData(out, 0, 0)
  return { canvas: c }
}

function trimCanvas(cellCanvas, alphaThreshold) {
  const { canvas } = cellCanvas
  const ctx = canvas.getContext('2d')
  const { width: w, height: h } = canvas
  const d = ctx.getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return cellCanvas // 全透明则保留原样
  const tw = maxX - minX + 1, th = maxY - minY + 1
  const c = makeCanvas(tw, th)
  c.getContext('2d').drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th)
  return { canvas: c }
}

// ---------- 演示视频生成（用于无素材体验 / 自动化测试） ----------
export async function generateDemoVideo({ w = 360, h = 240, frames = 48, fps = 12 } = {}) {
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0]

  const types = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || ''
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined)
  const chunks = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  const done = new Promise(r => { rec.onstop = r })
  rec.start()

  for (let i = 0; i < frames; i++) {
    const t = i / frames
    // 背景
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, `hsl(${230 + 40 * t}, 60%, ${16 + 8 * Math.sin(t * 6.28)}%)`)
    g.addColorStop(1, '#0b0d16')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    // 弹跳球
    const bx = w * (0.12 + 0.76 * t)
    const by = h / 2 + Math.sin(t * Math.PI * 4) * h * 0.3
    ctx.beginPath()
    ctx.arc(bx, by, 22, 0, 6.29)
    ctx.fillStyle = `hsl(${(i * 9) % 360}, 85%, 62%)`
    ctx.fill()
    // 帧号
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 20px monospace'
    ctx.fillText(String(i + 1).padStart(3, '0'), 12, h - 14)
    track.requestFrame && track.requestFrame()
    await sleep(1000 / fps)
  }
  await sleep(250)
  rec.stop()
  await done
  track.stop()
  const type = mimeType.split(';')[0] || 'video/webm'
  return new File(chunks, `demo_${fps}fps.webm`, { type })
}

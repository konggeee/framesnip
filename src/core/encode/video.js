// MP4 / WebM 导出：WebCodecs VideoEncoder + mp4-muxer / webm-muxer（均 MIT）
// 不支持 WebCodecs 的环境回退 MediaRecorder 实时录制
import { ArrayBufferTarget, Muxer as Mp4Muxer } from 'mp4-muxer'
import { ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer'
import { makeCanvas, sleep } from '../util.js'

const QUALITY_BITRATE = { low: 1_500_000, medium: 4_000_000, high: 10_000_000, ultra: 20_000_000 }

function even(n) { return Math.max(2, Math.round(n / 2) * 2) }

async function pickAvcCodec(w, h, bitrate, fps) {
  const candidates = ['avc1.640033', 'avc1.640032', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01e']
  for (const codec of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps })
      if (s.supported) return codec
    } catch (e) { /* try next */ }
  }
  return null
}

async function pickVpCodec(w, h, bitrate, fps) {
  const candidates = ['vp09.00.10.08', 'vp09.00.31.08', 'vp8']
  for (const codec of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps })
      if (s.supported) return codec
    } catch (e) { /* try next */ }
  }
  return null
}

export async function encodeVideo(frames, { format = 'mp4', fps = 12, quality = 'medium', loop = true, fill = '', onProgress, shouldCancel } = {}) {
  if (!frames.length) throw new Error('没有可导出的帧')
  const W = even(frames[0].width), H = even(frames[0].height)
  const bitrate = QUALITY_BITRATE[quality] || QUALITY_BITRATE.medium
  const totalMs = (frames.length / fps) * 1000 * (loop ? 1 : 1)

  if (typeof VideoEncoder !== 'undefined') {
    const codec = format === 'mp4' ? await pickAvcCodec(W, H, bitrate, fps) : await pickVpCodec(W, H, bitrate, fps)
    if (codec) {
      return encodeWithMuxer(frames, { format, codec, W, H, fps, bitrate, fill, onProgress, shouldCancel })
    }
  }
  return recordWithMediaRecorder(frames, { format, fps, fill, onProgress, shouldCancel })
}

async function encodeWithMuxer(frames, { format, codec, W, H, fps, bitrate, fill, onProgress, shouldCancel }) {
  const isMp4 = format === 'mp4'
  const MuxerCls = isMp4 ? Mp4Muxer : WebmMuxer
  const TargetCls = isMp4 ? Mp4Target : WebmTarget
  const muxer = new MuxerCls({
    target: new TargetCls(),
    video: isMp4
      ? { codec: 'avc', width: W, height: H, frameRate: fps }
      : { codec: codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', width: W, height: H, frameRate: fps },
    fastStart: isMp4 ? 'in-memory' : undefined,
  })

  let encErr = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encErr = e },
  })
  encoder.configure({ codec, width: W, height: H, bitrate, framerate: fps })

  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const loopN = 1
  let encoded = 0
  const total = frames.length * loopN
  const frameDur = 1e6 / fps

  for (let i = 0; i < total; i++) {
    if (shouldCancel && shouldCancel()) { encoder.close(); throw new Error('已取消') }
    if (encErr) throw new Error('编码失败: ' + encErr.message)
    const f = frames[i % frames.length]
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, W, H)
    } else {
      ctx.clearRect(0, 0, W, H)
    }
    ctx.drawImage(f, (W - f.width) / 2, (H - f.height) / 2)
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) })
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
    frame.close()
    encoded++
    if (encoder.encodeQueueSize > 10) await sleep(0)
    onProgress && onProgress(encoded / total, `编码 ${encoded}/${total}`)
  }
  await encoder.flush()
  encoder.close()
  muxer.finalize()
  const buffer = muxer.target.buffer
  return new Blob([buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' })
}

// 兼容回退：MediaRecorder 实时录制
async function recordWithMediaRecorder(frames, { format, fps, fill, onProgress, shouldCancel }) {
  const W = even(frames[0].width), H = even(frames[0].height)
  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const stream = canvas.captureStream(fps)
  const types = format === 'mp4'
    ? ['video/mp4', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp8']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  const mimeType = types.find(t => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('当前浏览器不支持该视频格式的录制')
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
  const chunks = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  const done = new Promise(r => { rec.onstop = r })
  rec.start()
  const total = frames.length * 2 // 循环两遍使结尾平滑
  for (let i = 0; i < total; i++) {
    if (shouldCancel && shouldCancel()) { rec.stop(); throw new Error('已取消') }
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, W, H)
    } else {
      ctx.clearRect(0, 0, W, H)
    }
    ctx.drawImage(frames[i % frames.length], (W - frames[i % frames.length].width) / 2, (H - frames[i % frames.length].height) / 2)
    onProgress && onProgress((i + 1) / total, `录制 ${i + 1}/${total}`)
    await sleep(1000 / fps)
  }
  await sleep(300)
  rec.stop()
  await done
  return new Blob(chunks, { type: mimeType.split(';')[0] })
}

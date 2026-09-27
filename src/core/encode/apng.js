// APNG 导出：upng-js（MIT）封装，无损 RGBA 多帧
import UPNG from 'upng-js'

export async function encodeApng(frames, { fps = 12, onProgress } = {}) {
  if (!frames.length) throw new Error('没有可导出的帧')
  const W = frames[0].width, H = frames[0].height
  const delay = Math.max(10, Math.round(1000 / fps))
  const rgbaArr = []
  const delays = []
  for (let i = 0; i < frames.length; i++) {
    const ctx = frames[i].getContext('2d', { willReadFrequently: true })
    rgbaArr.push(ctx.getImageData(0, 0, W, H).data.buffer)
    delays.push(delay)
    onProgress && onProgress(0.1 + 0.6 * (i + 1) / frames.length, `收集 ${i + 1}/${frames.length} 帧`)
  }
  // cnum=0 保持全彩；编码在主线程进行，帧多/大时会较慢
  await new Promise(r => setTimeout(r, 30))
  const ab = UPNG.encode(rgbaArr, W, H, 0, delays)
  onProgress && onProgress(1, '完成')
  return new Blob([ab], { type: 'image/png' })
}

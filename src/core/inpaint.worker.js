// 去水印图像修复 Worker：避免修复大图时阻塞 UI
import { teleaInpaint } from './inpaint.js'

self.onmessage = (e) => {
  const { id, imageData, mask, radius } = e.data
  try {
    teleaInpaint(imageData, mask, radius)
    self.postMessage({ id, ok: true, imageData }, [imageData.data.buffer])
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) })
  }
}

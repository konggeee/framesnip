// inpaint Worker 的主线程封装：串行任务队列 + transferable 传输
let worker = null
const pending = new Map()
let nextTaskId = 1

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./inpaint.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const { id, ok, imageData, error } = e.data
    const t = pending.get(id)
    if (!t) return
    pending.delete(id)
    ok ? t.resolve(imageData) : t.reject(new Error(error))
  }
  worker.onerror = (e) => {
    const err = new Error('修复 Worker 异常: ' + (e.message || '未知错误'))
    pending.forEach(t => t.reject(err))
    pending.clear()
    worker.terminate()
    worker = null
  }
  return worker
}

// 传入的 imageData/mask 会被 transfer（主线程侧失效），返回修复后的新 ImageData
export function inpaintAsync(imageData, mask, radius) {
  return new Promise((resolve, reject) => {
    const id = nextTaskId++
    pending.set(id, { resolve, reject })
    getWorker().postMessage(
      { id, imageData, mask, radius },
      [imageData.data.buffer, mask.buffer]
    )
  })
}

// 工程保存 / 加载：把帧数据内嵌进应用 HTML 的副本，生成可双击打开的 .fp.html
import { toast } from './state.js'

const PROJECT_TAG_ID = 'fp-project-data'

export async function serializeProject(frames, fps, loop, { onProgress } = {}) {
  const data = {
    app: 'framesnip',
    version: 1,
    fps,
    loop,
    savedAt: new Date().toISOString(),
    frames: [],
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const dataUrl = await canvasToDataUrl(f.canvas)
    data.frames.push({ name: f.name, w: f.w, h: f.h, png: dataUrl })
    onProgress && onProgress((i + 1) / frames.length, `序列化 ${i + 1}/${frames.length}`)
  }
  return data
}

function canvasToDataUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async b => {
      if (!b) return reject(new Error('PNG 序列化失败'))
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(new Error('PNG 读取失败'))
      fr.readAsDataURL(b)
    }, 'image/png')
  })
}

// 生成自包含 HTML：基于当前文档克隆，替换内嵌工程数据
export async function buildProjectHtml(projectData) {
  let html
  try {
    const res = await fetch(location.href, { cache: 'no-store' })
    if (res.ok) html = await res.text()
  } catch (e) { /* file:// 等 */ }
  if (!html || html.includes('/@vite') || html.includes('/src/main.js')) {
    // 开发模式或 fetch 失败：退化为当前 DOM 快照
    html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML
    if (import.meta.env.DEV) {
      toast('开发模式下保存的工程文件仅作预览，正式使用请先 npm run build 后用构建版本保存', 'warn', 5000)
    }
  }
  // 移除旧的内嵌数据
  html = html.replace(new RegExp(`<script[^>]*id="${PROJECT_TAG_ID}"[^>]*>[\\s\\S]*?</script>`, 'g'), '')
  const payload = `<script type="application/json" id="${PROJECT_TAG_ID}">${JSON.stringify(projectData).replace(/</g, '\\u003c')}</script>`
  if (html.includes('</body>')) html = html.replace('</body>', payload + '\n</body>')
  else html += payload
  return html
}

export function loadEmbeddedProject() {
  const el = document.getElementById(PROJECT_TAG_ID)
  if (!el || !el.textContent.trim()) return null
  try {
    const data = JSON.parse(el.textContent)
    // app 标识同时接受新名 framesnip 与旧名 frameforge（旧 .fp.html 工程兼容）
    if (data && (data.app === 'framesnip' || data.app === 'frameforge') && Array.isArray(data.frames)) return data
  } catch (e) { /* ignore */ }
  return null
}

export async function restoreFramesFromProject(data, { onProgress } = {}) {
  const out = []
  for (let i = 0; i < data.frames.length; i++) {
    const item = data.frames[i]
    const blob = await (await fetch(item.png)).blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    c.getContext('2d').drawImage(bmp, 0, 0)
    bmp.close()
    out.push({ name: item.name || `帧 ${i + 1}`, canvas: c, w: c.width, h: c.height })
    onProgress && onProgress((i + 1) / data.frames.length, `恢复 ${i + 1}/${data.frames.length}`)
  }
  return out
}

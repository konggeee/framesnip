<script setup>
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import { state, maxFrameSize, toast } from '../core/state.js'
import { fitToCanvas } from '../core/imageops.js'
import { formatBytes, makeCanvas } from '../core/util.js'
import { encodeGif } from '../core/encode/gif.js'
import { encodeApng } from '../core/encode/apng.js'
import { encodeZip } from '../core/encode/zip.js'
import { buildSheet } from '../core/encode/sheet.js'
import { encodeVideo } from '../core/encode/video.js'

const FORMATS = [
  { id: 'gif', label: 'GIF', desc: '透明背景动图，表情包/网页通用' },
  { id: 'apng', label: 'APNG', desc: '全彩透明动图（PNG 格式）' },
  { id: 'zip', label: 'PNG 序列', desc: '逐帧 PNG 打包为 ZIP' },
  { id: 'sheet', label: '精灵图', desc: '所有帧拼成一张图集' },
  { id: 'webm', label: 'WebM', desc: 'VP9 编码视频，支持透明（部分播放器）' },
  { id: 'mp4', label: 'MP4', desc: 'H.264 视频，无透明需填充背景色' },
]

const format = ref('gif')

const opt = reactive({
  // GIF
  maxColors: 256,
  alphaThreshold: 128,
  perFramePalette: false,
  // ZIP
  prefix: 'frame',
  digits: 4,
  // 精灵图
  sheetCols: 0,
  sheetPadding: 0,
  sheetBg: '',
  // 视频
  quality: 'medium',
  // 通用
  resMode: 'original', // original | half | double | custom
  customW: 0,
  customH: 0,
  lockRatio: true,
  fitMode: 'contain',   // stretch | contain | cover
  fillColor: '',        // '' = 透明
})

const base = computed(() => {
  const { w, h } = maxFrameSize()
  return { w, h }
})

const outSize = computed(() => {
  let w = base.value.w, h = base.value.h
  if (opt.resMode === 'half') { w /= 2; h /= 2 }
  else if (opt.resMode === 'double') { w *= 2; h *= 2 }
  else if (opt.resMode === 'custom') {
    w = opt.customW || w
    h = opt.lockRatio && opt.customW ? Math.round(opt.customW * base.value.h / base.value.w) : (opt.customH || h)
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
})

function setCustomFromBase() {
  opt.customW = base.value.w
  opt.customH = base.value.h
}

// ---- 导出帧渲染（统一分辨率） ----
function renderExportFrames() {
  const { w, h } = outSize.value
  return state.frames.map(f => fitToCanvas(f.canvas, w, h, opt.fitMode, opt.fillColor))
}

// ---- 导出 ----
const exporting = ref(false)
const exportProgress = ref(0)
const exportText = ref('')
const cancelFlag = ref(false)

async function doExport() {
  if (!state.frames.length) return toast('没有可导出的帧', 'warn')
  exporting.value = true
  cancelFlag.value = false
  exportProgress.value = 0
  try {
    const frames = renderExportFrames()
    const setP = (p, t) => { exportProgress.value = p; exportText.value = t || '' }
    const isCancelled = () => cancelFlag.value
    const { downloadBlob } = await import('../core/util.js')
    let blob = null, name = ''

    if (format.value === 'gif') {
      blob = await encodeGif(frames, {
        fps: state.fps, loop: state.loop, maxColors: opt.maxColors,
        alphaThreshold: opt.alphaThreshold, transparent: !opt.fillColor,
        perFramePalette: opt.perFramePalette,
        onProgress: (p, t) => setP(p * 0.95, t),
      })
      name = `animation_${state.fps}fps.gif`
    } else if (format.value === 'apng') {
      blob = await encodeApng(frames, { fps: state.fps, onProgress: (p, t) => setP(p * 0.95, t) })
      name = `animation_${state.fps}fps.png`
    } else if (format.value === 'zip') {
      blob = await encodeZip(frames, { prefix: opt.prefix, digits: opt.digits, onProgress: (p, t) => setP(p * 0.98, t) })
      name = `${opt.prefix}_序列.zip`
    } else if (format.value === 'sheet') {
      const { canvas } = buildSheet(frames, { cols: opt.sheetCols || 0, padding: opt.sheetPadding, bgColor: opt.sheetBg })
      blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('PNG 编码失败')), 'image/png'))
      name = `spritesheet_${sheetInfo.value.cols}x${sheetInfo.value.rows}.png`
      setP(1, '完成')
    } else {
      blob = await encodeVideo(frames, {
        format: format.value, fps: state.fps, quality: opt.quality, loop: state.loop,
        fill: format.value === 'mp4' ? (opt.fillColor || '#ffffff') : (opt.fillColor || ''),
        onProgress: (p, t) => setP(p * 0.98, t), shouldCancel: isCancelled,
      })
      name = `animation_${state.fps}fps.${format.value}`
    }
    if (blob) {
      downloadBlob(blob, name)
      toast(`导出完成：${name}（${formatBytes(blob.size)}）`, 'ok')
    }
  } catch (e) {
    if (e.message !== '已取消') toast(e.message || '导出失败', 'error')
    else toast('已取消', 'warn')
  } finally {
    exporting.value = false
  }
}

// ---- 精灵图预览 ----
const sheetInfo = computed(() => {
  const n = state.frames.length
  const cols = opt.sheetCols > 0 ? Math.min(opt.sheetCols, n) : Math.ceil(Math.sqrt(n))
  return { cols, rows: Math.ceil(n / (cols || 1)) }
})

const sheetPreviewEl = ref(null)
function renderSheetPreview() {
  const el = sheetPreviewEl.value
  if (!el) return
  el.innerHTML = ''
  if (!state.frames.length || format.value !== 'sheet') return
  try {
    const { canvas, cols, rows } = buildSheet(renderExportFrames(), { cols: opt.sheetCols || 0, padding: opt.sheetPadding, bgColor: opt.sheetBg })
    const cv = makeCanvas(560, Math.min(420, Math.round(560 * canvas.height / canvas.width)))
    const ctx = cv.getContext('2d')
    ctx.drawImage(canvas, 0, 0, cv.width, cv.height)
    // 帧边界
    ctx.strokeStyle = 'rgba(91,91,214,.85)'
    ctx.lineWidth = 1
    const fw = cv.width / cols, fh = cv.height / rows
    for (let c = 1; c < cols; c++) { ctx.beginPath(); ctx.moveTo(c * fw, 0); ctx.lineTo(c * fw, cv.height); ctx.stroke() }
    for (let r = 1; r < rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * fh); ctx.lineTo(cv.width, r * fh); ctx.stroke() }
    cv.style.maxWidth = '100%'
    el.appendChild(cv)
  } catch (e) { /* ignore */ }
}

// ---- 导出预览播放（带独立播放控制：暂停 / 倍速，不影响导出帧率） ----
const previewCanvasEl = ref(null)
const previewPlaying = ref(true)
const previewSpeed = ref(1) // 0.25 / 0.5 / 1 / 2
let previewRaf = 0
let previewIdx = 0
let previewAcc = 0
let previewLast = 0

function previewTick(ts) {
  try {
    if (state.frames.length) {
      if (previewLast) previewAcc += (ts - previewLast) / 1000
      previewLast = ts
      if (previewPlaying.value) {
        const frameDur = 1 / Math.max(0.01, state.fps * previewSpeed.value)
        while (previewAcc >= frameDur) {
          previewAcc -= frameDur
          previewIdx++
          if (previewIdx >= state.frames.length) previewIdx = 0
        }
      } else {
        previewAcc = 0
      }
      const c = previewCanvasEl.value
      if (c) {
        const ctx = c.getContext('2d')
        ctx.clearRect(0, 0, c.width, c.height)
        const src = state.frames[previewIdx]
        if (src) {
          const frame = fitToCanvas(src.canvas, c.width, c.height, opt.fitMode, opt.fillColor)
          ctx.drawImage(frame, 0, 0)
        }
      }
    } else previewLast = ts
  } catch (e) { /* 单帧渲染失败不中断播放链 */ }
  previewRaf = requestAnimationFrame(previewTick)
}
onMounted(() => { previewRaf = requestAnimationFrame(previewTick) })
onBeforeUnmount(() => { cancelAnimationFrame(previewRaf) })

// ---- 体积估算 ----
const estimating = ref(false)
const estimateText = ref('')

async function estimateSize() {
  if (!state.frames.length) return
  estimating.value = true
  estimateText.value = ''
  try {
    const n = state.frames.length
    const sampleN = Math.min(3, n)
    const idxs = [0, Math.floor(n / 2), n - 1].slice(0, sampleN)
    const sampleFrames = idxs.map(i => fitToCanvas(state.frames[i].canvas, outSize.value.w, outSize.value.h, opt.fitMode, opt.fillColor))
    let per = 0
    if (format.value === 'gif') {
      const blob = await encodeGif(sampleFrames, { fps: state.fps, loop: true, maxColors: opt.maxColors, alphaThreshold: opt.alphaThreshold, transparent: !opt.fillColor, perFramePalette: opt.perFramePalette })
      per = blob.size / sampleN
      estimateText.value = `约 ${formatBytes(per * n)}（按 ${sampleN} 帧样本推算）`
    } else if (format.value === 'apng' || format.value === 'zip') {
      const blobs = await Promise.all(sampleFrames.map(f => new Promise((res, rej) => f.toBlob(b => b ? res(b) : rej(new Error('编码失败')), 'image/png'))))
      per = blobs.reduce((s, b) => s + b.size, 0) / sampleN
      estimateText.value = format.value === 'zip'
        ? `约 ${formatBytes(per * n)}（PNG 已压缩，存储打包）`
        : `约 ${formatBytes(per * n * 1.15)}（APNG 全彩，仅供参考）`
    } else if (format.value === 'sheet') {
      const { canvas } = buildSheet(renderExportFrames(), { cols: opt.sheetCols || 0, padding: opt.sheetPadding, bgColor: opt.sheetBg })
      const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('编码失败')), 'image/png'))
      estimateText.value = `实际 ${formatBytes(blob.size)}`
    } else {
      const bitrate = { low: 1.5, medium: 4, high: 10, ultra: 20 }[opt.quality] || 4
      const sec = n / state.fps
      estimateText.value = `约 ${formatBytes(bitrate * 1e6 / 8 * sec)}（${bitrate} Mbps × ${sec.toFixed(1)}s）`
    }
  } catch (e) {
    estimateText.value = '估算失败'
  } finally {
    estimating.value = false
  }
}

defineExpose({ renderSheetPreview })
</script>

<template>
  <div class="export-layout">
    <div class="export-settings">
      <!-- 格式选择 -->
      <div class="seg" style="margin-bottom:6px">
        <button v-for="f in FORMATS" :key="f.id" :class="{ on: format === f.id }" @click="format = f.id">{{ f.label }}</button>
      </div>
      <div class="hint" style="margin-bottom:12px">{{ FORMATS.find(f => f.id === format).desc }}</div>

      <!-- 通用：分辨率与适配 -->
      <div class="section">
        <div class="section-title">分辨率</div>
        <div class="chips">
          <span class="chip" :class="{ on: opt.resMode === 'original' }" @click="opt.resMode = 'original'">原图 {{ base.w }}×{{ base.h }}</span>
          <span class="chip" :class="{ on: opt.resMode === 'half' }" @click="opt.resMode = 'half'">1/2</span>
          <span class="chip" :class="{ on: opt.resMode === 'double' }" @click="opt.resMode = 'double'">2x</span>
          <span class="chip" :class="{ on: opt.resMode === 'custom' }" @click="opt.resMode = 'custom'; setCustomFromBase()">自定义</span>
        </div>
        <div v-if="opt.resMode === 'custom'" style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <input v-model.number="opt.customW" type="number" min="1" max="4096" style="width:80px">
          <span class="muted">×</span>
          <input v-model.number="opt.customH" type="number" min="1" max="4096" style="width:80px">
          <label class="muted" style="display:flex;gap:4px;align-items:center">
            <input v-model="opt.lockRatio" type="checkbox"> 锁定比例
          </label>
        </div>
        <div class="form-row" style="margin-top:10px">
          <label>适配方式</label>
          <div class="seg">
            <button :class="{ on: opt.fitMode === 'contain' }" @click="opt.fitMode = 'contain'">适应留边</button>
            <button :class="{ on: opt.fitMode === 'cover' }" @click="opt.fitMode = 'cover'">填充裁剪</button>
            <button :class="{ on: opt.fitMode === 'stretch' }" @click="opt.fitMode = 'stretch'">拉伸</button>
          </div>
        </div>
        <div class="form-row">
          <label>背景填充</label>
          <div style="display:flex;gap:8px;align-items:center">
            <label class="muted" style="display:flex;gap:4px;align-items:center">
              <input v-model="opt.fillColor" type="checkbox" :true-value="''" :false-value="'#ffffff'" @change="opt.fillColor === '' ? opt.fillColor = '' : null"> 透明
            </label>
            <input v-if="opt.fillColor !== ''" v-model="opt.fillColor" type="color" style="width:38px;height:28px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff">
            <span v-if="format === 'mp4'" class="hint">MP4 不支持透明，必须填充背景色</span>
          </div>
        </div>
      </div>

      <!-- 各格式参数 -->
      <div v-if="format === 'gif'" class="section">
        <div class="section-title">GIF 参数</div>
        <div class="form-row">
          <label>颜色数</label>
          <div class="seg">
            <button v-for="c in [256, 128, 64, 32, 16]" :key="c" :class="{ on: opt.maxColors === c }" @click="opt.maxColors = c">{{ c }}</button>
          </div>
        </div>
        <div class="form-row">
          <label>透明阈值</label>
          <input v-model.number="opt.alphaThreshold" type="range" min="1" max="254" style="flex:1">
          <span class="slider-val">{{ opt.alphaThreshold }}</span>
        </div>
        <div class="form-row">
          <label>高质量模式</label>
          <label class="muted" style="display:flex;gap:4px;align-items:center">
            <input v-model="opt.perFramePalette" type="checkbox"> 逐帧独立调色板（更清晰，更慢）
          </label>
        </div>
      </div>

      <div v-if="format === 'zip'" class="section">
        <div class="section-title">PNG 序列参数</div>
        <div class="form-row">
          <label>文件名前缀</label>
          <input v-model="opt.prefix" type="text" style="width:140px">
        </div>
        <div class="form-row">
          <label>序号位数</label>
          <div class="seg">
            <button v-for="d in [3, 4, 5, 6]" :key="d" :class="{ on: opt.digits === d }" @click="opt.digits = d">{{ d }}</button>
          </div>
        </div>
        <div class="hint">命名示例：{{ opt.prefix }}_{{ '1'.padStart(opt.digits, '0') }}.png · 帧率信息以当前预览帧率（{{ state.fps }}fps）为准</div>
      </div>

      <div v-if="format === 'sheet'" class="section">
        <div class="section-title">精灵图参数</div>
        <div class="form-row">
          <label>列数</label>
          <input v-model.number="opt.sheetCols" type="number" min="0" max="128" style="width:80px">
          <span class="hint">0 = 自动（{{ sheetInfo.cols }} 列 × {{ sheetInfo.rows }} 行）</span>
        </div>
        <div class="form-row">
          <label>帧间距</label>
          <input v-model.number="opt.sheetPadding" type="number" min="0" max="64" style="width:80px">
        </div>
        <div class="form-row">
          <label>背景色</label>
          <label class="muted" style="display:flex;gap:4px;align-items:center">
            <input v-model="opt.sheetBg" type="checkbox" true-value="" false-value="#ffffff"> 透明
          </label>
          <input v-if="opt.sheetBg !== ''" v-model="opt.sheetBg" type="color" style="width:38px;height:28px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff">
        </div>
      </div>

      <div v-if="format === 'webm' || format === 'mp4'" class="section">
        <div class="section-title">视频参数</div>
        <div class="form-row">
          <label>画质</label>
          <div class="seg">
            <button v-for="q in [['low', '低'], ['medium', '中'], ['high', '高'], ['ultra', '超高']]" :key="q[0]" :class="{ on: opt.quality === q[0] }" @click="opt.quality = q[0]">{{ q[1] }}</button>
          </div>
        </div>
        <div class="hint" v-if="format === 'webm'">WebM(VP9) 可保留透明通道，但部分播放器不支持</div>
      </div>

      <!-- 估算 + 导出 -->
      <div class="section" style="border-bottom:none">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="primary" :disabled="exporting || !state.frames.length" @click="doExport">
            {{ exporting ? '导出中…' : `导出 ${FORMATS.find(f => f.id === format).label}` }}
          </button>
          <button v-if="exporting" @click="cancelFlag = true">取消</button>
          <button class="small" :disabled="estimating || !state.frames.length" @click="estimateSize">{{ estimating ? '估算中…' : '估算体积' }}</button>
          <span class="muted">{{ estimateText }}</span>
        </div>
        <div v-if="exporting" style="margin-top:10px">
          <div class="progress-track"><div class="progress-fill" :style="{ width: (exportProgress * 100).toFixed(1) + '%' }"></div></div>
          <div class="hint" style="margin-top:4px">{{ exportText || '处理中…' }}</div>
        </div>
      </div>
    </div>

    <!-- 右侧预览 -->
    <div class="export-side">
      <div class="muted" style="font-weight:600;margin-bottom:8px">导出预览（{{ outSize.w }}×{{ outSize.h }}）</div>
      <div class="checker" style="border-radius:10px;border:1px solid var(--line);overflow:hidden;display:flex;justify-content:center">
        <canvas ref="previewCanvasEl" width="240" height="240" style="max-width:100%"></canvas>
      </div>
      <div class="preview-controls">
        <button class="small" :disabled="!state.frames.length" @click="previewPlaying = !previewPlaying">{{ previewPlaying ? '⏸ 暂停' : '▶ 播放' }}</button>
        <div class="seg">
          <button v-for="s in [0.25, 0.5, 1, 2]" :key="s" :class="{ on: previewSpeed === s }" @click="previewSpeed = s">{{ s }}x</button>
        </div>
      </div>
      <div class="hint" style="text-align:center;margin-top:6px">{{ state.fps }} fps · {{ state.frames.length }} 帧 · {{ (state.frames.length / state.fps).toFixed(2) }}s{{ state.loop ? ' · 循环' : '' }}</div>

      <template v-if="format === 'sheet' && state.frames.length">
        <div class="muted" style="font-weight:600;margin:14px 0 8px">精灵图预览</div>
        <div class="checker" style="border-radius:10px;border:1px solid var(--line);padding:6px;max-height:420px;overflow:auto">
          <div ref="sheetPreviewEl"></div>
        </div>
        <button class="small" style="margin-top:6px" @click="renderSheetPreview">刷新预览</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.export-layout { display: flex; gap: 18px; align-items: flex-start; }
.export-settings { flex: 1 1 auto; min-width: 0; max-width: 560px; }
.export-side { flex: 0 0 460px; position: sticky; top: 16px; }
.preview-controls { display: flex; align-items: center; gap: 10px; justify-content: center; margin-top: 8px; flex-wrap: wrap; }
.section { padding: 14px 0; border-bottom: 1px solid var(--line); }
.section-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
@media (max-width: 1080px) {
  .export-layout { flex-direction: column; }
  .export-side { position: static; width: 100%; flex: 1 1 auto; }
}
</style>

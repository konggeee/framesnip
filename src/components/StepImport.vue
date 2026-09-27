<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { state, addFrame, clearFrames, resetSource, toast, confirmDialog } from '../core/state.js'
import { fileKind, probeVideo, extractFramesSeek, extractFramesMp4, decodeGif, decodeImage, decodeZip, generateDemoVideo } from '../core/importer.js'
import { formatTime, clamp } from '../core/util.js'
import SheetSplitDialog from './SheetSplitDialog.vue'

const fileInput = ref(null)
const dragOver = ref(false)
const busy = ref(false)
const progress = ref(0)
const progressText = ref('')
const cancelFlag = ref(false)

const videoEl = ref(null)
const playing = ref(false)
const curTime = ref(0)
const sheetSrc = ref(null)          // 待切分的单图
const showSheetSplit = ref(false)

const ex = state.extract

const hasFrames = computed(() => state.frames.length > 0)

function pick() { fileInput.value && fileInput.value.click() }

function onPick(e) {
  const files = e.target.files
  if (files && files.length) handleFile(files[0])
  e.target.value = ''
}

function onDrop(e) {
  dragOver.value = false
  const files = e.dataTransfer.files
  if (files && files.length) handleFile(files[0])
}

async function handleFile(file) {
  const kind = fileKind(file)
  if (kind === 'unknown') return toast('不支持的文件类型', 'warn')
  if (state.frames.length) {
    const ok = await confirmDialog({ title: '重新导入', body: '将清空当前帧列表并导入新文件，继续吗？' })
    if (!ok) return
    clearFrames()
  }
  resetSource()
  state.source.kind = kind
  state.source.fileName = file.name

  if (kind === 'video') {
    const url = URL.createObjectURL(file)
    state.source.objectUrls.push(url)
    state.source.videoUrl = url
    try {
      const meta = await probeVideo(url)
      state.source.duration = meta.duration
      state.source.width = meta.width
      state.source.height = meta.height
      ex.startTime = 0
      ex.endTime = 0
      toast(`已载入视频 ${file.name}（${meta.width}×${meta.height}，${formatTime(meta.duration)}）`, 'ok')
    } catch (e) {
      toast(e.message, 'error')
      resetSource()
    }
  } else if (kind === 'gif') {
    await runBusy(async (setP, isCancelled) => {
      const frames = await decodeGif(file, { onProgress: setP, shouldCancel: isCancelled })
      frames.forEach(c => addFrame(c))
      state.source.width = frames[0]?.width || 0
      state.source.height = frames[0]?.height || 0
      toast(`GIF 已解析为 ${frames.length} 帧`, 'ok')
    })
  } else if (kind === 'zip') {
    await runBusy(async (setP, isCancelled) => {
      const frames = await decodeZip(file, { onProgress: setP, shouldCancel: isCancelled })
      frames.forEach(c => addFrame(c))
      state.source.width = frames[0]?.width || 0
      state.source.height = frames[0]?.height || 0
      toast(`压缩包已导入 ${frames.length} 帧`, 'ok')
    })
  } else if (kind === 'image') {
    const c = await decodeImage(file)
    sheetSrc.value = c
    showSheetSplit.value = true
  }
}

async function runBusy(fn) {
  busy.value = true
  progress.value = 0
  progressText.value = ''
  cancelFlag.value = false
  try {
    await fn(p => { progress.value = p[0] || p; progressText.value = p[1] || '' }, () => cancelFlag.value)
  } catch (e) {
    toast(e.message || '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

// ---- 视频抽帧 ----
async function startExtract() {
  if (!state.source.videoUrl) return
  await runBusy(async (setP, isCancelled) => {
    let frames = null
    let via = ''
    const ext = (state.source.fileName.split('.').pop() || '').toLowerCase()
    if ((ext === 'mp4' || ext === 'm4v') && typeof VideoDecoder !== 'undefined') {
      try {
        frames = await extractFramesMp4({ arrayBuffer: () => fetch(state.source.videoUrl).then(r => r.arrayBuffer()), name: state.source.fileName }, ex, {
          onProgress: p => setP(p[0] * 0.95, p[1]),
          shouldCancel: isCancelled,
        })
        via = 'WebCodecs 快速解码'
      } catch (e) {
        frames = null
        toast('快速解码不可用（' + e.message + '），切换浏览器解码', 'warn')
      }
    }
    // extractFramesMp4 内部需要 File：改为直接传 url 版本
    if (!frames) {
      frames = await extractFramesSeek(state.source.videoUrl, ex, {
        onProgress: (p, t) => setP([p, t]),
        shouldCancel: isCancelled,
      })
      via = '浏览器 seek 解码'
    }
    if (frames.length) {
      frames.forEach(c => addFrame(c))
      state.source.width = frames[0].width
      state.source.height = frames[0].height
      toast(`提取完成：${frames.length} 帧（${via}）`, 'ok')
    } else {
      toast('已取消或未提取到帧', 'warn')
    }
  })
}

// ---- 演示视频 ----
async function loadDemo() {
  if (state.frames.length) {
    const ok = await confirmDialog({ title: '载入演示', body: '将清空当前帧列表，继续吗？' })
    if (!ok) return
    clearFrames()
  }
  resetSource()
  await runBusy(async setP => {
    setP([0.1, '正在生成演示视频…'])
    const file = await generateDemoVideo()
    setP([0.5, '解析演示视频…'])
    state.source.kind = 'demo'
    state.source.fileName = file.name
    const url = URL.createObjectURL(file)
    state.source.objectUrls.push(url)
    state.source.videoUrl = url
    const meta = await probeVideo(url)
    state.source.duration = meta.duration
    state.source.width = meta.width
    state.source.height = meta.height
    ex.startTime = 0
    ex.endTime = 0
    toast('演示视频已生成，点击「开始提取」体验抽帧', 'ok')
  })
}

// ---- 保存工程 ----
async function saveProject() {
  if (!hasFrames.value) return toast('还没有帧可保存', 'warn')
  const { serializeProject, buildProjectHtml } = await import('../core/project.js')
  await runBusy(async setP => {
    const data = await serializeProject(state.frames, state.fps, state.loop, {
      onProgress: (p, t) => setP([p * 0.9, t]),
    })
    setP([0.95, '打包工程文件…'])
    const html = await buildProjectHtml(data)
    const blob = new Blob([html], { type: 'text/html' })
    const { downloadBlob } = await import('../core/util.js')
    downloadBlob(blob, `framesnip_工程_${Date.now()}.fp.html`)
    toast('工程已保存：双击 .fp.html 文件即可在本工具中恢复', 'ok')
  })
}

// ---- 精灵图切分回调 ----
function onSheetSplit(cells) {
  showSheetSplit.value = false
  if (cells && cells.length) {
    cells.forEach(c => addFrame(c))
    state.source.width = cells[0].width
    state.source.height = cells[0].height
    toast(`精灵图已切分为 ${cells.length} 帧`, 'ok')
  } else if (sheetSrc.value) {
    addFrame(sheetSrc.value)
    toast('已作为单帧导入', 'ok')
  }
  sheetSrc.value = null
}

// ---- 视频播放器控制 ----
function togglePlay() {
  const v = videoEl.value
  if (!v) return
  if (v.paused) { v.play(); playing.value = true } else { v.pause(); playing.value = false }
}
function onSeek(e) {
  const v = videoEl.value
  if (!v) return
  v.currentTime = Number(e.target.value)
  curTime.value = v.currentTime
}
function onTimeUpdate() {
  const v = videoEl.value
  if (v) curTime.value = v.currentTime
}

const dur = computed(() => state.source.duration || 0)

// ---- 提取区间选择条：与右侧「起始时间 / 结束时间」双向联动 ----
const barEl = ref(null)
// 有效终点：0 表示「到结尾」，按 dur 展示
const rangeEnd = computed(() => (ex.endTime > 0 && ex.endTime <= dur.value) ? ex.endTime : dur.value)
const effStart = computed(() => clamp(ex.startTime || 0, 0, Math.max(0, rangeEnd.value - 0.05)))

let dragMode = null   // 'start' | 'end' | 'move' | null
let moveOffset = 0

function barFrac(e) {
  const r = barEl.value.getBoundingClientRect()
  return clamp((e.clientX - r.left) / r.width, 0, 1)
}

function onBarDown(e) {
  if (!dur.value) return
  barEl.value.setPointerCapture(e.pointerId)
  const f = barFrac(e)
  const s = effStart.value / dur.value, t = rangeEnd.value / dur.value
  if (Math.abs(f - s) <= 0.03) dragMode = 'start'
  else if (Math.abs(f - t) <= 0.03) dragMode = 'end'
  else if (f > s && f < t) { dragMode = 'move'; moveOffset = (f - s) * dur.value }
  else {
    // 区间外点下：从这里拖出一个新区间
    dragMode = 'end'
    ex.startTime = +(f * dur.value).toFixed(2)
    ex.endTime = +(f * dur.value).toFixed(2)
  }
}
function onBarMove(e) {
  if (!dragMode || !dur.value) return
  const time = +(barFrac(e) * dur.value).toFixed(2)
  if (dragMode === 'start') {
    ex.startTime = Math.min(time, rangeEnd.value - 0.05)
  } else if (dragMode === 'end') {
    ex.endTime = Math.max(time, effStart.value + 0.05)
  } else {
    const len = rangeEnd.value - effStart.value
    const s = clamp(time - moveOffset, 0, dur.value - len)
    ex.startTime = +s.toFixed(2)
    ex.endTime = +(s + len).toFixed(2)
  }
}
function onBarUp() {
  if (dragMode === 'end' && ex.endTime >= dur.value - 0.05) ex.endTime = 0 // 拖到最右 = 到结尾
  dragMode = null
}

// 按当前播放位置一键设置
function setStartHere() {
  ex.startTime = +curTime.value.toFixed(2)
  if (ex.endTime && ex.endTime <= ex.startTime) ex.endTime = 0
}
function setEndHere() {
  ex.endTime = +Math.max(curTime.value, (ex.startTime || 0) + 0.05).toFixed(2)
}
function clearRange() { ex.startTime = 0; ex.endTime = 0 }

onMounted(() => {
  window.addEventListener('dragover', prevent, false)
  window.addEventListener('drop', prevent, false)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', prevent)
  window.removeEventListener('drop', prevent)
})
function prevent(e) { e.preventDefault() }

defineExpose({ saveProject })
</script>

<template>
  <div>
    <!-- 未导入：拖放区 -->
    <div
      v-if="!state.source.kind"
      class="dropzone"
      :class="{ over: dragOver }"
      @click="pick"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div class="dz-icon">🎞️</div>
      <div class="dz-title">点击选择视频或图片</div>
      <div class="muted">支持 MP4 / MOV / WebM 视频，JPG / PNG / GIF 图片，ZIP 压缩包</div>
      <div class="hint" style="margin-top:4px">也可以拖入文件，多个文件将只导入第 1 个</div>
      <button class="primary" style="margin-top:14px" @click.stop="pick">选择文件</button>
      <div style="margin-top:10px">
        <button class="ghost small" @click.stop="loadDemo">没有素材？载入演示视频</button>
      </div>
      <input ref="fileInput" type="file" accept="video/*,image/*,.zip,.mov,.mp4,.webm,.gif" style="display:none" @change="onPick">
    </div>

    <!-- 已导入视频：预览 + 抽帧设置 -->
    <div v-else class="import-layout">
      <div class="import-left">
        <div class="video-wrap checker">
          <video
            ref="videoEl"
            :src="state.source.videoUrl"
            muted
            loop
            playsinline
            @timeupdate="onTimeUpdate"
            @click="togglePlay"
          ></video>
          <button class="play-overlay" :title="playing ? '暂停' : '播放'" @click="togglePlay">{{ playing ? '⏸' : '▶' }}</button>
        </div>
        <div class="video-controls">
          <span class="frame-indicator">{{ formatTime(curTime) }}</span>
          <input type="range" min="0" :max="dur" step="0.01" :value="curTime" style="flex:1" @input="onSeek">
          <span class="frame-indicator">{{ formatTime(dur) }}</span>
        </div>
        <!-- 提取区间选择条：拖动选择视频区间，与右侧起始/结束时间联动 -->
        <div v-if="dur > 0" class="range-bar" ref="barEl"
          @pointerdown="onBarDown" @pointermove="onBarMove" @pointerup="onBarUp" @pointercancel="onBarUp">
          <div class="range-track"></div>
          <div class="range-sel" :style="{ left: (effStart / dur * 100) + '%', width: ((rangeEnd - effStart) / dur * 100) + '%' }">
            <span class="range-handle" title="拖动调整起点"></span>
            <span class="range-handle right" title="拖动调整终点"></span>
          </div>
          <div class="range-playhead" :style="{ left: (curTime / dur * 100) + '%' }" title="当前播放位置"></div>
        </div>
        <div v-if="dur > 0" class="range-actions">
          <button class="small" @click="setStartHere" title="把当前播放时间设为起始时间">⬅ 设为起点</button>
          <button class="small" @click="setEndHere" title="把当前播放时间设为结束时间">设为终点 ➡</button>
          <button class="small" @click="clearRange">清除区间</button>
          <span class="hint">提取区间 {{ formatTime(effStart) }} – {{ formatTime(rangeEnd) }} · 共 {{ (rangeEnd - effStart).toFixed(1) }}s</span>
        </div>
        <div class="hint" style="text-align:center">{{ state.source.fileName }} · {{ state.source.width }}×{{ state.source.height }}</div>
      </div>

      <div class="import-right">
        <div class="seg" style="margin-bottom:12px">
          <button :class="{ on: ex.mode === 'fps' }" @click="ex.mode = 'fps'">按帧率</button>
          <button :class="{ on: ex.mode === 'interval' }" @click="ex.mode = 'interval'">按间隔</button>
          <button :class="{ on: ex.mode === 'count' }" @click="ex.mode = 'count'">按帧数</button>
          <button :class="{ on: ex.mode === 'all' }" @click="ex.mode = 'all'">全部帧</button>
        </div>

        <div v-if="ex.mode === 'fps'" class="form-row">
          <label>抽帧帧率</label>
          <input v-model.number="ex.fps" type="number" min="0.5" max="120" step="0.5" style="width:90px">
          <span class="hint">每秒抽取的帧数</span>
        </div>
        <div v-if="ex.mode === 'interval'" class="form-row">
          <label>间隔（秒）</label>
          <input v-model.number="ex.interval" type="number" min="0.01" max="10" step="0.01" style="width:90px">
        </div>
        <div v-if="ex.mode === 'count'" class="form-row">
          <label>总帧数</label>
          <input v-model.number="ex.count" type="number" min="1" max="1200" style="width:90px">
        </div>

        <div class="form-row">
          <label>起始时间</label>
          <input v-model.number="ex.startTime" type="number" min="0" :max="dur" step="0.1" style="width:90px">
          <span class="hint">秒</span>
        </div>
        <div class="form-row">
          <label>结束时间</label>
          <input v-model.number="ex.endTime" type="number" min="0" :max="dur" step="0.1" style="width:90px">
          <span class="hint">0 = 到结尾</span>
        </div>
        <div class="hint" style="margin:6px 0 12px">单次最多 {{ ex.maxFrames }} 帧，避免浏览器内存不足</div>

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="primary" :disabled="busy" @click="startExtract">开始提取</button>
          <button v-if="busy" @click="cancelFlag = true">取消</button>
          <button @click="resetSource(); state.source.kind = null">重新选择</button>
        </div>
      </div>
    </div>

    <!-- 抽帧进度 -->
    <div v-if="busy" style="margin-top:14px">
      <div class="progress-track"><div class="progress-fill" :style="{ width: (progress * 100).toFixed(1) + '%' }"></div></div>
      <div class="hint" style="margin-top:4px">{{ progressText || '处理中…' }}</div>
    </div>

    <!-- 精灵图切分 -->
    <SheetSplitDialog
      v-if="showSheetSplit && sheetSrc"
      :source="sheetSrc"
      @apply="onSheetSplit"
      @cancel="showSheetSplit = false; sheetSrc = null"
    />
  </div>
</template>

<style scoped>
.dropzone {
  border: 2px dashed #c9cede; border-radius: 12px; padding: 44px 20px;
  text-align: center; cursor: pointer; transition: border-color .15s, background .15s;
}
.dropzone:hover, .dropzone.over { border-color: var(--accent); background: var(--accent-soft); }
.dz-icon { font-size: 40px; }
.dz-title { font-size: 15px; font-weight: 600; margin: 8px 0 4px; }

.import-layout { display: flex; gap: 20px; flex-wrap: wrap; }
.import-left { flex: 1 1 320px; min-width: 280px; }
.import-right { flex: 0 0 300px; }
.video-wrap {
  position: relative; border-radius: 10px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--line); background: #10121a; min-height: 200px;
}
.video-wrap video { max-width: 100%; max-height: 260px; display: block; }
.play-overlay {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 52px; height: 52px; border-radius: 50%; border: none;
  background: rgba(20, 24, 38, .65); color: #fff; font-size: 20px;
}
.video-controls { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.frame-indicator { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; min-width: 52px; text-align: center; }

/* 提取区间选择条 */
.range-bar {
  position: relative; height: 26px; margin-top: 6px; cursor: pointer;
  touch-action: none; user-select: none;
}
.range-track {
  position: absolute; left: 0; right: 0; top: 11px; height: 4px;
  background: #d9dce8; border-radius: 2px;
}
.range-sel {
  position: absolute; top: 8px; height: 10px;
  background: var(--accent); opacity: .85; border-radius: 5px;
}
.range-handle {
  position: absolute; left: -4px; top: -2px; width: 8px; height: 14px;
  background: var(--accent-strong); border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0,0,0,.3); cursor: ew-resize;
}
.range-handle.right { left: auto; right: -4px; }
.range-playhead {
  position: absolute; top: 3px; width: 2px; height: 20px;
  background: #e5484d; border-radius: 1px; pointer-events: none;
}
.range-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
</style>

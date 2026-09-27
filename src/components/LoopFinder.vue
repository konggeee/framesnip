<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { state, toast } from '../core/state.js'
import { findLoops } from '../core/loopfinder.js'

const emit = defineEmits(['close'])

const searching = ref(false)
const progress = ref(0)
const progressText = ref('')
const candidates = ref([])
const activeIdx = ref(-1)

const pvEl = ref(null)
let pvRaf = 0
let pvIdx = 0
let pvLast = 0
let pvAcc = 0
let pvRange = null

async function search() {
  searching.value = true
  candidates.value = []
  activeIdx.value = -1
  await new Promise(r => setTimeout(r, 50))
  try {
    const canvases = state.frames.map(f => f.canvas)
    candidates.value = await findLoops(canvases, {
      minLen: 4,
      onProgress: (p, t) => { progress.value = p; progressText.value = t || '' },
    })
    if (!candidates.value.length) toast('未找到合适的循环区间，可尝试更长素材', 'warn')
  } finally {
    searching.value = false
  }
}

function pick(i) {
  activeIdx.value = i
  pvRange = candidates.value[i]
  stopPreview()
  startPreview()
}

function startPreview() {
  const el = pvEl.value
  if (!el) return
  const ctx = el.getContext('2d')
  function tick(ts) {
    if (pvRange && state.frames.length) {
      const { start, end } = pvRange
      const len = end - start + 1
      if (pvLast) pvAcc += (ts - pvLast) / 1000
      pvLast = ts
      const frameDur = 1 / state.fps
      while (pvAcc >= frameDur) {
        pvAcc -= frameDur
        pvIdx++
        if (pvIdx >= len) pvIdx = 0
      }
      const f = state.frames[start + pvIdx]
      ctx.clearRect(0, 0, el.width, el.height)
      const s = Math.min(el.width / f.w, el.height / f.h)
      ctx.drawImage(f.canvas, (el.width - f.w * s) / 2, (el.height - f.h * s) / 2, f.w * s, f.h * s)
    } else pvLast = ts
    pvRaf = requestAnimationFrame(tick)
  }
  pvRaf = requestAnimationFrame(tick)
}
function stopPreview() {
  cancelAnimationFrame(pvRaf)
  pvRaf = 0
  pvLast = 0
  pvAcc = 0
  pvIdx = 0
}

function applyTrim() {
  const c = candidates.value[activeIdx.value]
  if (!c) return
  state.frames = state.frames.slice(c.start, c.end + 1)
  state.selection.clear()
  toast(`已裁剪为第 ${c.start + 1} ~ ${c.end + 1} 帧，共 ${state.frames.length} 帧`, 'ok')
  emit('close')
}

onMounted(startPreview)
onBeforeUnmount(stopPreview)
</script>

<template>
  <div class="modal-mask" style="z-index:115" @click.self="emit('close')">
    <div class="modal-card" style="width:620px">
      <div class="modal-head">
        <h3>循环查找</h3>
        <button class="modal-x" @click="emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <div class="muted" style="margin-bottom:10px">
          自动在帧序列中寻找首尾衔接最平滑的子区间，用于把长素材裁剪成无缝循环动画。
        </div>
        <div style="display:flex;gap:14px">
          <div style="flex:1">
            <button class="primary" :disabled="searching" @click="search">
              {{ searching ? '搜索中…' : (candidates.length ? '重新搜索' : '开始搜索') }}
            </button>
            <div v-if="searching" style="margin-top:8px">
              <div class="progress-track"><div class="progress-fill" :style="{ width: (progress * 100).toFixed(0) + '%' }"></div></div>
              <div class="hint" style="margin-top:4px">{{ progressText }}</div>
            </div>
            <div v-if="candidates.length" class="cand-list">
              <div
                v-for="(c, i) in candidates"
                :key="i"
                class="cand-item"
                :class="{ on: activeIdx === i }"
                @click="pick(i)"
              >
                <div style="font-weight:600">候选 {{ i + 1 }}：第 {{ c.start + 1 }} ~ {{ c.end + 1 }} 帧</div>
                <div class="hint">长度 {{ c.end - c.start + 1 }} 帧 · 周期 {{ c.period }} · 平滑度 {{ c.score.toFixed(4) }}（越小越平滑）</div>
              </div>
            </div>
            <div v-if="!searching && !candidates.length && progress > 0" class="hint" style="margin-top:8px">无候选结果</div>
          </div>
          <div style="flex:0 0 220px">
            <div class="checker" style="border-radius:10px;border:1px solid var(--line);height:200px;display:flex;align-items:center;justify-content:center;overflow:hidden">
              <canvas ref="pvEl" width="200" height="180"></canvas>
            </div>
            <div class="hint" style="text-align:center;margin-top:4px">候选区间循环预览</div>
            <button v-if="activeIdx >= 0" class="primary" style="width:100%;margin-top:8px" @click="applyTrim">裁剪到该区间</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cand-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow: auto; }
.cand-item {
  border: 1.5px solid var(--line); border-radius: 9px; padding: 8px 12px; cursor: pointer;
}
.cand-item:hover { border-color: #b9bed0; }
.cand-item.on { border-color: var(--accent); background: var(--accent-soft); }
</style>

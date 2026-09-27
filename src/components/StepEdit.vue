<script setup>
import { ref, computed } from 'vue'
import { state, removeFrames, clearFrames, toast, confirmDialog } from '../core/state.js'
import { nextId } from '../core/util.js'
import { analyzeDedupe } from '../core/dedupe.js'
import { rotate90, flip } from '../core/imageops.js'
import FrameGrid from './FrameGrid.vue'
import PreviewPlayer from './PreviewPlayer.vue'

const emit = defineEmits(['edit', 'loopfinder'])

const hasFrames = computed(() => state.frames.length > 0)
const hasSel = computed(() => state.selection.size > 0)

// ---- 选择类 ----
function selectAll() {
  if (state.selection.size === state.frames.length) state.selection.clear()
  else state.frames.forEach(f => state.selection.add(f.id))
}
function invertSel() {
  const ids = state.frames.map(f => f.id)
  const next = ids.filter(id => !state.selection.has(id))
  state.selection.clear()
  next.forEach(id => state.selection.add(id))
}
function selIds() { return [...state.selection] }

async function deleteSelected() {
  if (!hasSel.value) return toast('先选中要删除的帧', 'warn')
  const ok = await confirmDialog({ title: '删除帧', body: `确定删除选中的 ${state.selection.size} 帧吗？`, danger: true })
  if (!ok) return
  removeFrames(selIds())
}

function duplicateSelected() {
  if (!hasSel.value) return toast('先选中要复制的帧', 'warn')
  const out = []
  for (const f of state.frames) {
    out.push(f)
    if (state.selection.has(f.id)) {
      const c = document.createElement('canvas')
      c.width = f.w; c.height = f.h
      c.getContext('2d').drawImage(f.canvas, 0, 0)
      out.push({
        id: nextId(),
        name: f.name + ' 副本',
        canvas: c,
        w: f.w,
        h: f.h,
        edited: false,
        rev: 0,
      })
    }
  }
  state.frames = out
}

function reverseOrder() {
  state.frames = state.frames.slice().reverse()
}

// ---- 变换类（作用于选中帧；未选中则全部） ----
function targetIndices() {
  return hasSel.value
    ? state.frames.map((f, i) => (state.selection.has(f.id) ? i : -1)).filter(i => i >= 0)
    : state.frames.map((_, i) => i)
}

function rotateTargets() {
  const idx = targetIndices()
  idx.forEach(i => {
    const f = state.frames[i]
    f.canvas = rotate90(f.canvas, true)
    f.w = f.canvas.width; f.h = f.canvas.height
    f.edited = true; f.rev = (f.rev || 0) + 1
  })
  toast(`已旋转 ${idx.length} 帧（90° 顺时针）`, 'ok')
}
function flipTargets(horizontal) {
  const idx = targetIndices()
  idx.forEach(i => {
    const f = state.frames[i]
    f.canvas = flip(f.canvas, horizontal)
    f.edited = true; f.rev = (f.rev || 0) + 1
  })
  toast(`已${horizontal ? '水平' : '垂直'}翻转 ${idx.length} 帧`, 'ok')
}

// ---- 智能去重 ----
const dedupeOpen = ref(false)
const dedupeThreshold = ref(0.012)
const dedupeResult = ref(null)
const dedupeBusy = ref(false)

async function openDedupe() {
  if (state.frames.length < 2) return toast('至少需要 2 帧才能去重', 'warn')
  dedupeOpen.value = true
  dedupeResult.value = null
}
async function runDedupe() {
  dedupeBusy.value = true
  await new Promise(r => setTimeout(r, 30))
  try {
    const frames = state.frames.map(f => f.canvas)
    dedupeResult.value = analyzeDedupe(frames, dedupeThreshold.value)
  } finally {
    dedupeBusy.value = false
  }
}
async function applyDedupe() {
  const { keepFlags } = dedupeResult.value
  const ids = state.frames.filter((f, i) => !keepFlags[i]).map(f => f.id)
  removeFrames(new Set(ids))
  dedupeOpen.value = false
  toast(`已移除 ${ids.length} 帧重复帧`, 'ok')
}

async function clearAll() {
  if (!hasFrames.value) return
  const ok = await confirmDialog({ title: '清空全部帧', body: '将删除全部帧，此操作不可撤销。', danger: true })
  if (ok) clearFrames()
}

function trimToSelection() {
  if (!hasSel.value) return toast('先选中要保留的帧', 'warn')
  const keep = new Set(state.selection)
  state.frames = state.frames.filter(f => keep.has(f.id))
  state.selection.clear()
  toast(`已裁剪，保留 ${state.frames.length} 帧`, 'ok')
}
</script>

<template>
  <div class="edit-layout">
    <div class="edit-main">
      <!-- 快捷操作 -->
      <div class="quick-actions">
        <button class="small" :disabled="!hasFrames" @click="selectAll">全选</button>
        <button class="small" :disabled="!hasFrames" @click="invertSel">反选</button>
        <button class="small danger" :disabled="!hasSel" @click="deleteSelected">删除选中</button>
        <button class="small" :disabled="!hasSel" @click="duplicateSelected">复制选中</button>
        <button class="small" :disabled="!hasFrames" @click="reverseOrder">反转顺序</button>
        <span class="va-sep"></span>
        <button class="small" :disabled="!hasFrames" title="选中帧（未选则全部）旋转 90°" @click="rotateTargets">旋转 90°</button>
        <button class="small" :disabled="!hasFrames" @click="flipTargets(true)">水平镜像</button>
        <button class="small" :disabled="!hasFrames" @click="flipTargets(false)">垂直镜像</button>
        <span class="va-sep"></span>
        <button class="small" :disabled="state.frames.length < 2" @click="openDedupe">智能去重</button>
        <button class="small" :disabled="state.frames.length < 4" @click="emit('loopfinder')">循环查找</button>
        <button class="small" :disabled="!hasSel" title="保留选中帧，删除其余" @click="trimToSelection">裁剪到选中</button>
        <span class="flex-sp"></span>
        <button class="small danger" :disabled="!hasFrames" @click="clearAll">清空</button>
      </div>
      <div class="hint" style="margin:8px 2px">
        已选 {{ state.selection.size }} / {{ state.frames.length }} 帧 · 拖拽可排序 · 单击选中（Ctrl 多选 / Shift 范围选）· 双击进入编辑器
      </div>
      <div class="grid-scroll card" style="padding:12px">
        <FrameGrid @edit="i => emit('edit', i)" />
      </div>
    </div>

    <div class="edit-side">
      <div class="muted" style="font-weight:600;margin-bottom:8px">预览</div>
      <PreviewPlayer />
    </div>
  </div>

  <!-- 智能去重弹窗 -->
  <div v-if="dedupeOpen" class="modal-mask" style="z-index:110" @click.self="dedupeOpen = false">
    <div class="modal-card" style="width:420px">
      <div class="modal-head"><h3>智能去重</h3>
        <button class="modal-x" @click="dedupeOpen = false">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label>相似阈值</label>
          <input v-model.number="dedupeThreshold" type="range" min="0.002" max="0.06" step="0.001" style="flex:1" @change="dedupeResult = null">
          <span class="slider-val">{{ dedupeThreshold.toFixed(3) }}</span>
        </div>
        <div class="hint">阈值越高，移除越激进。相邻两帧在 32×32 缩略采样下平均差异低于阈值时判定为重复。</div>
        <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
          <button class="primary" :disabled="dedupeBusy" @click="runDedupe">{{ dedupeBusy ? '分析中…' : (dedupeResult ? '重新分析' : '开始分析') }}</button>
          <span v-if="dedupeResult" class="muted">
            预计保留 <b>{{ dedupeResult.kept }}</b> 帧，移除 <b>{{ dedupeResult.removed }}</b> 帧
          </span>
        </div>
      </div>
      <div class="modal-foot">
        <button @click="dedupeOpen = false">取消</button>
        <button class="primary" :disabled="!dedupeResult || dedupeBusy" @click="applyDedupe">应用移除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.edit-layout { display: flex; gap: 18px; align-items: flex-start; }
.edit-main { flex: 1 1 auto; min-width: 0; }
.edit-side { flex: 0 0 440px; position: sticky; top: 16px; }
.quick-actions {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 4px;
}
.va-sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
.flex-sp { flex: 1; }
.grid-scroll { max-height: 560px; overflow: auto; }
@media (max-width: 1080px) {
  .edit-layout { flex-direction: column-reverse; }
  .edit-side { flex: 1 1 auto; position: static; width: 100%; }
}
</style>

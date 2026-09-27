<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Sortable from 'sortablejs'
import { state } from '../core/state.js'

const emit = defineEmits(['edit'])
const gridEl = ref(null)
let sortable = null

const THUMB = 96

function drawThumb(canvas, frame) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const scale = Math.min(canvas.width / frame.w, canvas.height / frame.h)
  const w = frame.w * scale, h = frame.h * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(frame.canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
}

function refreshThumbs() {
  nextTick(() => {
    const items = gridEl.value ? gridEl.value.querySelectorAll('canvas.thumb') : []
    items.forEach(cv => {
      const id = Number(cv.dataset.id)
      const f = state.frames.find(f => f.id === id)
      if (f) drawThumb(cv, f)
    })
  })
}

watch(() => state.frames.length, refreshThumbs)
watch(() => state.frames.map(f => f.rev || 0).join(','), refreshThumbs)

onMounted(() => {
  sortable = Sortable.create(gridEl.value, {
    animation: 150,
    draggable: '.frame-item',
    filter: 'input',
    onEnd(evt) {
      const { oldIndex, newIndex } = evt
      if (oldIndex === newIndex) return
      const [moved] = state.frames.splice(oldIndex, 1)
      state.frames.splice(newIndex, 0, moved)
    },
  })
  refreshThumbs()
})
onBeforeUnmount(() => { sortable && sortable.destroy() })

function clickItem(e, f, i) {
  if (e.shiftKey && state.selection.size) {
    const ids = state.frames.map(f => f.id)
    const last = [...state.selection].pop()
    const a = ids.indexOf(last), b = i
    const [lo, hi] = a < b ? [a, b] : [b, a]
    for (let k = lo; k <= hi; k++) state.selection.add(ids[k])
  } else if (e.ctrlKey || e.metaKey) {
    if (state.selection.has(f.id)) state.selection.delete(f.id)
    else state.selection.add(f.id)
  } else {
    state.selection.clear()
    state.selection.add(f.id)
  }
}

function has(id) { return state.selection.has(id) }
</script>

<template>
  <div ref="gridEl" class="frame-grid">
    <div
      v-for="(f, i) in state.frames"
      :key="f.id"
      class="frame-item"
      :class="{ selected: has(f.id) }"
      :data-id="f.id"
      :title="`${f.name}（双击编辑）`"
      @click="clickItem($event, f, i)"
      @dblclick="emit('edit', i)"
    >
      <canvas class="thumb checker" width="96" height="96" :data-id="f.id"></canvas>
      <span class="frame-no">{{ i + 1 }}</span>
      <span v-if="f.edited" class="frame-edited" title="已编辑">✏</span>
    </div>
    <div v-if="!state.frames.length" class="hint" style="padding:20px">还没有帧，先在步骤 1 导入</div>
  </div>
</template>

<style scoped>
.frame-grid {
  display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start;
  min-height: 120px;
}
.frame-item {
  position: relative; width: 104px; height: 104px; border-radius: 9px;
  border: 2px solid var(--line); background: #fafbfd; cursor: grab;
  display: flex; align-items: center; justify-content: center;
  transition: border-color .12s, box-shadow .12s;
}
.frame-item:hover { border-color: #b9bed0; }
.frame-item.selected { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(91,91,214,.25); }
.frame-item canvas.thumb { width: 96px; height: 96px; border-radius: 6px; pointer-events: none; }
.frame-no {
  position: absolute; left: 4px; top: 4px; background: rgba(30,34,48,.72); color: #fff;
  font-size: 10.5px; padding: 0 5px; border-radius: 5px; pointer-events: none;
  font-variant-numeric: tabular-nums;
}
.frame-edited { position: absolute; right: 4px; top: 4px; font-size: 11px; pointer-events: none; }
.sortable-ghost { opacity: .4; }
.sortable-chosen { cursor: grabbing; }
</style>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { state } from '../core/state.js'

const canvasEl = ref(null)
const playing = ref(false)
const idx = ref(0)
const raf = ref(0)
const lastTs = ref(0)
const acc = ref(0)

const total = computed(() => state.frames.length)
const duration = computed(() => total.value ? total.value / state.fps : 0)

function draw() {
  const c = canvasEl.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  const f = state.frames[idx.value]
  if (!f) return
  const scale = Math.min(c.width / f.w, c.height / f.h)
  const w = f.w * scale, h = f.h * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(f.canvas, (c.width - w) / 2, (c.height - h) / 2, w, h)
}

function tick(ts) {
  if (playing.value && total.value) {
    if (lastTs.value) acc.value += (ts - lastTs.value) / 1000
    lastTs.value = ts
    const frameDur = 1 / state.fps
    while (acc.value >= frameDur) {
      acc.value -= frameDur
      idx.value++
      if (idx.value >= total.value) {
        if (state.loop) idx.value = 0
        else { idx.value = total.value - 1; playing.value = false; acc.value = 0 }
      }
    }
  } else {
    lastTs.value = ts
  }
  draw()
  raf.value = requestAnimationFrame(tick)
}

function toggle() {
  if (!total.value) return
  playing.value = !playing.value
  if (playing.value && idx.value >= total.value - 1) idx.value = 0
  acc.value = 0
}

function step(d) {
  playing.value = false
  if (!total.value) return
  idx.value = (idx.value + d + total.value) % total.value
}

watch(() => state.frames.length, () => {
  if (idx.value >= total.value) idx.value = Math.max(0, total.value - 1)
})

onMounted(() => { raf.value = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(raf.value))

defineExpose({ toggle, step })
</script>

<template>
  <div class="player">
    <div class="player-canvas-wrap checker">
      <canvas ref="canvasEl" width="420" height="300"></canvas>
      <div v-if="!total" class="hint" style="position:absolute">暂无帧</div>
    </div>
    <div class="player-controls">
      <button class="small" :disabled="!total" @click="step(-1)">◀</button>
      <button class="small primary" :disabled="!total" @click="toggle">{{ playing ? '⏸' : '▶' }}</button>
      <button class="small" :disabled="!total" @click="step(1)">▶</button>
      <span class="frame-indicator">{{ idx + 1 }} / {{ total || 0 }}</span>
      <input v-model.number="idx" type="range" min="0" :max="Math.max(0, total - 1)" :disabled="!total" style="flex:1">
    </div>
    <div class="player-controls">
      <span class="muted" style="width:56px">帧率</span>
      <input v-model.number="state.fps" type="range" min="1" max="60" step="1" style="flex:1">
      <span class="slider-val">{{ state.fps }} fps</span>
      <label class="muted" style="display:flex;align-items:center;gap:4px">
        <input v-model="state.loop" type="checkbox"> 循环
      </label>
    </div>
    <div class="hint" style="text-align:center">时长 {{ duration.toFixed(2) }}s · {{ total }} 帧</div>
  </div>
</template>

<style scoped>
.player { display: flex; flex-direction: column; gap: 8px; }
.player-canvas-wrap {
  position: relative; border-radius: 10px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--line); height: 300px;
}
.player-canvas-wrap canvas { max-width: 100%; max-height: 100%; }
.player-controls { display: flex; align-items: center; gap: 8px; }
.frame-indicator { font-size: 12.5px; color: var(--text-2); font-variant-numeric: tabular-nums; min-width: 66px; text-align: center; }
</style>

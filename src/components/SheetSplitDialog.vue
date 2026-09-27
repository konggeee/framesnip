<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { splitSpriteSheet } from '../core/importer.js'

const props = defineProps({ source: { type: Object, required: true } })
const emit = defineEmits(['apply', 'cancel'])

const rows = ref(1)
const cols = ref(1)
const order = ref('row')
const trim = ref(true)
const threshold = ref(8)

// 猜测近方形网格
watch(() => props.source, src => {
  if (!src) return
  const ratio = src.width / src.height
  let bestCols = 1
  let bestErr = Infinity
  for (let c = 1; c <= Math.min(src.width, 64); c++) {
    const r = Math.max(1, Math.round(c / ratio))
    const cellW = src.width / c, cellH = src.height / r
    const err = Math.abs(Math.log(cellW / cellH)) + Math.abs(c * r - c * r)
    if (err < bestErr) { bestErr = err; bestCols = c }
  }
  cols.value = bestCols
  rows.value = Math.max(1, Math.round(bestCols / ratio))
}, { immediate: true })

const previewEl = ref(null)

function renderPreview() {
  const el = previewEl.value
  if (!el) return
  el.innerHTML = ''
  let cells = []
  try {
    cells = splitSpriteSheet(props.source, {
      rows: Math.max(1, rows.value | 0),
      cols: Math.max(1, cols.value | 0),
      order: order.value,
      trim: trim.value,
      alphaThreshold: threshold.value,
    })
  } catch (e) { /* 参数无效 */ }
  const max = 60
  cells.slice(0, max).forEach(c => {
    const cv = document.createElement('canvas')
    cv.width = 64; cv.height = 64
    cv.className = 'checker'
    const ctx = cv.getContext('2d')
    const s = Math.min(64 / c.width, 64 / c.height)
    ctx.drawImage(c, (64 - c.width * s) / 2, (64 - c.height * s) / 2, c.width * s, c.height * s)
    el.appendChild(cv)
  })
  return cells
}

let lastCount = 0
function preview() {
  const cells = renderPreview()
  lastCount = cells ? cells.length : 0
}

watch([rows, cols, order, trim, threshold], preview, { immediate: false })
onMounted(preview)

function apply() {
  try {
    const cells = splitSpriteSheet(props.source, {
      rows: Math.max(1, rows.value | 0),
      cols: Math.max(1, cols.value | 0),
      order: order.value,
      trim: trim.value,
      alphaThreshold: threshold.value,
    })
    emit('apply', cells)
  } catch (e) {
    emit('apply', null)
  }
}
</script>

<template>
  <div class="modal-mask" style="z-index:110" @click.self="emit('cancel')">
    <div class="modal-card" style="width:640px">
      <div class="modal-head">
        <h3>精灵图切分</h3>
        <button class="modal-x" @click="emit('cancel')">✕</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="flex:0 0 240px">
            <div class="form-row"><label>列数</label>
              <input v-model.number="cols" type="number" min="1" max="128" style="width:80px"></div>
            <div class="form-row"><label>行数</label>
              <input v-model.number="rows" type="number" min="1" max="128" style="width:80px"></div>
            <div class="form-row"><label>排列顺序</label>
              <div class="seg">
                <button :class="{ on: order === 'row' }" @click="order = 'row'">行优先</button>
                <button :class="{ on: order === 'col' }" @click="order = 'col'">列优先</button>
              </div>
            </div>
            <div class="form-row">
              <label>裁剪空白</label>
              <label class="muted" style="display:flex;align-items:center;gap:5px">
                <input v-model="trim" type="checkbox"> 去除单元格透明边缘
              </label>
            </div>
            <div v-if="trim" class="form-row">
              <label>透明阈值</label>
              <input v-model.number="threshold" type="range" min="1" max="128" style="flex:1">
              <span class="slider-val">{{ threshold }}</span>
            </div>
            <div class="hint">原图 {{ source.width }}×{{ source.height }}，切分后 {{ lastCount }} 格</div>
          </div>
          <div style="flex:1;min-width:240px">
            <div class="muted" style="margin-bottom:6px">预览（最多显示 60 格）</div>
            <div ref="previewEl" class="cell-preview"></div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button @click="emit('cancel')">取消</button>
        <button class="primary" @click="apply">切分并导入</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cell-preview { display: flex; flex-wrap: wrap; gap: 6px; max-height: 260px; overflow: auto; }
.cell-preview canvas { width: 64px; height: 64px; border: 1px solid var(--line); border-radius: 6px; }
</style>

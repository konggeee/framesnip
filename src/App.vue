<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { state, ui, toast, confirmDialog, clearFrames, resetSource } from './core/state.js'
import { brand } from './core/brand.js'
import { formatBytes } from './core/util.js'
import StepImport from './components/StepImport.vue'
import StepEdit from './components/StepEdit.vue'
import StepExport from './components/StepExport.vue'
import FrameEditor from './components/FrameEditor.vue'
import LoopFinder from './components/LoopFinder.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import ShortcutsHelp from './components/ShortcutsHelp.vue'

const editorOpen = ref(false)
const loopFinderOpen = ref(false)
const stepExportRef = ref(null)
const ossOpen = ref(false)
const projectRestore = ref(null)

const hasFrames = computed(() => state.frames.length > 0)

function openEditor(i) {
  if (!hasFrames.value) return
  state.editingIndex = i
  editorOpen.value = true
}

// 全局快捷键：? 帮助、空格播放（交给播放器内部处理）
function onKey(e) {
  if (e.target.tagName === 'INPUT' || editorOpen.value) return
  if (e.key === '?') ui.shortcutsOpen = true
  if (e.key === 'Escape') {
    if (loopFinderOpen.value) loopFinderOpen.value = false
  }
}
onMounted(() => window.addEventListener('keydown', onKey))

// 恢复内嵌工程（.fp.html 双击打开）
onMounted(async () => {
  const { loadEmbeddedProject, restoreFramesFromProject } = await import('./core/project.js')
  const data = loadEmbeddedProject()
  if (!data) return
  projectRestore.value = data
  const ok = await confirmDialog({
    title: `检测到 ${brand.name} 工程`,
    body: `该文件内嵌了 ${data.frames.length} 帧（保存于 ${new Date(data.savedAt).toLocaleString()}），要载入吗？`,
  })
  projectRestore.value = null
  if (!ok) return
  state.busy = { text: '恢复工程中…', progress: 0 }
  try {
    const frames = await restoreFramesFromProject(data, {
      onProgress: (p, t) => { state.busy.progress = p; state.busy.text = t },
    })
    clearFrames()
    resetSource()
    frames.forEach(f => {
      const item = { id: Date.now() + Math.random(), name: f.name, canvas: f.canvas, w: f.w, h: f.h, edited: false, rev: 0 }
      state.frames.push(item)
    })
    state.fps = data.fps || 12
    state.loop = data.loop !== false
    toast(`工程已恢复：${frames.length} 帧 @ ${state.fps}fps`, 'ok')
  } catch (e) {
    toast('工程恢复失败：' + e.message, 'error')
  } finally {
    state.busy = null
  }
})

// 步骤折叠状态
const step2Open = ref(true)
const step3Open = ref(true)
watch(hasFrames, v => { if (v) { step2Open.value = true } })

const OSS = [
  { name: 'vue', license: 'MIT', copyright: 'Copyright (c) 2013-present, Yuxi (Evan) You and Vue contributors' },
  { name: 'vite', license: 'MIT', copyright: 'Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors' },
  { name: 'sortablejs', license: 'MIT', copyright: 'Copyright 2013-2023 Levan Katsadze and contributors to Sortable' },
  { name: 'mp4box.js', license: 'BSD-3-Clause', copyright: 'Copyright (c) GPAC' },
  { name: 'mp4-muxer', license: 'MIT', copyright: 'Copyright (c) Vanilagy' },
  { name: 'webm-muxer', license: 'MIT', copyright: 'Copyright (c) Vanilagy' },
  { name: 'gifenc', license: 'MIT', copyright: 'Copyright (c) 2019 Mat Groves' },
  { name: 'upng-js', license: 'MIT', copyright: 'Photopea / Ivan Kutskir' },
  { name: 'jszip', license: 'MIT OR GPL-3.0', copyright: 'Copyright (c) 2009-2016 Stuart Knightley, David Duponchel' },
  { name: 'mediapipe selfie segmentation', license: 'Apache-2.0', copyright: 'Copyright (c) 2021 The MediaPipe Authors' },
]
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <div class="brand-icon">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
              <stop offset="1" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="M3 8h10.5L16.5 26H3z" fill="#fff" opacity=".95"/>
          <path d="M16.5 6H29v18h-9.5z" fill="#fff" opacity=".78"/>
          <circle cx="6.2" cy="13" r="1.4" fill="url(#brand-g)" stroke="#fff" stroke-opacity=".55"/>
          <circle cx="10.5" cy="20.5" r="1.4" fill="url(#brand-g)" stroke="#fff" stroke-opacity=".55"/>
          <circle cx="24.5" cy="11" r="1.6" fill="url(#brand-g)" stroke="#fff" stroke-opacity=".55"/>
          <path d="M14.3 3L18.7 29" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 2.5" stroke-linecap="round" opacity=".92"/>
        </svg>
      </div>
      <div>
        <div class="brand-name">{{ brand.nameZh }} <span>{{ brand.name }}</span></div>
        <div class="brand-sub">{{ brand.tagline }}</div>
      </div>
    </div>
    <div class="header-actions">
      <button class="small" @click="ui.shortcutsOpen = true">快捷键</button>
      <button class="small ghost" @click="ossOpen = true">开源许可</button>
    </div>
  </header>

  <div class="tip-bar">
    💡 {{ brand.name }} 依赖浏览器解码视频，推荐使用电脑端 Chrome / Edge / Safari 获得最佳兼容性
  </div>

  <main class="app-main">
    <!-- 步骤 1 -->
    <section class="card step-card">
      <div class="step-head">
        <div class="step-title">
          <span class="step-no active">1</span>
          <h2>帧提取</h2>
          <span class="muted" v-if="state.source.fileName">{{ state.source.fileName }}</span>
        </div>
        <div class="step-head-actions">
          <button class="small" :disabled="!hasFrames" title="保存为可双击恢复的 .fp.html 工程文件" @click="$refs.stepImport && $refs.stepImport.saveProject()">保存工程</button>
        </div>
      </div>
      <div class="step-body">
        <StepImport ref="stepImport" />
      </div>
    </section>

    <!-- 步骤 2 -->
    <section class="card step-card" :class="{ locked: !hasFrames }">
      <div class="step-head" style="cursor:pointer" @click="hasFrames && (step2Open = !step2Open)">
        <div class="step-title">
          <span class="step-no" :class="{ active: hasFrames }">2</span>
          <h2>编辑与整理</h2>
          <span class="muted" v-if="hasFrames">{{ state.frames.length }} 帧 @ {{ state.fps }} fps</span>
        </div>
        <span class="muted" v-if="!hasFrames">先完成帧提取</span>
        <span v-else class="muted">{{ step2Open ? '收起 ▲' : '展开 ▼' }}</span>
      </div>
      <div v-if="hasFrames && step2Open" class="step-body">
        <StepEdit @edit="openEditor" @loopfinder="loopFinderOpen = true" />
      </div>
    </section>

    <!-- 步骤 3 -->
    <section class="card step-card" :class="{ locked: !hasFrames }">
      <div class="step-head" style="cursor:pointer" @click="hasFrames && (step3Open = !step3Open)">
        <div class="step-title">
          <span class="step-no" :class="{ active: hasFrames }">3</span>
          <h2>导出</h2>
          <span class="muted" v-if="hasFrames">GIF · APNG · PNG 序列 · 精灵图 · WebM · MP4</span>
        </div>
        <span class="muted" v-if="!hasFrames">先完成帧提取</span>
        <span v-else class="muted">{{ step3Open ? '收起 ▲' : '展开 ▼' }}</span>
      </div>
      <div v-if="hasFrames && step3Open" class="step-body">
        <StepExport ref="stepExportRef" />
      </div>
    </section>
  </main>

    <footer class="app-footer">
      <div>{{ brand.nameZh }} <span>{{ brand.name }}</span> · Made with ❤️ by <b>{{ brand.author }}</b> · 全部解码与编码均在浏览器本地完成，素材不会上传</div>
      <div class="muted" style="margin-top:4px">
        基于开源项目：Vue · Vite · sortablejs · mp4box.js · mp4-muxer · webm-muxer · gifenc · upng-js · jszip · MediaPipe
      </div>
    </footer>

  <!-- 全局编辑器 -->
  <FrameEditor v-if="editorOpen" @close="editorOpen = false" />

  <!-- 循环查找 -->
  <LoopFinder v-if="loopFinderOpen" @close="loopFinderOpen = false" />

  <!-- 全局忙状态 -->
  <transition name="fade">
    <div v-if="state.busy" class="modal-mask" style="z-index:170">
      <div class="modal-card" style="width:360px;padding:22px;text-align:center">
        <div style="font-weight:600;margin-bottom:10px">{{ state.busy.text || '处理中…' }}</div>
        <div class="progress-track"><div class="progress-fill" :style="{ width: ((state.busy.progress || 0) * 100).toFixed(1) + '%' }"></div></div>
      </div>
    </div>
  </transition>

  <!-- 开源许可 -->
  <transition name="fade">
    <div v-if="ossOpen" class="modal-mask" style="z-index:140" @click.self="ossOpen = false">
      <div class="modal-card" style="width:460px">
        <div class="modal-head"><h3>开源许可</h3>
          <button class="modal-x" @click="ossOpen = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="muted" style="margin-bottom:10px">本项目（功能复刻练手）使用了以下开源项目：</div>
          <div v-for="o in OSS" :key="o.name" class="oss-item">
            <div class="oss-row">
              <code>{{ o.name }}</code>
              <span class="oss-badge">{{ o.license }}</span>
            </div>
            <div class="hint">{{ o.copyright }}</div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="primary" @click="ossOpen = false">确定</button>
        </div>
      </div>
    </div>
  </transition>

  <ToastHost />
  <ConfirmHost />
  <ShortcutsHelp />
</template>

<style scoped>
.app-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 22px; background: #fff; border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 12px; }
.brand-icon {
  width: 42px; height: 42px; border-radius: 11px;
  background: linear-gradient(135deg, #6d5df1, #38bdf8);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(91,91,214,.35);
}
.brand-name { font-size: 18px; font-weight: 800; letter-spacing: .2px; }
.brand-name span { color: var(--accent); }
.brand-sub { font-size: 12px; color: var(--text-2); }
.header-actions { display: flex; gap: 8px; align-items: center; }

.tip-bar {
  background: var(--blue-soft); color: var(--blue-text);
  font-size: 13px; padding: 8px 22px;
}

.app-main {
  flex: 1; width: 100%; max-width: 1280px; margin: 0 auto;
  padding: 18px 22px; display: flex; flex-direction: column; gap: 16px;
}

.step-card { overflow: hidden; }
.step-card.locked { opacity: .62; }
.step-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid var(--line);
}
.step-card.locked .step-head { border-bottom: none; }
.step-title { display: flex; align-items: center; gap: 12px; }
.step-title h2 { margin: 0; font-size: 16px; }
.step-no {
  width: 26px; height: 26px; border-radius: 50%; background: #e3e5ee; color: var(--text-3);
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;
}
.step-no.active { background: var(--accent); color: #fff; }
.step-head-actions { display: flex; gap: 8px; }
.step-body { padding: 16px 18px; }

.app-footer {
  text-align: center; color: var(--text-2); font-size: 12.5px;
  padding: 18px 20px 26px;
}
.app-footer span { color: var(--accent); font-weight: 700; }

.oss-item { border: 1px solid var(--line); border-radius: 9px; padding: 9px 12px; margin-bottom: 8px; }
.oss-row { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.oss-row code { font-weight: 700; font-size: 13px; }
.oss-badge {
  font-size: 11px; color: var(--accent-strong); background: var(--accent-soft);
  padding: 1px 8px; border-radius: 999px; font-weight: 600;
}
</style>

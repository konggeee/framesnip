<script setup>
import { ui } from '../core/state.js'

const groups = [
  {
    title: '通用',
    items: [
      { keys: '空格', label: '播放 / 暂停预览' },
      { keys: '← / →', label: '上一帧 / 下一帧' },
      { keys: '?', label: '打开本帮助' },
    ],
  },
  {
    title: '编辑器',
    items: [
      { keys: 'B / E / G / I / M / W', label: '画笔 / 橡皮 / 填充 / 吸管 / 魔棒 / 去水印笔' },
      { keys: '[ / ]', label: '画笔大小 - / +' },
      { keys: 'Ctrl+Z / Ctrl+Y', label: '撤销 / 重做' },
      { keys: 'Ctrl+ +/-', label: '缩放画布' },
      { keys: '0', label: '适应窗口' },
      { keys: '1', label: '100% 像素' },
      { keys: '空格+拖动', label: '平移画布' },
    ],
  },
]
</script>

<template>
  <transition name="fade">
    <div v-if="ui.shortcutsOpen" class="modal-mask" style="z-index:160" @click.self="ui.shortcutsOpen = false">
      <div class="modal-card" style="width:440px">
        <div class="modal-head">
          <h3>键盘快捷键</h3>
          <button class="modal-x" @click="ui.shortcutsOpen = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-for="g in groups" :key="g.title" style="margin-bottom:14px">
            <div class="muted" style="font-weight:600;margin-bottom:6px">{{ g.title }}</div>
            <div v-for="it in g.items" :key="it.keys" class="sc-row">
              <span class="kbd">{{ it.keys }}</span>
              <span class="muted">{{ it.label }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.sc-row { display: flex; align-items: center; gap: 10px; margin: 5px 0; }
.sc-row .kbd { min-width: 130px; text-align: center; }
</style>

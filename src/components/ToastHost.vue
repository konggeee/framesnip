<script setup>
import { ui } from '../core/state.js'
</script>

<template>
  <div class="toast-host">
    <transition-group name="fade">
      <div v-for="t in ui.toasts" :key="t.id" class="toast-item" :class="t.type">{{ t.text }}</div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
  z-index: 200; display: flex; flex-direction: column; gap: 8px; align-items: center;
  pointer-events: none;
}
.toast-item {
  background: #2b2f3d; color: #fff; padding: 9px 18px; border-radius: 9px;
  font-size: 13px; box-shadow: 0 6px 20px rgba(10,14,25,.3); max-width: 72vw;
}
.toast-item.warn { background: #8a5a12; }
.toast-item.error { background: #b3383c; }
.toast-item.ok { background: #237a55; }
</style>

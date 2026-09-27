<script setup>
import { ui, toast } from '../core/state.js'

function close(ok) {
  ui.confirmState.resolve(ok)
  ui.confirmState = null
}
</script>

<template>
  <transition name="fade">
    <div v-if="ui.confirmState" class="modal-mask" style="z-index:150" @click.self="close(false)">
      <div class="modal-card" style="width:380px">
        <div class="modal-head"><h3>{{ ui.confirmState.title }}</h3></div>
        <div class="modal-body" style="white-space:pre-wrap;color:var(--text-2)">{{ ui.confirmState.body }}</div>
        <div class="modal-foot">
          <button @click="close(false)">取消</button>
          <button :class="ui.confirmState.danger ? 'danger' : 'primary'" @click="close(true)">
            {{ ui.confirmState.danger ? '删除' : '确定' }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

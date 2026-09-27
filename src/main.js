import { createApp } from 'vue'
import App from './App.vue'
import './styles/global.css'

createApp(App).mount('#app')

// 开发模式测试钩子（构建不打包）：供自动化测试直接调用核心模块
if (import.meta.env.DEV) {
  const { state } = await import('./core/state.js')
  const mods = {
    gif: () => import('./core/encode/gif.js'),
    apng: () => import('./core/encode/apng.js'),
    zip: () => import('./core/encode/zip.js'),
    sheet: () => import('./core/encode/sheet.js'),
    video: () => import('./core/encode/video.js'),
    dedupe: () => import('./core/dedupe.js'),
    loop: () => import('./core/loopfinder.js'),
    importer: () => import('./core/importer.js'),
    project: () => import('./core/project.js'),
  }
  window.__ff = {
    state,
    async call(modName, fnName, ...args) {
      const mod = await mods[modName]()
      const t0 = performance.now()
      const out = await mod[fnName](...args)
      return { ms: Math.round(performance.now() - t0), out }
    },
  }
}

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 相对 base：构建产物可部署在任意路径（根路径 / 子路径均可），便于各类服务器托管
  base: './',
  server: { port: 5180, strictPort: true, host: '127.0.0.1' },
  build: { chunkSizeWarningLimit: 2048 }
})

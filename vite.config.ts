import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src/renderer',
  publicDir: 'public',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium')
  },
  server: {
    port: 5173,
    strictPort: true
  }
})

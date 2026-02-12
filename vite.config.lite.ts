import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Vite config for NTA Lite (Web version for trackers/viewers)
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/lite'),
  base: process.env.GITHUB_PAGES ? '/nta-tracker/' : '/',
  build: {
    outDir: resolve(__dirname, 'dist-lite'),
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/lite/index.html')
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/lite')
    }
  },
  server: {
    port: 5174,
    host: true,
    open: true,
    allowedHosts: ['localhost', '.trycloudflare.com']
  }
})

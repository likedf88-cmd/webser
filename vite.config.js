import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = process.env.API_TARGET || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // preview hostname comes from the environment; no blanket allowlists
    ...(process.env.PREVIEW_HOST ? { allowedHosts: [process.env.PREVIEW_HOST] } : {}),
    proxy: {
      '/api': API,
      '/uploads': API,
      '/socket.io': { target: API, ws: true }
    }
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 }
})

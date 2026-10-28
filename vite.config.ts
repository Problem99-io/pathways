import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const api = `http://localhost:${process.env.PATHWAYS_PORT || 4317}`

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5317,
    proxy: {
      '/api': api,
      '/files': api,
      '/mcp': api,
    },
  },
})

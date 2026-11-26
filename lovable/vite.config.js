import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Lovable serves on 8080 and expects the dev server to listen on every
// interface. The /api proxy is only used when VITE_DATA_SOURCE=rest and no
// VITE_API_URL is set — i.e. a backend running locally.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '::',
    port: 8080,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})

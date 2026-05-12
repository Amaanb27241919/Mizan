import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // The Vite warning fires on uncompressed chunk size; our charts vendor
    // (recharts) is naturally ~550 KB pre-gzip but compresses to ~155 KB
    // over the wire. 800 KB is a comfortable ceiling that still flags real
    // bloat without complaining about expected vendor weight.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})

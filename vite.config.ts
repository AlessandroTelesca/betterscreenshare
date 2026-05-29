import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // Allow requests when previewing or running dev on the Render domain.
    // Render and other hosts may send Host headers that Vite blocks by default.
    allowedHosts: ['betterscreenshare.onrender.com'],
  },
})

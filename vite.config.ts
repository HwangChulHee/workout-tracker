import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/workout-tracker/',
  build: {
    rollupOptions: {
      output: { manualChunks: { charts: ['recharts'] } },
    },
  },
  plugins: [
    react(),
    tailwind(),
    {
      name: 'production-content-security-policy',
      apply: 'build',
      transformIndexHtml: () => [{
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.github.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'self'",
        },
        injectTo: 'head-prepend',
      }],
    },
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Workout Tracker',
        short_name: 'Workout',
        lang: 'ko',
        display: 'standalone',
        background_color: '#101112',
        theme_color: '#101112',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,png}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})

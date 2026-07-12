import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png}'],
        // optional ambient video (public/ambient.mp4): too big to precache, so
        // cache on first play; rangeRequests serves the <video>'s byte-range
        // requests from the cached full response (ambient.js primes it with a
        // plain fetch, since 206 responses themselves aren't cacheable)
        runtimeCaching: [
          {
            urlPattern: /\/ambient\.mp4$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ambient-video',
              rangeRequests: true,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 1 },
            },
          },
        ],
      },
      manifest: {
        name: 'Web Sudoku',
        short_name: 'Sudoku',
        description: 'Sudoku puzzles from Easy to Evil. Works offline.',
        theme_color: '#666699',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})

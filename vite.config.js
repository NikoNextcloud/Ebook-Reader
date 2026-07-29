import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Забележка за сигурност: Gemini API ключът НЕ се вгражда в бъндъла. Той се
// въвежда от потребителя и се пази само в localStorage на устройството.
// Така публично разгърнатият код никога не съдържа таен ключ.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.png',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'pwa-maskable-512.png',
        'voxora-logo.png',
      ],
      workbox: {
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
      manifest: {
        name: 'Voxora AI Reader',
        short_name: 'Voxora',
        description: 'Слушай своя текст с избран AI глас и атмосфера.',
        theme_color: '#102a2a',
        background_color: '#f4f2e9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'google-ai',
              test: /node_modules[\\/]@google[\\/]genai[\\/]/,
              priority: 20,
            },
            {
              name: 'document-readers',
              test: /node_modules[\\/](mammoth|jszip|pdfjs-dist|tesseract\.js|foliate-js)[\\/]/,
              priority: 10,
              maxSize: 420 * 1024,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 1,
              maxSize: 420 * 1024,
            },
          ],
        },
      },
    },
  },
  define: {
    // Запазено за съвместимост — винаги празно, ключът идва от localStorage.
    __GEMINI_API_KEY__: JSON.stringify(''),
  },
});

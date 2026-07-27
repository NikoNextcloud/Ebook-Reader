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
      includeAssets: ['icon.svg', 'favicon.jpg', 'voxora-logo.png'],
      manifest: {
        name: 'Voxora AI Reader',
        short_name: 'Voxora',
        description: 'Слушай своя текст с избран AI глас и атмосфера.',
        theme_color: '#102a2a',
        background_color: '#f4f2e9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/favicon.jpg', sizes: '435x423', type: 'image/jpeg', purpose: 'any' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  define: {
    // Запазено за съвместимост — винаги празно, ключът идва от localStorage.
    __GEMINI_API_KEY__: JSON.stringify(''),
  },
});

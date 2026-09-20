import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base path matches this project's GitHub Pages URL:
// https://<user>.github.io/dev-workspace/pc-controller/
// Adjust if the Pages source/path is set up differently.
export default defineConfig({
  base: '/dev-workspace/pc-controller/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PC Controller',
        short_name: 'PC Ctrl',
        description: 'คุมเปิด-ปิดคอมจากมือถือผ่าน ESP32 + relay',
        theme_color: '#161a23',
        background_color: '#0f1115',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
    }),
  ],
});

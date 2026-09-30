import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Deployed on Vercel with the project root set to this folder (see README.md),
// so it's served at its own domain root — no subpath base needed.
export default defineConfig({
  server: {
    // agent/ (C#) and firmware/ (Arduino) aren't part of the web app. Without
    // this, `dotnet build` churning agent/obj/*.tmp crashed the dev server with
    // EBUSY (see bugs.md).
    watch: { ignored: ['**/agent/**', '**/firmware/**', '**/scripts/**'] },
  },
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

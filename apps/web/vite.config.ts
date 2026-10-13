import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Agrega Construtoras',
        short_name: 'Agrega',
        description: 'ERP para construtoras: obras, engenharia e financeiro',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#F4F3F0',
        theme_color: '#1F2328',
        icons: [
          { src: '/icone.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icone-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/manual\//],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});

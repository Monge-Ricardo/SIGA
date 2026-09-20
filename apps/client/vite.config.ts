import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        login: path.resolve(__dirname, 'login.html'),
        caja: path.resolve(__dirname, 'caja.html'),
        socios: path.resolve(__dirname, 'socios.html'),
        lecturas: path.resolve(__dirname, 'lecturas.html'),
        fondos: path.resolve(__dirname, 'fondos.html'),
        reportes: path.resolve(__dirname, 'reportes.html'),
        admin: path.resolve(__dirname, 'admin.html')
      }
    }
  }
});

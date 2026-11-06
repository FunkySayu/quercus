import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // En dev, le backend FastAPI tourne à côté (uvicorn sur :8000) ; en prod c'est
    // nginx qui reverse-proxy /api/ (voir nginx.conf).
    proxy: { '/api': 'http://localhost:8000' },
  },
});

import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// D56: the tests run in a time zone far from the businesses, so any use of the
// browser's time zone shows up. Set before Vitest starts its workers.
process.env.TZ = 'Asia/Tokyo'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: true,
      port: 5174,
      strictPort: true,
      watch: {
        // File events from a Windows bind mount do not reach the container.
        usePolling: env.VITE_USE_POLLING === 'true',
      },
      // D52: the API stays on the same origin in development, so the refresh
      // cookie (SameSite=Strict, Path=/api/v1/auth) works without CORS.
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://api:8000',
          changeOrigin: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      env: {
        TZ: 'Asia/Tokyo',
        VITE_API_BASE_URL: 'http://api.test',
        VITE_DEMO_PASSWORD: 'senha-da-demo-de-teste',
      },
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/api/schema.d.ts', 'src/**/*.d.ts'],
        reporter: ['text', 'html'],
        // D57: at least 80% in src/lib, src/api and each feature.
        thresholds: {
          'src/lib/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/api/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/scheduling/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/auth/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/booking/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/customer-appointment/**': {
            statements: 80,
            branches: 80,
            functions: 80,
            lines: 80,
          },
        },
      },
    },
  }
})

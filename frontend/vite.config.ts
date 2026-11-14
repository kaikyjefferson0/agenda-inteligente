import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import { apiBaseUrlProblem, CONTENT_SECURITY_POLICY } from './csp.ts'

// D56: the tests run in a time zone far from the businesses, so any use of the
// browser's time zone shows up. Set before Vitest starts its workers.
process.env.TZ = 'Asia/Tokyo'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  // D116: a wrong address would only show up in the browser, after the deploy.
  if (command === 'build') {
    const problem = apiBaseUrlProblem(env.VITE_API_BASE_URL)
    if (problem !== null) throw new Error(problem)
  }

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
      // cookie (__Host-refresh_token, SameSite=Strict, Path=/) works without CORS.
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://api:8000',
          changeOrigin: false,
        },
      },
    },
    // D102: the E2E serves the production build here. The proxy is the one
    // above (preview.proxy defaults to server.proxy). D117: under the CSP of
    // production, so the E2E fails on any violation. Only here: the dev
    // server injects inline scripts of its own.
    preview: {
      host: true,
      port: 5174,
      strictPort: true,
      headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // On a cold run (as in CI), the first test of each file waits for the
      // lazy route chunks to be transformed, under coverage: 5 s is not enough.
      testTimeout: 15_000,
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
          'src/features/team-agenda/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/work-schedule/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/services/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/team/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
          'src/features/business-settings/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        },
      },
    },
  }
})

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API in production, e.g. `https://api.exemplo.com` (D52). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

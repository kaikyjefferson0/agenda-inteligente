/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API in production, e.g. `https://api.exemplo.com` (D52). */
  readonly VITE_API_BASE_URL?: string
  /**
   * Password of the demo accounts (D75). Public: every `VITE_` variable goes
   * into the JavaScript the browser downloads. Never the password of a real account.
   */
  readonly VITE_DEMO_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

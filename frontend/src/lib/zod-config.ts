import { z } from 'zod'

/**
 * D117: without `jitless`, Zod probes `new Function('')` to compile its
 * parsers, and the CSP (no `'unsafe-eval'`) blocks the probe with a violation
 * in the console. Zod would fall back to the same parsing without it, so this
 * only skips the probe. Imported first in main.tsx, before any schema exists.
 */
z.config({ jitless: true })

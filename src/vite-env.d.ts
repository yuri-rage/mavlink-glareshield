/// <reference types="vite/client" />

/** This build's identity, defined by vite.config.ts (scripts/buildInfo.mjs); "dev" on the dev server. */
declare const __BUILD__: { id: string; sha: string | null; date: string | null; dirty: boolean };

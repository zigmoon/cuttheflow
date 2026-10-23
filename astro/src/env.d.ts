/// <reference types="astro/client" />

/**
 * Injecté au build par `astro.config.mjs` (bloc `vite.define`), à partir de
 * `package.json`. En développement la valeur est aussi remplacée ; le garde de
 * `version.ts` couvre le cas d'un bundle chargé hors de ce pipeline.
 */
declare const __APP_VERSION__: string | undefined;

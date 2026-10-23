/**
 * Version du studio affichée à l'utilisateur.
 *
 * La valeur vient de `package.json` via `vite.define` (voir `astro.config.mjs`) :
 * une seule source de vérité, donc aucun risque d'afficher un numéro périmé.
 * `typeof` protège le cas d'un bundle évalué hors du pipeline Astro.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';

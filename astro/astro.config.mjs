import { defineConfig } from 'astro/config';

/**
 * CUT THE FLOW — interface.
 *
 * Le site est **statique** : il est compilé dans `dist/`, puis embarqué dans le
 * binaire Rust (`crates/ctf-app/build.rs`). Il n'y a donc ni serveur Node ni
 * node_modules à livrer avec l'application finale.
 *
 * En développement, `astro dev` sert l'interface sur le port 4321 ; il faut
 * lancer le moteur Rust à côté (`cargo run -- serve --port 7317`) et pointer
 * l'interface dessus avec `?api=http://127.0.0.1:7317`.
 */
export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  publicDir: 'public',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1', port: 4321 },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});

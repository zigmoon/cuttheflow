import { defineConfig } from 'astro/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Version du studio, lue **une seule fois** dans `package.json` et injectée dans
 * le bundle. Le numéro affiché dans les Préférences ne peut donc pas diverger de
 * celui qui est publié : il n'existe aucun endroit où le saisir à la main.
 */
const pkg = JSON.parse(
  await readFile(new URL('./package.json', import.meta.url), 'utf8'),
);
const APP_VERSION = String(pkg.version || '0.0.0');

/**
 * L'hébergeur laisse `Options +Indexes` actif : `/_astro/`, `/img/` et
 * `/vendor/` affichent alors un listing de dossier. Un index neutre suffit et
 * reste sûr — une directive `Options -Indexes` provoquerait une erreur 500 là
 * où `AllowOverride` est limité.
 */
const stubDirectoryIndexes = {
  name: 'ctf-stub-directory-indexes',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      const root = fileURLToPath(dir);
      const html =
        '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
        '<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width">' +
        '<title>CUT THE FLOW</title></head><body style="font-family:system-ui;background:#0c0c0f;color:#e8e8ee;padding:2rem">' +
        '<p><a style="color:#7cc4ff" href="../">← CUT THE FLOW</a></p></body></html>\n';
      for (const folder of ['_astro', 'img', 'vendor']) {
        const target = join(root, folder);
        await mkdir(target, { recursive: true });
        await writeFile(join(target, 'index.html'), html, 'utf8');
        logger.info(`index neutre écrit dans ${folder}/`);
      }
    },
  },
};


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
  // Domaine de publication : les URL absolues (canonical, og:url, og:image)
  // sont calculées à partir d'ici. Les robots de partage refusent ou ignorent
  // les chemins relatifs, d'où ce réglage explicite.
  site: 'https://app.zigmoon.com',
  srcDir: 'src',
  outDir: 'dist',
  publicDir: 'public',
  integrations: [stubDirectoryIndexes],
  // Le studio est publié dans un sous-dossier (app.zigmoon.com/CUTTHEFLOW).
  // Sans `base`, tous les liens `/_astro/...` et `/img/...` partiraient à la
  // racine du domaine et répondraient 404.
  base: '/CUTTHEFLOW',
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
    define: {
      // Remplace `__APP_VERSION__` dans le bundle au moment de la compilation.
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
  },
});

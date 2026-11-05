/**
 * Baut das Programm zu einer einzigen, eigenständigen HTML-Datei
 * (dist/Falzschema.html). Sie enthält Oberfläche, Programmcode und Three.js
 * und lässt sich per Doppelklick ohne Webserver und ohne Internet öffnen.
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);

const result = await build({
  entryPoints: [r('src/app.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  legalComments: 'inline',
  alias: {
    three: r('vendor/three/three.module.min.js'),
  },
  plugins: [
    {
      name: 'three-addons',
      setup(b) {
        b.onResolve({ filter: /^three\/addons\// }, (args) => ({
          path: r('vendor/three', args.path.slice('three/addons/'.length)),
        }));
      },
    },
  ],
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(r('styles.css'), 'utf8');
let html = await readFile(r('index.html'), 'utf8');

const replaceOnce = (pattern, replacement) => {
  if (!pattern.test(html)) throw new Error(`Nicht gefunden in index.html: ${pattern}`);
  html = html.replace(pattern, () => replacement);
};

replaceOnce(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
replaceOnce(/<link rel="stylesheet" href="styles.css" \/>/, `<style>\n${css}</style>`);
replaceOnce(/<script type="module" src="src\/app.js"><\/script>/, `<script>\n${js}</script>`);

await mkdir(r('dist'), { recursive: true });
const out = r('dist', 'Falzschema.html');
await writeFile(out, html);
console.log(`Erstellt: ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB)`);

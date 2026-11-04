import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

// Writes dist/sw.js from sw/sw.js with the list of this build's files, so the app opens offline.
// A new build gives a new list, hence a new sw.js, which the browser picks up on its next visit.
function offlineCopy() {
  return {
    name: 'colornote-offline-copy',
    apply: 'build',
    generateBundle(_options, bundle) {
      // index.html isn't in the bundle yet at this point, so it's named here.
      const built = Object.keys(bundle).filter(f => !f.endsWith('.map'));
      const fromPublic = readdirSync('public');
      const files = [...new Set(['index.html', ...built, ...fromPublic])].sort().map(f => `/${f}`);
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync('sw/sw.js', 'utf8');
      const fill = (line, value) => {
        if (!template.includes(line)) throw new Error(`sw/sw.js: missing ${line}`);
        return value;
      };
      const source = template
        .replace("const VERSION = '__VERSION__';", fill("const VERSION = '__VERSION__';", `const VERSION = ${JSON.stringify(version)};`))
        .replace('const FILES = __FILES__;', fill('const FILES = __FILES__;', `const FILES = ${JSON.stringify(files)};`));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineCopy()],
})

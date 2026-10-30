#!/usr/bin/env node
/**
 * Build the Night Owl browser half.
 *
 * esbuild bundles `src/client/index.tsx` (the only built artifact in this
 * package) into the DSH Client closure-factory format: the page installs
 * `window.__ModuleLoader__` before any bundle executes, and a bundle submits
 * `{ id, factory }` whose factory receives the module-table `require` and
 * returns the Cordis plugin face.
 *
 * The platform modules the page shares stay external and resolve through that
 * injected `require`; everything else is bundled. Output is `lib/client.js`
 * plus an external `lib/client.js.map` (package.json exports `./client`).
 *
 * Usage: `node build.mjs` (esbuild is a devDependency of this package).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ENTRY = resolve(ROOT, 'src/client/index.tsx')
const OUT_DIR = resolve(ROOT, 'lib')
const OUT_FILE = resolve(OUT_DIR, 'client.js')
const MAP_FILE = `${OUT_FILE}.map`

/** Registration key: the loader matches it against the boot graph's package row. */
const PACKAGE_ID = 'dsh-nightowl'

/**
 * Page-shared module-table words. These are the shell's platform singletons
 * (never a duplicated React or primitives copy); the loader's `require`
 * resolves them, so esbuild must leave the imports untouched.
 */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** esbuild CJS epilogue that would replace `module.exports` with its own view. */
const CJS_EPILOGUE = /^module\.exports = __toCommonJS\(\w+\);\n/mu

/** One top-level binding declaration (`function`/`var`/`let`/`const`). */
const declared = (name) => new RegExp(`(?:^|\\n)(?:function|var|let|const) ${name}\\b`, 'u')

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  charset: 'utf8',
  external: EXTERNALS,
  sourcemap: 'external',
  // Keep the artifact readable: this bundle is a contract surface for review.
  minify: false,
  write: false,
  logLevel: 'silent',
})

const outputs = new Map(result.outputFiles.map(file => [file.path, file.text]))
const bundled = outputs.get(OUT_FILE)
const sourceMap = outputs.get(MAP_FILE)
if (bundled === undefined || sourceMap === undefined) {
  throw new Error(`esbuild did not emit ${OUT_FILE} and ${MAP_FILE}`)
}

// The wrapper below owns the exports face, so drop esbuild's own CJS epilogue.
// The entry's bound names survive bundling (a collision would be a build bug
// caught next), which is what lets the wrapper assign `apply`/`inject` directly.
if (!CJS_EPILOGUE.test(bundled)) {
  throw new Error('esbuild output changed: expected the CJS `module.exports = __toCommonJS(...)` epilogue')
}
const body = bundled.replace(CJS_EPILOGUE, '')
for (const name of ['apply', 'inject']) {
  if (!declared(name).test(body)) {
    throw new Error(`esbuild output does not declare the plugin binding "${name}"; the wrapper cannot export it`)
  }
}

const factory = [
  'window.__ModuleLoader__.load({',
  `  id: ${JSON.stringify(PACKAGE_ID)},`,
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  // The bundle body stays verbatim (no re-indent) so the source map's columns
  // keep pointing at src/client/index.tsx.
  body.trimEnd(),
  '    exports.apply = apply;',
  '    exports.inject = inject;',
  '    return module.exports;',
  '  }',
  '});',
  '',
].join('\n')

for (const [label, pattern] of [
  ['registration header', /^window\.__ModuleLoader__\.load\(\{\n {2}id: "dsh-nightowl",\n {2}factory: \(require\) => \{/u],
  ['exports face', / {4}exports\.apply = apply;\n {4}exports\.inject = inject;\n {4}return module\.exports;/u],
]) {
  if (!pattern.test(factory)) throw new Error(`generated bundle lost its ${label}`)
}

// A source map comment must be the last line of the file it belongs to, so it
// is appended after the wrapper rather than inside the factory.
const artifact = `${factory}//# sourceMappingURL=${basename(MAP_FILE)}\n`
const mapDocument = JSON.parse(sourceMap)
const map = JSON.stringify({ ...mapDocument, file: basename(OUT_FILE) })

await mkdir(OUT_DIR, { recursive: true })
await Promise.all([
  writeFile(OUT_FILE, artifact, 'utf8'),
  writeFile(MAP_FILE, map, 'utf8'),
])

const bytes = Buffer.byteLength(artifact)
console.log(`built ${relative(ROOT, OUT_FILE)} (${bytes} bytes, id "${PACKAGE_ID}") + ${relative(ROOT, MAP_FILE)}`)

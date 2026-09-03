import { defineConfig } from 'tsdown'

/**
 * The dsh web GUI's frozen module-table rows a client bundle may require at
 * runtime instead of inlining: the platform baseline (react, cordis, the
 * snapshot store, the slot registry, the primitives). Mirrors the harness's
 * packages/client/web/src/platform.ts `PLATFORM_MODULES` roster; a specifier
 * outside this set is bundled into client.js.
 */
const CLIENT_EXTERNALS = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

/**
 * Self-contained build, run from `prepare` so a git install produces the
 * published entry points without a monorepo checkout. Two artifacts:
 *
 * - lib/index.mjs (+ d.mts): the Node half the dsh Loader imports.
 * - lib/client.js: the browser half, in the harness client-bundle shape — a
 *   CJS body wrapped in a `window.__ModuleLoader__.load` factory whose
 *   injected `require` resolves the module-table externals above (see the
 *   harness's packages/client/tsdown.client.ts, the format's source of truth).
 */
export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: 'esm',
    dts: true,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@opdsh/unity-plugin", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])

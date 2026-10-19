import { defineConfig } from 'tsdown'
const external = [/^@deepseek-ai\//, /^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/]
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'], dts: true, clean: false,
    outDir: 'lib', fixedExtension: false, external,
  },
  {
    entry: { client: 'src/client/index.ts' },
    format: ['cjs'], dts: false, clean: false,
    outDir: 'lib', fixedExtension: false, external,
    outExtensions: () => ({ js: '.js' }),
    banner: 'window.__ModuleLoader__.load({ id: "dsh-goal-queue", factory: (require) => { const module = { exports: {} }; const exports = module.exports;',
    footer: 'return module.exports; } });',
  },
])

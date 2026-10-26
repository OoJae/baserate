import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(webRoot, '..', '..')

// ---------------------------------------------------------------------------------------------------------------
// Routing: two HTML shells (index.html for the site, app.html for the app), chosen by vercel.json's rewrites.
// Dev and preview read the same file, so what works locally is what Vercel serves.
// ---------------------------------------------------------------------------------------------------------------

interface VercelConfig {
  rewrites: { source: string; destination: string }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

/** vercel.json sources here are literal paths plus `(.*)` groups; anything richer needs a real path-to-regexp. */
function sourceToRegExp(source: string): RegExp {
  const escaped = source
    .split('(.*)')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(.*)')
  return new RegExp(`^${escaped}$`)
}

function readVercel(): VercelConfig {
  return JSON.parse(readFileSync(join(webRoot, 'vercel.json'), 'utf8')) as VercelConfig
}

/** The shell a path gets: the first matching rewrite, or none (the path is served as it is). */
function rewriteFor(pathname: string, config: VercelConfig): string | undefined {
  return config.rewrites.find((r) => sourceToRegExp(r.source).test(pathname))?.destination
}

function pathnameOf(req: IncomingMessage): string {
  try {
    return decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    return '/'
  }
}

function queryOf(req: IncomingMessage): string {
  const i = req.url?.indexOf('?') ?? -1
  return i >= 0 && req.url ? req.url.slice(i) : ''
}

function siteRouting(): Plugin {
  const vercel = readVercel()
  return {
    name: 'baserate-site-routing',
    // Dev: rewrite page navigations only (never module, asset or HMR requests).
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, _res: ServerResponse, next: () => void) => {
        const pathname = pathnameOf(req)
        const isPage =
          req.method === 'GET' &&
          (req.headers.accept ?? '').includes('text/html') &&
          !pathname.startsWith('/@') &&
          !/\.[a-z0-9]+$/i.test(pathname)
        if (isPage && pathname !== '/') {
          const shell = rewriteFor(pathname, vercel)
          if (shell) req.url = shell + queryOf(req)
        }
        next()
      })
    },
    // Preview: Vercel's order. Static files win; then the rewrites; and vercel.json's headers on every response.
    // BASERATE_PREVIEW_CSP=enforce turns the report-only CSP into an enforcing one (the site specs use it).
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir)
      const enforceCsp = process.env.BASERATE_PREVIEW_CSP === 'enforce'
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const pathname = pathnameOf(req)
        for (const rule of vercel.headers) {
          if (!sourceToRegExp(rule.source).test(pathname)) continue
          for (const { key, value } of rule.headers) {
            const name =
              enforceCsp && key === 'Content-Security-Policy-Report-Only'
                ? 'Content-Security-Policy'
                : key
            res.setHeader(name, value)
          }
        }
        const file = join(outDir, pathname)
        const isFile = pathname !== '/' && existsSync(file) && statSync(file).isFile()
        if (pathname !== '/' && !isFile) {
          const shell = rewriteFor(pathname, vercel)
          if (shell) req.url = shell + queryOf(req)
        }
        next()
      })
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bundle report: what each chunk contains and weighs, for scripts/check-size.mjs. Written to
// <outDir>/.bundle-report.json (dist/ is gitignored). Sizes are bytes; gzip is zlib's default level, as Vite reports.
// ---------------------------------------------------------------------------------------------------------------

/** A module id as a stable, machine-independent key: a package name, a repo path, or a virtual id. */
function moduleKey(id: string): string {
  const clean = id.replace(/^\0/, 'virtual:').replace(/\?.*$/, '')
  const nm = clean.lastIndexOf('/node_modules/')
  if (nm >= 0) {
    const rest = clean.slice(nm + '/node_modules/'.length).split('/')
    const pkg = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
    return `npm:${pkg}`
  }
  if (clean.startsWith(repoRoot)) return relative(repoRoot, clean)
  return clean
}

function parseHtml(html: string) {
  const out = {
    scripts: [] as string[],
    modulepreload: [] as string[],
    stylesheets: [] as string[],
    fontPreloads: [] as string[],
  }
  for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g))
    if (src) out.scripts.push(src)
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const rel = /\brel="([^"]+)"/.exec(tag)?.[1]
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1]
    if (!rel || !href) continue
    if (rel === 'modulepreload') out.modulepreload.push(href)
    else if (rel === 'stylesheet') out.stylesheets.push(href)
    else if (rel === 'preload' && /\bas="font"/.test(tag)) out.fontPreloads.push(href)
  }
  return out
}

function bundleReport(): Plugin {
  return {
    name: 'baserate-bundle-report',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = options.dir ?? resolve(webRoot, 'dist')
      const size = (fileName: string) => {
        const buf = readFileSync(join(outDir, fileName))
        return { bytes: buf.length, gzip: gzipSync(buf).length }
      }
      const chunks = []
      const assets = []
      const html: Record<string, ReturnType<typeof parseHtml>> = {}
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'chunk') {
          const modules: Record<string, number> = {}
          const rendered = (item as { modules?: Record<string, { renderedLength?: number }> })
            .modules
          for (const id of item.moduleIds ?? Object.keys(rendered ?? {})) {
            const key = moduleKey(id)
            modules[key] = (modules[key] ?? 0) + (rendered?.[id]?.renderedLength ?? 0)
          }
          const meta = (
            item as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } }
          ).viteMetadata
          chunks.push({
            file: fileName,
            name: item.name,
            isEntry: item.isEntry,
            isDynamicEntry: item.isDynamicEntry,
            facade: item.facadeModuleId ? moduleKey(item.facadeModuleId) : null,
            imports: item.imports,
            dynamicImports: item.dynamicImports,
            css: [...(meta?.importedCss ?? [])],
            assets: [...(meta?.importedAssets ?? [])],
            ...size(fileName),
            modules,
          })
        } else {
          if (fileName.endsWith('.html')) {
            const source =
              typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source)
            html[fileName] = parseHtml(source)
          }
          assets.push({ file: fileName, ...size(fileName) })
        }
      }
      chunks.sort((a, b) => a.file.localeCompare(b.file))
      assets.sort((a, b) => a.file.localeCompare(b.file))
      const report = {
        note: 'Written by vite.config.ts (bundleReport); read by scripts/check-size.mjs. Sizes in bytes; gzip = zlib default level.',
        html,
        chunks,
        assets,
      }
      writeFileSync(join(outDir, '.bundle-report.json'), `${JSON.stringify(report, null, 2)}\n`)
    },
  }
}

// Secrets never reach the bundle: only BASERATE_PUBLIC_* variables are exposed through import.meta.env.
// Do not add `define` for env values and never call loadEnv(mode, cwd, '') here (see scripts/check-bundle.mjs).
export default defineConfig({
  envPrefix: 'BASERATE_PUBLIC_',
  plugins: [react(), tailwindcss(), siteRouting(), bundleReport()],
  resolve: {
    // One copy of each web3 runtime, so `instanceof` checks in @baserate/sdk see wagmi's errors.
    dedupe: ['viem', 'wagmi', '@tanstack/react-query', 'react', 'react-dom'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      // The site shell and the app shell; vercel.json decides which path gets which.
      input: {
        index: resolve(webRoot, 'index.html'),
        app: resolve(webRoot, 'app.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
})

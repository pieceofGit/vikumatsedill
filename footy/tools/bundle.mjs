#!/usr/bin/env node
/**
 * Inlines data/fixtures.json into index.html and writes dist/index.html —
 * one self-contained file you can open from disk, email, or drop on any host.
 *
 * Usage:  node tools/bundle.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = await readFile(join(ROOT, 'index.html'), 'utf8')
const data = await readFile(join(ROOT, 'data/fixtures.json'), 'utf8')

// </script> inside the payload would close the tag early
const safe = data.replace(/<\//g, '<\\/')
const tag = `<script type="application/json" id="fixtures-data">${safe}</script>\n<script>`
const out = html.replace(/<script>\n\(\(\) => \{/, `${tag}\n(() => {`)
if (out === html) { console.error('bundle failed: could not find the app script tag'); process.exit(1) }

await mkdir(join(ROOT, 'dist'), { recursive: true })
await writeFile(join(ROOT, 'dist/index.html'), out)
console.log(`wrote dist/index.html (${(out.length / 1024).toFixed(0)} kB)`)

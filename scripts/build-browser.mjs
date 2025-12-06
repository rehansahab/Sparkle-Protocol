#!/usr/bin/env node
/**
 * Build browser bundle for Sparkle Protocol
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

async function build() {
  console.log('Building Sparkle Protocol browser bundle...\n');

  // ESM bundle for modern browsers
  const esmResult = await esbuild.build({
    entryPoints: [join(rootDir, 'src/browser-bundle.ts')],
    bundle: true,
    format: 'esm',
    target: ['es2020'],
    platform: 'browser',
    outfile: join(rootDir, 'dist/sparkle-browser.esm.js'),
    sourcemap: true,
    minify: true,
    metafile: true,
    external: [], // Bundle all dependencies
  });

  // IIFE bundle for legacy/script tag usage
  const iifeResult = await esbuild.build({
    entryPoints: [join(rootDir, 'src/browser-bundle.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'SparkleProtocol',
    target: ['es2020'],
    platform: 'browser',
    outfile: join(rootDir, 'dist/sparkle-browser.js'),
    sourcemap: true,
    minify: true,
    metafile: true,
    external: [],
  });

  // Calculate sizes
  const esmSize = readFileSync(join(rootDir, 'dist/sparkle-browser.esm.js')).length;
  const iifeSize = readFileSync(join(rootDir, 'dist/sparkle-browser.js')).length;

  console.log('Build complete!\n');
  console.log(`ESM bundle:  dist/sparkle-browser.esm.js (${(esmSize / 1024).toFixed(1)} KB)`);
  console.log(`IIFE bundle: dist/sparkle-browser.js     (${(iifeSize / 1024).toFixed(1)} KB)`);
  console.log('\nUsage:');
  console.log('  ESM:  import { SparkleProtocol } from "./sparkle-browser.esm.js"');
  console.log('  IIFE: <script src="sparkle-browser.js"></script> → window.SparkleProtocol');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

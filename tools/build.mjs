#!/usr/bin/env node
/**
 * Packages the add-on into dist/. The zip is loadable in Firefox via
 * about:debugging -> This Firefox -> Load Temporary Add-on (pick manifest.json
 * from the source tree, or the built zip).
 */

import { mkdirSync, rmSync, existsSync, cpSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const staging = join(dist, 'package');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const zipName = `scan-${manifest.version}.zip`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

cpSync(join(root, 'manifest.json'), join(staging, 'manifest.json'));
cpSync(join(root, 'icons'), join(staging, 'icons'), { recursive: true });
cpSync(join(root, 'src'), join(staging, 'src'), {
  recursive: true,
  // Templates are documentation for future providers, not shipped code.
  filter: (src) => !src.endsWith('.template.js'),
});

execFileSync('zip', ['-r', '-q', '-X', join(dist, zipName), 'manifest.json', 'icons', 'src'], { cwd: staging });
rmSync(staging, { recursive: true, force: true });

const size = execFileSync('du', ['-h', join(dist, zipName)]).toString().split('\t')[0];
console.log(`build: dist/${zipName} (${size})`);
if (!existsSync(join(dist, zipName))) process.exit(1);

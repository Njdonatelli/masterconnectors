#!/usr/bin/env node
/**
 * npm workspaces hoist react to the repo root. Vite (cwd: site/) still looks
 * under site/node_modules during dependency pre-bundling — symlink hoisted copies.
 */
import { mkdirSync, symlinkSync, existsSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteModules = join(root, 'site', 'node_modules');

const links = [
  ['react', join(root, 'node_modules', 'react')],
  ['react-dom', join(root, 'node_modules', 'react-dom')],
];

mkdirSync(siteModules, { recursive: true });

for (const [name, target] of links) {
  const linkPath = join(siteModules, name);
  try {
    if (existsSync(linkPath)) {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink()) continue;
    }
    symlinkSync(target, linkPath);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') continue;
    throw err;
  }
}

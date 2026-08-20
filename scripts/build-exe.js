#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const releaseDir = path.join(root, 'release', 'Burning-Chariot');
const gameDir = path.join(releaseDir, 'game');
const bundle = path.join(buildDir, 'sea-bundle.cjs');
const blob = path.join(buildDir, 'sea-prep.blob');
const exe = path.join(releaseDir, 'BurningChariot.exe');

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(gameDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'server', 'exe-entry.js')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node24'],
  minify: false,
  sourcemap: false
});

run(process.execPath, ['--experimental-sea-config', path.join(root, 'sea-config.json')]);
if (!fs.existsSync(blob)) throw new Error('未生成 SEA blob: ' + blob);

fs.copyFileSync(process.execPath, exe);
const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
run(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);

fs.copyFileSync(path.join(root, 'index.html'), path.join(gameDir, 'index.html'));
copyDir(path.join(root, 'css'), path.join(gameDir, 'css'));
copyDir(path.join(root, 'js'), path.join(gameDir, 'js'));

console.log('\n构建完成：' + exe);
console.log('发行目录：' + releaseDir);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name), dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(path.basename(command) + ' 退出码 ' + result.status);
}

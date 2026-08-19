#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const jsDir = path.join(root, 'js');
const browserFiles = fs.readdirSync(jsDir).filter(name => name.endsWith('.js'));

for (const name of browserFiles) {
  esbuild.transformSync(fs.readFileSync(path.join(jsDir, name), 'utf8'), {
    loader: 'js', target: 'chrome102', charset: 'utf8', legalComments: 'none'
  });
}

esbuild.buildSync({
  entryPoints: [path.join(root, 'server', 'exe-entry.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node12'],
  write: false,
  logLevel: 'silent'
});

const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const unsupportedCss = [
  [/:has\s*\(/, ':has()'], [/@container\b/, '@container'], [/container-type\s*:/, 'container-type'],
  [/color-mix\s*\(/, 'color-mix()'], [/\b(?:dvh|svh|lvh)\b/, 'dynamic viewport units'],
  [/grid-template-(?:rows|columns)\s*:[^;]*\bsubgrid\b/, 'subgrid']
];
const found = unsupportedCss.filter(item => item[0].test(css)).map(item => item[1]);
if (found.length) throw new Error('Chrome 102 不支持这些 CSS：' + found.join(', '));

const serverSources = [
  path.join(root, 'server', 'server.js'),
  path.join(root, 'server', 'room-manager.js'),
  path.join(root, 'server', 'exe-entry.js')
].map(file => fs.readFileSync(file, 'utf8')).join('\n');
if (/\.toString\(\s*['"]base64url['"]\s*\)/.test(serverSources)) {
  throw new Error('Node 12 不支持 Buffer.toString("base64url")');
}

console.log('  ok   ' + browserFiles.length + ' 个浏览器脚本可编译到 Chrome 102');
console.log('  ok   CSS 未使用已知的 Chrome 102 后新增特性');
console.log('  ok   LAN 服务端可编译到 Node 12 / Windows 7 运行时');

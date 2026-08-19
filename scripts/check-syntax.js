#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourceDirectories = ['js', 'server', 'scripts', 'test'];
const jsonFiles = ['.c8rc.json', 'package.json', 'package-lock.json', 'sea-config.json'];
const scripts = [];

for (const directory of sourceDirectories) collectJavaScript(path.join(root, directory));

for (const file of scripts.sort()) {
  let source = fs.readFileSync(file, 'utf8');
  if (source.startsWith('#!')) source = source.replace(/^#![^\r\n]*(?:\r?\n|$)/, '');
  new vm.Script(source, { filename: path.relative(root, file) });
}

for (const relative of jsonFiles) {
  const file = path.join(root, relative);
  JSON.parse(fs.readFileSync(file, 'utf8'));
}

console.log('Syntax check passed: ' + scripts.length + ' JavaScript files, ' + jsonFiles.length + ' JSON files.');

function collectJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScript(file);
    else if (entry.isFile() && entry.name.endsWith('.js')) scripts.push(file);
  }
}

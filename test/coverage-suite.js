#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const entries = [
  'scripts/check-syntax.js',
  'test/run.js',
  'test/lan-server.js',
  'test/lan-game.js',
  'scripts/check-compatibility.js'
];

for (const entry of entries) {
  const result = spawnSync(process.execPath, [path.join(root, entry)], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

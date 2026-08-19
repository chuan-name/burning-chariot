#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const c8 = require.resolve('c8/bin/c8.js');
const suite = path.join(root, 'test', 'coverage-suite.js');
const result = spawnSync(process.execPath, [
  c8,
  '--config', path.join(root, '.c8rc.json'),
  process.execPath,
  suite
], {
  cwd: root,
  stdio: 'inherit'
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;

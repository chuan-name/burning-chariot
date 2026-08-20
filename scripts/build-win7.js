#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('esbuild');

const NODE_VERSION = '12.22.12';
const NODE_URL = 'https://nodejs.org/dist/v' + NODE_VERSION + '/win-x64/node.exe';
const NODE_SHA256 = 'b014e4ec5ca810b2fb54cdbf6ab8d6acc488285c98469606efb8b412472bec2a';
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const cacheDir = path.join(buildDir, 'win7-runtime-cache');
const cachedNode = path.join(cacheDir, 'node-v' + NODE_VERSION + '-win-x64.exe');
const releaseDir = path.join(root, 'release', 'Burning-Chariot-Win7-x64');
const gameDir = path.join(releaseDir, 'game');
const runtimeDir = path.join(releaseDir, 'runtime');
const serverDir = path.join(releaseDir, 'server');
const bundle = path.join(serverDir, 'win7-server.cjs');
const exe = path.join(releaseDir, 'BurningChariot-Win7.exe');

async function main() {
  fs.mkdirSync(cacheDir, { recursive: true });
  await ensureOfficialNode();

  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(serverDir, { recursive: true });

  // 服务端限制在 Node 12 语法/API 基线；官方 Node 12.22.12 x64 是 Node
  // 最后一个可用于 Windows 7 的维护线，目标电脑无需另装 Node.js。
  esbuild.buildSync({
    entryPoints: [path.join(root, 'server', 'exe-entry.js')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node12'],
    minify: false,
    sourcemap: false
  });

  fs.copyFileSync(cachedNode, path.join(runtimeDir, 'node.exe'));
  const launcherFramework = buildLauncher(exe);
  fs.copyFileSync(path.join(root, 'index.html'), path.join(gameDir, 'index.html'));
  copyDir(path.join(root, 'css'), path.join(gameDir, 'css'));
  compileBrowserScripts(path.join(root, 'js'), path.join(gameDir, 'js'));

  const manifest = {
    product: 'Burning Chariot LAN',
    operatingSystem: 'Windows 7 SP1 x64 or newer',
    browserTarget: 'Google Chrome 102.0.5005.63',
    browserJavaScriptTarget: 'chrome102',
    serverRuntime: 'Official Node.js ' + NODE_VERSION + ' x64',
    serverRuntimeSha256: NODE_SHA256,
    launcherFramework,
    port: 3000
  };
  fs.writeFileSync(path.join(releaseDir, 'compatibility.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeWin7Readme(path.join(releaseDir, '使用说明-Windows7.txt'));

  console.log('\nWindows 7 x64 兼容版构建完成：' + exe);
  console.log('Chrome 目标版本：102.0.5005.63');
  console.log('Node 运行时 SHA-256 已验证：' + NODE_SHA256);
  console.log('发行目录：' + releaseDir);
}

async function ensureOfficialNode() {
  if (fs.existsSync(cachedNode) && sha256(cachedNode) === NODE_SHA256) return;
  if (fs.existsSync(cachedNode)) fs.unlinkSync(cachedNode);
  const partial = cachedNode + '.partial';
  if (fs.existsSync(partial)) fs.unlinkSync(partial);
  console.log('下载 Node.js 官方 Windows x64 运行时：v' + NODE_VERSION);
  await download(NODE_URL, partial, 0);
  const actual = sha256(partial);
  if (actual !== NODE_SHA256) {
    fs.unlinkSync(partial);
    throw new Error('Node.js 运行时 SHA-256 校验失败：' + actual);
  }
  fs.renameSync(partial, cachedNode);
}

function download(url, destination, redirects) {
  if (redirects > 5) return Promise.reject(new Error('Node.js 下载重定向次数过多'));
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error('Node.js 下载失败，HTTP ' + response.statusCode));
      }
      const output = fs.createWriteStream(destination);
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.setTimeout(30000, () => request.destroy(new Error('Node.js 下载超时')));
    request.on('error', reject);
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildLauncher(output) {
  const csc = 'C:\\Windows\\Microsoft.NET\\Framework\\v3.5\\csc.exe';
  const requested = process.env.BC_WIN7_LAUNCHER || 'auto';
  if (requested !== 'native' && fs.existsSync(csc)) {
    compileDotNet35Launcher(csc, output);
    return '.NET Framework 3.5 Client/Full Profile';
  }
  if (requested === 'dotnet35') {
    throw new Error('BC_WIN7_LAUNCHER=dotnet35，但未找到 Windows/.NET 3.5 C# 编译器：' + csc);
  }
  compileNativeLauncher(output);
  return 'Native Win32 x64 (Windows 7 subsystem 6.01; no .NET dependency)';
}

function compileDotNet35Launcher(csc, output) {
  const source = path.join(root, 'scripts', 'win7-launcher.cs');
  const result = spawnSync(csc, [
    '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/out:' + output, source
  ], { cwd: root, encoding: 'utf8' });
  finishCompiler(result, 'Windows 7 .NET 3.5 启动器');
}

function compileNativeLauncher(output) {
  const installation = findVisualStudio();
  const toolsRoot = path.join(installation, 'VC', 'Tools', 'MSVC');
  const compatible = fs.readdirSync(toolsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && isWin7CompatibleToolset(entry.name))
    .map(entry => entry.name)
    .sort(compareVersions)
    .pop();
  if (!compatible) {
    throw new Error('未找到可面向 Windows 7 的 MSVC v142/v143 工具集；VS 2026 v145 不支持 Windows 7。');
  }

  const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const source = path.join(root, 'scripts', 'win7-launcher.c');
  const object = path.join(buildDir, 'win7-launcher.obj');
  const commandFile = path.join(buildDir, 'win7-native-build.cmd');
  const toolsetFamily = compatible.split('.').slice(0, 2).join('.');
  const commands = [
    '@echo off',
    'call ' + quoteCmd(vcvars) + ' -vcvars_ver=' + toolsetFamily + ' >nul',
    'if errorlevel 1 exit /b %errorlevel%',
    [
      'cl.exe', '/nologo', '/c', '/O1', '/GS-', '/Zl', '/D_WIN32_WINNT=0x0601',
      '/Fo' + quoteCmd(object), quoteCmd(source)
    ].join(' '),
    'if errorlevel 1 exit /b %errorlevel%',
    [
      'link.exe', '/nologo', '/NODEFAULTLIB', '/ENTRY:wWinMainCRTStartup',
      '/SUBSYSTEM:CONSOLE,6.01', '/MACHINE:X64', '/INCREMENTAL:NO',
      '/OUT:' + quoteCmd(output), quoteCmd(object), 'kernel32.lib'
    ].join(' '),
    'exit /b %errorlevel%',
    ''
  ];
  fs.writeFileSync(commandFile, commands.join('\r\n'), 'utf8');
  const result = spawnSync('cmd.exe', ['/d', '/c', commandFile], {
    cwd: root, encoding: 'utf8'
  });
  finishCompiler(result, 'Windows 7 原生 Win32 启动器（MSVC ' + compatible + '）');
}

function findVisualStudio() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
  ].filter(Boolean);
  const vswhere = candidates.find(file => fs.existsSync(file));
  if (!vswhere) throw new Error('未找到 vswhere.exe，无法定位 Windows 7 兼容 MSVC 工具集。');
  const result = spawnSync(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath'
  ], { encoding: 'utf8' });
  finishCompiler(result, 'Visual Studio 检测');
  const installation = (result.stdout || '').trim();
  if (!installation) throw new Error('vswhere.exe 未返回 Visual Studio 安装目录。');
  return installation;
}

function isWin7CompatibleToolset(version) {
  const parts = version.split('.').map(Number);
  return parts[0] === 14 && parts[1] >= 29 && parts[1] <= 44;
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

function quoteCmd(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function finishCompiler(result, label) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(label + '失败，退出码 ' + result.status);
}

function compileBrowserScripts(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) compileBrowserScripts(src, dest);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const result = esbuild.transformSync(fs.readFileSync(src, 'utf8'), {
        loader: 'js', target: 'chrome102', charset: 'utf8', legalComments: 'none'
      });
      fs.writeFileSync(dest, result.code);
    } else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

function writeWin7Readme(file) {
  const text = [
    '燃烧战车 Windows 7 SP1 x64 兼容版',
    '',
    '适配浏览器：Google Chrome 102.0.5005.63',
    '适配系统：Windows 7 SP1 64 位及更高版本',
    '',
    '1. 请完整保留本目录以及 game、runtime、server 文件夹。',
    '2. 双击 BurningChariot-Win7.exe。',
    '3. 若防火墙询问，请只允许“家庭或工作(专用)网络”。',
    '4. 房主访问 http://localhost:3000 并创建房间。',
    '5. 另一位玩家访问窗口显示的局域网地址并输入六位房间号。',
    '',
    '如页面曾打开过旧版，请在两台电脑上按 Ctrl+F5 强制刷新。',
    'Windows 7 与 Node 12 均已停止安全维护，请勿把端口 3000 暴露到互联网。',
    ''
  ].join('\r\n');
  // Windows 7 记事本依靠 BOM 正确识别 UTF-8 中文。
  fs.writeFileSync(file, '\uFEFF' + text, 'utf8');
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

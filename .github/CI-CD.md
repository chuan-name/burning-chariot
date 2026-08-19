# CI/CD 与发布说明

`.github/workflows/ci-cd.yml` 采用最小权限：整个工作流默认只有 `contents: read`，只有发布 job
覆写为 `contents: write`。不需要个人访问令牌，Release 使用 GitHub 自动提供的 token。

## 触发与任务

- `main` push、以 `main` 为目标的 Pull Request、手动运行：并行执行轻量语法检查、完整自动化测试、
  Chrome 102 / Node 12 兼容性检查和 c8 覆盖率门禁，不构建或发布正式发行版。
- 推送 `v*` tag：先执行以上三项 CI，通过后并行构建现代 Windows x64 与 Windows 7 x64，
  上传两个 ZIP artifact，最后生成 `SHA256SUMS.txt` 并创建 GitHub Release。

正式产物只有：

- `Burning-Chariot-Windows-x64.zip`
- `Burning-Chariot-Win7-x64-Chrome102.zip`
- `SHA256SUMS.txt`

两个 ZIP 都包含顶层发行目录，不能只取出 EXE；`node_modules/`、`build/`、运行时缓存和 SEA
中间文件都不会进入 Release。

## 覆盖率门禁

`npm run coverage` 使用 c8 统计 `server/`、`scripts/` 和现有 Node 测试可以可靠执行的核心
`js/` 文件。配置启用 `all`，因此范围内没有加载的源码会按 0% 计入，而不是从分母中消失。
CI 会打印逐文件表格和汇总，并同时要求：

- Line Coverage >= 50%
- Branch Coverage >= 50%

任意一项不足都会以非零退出码终止 `coverage` job，两个发行构建也都依赖该 job。

核心浏览器脚本由测试通过 `vm.runInContext()` 加载。测试桩为每个 VM 脚本提供源码绝对路径，
使 V8/c8 能将覆盖区间映射回真实文件；没有把浏览器执行结果伪装成 Node 覆盖率。

## Windows 7 启动器

本地 `npm run build:win7` 会优先使用 Windows 自带的 `.NET Framework 3.5` C# 编译器，延续原有
启动器实现。当前 GitHub `windows-latest` 不保证存在该编译器，因此 CI 明确设置
`BC_WIN7_LAUNCHER=native`，从同一份源码构建不依赖 .NET 的原生 Win32 x64 启动器。

原生启动器只调用 Windows 7 已有的 Kernel32 API，以 `/SUBSYSTEM:CONSOLE,6.01`、无 CRT 依赖方式
链接，并拒绝 VS 2026 的 v145 工具集；CI 必须找到仍支持目标 Windows 7 的 MSVC v142/v143
工具集，否则构建会明确失败。`compatibility.json` 会记录本次构建实际采用的启动器类型。

两种启动器都只负责以 `BC_GAME_ROOT` 启动随包携带的服务端。Win7 构建仍固定并验证：

- 官方 Node.js `12.22.12` Windows x64 runtime 及其 SHA-256；
- 服务端 esbuild target `node12`；
- 浏览器端 esbuild target `chrome102`，对应 Chrome `102.0.5005.63`。

Actions 缓存只保存 `build/win7-runtime-cache/` 以减少下载；无论是否命中缓存，构建脚本都会重新
计算并核对 Node runtime 的 SHA-256。

## 发布新版本

从准备发布的提交创建并推送 tag：

```sh
git tag v1.0.0
git push origin v1.0.0
```

请只给已审核、可发布的提交打 tag。手动运行 workflow 不会创建 Release。

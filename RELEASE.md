# Release 打包说明

## 前置准备

### 1. 安装依赖
```bash
npm install
```

### 2. 准备图标（可选）
将图标文件放置在 `build/` 目录下：
- macOS: `icon.icns`
- Windows: `icon.ico`
- Linux: `icon.png`

如无图标，打包时会使用 Electron 默认图标。

---

## 打包命令

### 开发模式运行（测试）
```bash
# 仅运行后端服务器
npm run dev

# 运行 Electron 应用（需先启动后端）
npm run electron

# 同时运行后端和 Electron（开发测试）
npm run electron:dev
```

### 打包当前平台
```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

### 打包所有平台
```bash
npm run build:all
```

### 使用 dist 命令（按当前平台自动打包）
```bash
npm run dist
```

---

## 输出文件

打包完成后，安装包会生成在 `release/` 目录下：

### macOS
- `Project Manager-1.0.0.dmg` - DMG 安装包
- `Project Manager-1.0.0-mac.zip` - 压缩包

### Windows
- `Project Manager Setup 1.0.0.exe` - NSIS 安装程序
- `Project Manager 1.0.0.exe` - 便携版（无需安装）

### Linux
- `Project Manager-1.0.0.AppImage` - AppImage（跨发行版）
- `project-manager_1.0.0_amd64.deb` - Debian/Ubuntu 安装包
- `project-manager-1.0.0.x86_64.rpm` - Fedora/RHEL 安装包

---

## 跨平台打包注意事项

### macOS 打包
- 只能在 macOS 上打包 DMG
- 如需签名，需要配置 Apple Developer 证书

### Windows 打包
- 可以在 macOS/Linux 上打包（需要 wine）
- 推荐在 Windows 本机打包 NSIS 安装包

### Linux 打包
- 可以在任何平台打包
- 打包 deb/rpm 需要相应的系统工具

---

## CI/CD 自动发布（GitHub Actions 示例）

在项目根目录创建 `.github/workflows/release.yml`：

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install Dependencies
        run: npm ci

      - name: Build Electron App
        run: npm run dist
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-${{ runner.os }}
          path: release/
```

---

## 系统要求

### 构建环境
- Node.js >= 16.0.0
- npm >= 8.0.0

### 运行环境
- macOS >= 10.13 (High Sierra)
- Windows >= 10
- Linux (大多数现代发行版)

---

## 常见问题

### 1. 打包失败，提示找不到图标
```
解决：确认 build/ 目录下有对应图标文件，或删除 package.json 中的 icon 配置使用默认图标
```

### 2. macOS 上无法打开应用
```
解决：右键打开，或在 系统设置 -> 隐私与安全性 中允许运行
```

### 3. Windows Defender 报毒
```
这是常见的误报，可以提交给 Microsoft 进行白名单认证，或使用代码签名证书
```

### 4. 打包速度慢
```
- 确保 node_modules 已正确安装
- 使用国内镜像：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

---

## 版本更新

1. 修改 `package.json` 中的 `version` 字段
2. 提交代码并打 tag
3. 运行打包命令

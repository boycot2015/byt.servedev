export default {
  app: {
    name: 'Project Manager',
    identifier: 'com.project-manager.app',
    version: '1.0.0',
  },
  // macOS 平台专属配置
  mac: {
    // 打包输出dmg + app
    target: ["dmg", "app"],
    // 图标：使用根目录 icon.iconset 文件夹（自动读取）
    // 不签名本地调试打包时关闭
    codesign: false,
    notarize: false,
    // 打包架构：arm64(M芯片) / x64(Intel) / universal(通用双架构)
    arch: "universal",
  },
  // Windows 平台专属配置
  win: {
    // 图标文件（PNG 格式，推荐 256x256 或更大）
    icon: "src/assets/win/icon.png",
    // 是否打包 CEF
    bundleCEF: true,
  },
  // Linux 平台专属配置
  linux: {
    // 图标文件（PNG 格式，推荐 512x512）
    icon: "src/assets/linux/icon.png",
    // 是否打包 CEF
    bundleCEF: true,
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
  },
};

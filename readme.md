# 项目管理工具 v1.0.0

## 项目概述

这是一个基于 Node.js 的开发项目管理工具，用于简化前端项目的启动和管理流程。采用前后端分离架构，后端使用原生 Node.js HTTP 服务器，前端使用原生 JavaScript。

### 技术栈

- **后端**: Node.js (原生 HTTP 模块)
- **前端**: 原生 JavaScript + HTML5 + CSS3
- **数据存储**: JSON 文件 (projects.json, groups.json)
- **端口**: 默认 3000

---

## 目录结构

```
byt.servedev/
├── server.js              # 后端服务器主文件
├── projects.json          # 项目数据存储
├── groups.json            # 分组数据存储
├── package.json           # 项目配置
├── README.md              # 项目管理工具介绍
└── public/                # 前端静态文件
    ├── index.html         # 主页面
    ├── app.js             # 前端逻辑
    └── styles.css         # 样式文件
```

---

## 核心功能

### 1. 项目管理

#### 1.1 项目导入
- **单项目导入**: 选择单个项目文件夹导入
- **批量扫描导入**: 扫描文件夹批量导入项目
- **Git 仓库导入**: 支持导入局域网 GitLab、GitHub 仓库项目
  - 项目已存在时可选择跳过或覆盖
  - 不存在时让用户选择保存路径

#### 1.2 项目信息展示
- 项目名称、版本号、Node 版本
- 项目描述（自动从 package.json 或 README 提取）
- 项目状态：
  - `running`: 运行中（绿色边框）
  - `starting`: 启动中（橙色边框）
  - `stopped`: 已停止（灰色边框）
- 创建时间和修改时间（按时间排序，最新在最前）
- 端口号和实际运行端口

#### 1.3 项目操作
- 启动/停止项目
- 重启项目（支持端口占用自动杀死）
- 编辑项目信息
- 删除项目（支持批量删除）
- 在编辑器中打开项目（VS Code）
- 查看 package.json
- 查看实时日志

---

### 2. Git 操作功能

#### 2.1 Git 信息展示
- **分支名称显示**: 项目名称后以绿色标签显示当前分支
- **最新提交记录**: 项目卡片底部显示最新一条提交记录
  - 提交 ID: 显示前 7 位，紫色 monospace 字体
  - 提交信息: 超过 30 字符截断显示，hover 显示完整内容

#### 2.2 Git 操作按钮
Actions 区域新增 4 个 Git 操作按钮（紫色渐变样式）：

| 按钮 | 功能 | 说明 |
|------|------|------|
| 拉取 | `git pull` | 拉取最新代码，冲突时自动打开编辑器 |
| 同步 | `git push` | 推送本地提交到远程 |
| 迁出 | 切换分支 | 同切换分支功能，弹出分支选择弹窗 |
| 合并 | `git merge` | 选择源分支合并到当前分支，冲突时自动打开编辑器 |

#### 2.3 分支切换
- 点击分支名称标签弹出分支选择弹窗
- 显示本地和远程所有分支
- 标识当前分支
- 切换成功后自动更新提交信息展示
- **冲突处理**: 检测到冲突时返回 `hasConflict` 标志，前端自动打开 VS Code 编辑器

#### 2.4 合并分支
- 弹窗选择要合并的源分支
- 显示当前分支信息
- 合并成功后更新提交信息
- **冲突处理**: 检测到冲突时返回 `hasConflict` 标志，前端自动打开 VS Code 编辑器

---

### 3. 分组管理

- 创建分组
- 重命名分组
- 删除分组（删除时项目自动移到"默认分组"）
- 按分组筛选项目
- 侧边栏展示分组及项目数量
- 分组排序

---

### 4. 其他功能

#### 4.1 主题切换
- 支持明暗主题切换
- 使用 localStorage 保存主题偏好
- 支持系统主题检测

#### 4.2 响应式设计
- 支持移动端侧边栏抽屉菜单
- 分组筛选
- 状态筛选
- 搜索功能

---

## API 接口文档

### 项目相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 获取所有项目列表（含运行状态） |
| POST | `/api/projects` | 导入单个项目 |
| POST | `/api/projects/batch` | 批量导入项目 |
| PUT | `/api/projects/{id}` | 更新项目信息 |
| DELETE | `/api/projects/{id}` | 删除单个项目 |
| POST | `/api/projects/batch-delete` | 批量删除项目 |

### Git 相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects/{id}/git/info` | 获取 Git 信息（分支、最新提交） |
| GET | `/api/projects/{id}/git/branches` | 获取分支列表 |
| POST | `/api/projects/{id}/git/checkout` | 切换分支 |
| POST | `/api/projects/{id}/git/pull` | 拉取代码 |
| POST | `/api/projects/{id}/git/push` | 推送代码（同步） |
| POST | `/api/projects/{id}/git/merge` | 合并分支 |

#### Git API 响应格式

**获取 Git 信息**
```json
{
  "isGitRepo": true,
  "currentBranch": "main",
  "commitId": "a1b2c3d4e5f6g7h8i9j0",
  "commitMessage": "feat: add new feature"
}
```

**冲突响应（checkout/pull/merge）**
```json
{
  "error": "错误信息...",
  "hasConflict": true
}
```

### 分组相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/groups` | 获取所有分组 |
| POST | `/api/groups` | 创建分组 |
| PUT | `/api/groups` | 重命名分组 |
| DELETE | `/api/groups` | 删除分组 |

### 其他 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/browse-folder` | 浏览文件夹（macOS） |
| POST | `/api/start/{id}` | 启动项目 |
| POST | `/api/stop/{id}` | 停止项目 |
| GET | `/api/logs/{id}` | 获取项目日志 |
| POST | `/api/scan-projects` | 扫描项目 |
| POST | `/api/git/clone` | 克隆 Git 仓库 |

---

## 前端核心模块

### 数据缓存机制

```javascript
// Git 信息缓存，避免重复请求
let gitInfoCache = {};
```

### 核心函数

| 函数名 | 功能 |
|--------|------|
| `loadProjects()` | 加载项目列表，并行获取所有项目 Git 信息 |
| `renderProjects()` | 渲染项目卡片，含 Git 信息展示 |
| `fetchGitInfo(projectId)` | 获取单个项目 Git 信息 |
| `fetchGitBranches(projectId)` | 获取项目分支列表 |
| `checkoutBranch()` | 切换分支 |
| `gitPull(projectId)` | 拉取代码，冲突时打开编辑器 |
| `gitPush(projectId)` | 推送代码 |
| `executeMerge()` | 执行合并，冲突时打开编辑器 |
| `openEditor(path)` | 在 VS Code 中打开项目 |
| `truncateCommitMessage(msg)` | 提交信息截断（30字符） |
| `formatCommitId(id)` | 格式化提交 ID（前 7 位） |

---

## 样式说明

### Git 相关样式类

| 类名 | 说明 |
|------|------|
| `.git-branch-tag` | 分支标签（绿色背景） |
| `.git-commit-info` | 提交信息区域 |
| `.git-commit-id` | 提交 ID（紫色 monospace 字体） |
| `.git-actions` | Git 按钮容器 |
| `.btn-git` | Git 操作按钮（紫色渐变） |

### 项目状态边框颜色

| 状态 | 边框颜色 | 类名 |
|------|----------|------|
| running | 绿色 | `.project-item.running` |
| starting | 橙色 | `.project-item.starting` |
| stopped | 灰色 | `.project-item.stopped` |

---

## 数据结构

### 项目数据结构 (projects.json)

```javascript
{
  "id": 1234567890123,           // 项目唯一 ID（时间戳）
  "name": "project-name",        // 项目名称
  "version": "1.0.0",            // 版本号
  "nodeVersion": ">=16.0.0",     // Node 版本要求
  "projectPath": "/path/to/proj",// 项目绝对路径
  "port": 1024,                  // 配置端口
  "group": "默认分组",           // 所属分组
  "scripts": {},                 // package.json scripts
  "description": "",             // 项目描述
  "createdAt": 1234567890123,    // 创建时间
  "updatedAt": 1234567890123     // 修改时间
}
```

### 运行时状态

```javascript
{
  "status": "running|starting|stopped",  // 运行状态
  "port": 3001,                           // 实际运行端口
  "nodeVersion": "v16.0.0"                // 实际使用的 Node 版本
}
```

---

## 启动方式

```bash
# 安装依赖（无外部依赖）
# 直接启动
npm start

# 或
node server.js
```

访问 http://localhost:3000

---

## 注意事项

1. **Git 仓库检测**: 需要项目目录下存在 `.git` 文件夹才能使用 Git 功能
2. **冲突处理**: 切换分支、拉取、合并操作检测到冲突时，会自动调用 `code` 命令打开 VS Code
3. **端口占用**: 启动项目时如果端口被占用，会自动查找可用端口，支持强制杀死占用进程
4. **Node 版本管理**: 优先使用 fnm 切换到项目指定的 Node 版本
5. **macOS 专属**: 文件夹浏览功能使用 AppleScript，仅支持 macOS

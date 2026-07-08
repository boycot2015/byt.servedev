import { BrowserWindow } from 'electrobun/bun';
import { spawn, exec } from 'child_process';
import { createServer } from 'net';
import path from 'path';
import fs from 'fs';

interface Project {
  id: number;
  name: string;
  version?: string;
  nodeVersion?: string;
  projectPath: string;
  group: string;
  scripts: Record<string, string>;
  description?: string;
  port?: number;
  pid?: number;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  isGitRepo: boolean;
  lastRunTime?: string;
  currentBranch?: string;
  commitId?: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitTime?: string;
  aheadCount?: number;
  behindCount?: number;
}

interface GroupStats {
  [key: string]: number;
}

interface ScanResult {
  path: string;
  name: string;
  version?: string;
  hasPackageJson: boolean;
  hasGit: boolean;
  packageJson?: {
    name?: string;
    scripts?: { [key: string]: string };
  };
}

interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

let projects: Project[] = [];
let groups: string[] = ['默认分组'];
let projectLogs: { [key: string]: { logs: { type: 'stdout' | 'stderr'; content: string }[]; index: number } } = {};
let projectProcesses: { [key: string]: any } = {};

const dataDir = path.join(__dirname, '../../');
const projectsFile = path.join(dataDir, 'projects.json');
const groupsFile = path.join(dataDir, 'groups.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  try {
    if (fs.existsSync(projectsFile)) {
      projects = JSON.parse(fs.readFileSync(projectsFile, 'utf-8'));
    }
  } catch {
    projects = [];
  }
  try {
    if (fs.existsSync(groupsFile)) {
      const savedGroups = JSON.parse(fs.readFileSync(groupsFile, 'utf-8'));
      if (savedGroups.includes('默认分组')) {
        groups = savedGroups;
      } else {
        groups = ['默认分组', ...savedGroups];
      }
    }
  } catch {
    groups = ['默认分组'];
  }
}

function saveProjects() {
  ensureDataDir();
  fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));
}

function saveGroups() {
  ensureDataDir();
  fs.writeFileSync(groupsFile, JSON.stringify(groups, null, 2));
}

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
    server.listen(startPort, () => {
      server.close(() => {
        resolve(startPort);
      });
    });
  });
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

function killPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`netstat -ano | findstr ":${port}" | findstr LISTENING`, (err, stdout) => {
        const lines = stdout.trim().split('\n');
        lines.forEach(line => {
          const match = line.match(/\s+(\d+)$/);
          if (match) {
            exec(`taskkill /F /PID ${match[1]}`);
          }
        });
        resolve();
      });
    } else {
      exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, () => resolve());
    }
  });
}

async function detectNodeVersion(projectPath: string): Promise<{ version: string; manager: string; fallback?: boolean }> {
  return new Promise((resolve) => {
    const pkg = getPackageJson(projectPath);
    
    let nodeVersion = pkg?.engines?.node || '';
    
    if (!nodeVersion || nodeVersion === '未指定') {
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      const getMajor = (v: string, len = 1) => parseInt(v.replace(/[^0-9]/g, '').substring(0, len)) || 0;
      
      // 框架检测规则配置 - 按优先级排序
      const frameworks = [
        { keys: ['vue', 'vue@next'], map: (v: string) => getMajor(v) === 3 ? '22.16.0' : '14.19.0' },
        { keys: ['nuxt', 'nuxt3', 'nuxt-edge'], map: (v: string) => getMajor(v) === 3 ? '22.16.0' : '14.19.0' },
        { keys: ['next', 'next@canary'], map: (v: string) => getMajor(v, 2) >= 13 ? '22.16.0' : '18.18.0' },
        { keys: ['react', 'react-dom'], map: (v: string) => getMajor(v, 2) >= 18 ? '22.16.0' : '16.14.0' }
      ];
      
      for (const { keys, map } of frameworks) {
        const version = keys.map(k => deps?.[k]).find(Boolean);
        if (version) {
          nodeVersion = map(version);
          break;
        }
      }
      nodeVersion = nodeVersion || '22.16.0';
    }
    
    // 清理版本号（去掉 >=, ^, ~, v 等前缀）
    const cleanVersion = nodeVersion.replace(/^[>=^~v]+/, '').replace('>=', '').replace('^', '').replace('~', '');
    
    // 检测 nvm（nvm 是 shell 函数，which 找不到，所以直接检查目录）
    const nvmPath = process.env.HOME + '/.nvm/nvm.sh';
    if (fs.existsSync(nvmPath)) {
      exec(`bash -c "source '${nvmPath}' && nvm ls '${cleanVersion}' 2>/dev/null"`, (err, nvmOutput) => {
        if (!err && nvmOutput.trim() && !nvmOutput.includes('N/A') && !nvmOutput.includes('not installed')) {
          resolve({ version: cleanVersion, manager: 'nvm' });
        } else {
          resolve({ version: cleanVersion, manager: 'nvm', fallback: true });
        }
      });
      return;
    }
    
    // 检测 fnm
    exec('which fnm 2>/dev/null', (err, output) => {
      if (!err && output.trim()) {
        exec(`bash -c "fnm list '${cleanVersion}' 2>/dev/null"`, (err, fnmOutput) => {
          if (!err && fnmOutput.trim() && !fnmOutput.includes('not installed')) {
            resolve({ version: cleanVersion, manager: 'fnm' });
          } else {
            resolve({ version: cleanVersion, manager: 'fnm', fallback: true });
          }
        });
      } else {
        resolve({ 
          version: cleanVersion || '14.19.0', 
          manager: 'nvm',
          fallback: true 
        });
      }
    });
  });
}

function executeGitCommand(projectPath: string, command: string): Promise<string> {
  return new Promise((resolve) => {
    exec(`cd "${projectPath}" && git ${command}`, (error, stdout, stderr) => {
      if (error) {
        resolve(stderr || '');
      } else {
        resolve(stdout || '');
      }
    });
  });
}
function stripMarkdownFormatting(text: string) {
  return text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/```[\w-]*\s*([\s\S]*?)```/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\n/g, ' ')
    .trim();
}
function getPackageJson(projectPath: string) {
  const pkgPath = path.join(projectPath, 'package.json');
  try {
    const data = fs.readFileSync(pkgPath, 'utf8');
    
    return JSON.parse(data);
  } catch {
    return null;
  }
}
function getProjectDescription(projectPath: string) {
  const limitWidth = 999;
  const pkg = getPackageJson(projectPath);
  if (pkg?.description) {
    const desc = stripMarkdownFormatting(pkg.description);
    return desc.substring(0, limitWidth) + (desc.length > limitWidth ? '...' : '');
  }
  
  const readmePath = path.join(projectPath, 'README.md');
  if (fs.existsSync(readmePath)) {
    try {
      const content = fs.readFileSync(readmePath, 'utf8');
      // 先对整个内容做 markdown 清理
      const cleanContent = stripMarkdownFormatting(content);
      const lines = cleanContent.split('\n');
      
      let title = '';
      let firstParagraph = '';
      let foundTitle = false;
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (!trimmedLine) continue;
        
        if (!foundTitle) {
          title = trimmedLine;
          foundTitle = true;
          continue;
        }
        
        // 跳过仍然像标题的行（清理后可能还有残留）
        if (trimmedLine.startsWith('##') || trimmedLine.startsWith('###')) continue;
        
        if (!firstParagraph) {
          firstParagraph = trimmedLine;
          break;
        }
      }
      
      let description = title;
      if (firstParagraph) {
        description = description ? `${title} ${firstParagraph}` : firstParagraph;
      }
      
      if (description) {
        return description.substring(0, limitWidth) + (description.length > limitWidth ? '...' : '');
      }
    } catch {
      return '';
    }
  }
  
  return '';
}
async function getGitInfoInternal(projectPath: string): Promise<{
  isGitRepo: boolean;
  currentBranch?: string;
  commitId?: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitTime?: string;
  aheadCount?: number;
  behindCount?: number;
}> {
  try {
    const isRepo = await executeGitCommand(projectPath, 'branch --show-current 2>/dev/null');
    if (!isRepo) {
      return { isGitRepo: false };
    }

    const branch = await executeGitCommand(projectPath, 'rev-parse --abbrev-ref HEAD');
    const commit = await executeGitCommand(projectPath, 'log -1 --format=%H');
    const message = await executeGitCommand(projectPath, 'log -1 --format=%s');
    const author = await executeGitCommand(projectPath, 'log -1 --format=%an');
    const time = await executeGitCommand(projectPath, 'log -1 --format=%ct');
    
    const aheadBehind = await executeGitCommand(projectPath, 'rev-list --left-right --count HEAD...@{u} 2>/dev/null');
    let aheadCount = 0, behindCount = 0;
    if (aheadBehind.trim()) {
      const parts = aheadBehind.trim().split(/\s+/);
      if (parts.length >= 2) {
        aheadCount = parseInt(parts[0]) || 0;  // 本地比远程多的提交数（需要推送）
        behindCount = parseInt(parts[1]) || 0; // 远程比本地多的提交数（需要拉取）
      }
    }

    return {
      isGitRepo: true,
      currentBranch: branch.trim(),
      commitId: commit.trim(),
      commitMessage: message.trim(),
      commitAuthor: author.trim(),
      commitTime: time.trim(),
      aheadCount,
      behindCount
    };
  } catch {
    return { isGitRepo: false };
  }
}

async function getGitBranchesInternal(projectPath: string): Promise<{ isGitRepo: boolean; branches: GitBranch[] }> {
  try {
    const isRepo = await executeGitCommand(projectPath, 'branch --show-current 2>/dev/null');
    if (!isRepo) {
      return { isGitRepo: false, branches: [] };
    }

    const currentBranch = await executeGitCommand(projectPath, 'rev-parse --abbrev-ref HEAD');
    const allBranches = await executeGitCommand(projectPath, 'branch -a');
    
    const branches: GitBranch[] = [];
    allBranches.split('\n').forEach(line => {
      line = line.trim();
      if (!line) return;
      
      let name = line.replace('*', '').trim();
      let isRemote = false;
      
      if (name.startsWith('remotes/origin/')) {
        name = name.replace('remotes/origin/', '');
        isRemote = true;
        if (branches.some(b => b.name === name && !b.isRemote)) return;
      }
      
      branches.push({
        name,
        isCurrent: name === currentBranch.trim(),
        isRemote
      });
    });

    return { isGitRepo: true, branches };
  } catch {
    return { isGitRepo: false, branches: [] };
  }
}

const apiHandlers: { [key: string]: (params?: any) => Promise<any> | any } = {
  getGroups: () => groups,

  createGroup: (params: { name: string }) => {
    const name = params.name;
    if (!name || name.trim() === '') {
      return { success: false, error: '分组名称不能为空' };
    }
    if (groups.includes(name)) {
      return { success: false, error: '分组已存在' };
    }
    groups.push(name);
    saveGroups();
    return { success: true, groups };
  },

  renameGroup: (params: { oldName: string; newName: string }) => {
    const { oldName, newName } = params;
    if (!newName || newName.trim() === '') {
      return { success: false, error: '分组名称不能为空' };
    }
    if (oldName === '默认分组') {
      return { success: false, error: '不能重命名默认分组' };
    }
    if (groups.includes(newName)) {
      return { success: false, error: '分组已存在' };
    }
    const index = groups.indexOf(oldName);
    if (index === -1) {
      return { success: false, error: '分组不存在' };
    }
    groups[index] = newName;
    projects.forEach(p => {
      if (p.group === oldName) {
        p.group = newName;
      }
    });
    saveGroups();
    saveProjects();
    return { success: true, groups };
  },

  deleteGroup: (params: { name: string }) => {
    const name = params.name;
    if (name === '默认分组') {
      return { success: false, error: '不能删除默认分组' };
    }
    const index = groups.indexOf(name);
    if (index === -1) {
      return { success: false, error: '分组不存在' };
    }
    groups.splice(index, 1);
    projects.forEach(p => {
      if (p.group === name) {
        p.group = '默认分组';
      }
    });
    saveGroups();
    saveProjects();
    return { success: true, groups };
  },

  getProjects: (params: { page?: number; pageSize?: number; group?: string; status?: string; search?: string; } = {}) => {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    let filtered = [...projects];

    if (params.group && params.group !== '全部') {
      filtered = filtered.filter(p => p.group === params.group);
    }
    if (params.status && params.status !== 'all') {
      filtered = filtered.filter(p => p.status === params.status);
    }

    if (params.search) {
      const searchLower = params.search.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchLower) || 
        p.projectPath.toLowerCase().includes(searchLower)
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginated = filtered.slice(start, end).sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));

    const groupStats: GroupStats = {};
    projects.forEach(p => {
      groupStats[p.group] = (groupStats[p.group] || 0) + 1;
    });

    return {
      list: paginated,
      page,
      pageSize,
      total,
      hasMore: end < total,
      groupStats
    };
  },

  getProjectById: (params: { id: number }) => {
    return projects.find(p => p.id == params.id) || null;
  },

  importProject: async (params: { projectPath: string; group?: string }) => {
    const { projectPath, group } = params;
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { success: false, error: '路径不存在' };
    }

    const existing = projects.find(p => p.projectPath === projectPath);
    if (existing) {
      return { success: false, error: '项目已存在' };
    }

    let pkg = getPackageJson(projectPath);
    if (!pkg) {
      return { success: false, error: 'package.json 不存在' };
    }

    const project: Project = {
      id: Date.now(),
      createdAt: Date.now(),
      name: path.basename(projectPath),
      projectPath: projectPath,
      group: group || '默认分组',
      scripts: pkg.scripts || {},
      version: pkg.version || '',
      nodeVersion: pkg.engines?.node || '未指定',
      description: pkg.description || getProjectDescription(projectPath) || '',
      status: 'stopped',
      isGitRepo: false
    };

    const gitInfo = await getGitInfoInternal(projectPath);
    project.isGitRepo = gitInfo.isGitRepo;
    project.currentBranch = gitInfo.currentBranch;
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    project.aheadCount = gitInfo.aheadCount;
    project.behindCount = gitInfo.behindCount;

    projects.push(project);
    saveProjects();
    return { success: true, project };
  },

  updateProject: (params: Project) => {
    const { id } = params;
    const index = projects.findIndex(p => p.id == id);
    if (index === -1) {
      return { success: false, error: '项目不存在' };
    }

    for (const key in params) {
      if (key !== 'id' && params[key as keyof Project] !== undefined) {
        (projects[index] as any)[key] = params[key as keyof Project];
      }
    }
    projects[index].updatedAt = Date.now();
    saveProjects();
    return { success: true, project: projects[index] };
  },

  deleteProject: (params: { id: number }) => {
    const id = params.id;
    const index = projects.findIndex(p => p.id == id);
    if (index === -1) {
      return { success: false, error: '项目不存在' };
    }

    if (projects[index].status === 'running') {
      return { success: false, error: '请先停止项目' };
    }

    projects.splice(index, 1);
    saveProjects();
    return { success: true };
  },

  batchImportProjects: async (params: { paths: string[]; group: string }) => {
    const { paths, group } = params;
    const results: any[] = [];
    for (const projectPath of paths) {
      if (!fs.existsSync(projectPath)) {
        results.push({ success: false, path: projectPath, error: '路径不存在' });
        continue;
      }

      const existing = projects.find(p => p.projectPath === projectPath);
      if (existing) {
        results.push({ success: false, path: projectPath, error: '项目已存在' });
        continue;
      }

      let pkg = getPackageJson(projectPath);
      if (!pkg) {
        results.push({ success: false, path: projectPath, error: 'package.json 不存在' });
        continue;
      }

      const project: Project = {
        id: Date.now(),
        createdAt: Date.now(),
        name: path.basename(projectPath),
        projectPath: projectPath,
        group: group || '默认分组',
        scripts: pkg.scripts || {},
        version: pkg.version || '',
        nodeVersion: pkg.engines?.node || '未指定',
        description: pkg.description || getProjectDescription(projectPath) || '',
        status: 'stopped',
        isGitRepo: false
      };

      const gitInfo = await getGitInfoInternal(projectPath);
      project.isGitRepo = gitInfo.isGitRepo;
      project.currentBranch = gitInfo.currentBranch;
      project.commitId = gitInfo.commitId;
      project.commitMessage = gitInfo.commitMessage;
      project.commitAuthor = gitInfo.commitAuthor;
      project.commitTime = gitInfo.commitTime;
      project.aheadCount = gitInfo.aheadCount;
      project.behindCount = gitInfo.behindCount;

      projects.push(project);
      results.push({ success: true, project });
    }
    saveProjects();
    return { results, total: results.length, successCount: results.filter(r => r.success).length };
  },

  batchDeleteProjects: (params: { ids: string[] }) => {
    const ids = params.ids;
    const runningIds = projects.filter(p => p.status === 'running' && !ids.map(id => id.toString()).includes(p.id?.toString())).map(p => p.id);
    if (runningIds.length > 0) {
      return { success: false, error: `以下项目正在运行，请先停止: ${runningIds.join(', ')}` };
    }

    projects = projects.filter(p => !ids.map(id => id.toString()).includes(p.id?.toString()));
    saveProjects();
    return { success: true, deletedCount: ids.length, remainingCount: projects.length };
  },

  startProject: async (params: { id: number }) => {
    const id = params.id;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    if (!project.projectPath || !fs.existsSync(project.projectPath)) {
      return { success: false, error: '项目路径不存在' };
    }

    // 防止启动项目管理工具本身
    if (project.projectPath === path.dirname(require.main?.filename || '') || 
        project.projectPath === __dirname ||
        project.projectPath === path.join(__dirname, '../..')) {
      return { success: false, error: '不能启动项目管理工具本身' };
    }

    const packageJsonPath = path.join(project.projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return { success: false, error: 'package.json 不存在' };
    }

    const nodeModulesPath = path.join(project.projectPath, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log(`项目 ${project.name} 缺少依赖，正在自动执行 npm install...`);
      
      // 初始化日志进程
      projectProcesses[id] = {
        process: null,
        logs: [
          { type: 'system', content: '检测到缺少依赖，正在自动执行 npm install...' },
          { type: 'system', content: '请等待安装完成后重新启动项目' },
          { type: 'stdout', content: '> npm install' }
        ],
        pid: null,
        nodeVersion: null,
        actualPort: null,
        status: 'installing'
      };
      
      // 返回正在安装的状态
      const result = { 
        success: true, 
        installing: true,
        message: '正在安装项目依赖，请查看日志...' 
      };
      
      // 使用 spawn 执行 npm install 捕获实时日志
      const installProcess = spawn('npm', ['install'], { 
        cwd: project.projectPath,
        shell: true,
        detached: true
      });
      
      projectProcesses[id].process = installProcess;
      projectProcesses[id].pid = installProcess.pid;
      
      installProcess.stdout.on('data', (data) => {
        const log = data.toString();
        if (projectProcesses[id]) {
          projectProcesses[id].logs.push({ type: 'stdout', content: log });
        }
      });
      
      installProcess.stderr.on('data', (data) => {
        const log = data.toString();
        if (projectProcesses[id]) {
          projectProcesses[id].logs.push({ type: 'stderr', content: log });
        }
      });
      
      installProcess.on('close', (code) => {
        if (projectProcesses[id]) {
          if (code === 0) {
            projectProcesses[id].logs.push({ type: 'system', content: '✓ 依赖安装完成！可以启动项目了' });
            projectProcesses[id].status = 'stopped';
            console.log(`项目 ${project.name} 依赖安装完成`);
          } else {
            projectProcesses[id].logs.push({ type: 'system', content: `✗ 依赖安装失败，退出码: ${code}` });
            projectProcesses[id].status = 'stopped';
            console.error(`项目 ${project.name} npm install 失败，退出码: ${code}`);
          }
        }
      });
      
      installProcess.on('error', (err) => {
        if (projectProcesses[id]) {
          projectProcesses[id].logs.push({ type: 'system', content: `✗ 依赖安装出错: ${err.message}` });
          projectProcesses[id].status = 'stopped';
        }
      });
      
      return result;
    }

    if (projectProcesses[id] && projectProcesses[id].status === 'running') {
      return { success: false, error: '项目已在运行中' };
    }

    // 自动选择启动脚本
    let startScript = 'dev';
    if (project.scripts) {
      if (project.scripts.dev) startScript = 'dev';
      else if (project.scripts.serve) startScript = 'serve';
      else if (project.scripts.start) startScript = 'start';
      else {
        const scripts = Object.keys(project.scripts);
        if (scripts.length > 0) startScript = scripts[0];
      }
    }

    // 检测 Node 版本
    const nodeInfo = await detectNodeVersion(project.projectPath);
    console.log(nodeInfo, 'nodeInfo');
    // 获取端口
    let startPort = project.port || 1024;
    const portAvailable = await checkPort(startPort);
    if (!portAvailable) {
      console.log(`端口 ${startPort} 被占用，正在尝试清理...`);
      await killPort(startPort);
    }
    
    // 设置环境变量
    const portEnv = `PORT=${startPort} VITE_PORT=${startPort}`;
    const nvmPath = process.env.HOME + '/.nvm/nvm.sh';
    
    let command: string;
    let args: string[];
    
    if (nodeInfo.manager === 'nvm') {
      command = 'bash';
      args = ['-c', `
        cd "${project.projectPath}"
        if [ -f "${nvmPath}" ]; then
          source "${nvmPath}"
          # 尝试使用指定版本，如果不存在则安装
          if nvm ls "${nodeInfo.version}" | grep -q "N/A\|not installed"; then
            echo "Installing Node.js ${nodeInfo.version}..."
            nvm install "${nodeInfo.version}"
          fi
          nvm use "${nodeInfo.version}"
          echo "Using Node.js version: $(node -v)"
        fi
        ${portEnv} npm run ${startScript}
      `];
      console.log('Using nvm with version:', nodeInfo.version, 'and port:', startPort);
    } else if (nodeInfo.manager === 'fnm') {
      command = 'bash';
      args = ['-c', `
        cd "${project.projectPath}"
        if command -v fnm &> /dev/null; then
          eval "$(fnm env)"
          # 尝试使用指定版本，如果不存在则安装
          if ! fnm list | grep -q "${nodeInfo.version}"; then
            echo "Installing Node.js ${nodeInfo.version}..."
            fnm install "${nodeInfo.version}"
          fi
          fnm use "${nodeInfo.version}"
          echo "Using Node.js version: $(node -v)"
        fi
        ${portEnv} npm run ${startScript}
      `];
      console.log('Using fnm with version:', nodeInfo.version, 'and port:', startPort);
    } else {
      command = 'bash';
      args = ['-c', `cd "${project.projectPath}" && ${portEnv} npm run ${startScript}`];
      console.log('Using system Node.js and port:', startPort);
    }

    // 初始化日志
    projectLogs[id] = { logs: [], index: 0 };

    // 启动进程
    const child = spawn(command, args, { 
      stdio: ['pipe', 'pipe', 'pipe'], 
      shell: true, 
      cwd: project.projectPath, 
      detached: true 
    });

    projectProcesses[id] = {
      process: child,
      logs: [],
      pid: child.pid,
      nodeVersion: nodeInfo.version,
      actualPort: startPort,
      status: 'starting'
    };

    // 标记是否已将状态更新为 running
    let statusUpdatedToRunning = false;
    
    // 更新状态为 running 的通用函数
    const updateStatusToRunning = () => {
      if (statusUpdatedToRunning || !projectProcesses[id]) return;
      statusUpdatedToRunning = true;
      
      projectProcesses[id].status = 'running';
      const projectsCopy = [...projects];
      const projectIndex = projectsCopy.findIndex(p => p.id == id);
      if (projectIndex !== -1) {
        projectsCopy[projectIndex].status = 'running';
        projectsCopy[projectIndex].port = startPort;
        projectsCopy[projectIndex].pid = child.pid;
        projectsCopy[projectIndex].nodeVersion = nodeInfo.version;
        projects = projectsCopy;
        saveProjects();
      }
    };

    child.stdout.on('data', (data: Buffer) => {
      const log = data.toString();
      projectLogs[id].logs.push({ type: 'stdout', content: log });
      if (projectProcesses[id]) {
        projectProcesses[id].logs.push({ type: 'stdout', content: log });
      }
      
      // 只要有日志输出，就认为服务已开始运行，更新状态为 running
      updateStatusToRunning();
      
      // 从日志中自动检测实际端口
      const portMatch = log.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|:::):(\d+)/);
      if (portMatch && projectProcesses[id]) {
        const detectedPort = parseInt(portMatch[1]);
        if (detectedPort !== projectProcesses[id].actualPort) {
          projectProcesses[id].actualPort = detectedPort;
          const projectsCopy = [...projects];
          const projectIndex = projectsCopy.findIndex(p => p.id == id);
          if (projectIndex !== -1) {
            projectsCopy[projectIndex].port = detectedPort;
            projectsCopy[projectIndex].nodeVersion = nodeInfo.version;
            projects = projectsCopy;
            saveProjects();
          }
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const log = data.toString();
      projectLogs[id].logs.push({ type: 'stderr', content: log });
      if (projectProcesses[id]) {
        projectProcesses[id].logs.push({ type: 'stderr', content: log });
      }
      
      // 只要有日志输出（包括 stderr），就认为服务已开始运行
      updateStatusToRunning();
      
      // 从日志中自动检测实际端口
      const portMatch = log.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|:::):(\d+)/);
      if (portMatch && projectProcesses[id]) {
        const detectedPort = parseInt(portMatch[1]);
        if (detectedPort !== projectProcesses[id].actualPort) {
          projectProcesses[id].actualPort = detectedPort;
          const projectsCopy = [...projects];
          const projectIndex = projectsCopy.findIndex(p => p.id == id);
          if (projectIndex !== -1) {
            projectsCopy[projectIndex].port = detectedPort;
            projectsCopy[projectIndex].nodeVersion = nodeInfo.version;
            projects = projectsCopy;
            saveProjects();
          }
        }
      }
    });

    child.on('close', (code) => {
      if (projectProcesses[id]) {
        const prevStatus = projectProcesses[id].status;
        projectProcesses[id].status = 'stopped';
        if (prevStatus === 'starting') {
          projectProcesses[id].logs.push({ type: 'system', content: `启动失败，进程已退出，退出码: ${code}` });
        } else {
          projectProcesses[id].logs.push({ type: 'system', content: `进程已退出，退出码: ${code}` });
        }
        const projectsCopy = [...projects];
        const projectIndex = projectsCopy.findIndex(p => p.id == id);
        if (projectIndex !== -1) {
          projectsCopy[projectIndex].status = 'stopped';
          projectsCopy[projectIndex].pid = undefined;
          projectsCopy[projectIndex].nodeVersion = nodeInfo.version;
          projects = projectsCopy;
          saveProjects();
        }
      }
    });

    project.status = 'running';
    project.port = startPort;
    project.pid = child.pid;
    project.lastRunTime = new Date().toISOString();
    saveProjects();

    return { 
      success: true, 
      port: startPort,
      script: startScript,
      nodeVersion: nodeInfo.version,
      manager: nodeInfo.manager
    };
  },

  stopProject: (params: { id: number }) => {
    const id = params.id;
    
    if (projectProcesses[id] && (projectProcesses[id].status === 'running' || projectProcesses[id].status === 'starting')) {
      const pid = projectProcesses[id].pid;
      const actualPort = projectProcesses[id].actualPort;
      projectProcesses[id].status = 'stopped';
      
      // 使用 pkill + kill 组合确保进程完全终止
      if (process.platform === 'win32') {
        exec(`taskkill /F /PID ${pid} 2>nul`);
        exec(`taskkill /F /T /PID ${pid} 2>nul`);
      } else {
        exec(`pkill -P ${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null; sleep 1; pkill -P ${pid} -9 2>/dev/null; kill -KILL ${pid} 2>/dev/null`);
      }
      
      delete projectProcesses[id];
      
      // 保存实际端口
      if (actualPort) {
        const projectsCopy = [...projects];
        const projectIndex = projectsCopy.findIndex(p => p.id == id);
        if (projectIndex !== -1) {
          projectsCopy[projectIndex].port = actualPort;
          projectsCopy[projectIndex].status = 'stopped';
          projectsCopy[projectIndex].pid = undefined;
          projects = projectsCopy;
          saveProjects();
        }
      }
      
      return { success: true };
    } else {
      // 兼容旧的 isRunning 检查方式
      const project = projects.find(p => p.id == id);
      if (!project) {
        return { success: false, error: '项目不存在' };
      }

      if (project.status !== 'running') {
        return { success: false, error: '项目未在运行' };
      }

      const process = projectProcesses[id];
      if (process) {
        try {
          if (process.pid) {
            if (process.platform === 'win32') {
              exec(`taskkill /F /PID ${process.pid} 2>nul`);
            } else {
              exec(`kill -9 ${process.pid} 2>/dev/null`);
            }
          }
          delete projectProcesses[id];
        } catch {}
      }

      project.status = 'stopped';
      project.pid = undefined;
      project.port = undefined;
      saveProjects();

      return { success: true };
    }
  },

  getProjectStatus: (params: { id: number }) => {
    const id = params.id;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { isRunning: false };
    }
    return {
      status: project.status,
      port: project.port,
      pid: project.pid
    };
  },

  getPackageJson: (params: { id: number }) => {
    const id = params.id;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    const pkg = getPackageJson(project.projectPath);
    if (!pkg) {
      return { success: false, error: 'package.json 不存在' };
    }
    return { success: true, name: project.name, content: pkg };  
  },

  getProjectLogs: (params: { id: string; since?: number }) => {
    const { id, since = 0 } = params;
    const logs = projectLogs[id];
    if (!logs) {
      return { logs: [], index: 0, total: 0 };
    }

    const newLogs = logs.logs.slice(since);
    return {
      logs: newLogs,
      index: logs.logs.length,
      total: logs.logs.length
    };
  },

  getGitInfo: async (params: { id: number }) => {
    const id = params.id;
    
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { isGitRepo: false };
    }
    return await getGitInfoInternal(project.projectPath);
  },

  getGitBranches: async (params: { id: number }) => {
    const id = params.id;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { isGitRepo: false, branches: [] };
    }
    return await getGitBranchesInternal(project.projectPath);
  },

  gitCheckout: async (params: { id: number; branch: string }) => {
    const { id, branch } = params;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    const result = await executeGitCommand(project.projectPath, `checkout "${branch}" 2>&1`);
    const hasConflict = result.includes('error:') || result.includes('冲突');
    if (hasConflict) {
      return { success: false, error: result.trim(), hasConflict };
    }

    const gitInfo = await getGitInfoInternal(project.projectPath);
    project.currentBranch = gitInfo.currentBranch;
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    saveProjects();

    return { 
      success: true, 
      branch, 
      commitId: gitInfo.commitId, 
      commitMessage: gitInfo.commitMessage 
    };
  },

  gitPull: async (params: { id: number }) => {
    const id = params.id;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    const result = await executeGitCommand(project.projectPath, 'pull 2>&1');
    const hasConflict = result.includes('error:') || result.includes('冲突');
    if (hasConflict) {
      return { success: false, error: result.trim(), hasConflict };
    }

    const gitInfo = await getGitInfoInternal(project.projectPath);
    project.currentBranch = gitInfo.currentBranch;
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    project.aheadCount = 0;
    saveProjects();

    return { 
      success: true, 
      output: result.trim(),
      commitId: gitInfo.commitId, 
      commitMessage: gitInfo.commitMessage 
    };
  },

  gitPush: async (params: { id: number }) => {
    const id = params.id;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    const result = await executeGitCommand(project.projectPath, 'push 2>&1');
    if (result.includes('error') || result.includes('fatal')) {
      return { success: false, error: result.trim() };
    }

    project.behindCount = 0;
    saveProjects();

    return { success: true, output: result.trim() };
  },

  gitMerge: async (params: { id: number; branch: string }) => {
    const { id, branch } = params;
    const project = projects.find(p => p.id == id);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }

    const result = await executeGitCommand(project.projectPath, `merge "${branch}" 2>&1`);
    const hasConflict = result.includes('error:') || result.includes('冲突') || result.includes('Automatic merge failed');
    if (hasConflict) {
      return { success: false, error: result.trim(), hasConflict };
    }

    const gitInfo = await getGitInfoInternal(project.projectPath);
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    saveProjects();

    return { 
      success: true, 
      branch, 
      commitId: gitInfo.commitId, 
      commitMessage: gitInfo.commitMessage 
    };
  },

  gitClone: async (params: { url: string; path: string; group: string }) => {
    const { url, path: clonePath, group } = params;
    if (!url || !clonePath) {
      return { success: false, error: 'URL 和路径不能为空' };
    }

    const targetPath = path.join(clonePath, path.basename(url, '.git'));
    if (fs.existsSync(targetPath)) {
      return { success: false, error: '目标路径已存在' };
    }

    const result = await executeGitCommand(clonePath, `clone ${url}`);
    if (result.includes('error') || result.includes('fatal')) {
      return { success: false, error: result };
    }

    let pkg = getPackageJson(targetPath);
    if (!pkg) {
      return { success: false, error: 'package.json 不存在' };
    }

    const project: Project = {
      id: Date.now(),
      name: path.basename(targetPath),
      projectPath: targetPath,
      group: group || '默认分组',
      scripts: pkg.scripts || {},
      version: pkg.version || '',
      nodeVersion: pkg.engines?.node || '未指定',
      description: pkg.description || getProjectDescription(targetPath) || '',
      status: 'stopped',
      isGitRepo: true
    };

    const gitInfo = await getGitInfoInternal(targetPath);
    project.currentBranch = gitInfo.currentBranch;
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    project.aheadCount = gitInfo.aheadCount;
    project.behindCount = gitInfo.behindCount;

    projects.push(project);
    saveProjects();

    return { success: true, project };
  },

  scanDirectory: (params: { scanPath: string; depth?: number }) => {
    const { scanPath, depth = 3 } = params;
    const results: ScanResult[] = [];

    function scan(dir: string, currentDepth: number) {
      if (currentDepth > depth) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name.startsWith('node_modules')) continue;
          
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            const packageJsonPath = path.join(fullPath, 'package.json');
            const gitPath = path.join(fullPath, '.git');
            
            if (fs.existsSync(packageJsonPath)) {
              let packageJson = getPackageJson(fullPath);
              if (!packageJson) continue;

              results.push({
                path: fullPath,
                name: entry.name,
                hasPackageJson: true,
                version: packageJson.version || '',
                hasGit: fs.existsSync(gitPath),
                packageJson
              });
            } else {
              scan(fullPath, currentDepth + 1);
            }
          }
        }
      } catch {
        return;
      }
    }

    scan(scanPath, 0);
    return results;
  },

  browseFolder: () => {
    return new Promise((resolve, reject) => {
      exec(`osascript -e 'POSIX path of (choose folder with prompt "请选择项目目录")'`, (err, output) => {
        if (err) {
          reject({ error: '取消选择' });
        } else {
          const folderPath = output.trim();
          resolve({ path: folderPath });
        }
      });
    })
  },

  openEditor: (params: { path: string }) => {
    const editorPath = params.path;
    if (!fs.existsSync(editorPath)) {
      return { success: false, error: '路径不存在' };
    }

    let command: string;
    let args: string[];

    if (process.platform === 'darwin') {
      command = 'open';
      args = ['-a', 'Visual Studio Code', editorPath];
    } else if (process.platform === 'win32') {
      command = 'code';
      args = [editorPath];
    } else {
      command = 'code';
      args = [editorPath];
    }

    try {
      spawn(command, args, { detached: true, stdio: 'ignore' });
      return { success: true };
    } catch {
      return { success: false, error: '无法打开编辑器' };
    }
  },

  killPort: (params: { port: number }) => {
    const port = params.port;
    try {
      if (process.platform === 'win32') {
        exec(`netstat -ano | findstr ":${port}" | findstr LISTENING`, (err, stdout) => {
          const lines = stdout.trim().split('\n');
          lines.forEach(line => {
            const match = line.match(/\s+(\d+)$/);
            if (match) {
              exec(`taskkill /F /PID ${match[1]}`);
            }
          });
        });
      } else {
        exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`);
      }
      return { success: true };
    } catch {
      return { success: false, error: '操作失败' };
    }
  }
};

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/api/groups' && request.method === 'GET') {
    return new Response(JSON.stringify(apiHandlers.getGroups()), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/groups' && request.method === 'POST') {
    const body = await request.json();
    return new Response(JSON.stringify(apiHandlers.createGroup(body)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/groups' && request.method === 'PUT') {
    const body = await request.json();
    return new Response(JSON.stringify(apiHandlers.renameGroup(body)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/groups' && request.method === 'DELETE') {
    const body = await request.json();
    return new Response(JSON.stringify(apiHandlers.deleteGroup(body)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/projects' && request.method === 'GET') {
    const params: any = {};
    if (url.searchParams.has('page')) params.page = parseInt(url.searchParams.get('page')!);
    if (url.searchParams.has('pageSize')) params.pageSize = parseInt(url.searchParams.get('pageSize')!);
    if (url.searchParams.has('group')) params.group = url.searchParams.get('group');
    if (url.searchParams.has('status')) params.status = url.searchParams.get('status');
    if (url.searchParams.has('search')) params.search = url.searchParams.get('search');
    return new Response(JSON.stringify(apiHandlers.getProjects(params)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/projects' && request.method === 'POST') {
    const body = await request.json();
    const result = await apiHandlers.importProject(body);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const projectIdMatch = pathname.match(/^\/api\/projects\/([^/]+)/);
  if (projectIdMatch) {
    const projectId = projectIdMatch[1];
    
    if (pathname === `/api/projects/${projectId}` && request.method === 'PUT') {
      const body = await request.json();
      return new Response(JSON.stringify(apiHandlers.updateProject({ id: projectId, updatedAt: Date.now(), ...body })), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}` && request.method === 'DELETE') {
      return new Response(JSON.stringify(apiHandlers.deleteProject({ id: projectId })), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/git/info` && request.method === 'GET') {
      const result = await apiHandlers.getGitInfo({ id: projectId });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/git/branches` && request.method === 'GET') {
      const result = await apiHandlers.getGitBranches({ id: projectId });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/git/checkout` && request.method === 'POST') {
      const body = await request.json();
      const result = await apiHandlers.gitCheckout({ id: projectId, branch: body.branch });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/git/pull` && request.method === 'POST') {
      const result = await apiHandlers.gitPull({ id: projectId });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/git/push` && request.method === 'POST') {
      const result = await apiHandlers.gitPush({ id: projectId });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/git/merge` && request.method === 'POST') {
      const body = await request.json();
      const result = await apiHandlers.gitMerge({ id: projectId, branch: body.branch });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/start` && request.method === 'POST') {
      const result = await apiHandlers.startProject({ id: projectId });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/stop` && request.method === 'POST') {
      return new Response(JSON.stringify(apiHandlers.stopProject({ id: projectId })), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/status` && request.method === 'GET') {
      return new Response(JSON.stringify(apiHandlers.getProjectStatus({ id: projectId })), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/api/projects/${projectId}/package-json` && request.method === 'GET') {
      return new Response(JSON.stringify(apiHandlers.getPackageJson({ id: projectId })), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname.startsWith(`/api/projects/${projectId}/logs`)) {
      const since = url.searchParams.has('since') ? parseInt(url.searchParams.get('since')!) : 0;
      return new Response(JSON.stringify(apiHandlers.getProjectLogs({ id: projectId, since })), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (pathname === '/api/projects/batch' && request.method === 'POST') {
    const body = await request.json();
    const result = await apiHandlers.batchImportProjects(body);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/projects/batch-delete' && request.method === 'POST') {
    const body = await request.json();
    return new Response(JSON.stringify(apiHandlers.batchDeleteProjects(body)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/scan' && request.method === 'POST') {
    const body = await request.json();
    return new Response(JSON.stringify(apiHandlers.scanDirectory(body)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/git/clone' && request.method === 'POST') {
    const body = await request.json();
    const result = await apiHandlers.gitClone(body);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/browse-folder' && request.method === 'POST') {
    let result = await apiHandlers.browseFolder();
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/open-editor' && request.method === 'POST') {
    const body = await request.json();
    return new Response(JSON.stringify(apiHandlers.openEditor(body)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (pathname === '/api/kill-port' && request.method === 'POST') {
    const body = await request.json();
    return new Response(JSON.stringify(apiHandlers.killPort(body)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const staticPath = path.join(__dirname, '../../public', pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(staticPath)) {
    const content = fs.readFileSync(staticPath);
    const ext = path.extname(staticPath);
    let contentType = 'text/plain';
    if (ext === '.html') contentType = 'text/html';
    if (ext === '.js') contentType = 'application/javascript';
    if (ext === '.css') contentType = 'text/css';
    if (ext === '.ico') contentType = 'image/x-icon';
    return new Response(content.toString(), { headers: { 'Content-Type': contentType } });
  }

  return new Response('Not Found', { status: 404 });
}

loadData();

async function main() {
  const server = Bun.serve({
    port: 3003,
    fetch: handleRequest
  });

  console.log(`Server running on http://localhost:${server.port}`);

  const win = new BrowserWindow({
    title: 'Project Manager',
    url: `http://localhost:${server.port}`,
    frame: {
      x: 0,
      y: 0,
      width: 1200,
      height: 600,
    },
  });
}

main().catch(console.error);
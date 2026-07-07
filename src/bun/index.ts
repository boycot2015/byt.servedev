import { BrowserWindow } from 'electrobun/bun';
import { spawn, exec } from 'child_process';
import { createServer } from 'net';
import path from 'path';
import fs from 'fs';

interface Project {
  id: string;
  name: string;
  path: string;
  group: string;
  script: string;
  port?: number;
  pid?: number;
  isRunning: boolean;
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
let projectLogs: { [key: string]: { logs: string[]; index: number } } = {};
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
    if (!fs.existsSync(path.join(projectPath, '.git'))) {
      return { isGitRepo: false };
    }

    const isRepo = await executeGitCommand(projectPath, 'rev-parse --is-inside-work-tree');
    if (isRepo.trim() !== 'true') {
      return { isGitRepo: false };
    }

    const branch = await executeGitCommand(projectPath, 'rev-parse --abbrev-ref HEAD');
    const commit = await executeGitCommand(projectPath, 'log -1 --format=%H');
    const message = await executeGitCommand(projectPath, 'log -1 --format=%s');
    const author = await executeGitCommand(projectPath, 'log -1 --format=%an');
    const time = await executeGitCommand(projectPath, 'log -1 --format=%ct');
    
    const aheadBehind = await executeGitCommand(projectPath, 'rev-list --count --left-right HEAD...origin/HEAD 2>/dev/null');
    let aheadCount = 0, behindCount = 0;
    if (aheadBehind.trim()) {
      const parts = aheadBehind.trim().split('\t');
      aheadCount = parseInt(parts[1]) || 0;
      behindCount = parseInt(parts[0]) || 0;
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
    const isRepo = await executeGitCommand(projectPath, 'rev-parse --is-inside-work-tree');
    if (isRepo.trim() !== 'true') {
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
      return { success: false, message: '分组名称不能为空' };
    }
    if (groups.includes(name)) {
      return { success: false, message: '分组已存在' };
    }
    groups.push(name);
    saveGroups();
    return { success: true };
  },

  renameGroup: (params: { oldName: string; newName: string }) => {
    const { oldName, newName } = params;
    if (!newName || newName.trim() === '') {
      return { success: false, message: '分组名称不能为空' };
    }
    if (oldName === '默认分组') {
      return { success: false, message: '不能重命名默认分组' };
    }
    if (groups.includes(newName)) {
      return { success: false, message: '分组已存在' };
    }
    const index = groups.indexOf(oldName);
    if (index === -1) {
      return { success: false, message: '分组不存在' };
    }
    groups[index] = newName;
    projects.forEach(p => {
      if (p.group === oldName) {
        p.group = newName;
      }
    });
    saveGroups();
    saveProjects();
    return { success: true };
  },

  deleteGroup: (params: { name: string }) => {
    const name = params.name;
    if (name === '默认分组') {
      return { success: false, message: '不能删除默认分组' };
    }
    const index = groups.indexOf(name);
    if (index === -1) {
      return { success: false, message: '分组不存在' };
    }
    groups.splice(index, 1);
    projects.forEach(p => {
      if (p.group === name) {
        p.group = '默认分组';
      }
    });
    saveGroups();
    saveProjects();
    return { success: true };
  },

  getProjects: (params: { page?: number; pageSize?: number; group?: string; search?: string } = {}) => {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    let filtered = [...projects];

    if (params.group && params.group !== '全部') {
      filtered = filtered.filter(p => p.group === params.group);
    }

    if (params.search) {
      const searchLower = params.search.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchLower) || 
        p.path.toLowerCase().includes(searchLower)
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginated = filtered.slice(start, end);

    const groupStats: GroupStats = {};
    projects.forEach(p => {
      groupStats[p.group] = (groupStats[p.group] || 0) + 1;
    });

    return {
      list: paginated,
      pagination: {
        page,
        pageSize,
        total,
        hasMore: end < total
      },
      groupStats
    };
  },

  getProjectById: (params: { id: string }) => {
    return projects.find(p => p.id === params.id) || null;
  },

  importProject: async (params: { path: string; group: string }) => {
    const { path: projectPath, group } = params;
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { success: false, message: '路径不存在' };
    }

    const existing = projects.find(p => p.path === projectPath);
    if (existing) {
      return { success: false, message: '项目已存在' };
    }

    const packageJsonPath = path.join(projectPath, 'package.json');
    let scripts: { [key: string]: string } = {};
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        scripts = pkg.scripts || {};
      } catch {}
    }

    const project: Project = {
      id: Date.now().toString(),
      name: path.basename(projectPath),
      path: projectPath,
      group: group || '默认分组',
      script: scripts.dev ? 'dev' : scripts.start ? 'start' : '',
      isRunning: false,
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

  updateProject: (params: { id: string; name?: string; group?: string; script?: string }) => {
    const { id, name, group, script } = params;
    const index = projects.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, message: '项目不存在' };
    }

    if (name !== undefined) {
      projects[index].name = name;
    }
    if (group !== undefined) {
      projects[index].group = group;
    }
    if (script !== undefined) {
      projects[index].script = script;
    }

    saveProjects();
    return { success: true, project: projects[index] };
  },

  deleteProject: (params: { id: string }) => {
    const id = params.id;
    const index = projects.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, message: '项目不存在' };
    }

    if (projects[index].isRunning) {
      return { success: false, message: '请先停止项目' };
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
        results.push({ success: false, path: projectPath, message: '路径不存在' });
        continue;
      }

      const existing = projects.find(p => p.path === projectPath);
      if (existing) {
        results.push({ success: false, path: projectPath, message: '项目已存在' });
        continue;
      }

      const packageJsonPath = path.join(projectPath, 'package.json');
      let scripts: { [key: string]: string } = {};
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          scripts = pkg.scripts || {};
        } catch {}
      }

      const project: Project = {
        id: Date.now().toString() + Math.random(),
        name: path.basename(projectPath),
        path: projectPath,
        group: group || '默认分组',
        script: scripts.dev ? 'dev' : scripts.start ? 'start' : '',
        isRunning: false,
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
    const runningIds = projects.filter(p => p.isRunning && ids.includes(p.id)).map(p => p.id);
    if (runningIds.length > 0) {
      return { success: false, message: `以下项目正在运行，请先停止: ${runningIds.join(', ')}` };
    }

    projects = projects.filter(p => !ids.includes(p.id));
    saveProjects();
    return { success: true };
  },

  startProject: async (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { success: false, message: '项目不存在' };
    }

    if (project.isRunning) {
      return { success: false, message: '项目已在运行' };
    }

    if (!project.script) {
      return { success: false, message: '未配置启动脚本' };
    }

    const packageJsonPath = path.join(project.path, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return { success: false, message: 'package.json 不存在' };
    }

    const port = await findAvailablePort(3000);

    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const processEnv = {
      ...process.env,
      PORT: port.toString(),
      HOST: '127.0.0.1'
    };

    const child = spawn(command, ['run', project.script], {
      cwd: project.path,
      env: processEnv,
      shell: true
    });

    projectProcesses[id] = child;
    projectLogs[id] = { logs: [], index: 0 };

    child.stdout.on('data', (data: Buffer) => {
      const log = data.toString();
      projectLogs[id].logs.push(log);
    });

    child.stderr.on('data', (data: Buffer) => {
      const log = data.toString();
      projectLogs[id].logs.push(log);
    });

    child.on('close', () => {
      project.isRunning = false;
      project.pid = undefined;
      delete projectProcesses[id];
      saveProjects();
    });

    project.isRunning = true;
    project.port = port;
    project.pid = child.pid;
    project.lastRunTime = new Date().toISOString();
    saveProjects();

    return { success: true, port };
  },

  stopProject: (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { success: false, message: '项目不存在' };
    }

    if (!project.isRunning) {
      return { success: false, message: '项目未在运行' };
    }

    const process = projectProcesses[id];
    if (process) {
      try {
        process.kill();
        delete projectProcesses[id];
      } catch {}
    }

    project.isRunning = false;
    project.pid = undefined;
    project.port = undefined;
    saveProjects();

    return { success: true };
  },

  getProjectStatus: (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { isRunning: false };
    }
    return {
      isRunning: project.isRunning,
      port: project.port,
      pid: project.pid
    };
  },

  getPackageJson: (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { success: false, message: '项目不存在' };
    }

    const packageJsonPath = path.join(project.path, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return { success: false, message: 'package.json 不存在' };
    }

    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      return { success: true, data: JSON.parse(content) };
    } catch {
      return { success: false, message: '读取失败' };
    }
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

  getGitInfo: async (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { isGitRepo: false };
    }
    return await getGitInfoInternal(project.path);
  },

  getGitBranches: async (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { isGitRepo: false, branches: [] };
    }
    return await getGitBranchesInternal(project.path);
  },

  gitCheckout: async (params: { id: string; branch: string }) => {
    const { id, branch } = params;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { success: false, message: '项目不存在' };
    }

    if (project.isRunning) {
      return { success: false, message: '请先停止项目' };
    }

    const result = await executeGitCommand(project.path, `checkout ${branch}`);
    if (result.includes('error') || result.includes('fatal')) {
      return { success: false, message: result };
    }

    const gitInfo = await getGitInfoInternal(project.path);
    project.currentBranch = gitInfo.currentBranch;
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    saveProjects();

    return { success: true };
  },

  gitPull: async (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { success: false, message: '项目不存在' };
    }

    if (project.isRunning) {
      return { success: false, message: '请先停止项目' };
    }

    const result = await executeGitCommand(project.path, 'pull');
    if (result.includes('error') || result.includes('fatal')) {
      return { success: false, message: result };
    }

    const gitInfo = await getGitInfoInternal(project.path);
    project.currentBranch = gitInfo.currentBranch;
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    project.aheadCount = 0;
    saveProjects();

    return { success: true };
  },

  gitPush: async (params: { id: string }) => {
    const id = params.id;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { success: false, message: '项目不存在' };
    }

    if (project.isRunning) {
      return { success: false, message: '请先停止项目' };
    }

    const result = await executeGitCommand(project.path, 'push');
    if (result.includes('error') || result.includes('fatal')) {
      return { success: false, message: result };
    }

    project.behindCount = 0;
    saveProjects();

    return { success: true };
  },

  gitMerge: async (params: { id: string; branch: string }) => {
    const { id, branch } = params;
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { success: false, message: '项目不存在' };
    }

    if (project.isRunning) {
      return { success: false, message: '请先停止项目' };
    }

    const result = await executeGitCommand(project.path, `merge ${branch}`);
    if (result.includes('error') || result.includes('fatal')) {
      return { success: false, message: result };
    }

    const gitInfo = await getGitInfoInternal(project.path);
    project.commitId = gitInfo.commitId;
    project.commitMessage = gitInfo.commitMessage;
    project.commitAuthor = gitInfo.commitAuthor;
    project.commitTime = gitInfo.commitTime;
    saveProjects();

    return { success: true };
  },

  gitClone: async (params: { url: string; path: string; group: string }) => {
    const { url, path: clonePath, group } = params;
    if (!url || !clonePath) {
      return { success: false, message: 'URL 和路径不能为空' };
    }

    const targetPath = path.join(clonePath, path.basename(url, '.git'));
    if (fs.existsSync(targetPath)) {
      return { success: false, message: '目标路径已存在' };
    }

    const result = await executeGitCommand(clonePath, `clone ${url}`);
    if (result.includes('error') || result.includes('fatal')) {
      return { success: false, message: result };
    }

    const packageJsonPath = path.join(targetPath, 'package.json');
    let scripts: { [key: string]: string } = {};
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        scripts = pkg.scripts || {};
      } catch {}
    }

    const project: Project = {
      id: Date.now().toString(),
      name: path.basename(targetPath),
      path: targetPath,
      group: group || '默认分组',
      script: scripts.dev ? 'dev' : scripts.start ? 'start' : '',
      isRunning: false,
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

  scanDirectory: (params: { path: string; depth?: number }) => {
    const { path: scanPath, depth = 3 } = params;
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
              let packageJson: any = {};
              try {
                packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
              } catch {}

              results.push({
                path: fullPath,
                name: entry.name,
                hasPackageJson: true,
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
    return { path: '' };
  },

  openEditor: (params: { path: string }) => {
    const editorPath = params.path;
    if (!fs.existsSync(editorPath)) {
      return { success: false, message: '路径不存在' };
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
      return { success: false, message: '无法打开编辑器' };
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
      return { success: false, message: '操作失败' };
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
      return new Response(JSON.stringify(apiHandlers.updateProject({ id: projectId, ...body })), {
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
    return new Response(JSON.stringify(apiHandlers.browseFolder()), {
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
    port: 3000,
    fetch: handleRequest
  });

  console.log(`Server running on http://localhost:${server.port}`);

  const win = new BrowserWindow({
    title: 'Project Manager',
    url: `http://localhost:${server.port}`,
    frame: {
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
    },
  });
}

main().catch(console.error);
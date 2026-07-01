const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, exec } = require('child_process');

const PORT = 3000;
const PROJECTS_FILE = path.join(__dirname, 'projects.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');
const RUNNING_PROCESSES = {};

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function killPort(port) {
  return new Promise((resolve) => {
    exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, (err) => {
      if (err) {
        resolve({ success: false, error: '未找到占用该端口的进程' });
      } else {
        setTimeout(() => {
          resolve({ success: true });
        }, 500);
      }
    });
  });
}

async function findAvailablePort(startPort) {
  let port = startPort;
  for (let i = 0; i < 100; i++) {
    const available = await checkPort(port);
    if (available) return port;
    port++;
  }
  return null;
}

function readGroups() {
  try {
    const data = fs.readFileSync(GROUPS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return ['默认分组'];
  }
}

function writeGroups(groups) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

function readProjects() {
  try {
    const data = fs.readFileSync(PROJECTS_FILE, 'utf8');
    const projects = JSON.parse(data);
    return projects.map(p => ({
      ...p,
      group: p.group || '默认分组'
    }));
  } catch {
    return [];
  }
}

function writeProjects(projects) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

function getPackageJson(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  try {
    const data = fs.readFileSync(pkgPath, 'utf8');
    
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function detectNodeVersion(projectPath) {
  return new Promise((resolve) => {
    const pkg = getPackageJson(projectPath);
    
    let nodeVersion = pkg?.engines?.node || '';
    
    if (!nodeVersion || nodeVersion === '未指定') {
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      const getMajor = (v, len = 1) => parseInt(v.replace(/[^0-9]/g, '').substring(0, len)) || 0;
      
      // 框架检测规则配置 - 按优先级排序
      const frameworks = [
        { keys: ['vue', 'vue@next'], map: v => getMajor(v) === 3 ? '22.16.0' : '14.19.0' },
        { keys: ['nuxt', 'nuxt3', 'nuxt-edge'], map: v => getMajor(v) === 3 ? '22.16.0' : '14.19.0' },
        { keys: ['next', 'next@canary'], map: v => getMajor(v, 2) >= 13 ? '22.16.0' : '18.20.0' },
        { keys: ['react', 'react-dom'], map: v => getMajor(v, 2) >= 18 ? '22.16.0' : '16.20.0' }
      ];
      
      for (const { keys, map } of frameworks) {
        const version = keys.map(k => deps?.[k]).find(Boolean);
        if (version) {
          nodeVersion = map(version);
          break;
        }
      }
      nodeVersion = nodeVersion || '22.16.0';
    //   console.log(nodeVersion, deps, 'nodeVersion');
    }
    exec('which nvm 2>/dev/null || which fnm 2>/dev/null || echo ""', (err, output) => {
      if (output.trim()) {
        if (output.includes('nvm')) {
          exec(`source ~/.nvm/nvm.sh && nvm ls 2>/dev/null`, (err, nvmOutput) => {
            const cleanVersion = nodeVersion.replace('>=', '').replace('^', '').replace('~', '');
            if (nvmOutput.includes(cleanVersion)) {
              resolve({ version: nodeVersion, manager: 'nvm' });
            } else {
              resolve({ version: nodeVersion, manager: 'nvm', fallback: true });
            }
          });
        } else if (output.includes('fnm')) {
          exec(`fnm list 2>/dev/null`, (err, fnmOutput) => {
            const cleanVersion = nodeVersion.replace('>=', '').replace('^', '').replace('~', '');
            if (fnmOutput.includes(cleanVersion)) {
              resolve({ version: nodeVersion, manager: 'fnm' });
            } else {
              resolve({ version: nodeVersion, manager: 'fnm', fallback: true });
            }
          });
        }
      } else {
        resolve({ 
          version: nodeVersion, 
          manager: 'system',
          fallback: true 
        });
      }
    });
  });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  return types[ext] || 'text/plain';
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
    } else {
      res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
      res.end(content);
    }
  });
}

async function handleApi(req, res) {
  const url = req.url;
  const method = req.method;

  if (url === '/api/projects' && method === 'GET') {
    const projects = readProjects();
    const projectsWithStatus = projects.map(p => {
      const runningInfo = RUNNING_PROCESSES[p.id];
      return {
        ...p,
        status: runningInfo?.status || 'stopped',
        port: runningInfo?.actualPort || p.port,
        nodeVersion: runningInfo?.nodeVersion || p.nodeVersion || '未指定'
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projectsWithStatus));
  }

  else if (url === '/api/projects' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const { projectPath, group } = JSON.parse(body);
      const pkg = getPackageJson(projectPath);
      
      if (!pkg) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无法读取package.json' }));
        return;
      }

      const projects = readProjects();
      const newProject = {
        id: Date.now(),
        name: pkg.name || '未命名项目',
        version: pkg.version || '1.0.0',
        nodeVersion: pkg.engines?.node || '未指定',
        projectPath: projectPath,
        port: 1024,
        group: group || '默认分组',
        scripts: pkg.scripts || {}
      };

      projects.push(newProject);
      writeProjects(projects);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newProject));
    });
  }

  else if (url === '/api/projects/batch' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { paths, group } = JSON.parse(body);
      const projects = readProjects();
      const addedProjects = [];

      paths.forEach(projectPath => {
        const pkg = getPackageJson(projectPath);
        if (pkg) {
          const existing = projects.find(p => p.projectPath === projectPath);
          if (!existing) {
            const newProject = {
              id: Date.now() + Math.random(),
              name: pkg.name || '未命名项目',
              version: pkg.version || '1.0.0',
              nodeVersion: pkg.engines?.node || '未指定',
              projectPath: projectPath,
              port: 1024,
              group: group || '默认分组',
              scripts: pkg.scripts || {}
            };
            projects.push(newProject);
            addedProjects.push(newProject);
          }
        }
      });

      writeProjects(projects);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(addedProjects));
    });
  }

  else if (url.match(/\/api\/projects\/([\d.]+)/) && method === 'PUT') {
    const id = parseFloat(url.match(/\/api\/projects\/([\d.]+)/)[1]);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const updates = JSON.parse(body);
      const projects = readProjects();
      const index = projects.findIndex(p => p.id === id);
      
      if (index !== -1) {
        projects[index] = { ...projects[index], ...updates };
        writeProjects(projects);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '项目不存在' }));
      }
    });
  }

  else if (url.match(/\/api\/projects\/([\d.]+)/) && method === 'DELETE') {
    const id = parseFloat(url.match(/\/api\/projects\/([\d.]+)/)[1]);
    let projects = readProjects();
    projects = projects.filter(p => p.id !== id);
    writeProjects(projects);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }

  else if (url === '/api/projects/batch-delete' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { ids } = JSON.parse(body);
      if (!ids || !Array.isArray(ids)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '缺少项目ID列表' }));
        return;
      }
      let projects = readProjects();
      projects = projects.filter(p => !ids.includes(p.id));
      writeProjects(projects);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deletedCount: ids.length }));
    });
  }

  else if (url === '/api/browse-folder' && method === 'POST') {
    exec(`osascript -e 'POSIX path of (choose folder with prompt "请选择项目目录")'`, (err, output) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '取消选择' }));
      } else {
        const folderPath = output.trim();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: folderPath }));
      }
    });
  }

  else if (url === '/api/groups' && method === 'GET') {
    const groups = readGroups();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(groups));
  }

  else if (url === '/api/groups' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { name } = JSON.parse(body);
      if (!name || !name.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '分组名称不能为空' }));
        return;
      }
      const groups = readGroups();
      if (groups.includes(name.trim())) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '分组名称已存在' }));
        return;
      }
      groups.push(name.trim());
      writeGroups(groups);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, groups }));
    });
  }

  else if (url === '/api/groups' && method === 'PUT') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { oldName, newName } = JSON.parse(body);
      if (!oldName || !newName || !newName.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '分组名称不能为空' }));
        return;
      }
      let groups = readGroups();
      const index = groups.indexOf(oldName);
      if (index === -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '原分组不存在' }));
        return;
      }
      if (groups.includes(newName.trim())) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '新分组名称已存在' }));
        return;
      }
      groups[index] = newName.trim();
      writeGroups(groups);

      let projects = readProjects();
      projects = projects.map(p => p.group === oldName ? { ...p, group: newName.trim() } : p);
      writeProjects(projects);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, groups }));
    });
  }

  else if (url === '/api/groups' && method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { name } = JSON.parse(body);
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '分组名称不能为空' }));
        return;
      }
      if (name === '默认分组') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '不能删除默认分组' }));
        return;
      }
      let groups = readGroups();
      const index = groups.indexOf(name);
      if (index === -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '分组不存在' }));
        return;
      }
      groups.splice(index, 1);
      writeGroups(groups);

      let projects = readProjects();
      projects = projects.map(p => p.group === name ? { ...p, group: '默认分组' } : p);
      writeProjects(projects);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, groups }));
    });
  }

  else if (url === '/api/scan' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { scanPath } = JSON.parse(body);
      const foundProjects = [];
      
      try {
        const files = fs.readdirSync(scanPath);
        files.forEach(file => {
          const fullPath = path.join(scanPath, file);
          if (fs.statSync(fullPath).isDirectory()) {
            const pkg = getPackageJson(fullPath);
            if (pkg) {
              foundProjects.push({
                name: pkg.name || '未命名项目',
                version: pkg.version || '1.0.0',
                nodeVersion: pkg.engines?.node || '未指定',
                path: fullPath,
                scripts: pkg.scripts || {}
              });
            }
          }
        });
      } catch (err) {
        console.error('扫描失败:', err);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(foundProjects));
    });
  }

  else if (url.match(/\/api\/projects\/([\d.]+)\/start/) && method === 'POST') {
    const id = parseFloat(url.match(/\/api\/projects\/([\d.]+)\/start/)[1]);
    const projects = readProjects();
    const project = projects.find(p => p.id === id);

    console.log('=== 启动项目调试 ===');
    console.log('请求ID:', id);
    console.log('找到的项目:', project ? JSON.stringify({ name: project.name, path: project.projectPath, scripts: project.scripts }) : 'null');

    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '项目不存在' }));
      return;
    }

    if (!project.projectPath || !fs.existsSync(project.projectPath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '项目路径不存在' }));
      return;
    }

    if (project.projectPath === __dirname) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '不能启动项目管理工具本身' }));
      return;
    }

    const nodeModulesPath = path.join(project.projectPath, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log(`项目 ${project.name} 缺少依赖，正在自动执行 npm install...`);
      
      // 初始化日志进程
      RUNNING_PROCESSES[id] = {
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        installing: true,
        message: '正在安装项目依赖，请查看日志...' 
      }));
      
      // 使用 spawn 执行 npm install 捕获实时日志
      const installProcess = spawn('npm', ['install'], { 
        cwd: project.projectPath,
        shell: true,
        detached: true
      });
      
      RUNNING_PROCESSES[id].process = installProcess;
      RUNNING_PROCESSES[id].pid = installProcess.pid;
      
      installProcess.stdout.on('data', (data) => {
        const log = data.toString();
        if (RUNNING_PROCESSES[id]) {
          RUNNING_PROCESSES[id].logs.push({ type: 'stdout', content: log });
        }
      });
      
      installProcess.stderr.on('data', (data) => {
        const log = data.toString();
        if (RUNNING_PROCESSES[id]) {
          RUNNING_PROCESSES[id].logs.push({ type: 'stderr', content: log });
        }
      });
      
      installProcess.on('close', (code) => {
        if (RUNNING_PROCESSES[id]) {
          if (code === 0) {
            RUNNING_PROCESSES[id].logs.push({ type: 'system', content: '✓ 依赖安装完成！可以启动项目了' });
            RUNNING_PROCESSES[id].status = 'stopped';
            console.log(`项目 ${project.name} 依赖安装完成`);
          } else {
            RUNNING_PROCESSES[id].logs.push({ type: 'system', content: `✗ 依赖安装失败，退出码: ${code}` });
            RUNNING_PROCESSES[id].status = 'stopped';
            console.error(`项目 ${project.name} npm install 失败，退出码: ${code}`);
          }
        }
      });
      
      installProcess.on('error', (err) => {
        if (RUNNING_PROCESSES[id]) {
          RUNNING_PROCESSES[id].logs.push({ type: 'system', content: `✗ 依赖安装出错: ${err.message}` });
          RUNNING_PROCESSES[id].status = 'stopped';
        }
      });
      
      return;
    }

    if (RUNNING_PROCESSES[id] && RUNNING_PROCESSES[id].status === 'running') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '项目已在运行中' }));
      return;
    }

    let startScript = 'dev';
    if (project.scripts) {
      if (project.scripts.dev) startScript = 'dev';
      else if (project.scripts.start) startScript = 'start';
      else if (project.scripts.serve) startScript = 'serve';
      else {
        const scripts = Object.keys(project.scripts);
        if (scripts.length > 0) startScript = scripts[0];
      }
    }

    const nodeInfo = await detectNodeVersion(project.projectPath);
    
    let startPort = parseInt(project.port) || 1024;
    
    const portAvailable = await checkPort(startPort);
    if (!portAvailable) {
      console.log(`端口 ${startPort} 被占用，正在尝试清理...`);
      await killPort(startPort);
    }
    
    let command;
    let args;
    const portEnv = `PORT=${startPort} VITE_PORT=${startPort} `;
    
    if (nodeInfo.manager === 'nvm') {
      command = 'bash';
      args = ['-c', `cd "${project.projectPath}" && source ~/.nvm/nvm.sh && nvm use ${nodeInfo.version} 2>/dev/null || nvm install ${nodeInfo.version} 2>/dev/null; ${portEnv}npm run ${startScript}`];
    } else if (nodeInfo.manager === 'fnm') {
      command = 'bash';
      args = ['-c', `cd "${project.projectPath}" && eval "$(fnm env)" && fnm use ${nodeInfo.version} 2>/dev/null || fnm install ${nodeInfo.version} 2>/dev/null; ${portEnv}npm run ${startScript}`];
    } else {
      command = 'bash';
      args = ['-c', `cd "${project.projectPath}" && ${portEnv}npm run ${startScript}`];
    }

    const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: true, cwd: project.projectPath, detached: true });

    RUNNING_PROCESSES[id] = {
      process,
      logs: [],
      pid: process.pid,
      nodeVersion: nodeInfo.version,
      actualPort: startPort,
      status: 'starting'
    };

    // 标记是否已将状态更新为 running
    let statusUpdatedToRunning = false;
    
    // 更新状态为 running 的通用函数
    const updateStatusToRunning = () => {
      if (statusUpdatedToRunning || !RUNNING_PROCESSES[id]) return;
      statusUpdatedToRunning = true;
      
      RUNNING_PROCESSES[id].status = 'running';
      const projects = readProjects();
      const projectIndex = projects.findIndex(p => p.id === id);
      if (projectIndex !== -1) {
        projects[projectIndex].status = RUNNING_PROCESSES[id].status;
        writeProjects(projects);
      }
    };

    process.stdout.on('data', (data) => {
      const log = data.toString();
      RUNNING_PROCESSES[id]?.logs.push({ type: 'stdout', content: log });
      
      // 只要有日志输出，就认为服务已开始运行，更新状态为 running
      updateStatusToRunning();
      
      const portMatch = log.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|:::):(\d+)/);
      if (portMatch && RUNNING_PROCESSES[id]) {
        const detectedPort = parseInt(portMatch[1]);
        if (detectedPort !== RUNNING_PROCESSES[id].actualPort) {
          RUNNING_PROCESSES[id].actualPort = detectedPort;
          const projects = readProjects();
          const projectIndex = projects.findIndex(p => p.id === id);
          if (projectIndex !== -1) {
            projects[projectIndex].port = detectedPort;
            writeProjects(projects);
          }
        }
      }
    });

    process.stderr.on('data', (data) => {
      const log = data.toString();
      RUNNING_PROCESSES[id]?.logs.push({ type: 'stderr', content: log });
      
      // 只要有日志输出（包括 stderr），就认为服务已开始运行
      updateStatusToRunning();
      
      const portMatch = log.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|:::):(\d+)/);
      if (portMatch && RUNNING_PROCESSES[id]) {
        const detectedPort = parseInt(portMatch[1]);
        if (detectedPort !== RUNNING_PROCESSES[id].actualPort) {
          RUNNING_PROCESSES[id].actualPort = detectedPort;
          const projects = readProjects();
          const projectIndex = projects.findIndex(p => p.id === id);
          if (projectIndex !== -1) {
            projects[projectIndex].port = detectedPort;
            writeProjects(projects);
          }
        }
      }
    });

    process.on('close', (code) => {
      if (RUNNING_PROCESSES[id]) {
        const prevStatus = RUNNING_PROCESSES[id].status;
        RUNNING_PROCESSES[id].status = 'stopped';
        if (prevStatus === 'starting') {
          RUNNING_PROCESSES[id].logs.push({ type: 'system', content: `启动失败，进程已退出，退出码: ${code}` });
        } else {
          RUNNING_PROCESSES[id].logs.push({ type: 'system', content: `进程已退出，退出码: ${code}` });
        }
        const projects = readProjects();
        const projectIndex = projects.findIndex(p => p.id === id);
        if (projectIndex !== -1) {
          projects[projectIndex].status = 'stopped';
          writeProjects(projects);
        }
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true, 
      script: startScript,
      nodeVersion: nodeInfo.version,
      manager: nodeInfo.manager
    }));
  }

  else if (url.match(/\/api\/projects\/([\d.]+)\/stop/) && method === 'POST') {
    const id = parseFloat(url.match(/\/api\/projects\/([\d.]+)\/stop/)[1]);
    
    if (RUNNING_PROCESSES[id] && RUNNING_PROCESSES[id].status === 'running') {
      const pid = RUNNING_PROCESSES[id].pid;
      const actualPort = RUNNING_PROCESSES[id].actualPort;
      RUNNING_PROCESSES[id].status = 'stopped';
      exec(`pkill -P ${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null; sleep 1; pkill -P ${pid} -9 2>/dev/null; kill -KILL ${pid} 2>/dev/null`);
      delete RUNNING_PROCESSES[id]
      if (actualPort) {
        const projects = readProjects();
        const projectIndex = projects.findIndex(p => p.id === id);
        if (projectIndex !== -1) {
          projects[projectIndex].port = actualPort;
          writeProjects(projects);
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '项目未在运行' }));
    }
  }

  else if (url.match(/\/api\/projects\/([\d.]+)\/logs/) && method === 'GET') {
    const id = parseFloat(url.match(/\/api\/projects\/([\d.]+)\/logs/)[1]);
    const logs = RUNNING_PROCESSES[id]?.logs || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs));
  }

  else if (url.match(/\/api\/projects\/([\d.]+)\/package-json/) && method === 'GET') {
    const id = parseFloat(url.match(/\/api\/projects\/([\d.]+)\/package-json/)[1]);
    const projects = readProjects();
    const project = projects.find(p => p.id === id);
    
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '项目不存在' }));
      return;
    }
    
    const pkgPath = path.join(project.projectPath, 'package.json');
    
    if (!fs.existsSync(pkgPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `package.json 不存在: ${pkgPath}` }));
      return;
    }
    
    const pkg = getPackageJson(project.projectPath);
    
    if (!pkg) {
      res.writeHead(500, { 'Content-Type': 'application/json' });   
      res.end(JSON.stringify({ error: 'package.json 解析失败' }));
      return;
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: project.name, content: pkg }));
  }

  else if (url.match(/\/api\/projects\/([\d.]+)\/status/) && method === 'GET') {
    const id = parseInt(url.match(/\/api\/projects\/([\d.]+)\/status/)[1]);
    const status = RUNNING_PROCESSES[id]?.status || 'stopped';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status }));
  }

  else if (url === '/api/kill-port' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const { port } = JSON.parse(body);
      const result = await killPort(port);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  }

  else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API not found' }));
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url.startsWith('/api/')) {
    handleApi(req, res);
  } else {
    const filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    serveStaticFile(res, filePath);
  }
});

server.listen(PORT, () => {
  console.log(`项目管理工具已启动: http://localhost:${PORT}`);
});

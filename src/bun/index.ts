import { BrowserWindow } from 'electrobun/bun';
import { spawn, exec } from 'child_process';
import { createServer } from 'net';
import path from 'path';
import fs from 'fs';

let serverProcess: any = null;
let serverPort = 3000;

// 查找可用端口
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

// 向上遍历查找项目根目录中的 server.js
function findServerPath(): string {
  // 从当前目录开始，向上遍历查找
  let currentDir = process.cwd();
  
  // 尝试多个可能的起始点
  const startDirs = [
    currentDir,
    import.meta.dir,
    path.dirname(process.execPath),
  ];

  for (const startDir of startDirs) {
    let dir = startDir;
    // 向上遍历最多 10 层
    for (let i = 0; i < 10; i++) {
      const testPath = path.join(dir, 'server.js');
      if (fs.existsSync(testPath)) {
        console.log(`Found server.js at: ${testPath}`);
        return testPath;
      }
      
      const parentDir = path.dirname(dir);
      if (parentDir === dir) {
        break; // 到达根目录
      }
      dir = parentDir;
    }
  }

  throw new Error('Cannot find server.js in parent directories');
}

// 启动 Node.js 后端服务器
async function startServer(): Promise<number> {
  // 杀掉所有 3xxx 端口的进程
function killAll3xxxPorts() {
  return new Promise((resolve) => {
    exec(`lsof -ti:3000-3999 | xargs kill -9 2>/dev/null`, (err) => {
      setTimeout(() => {
        resolve({ success: true });
      }, 500);
    });
  });
}
  await killAll3xxxPorts();
  console.log('正在清理所有 3xxx 端口进程...');
  serverPort = await findAvailablePort(3000);
  console.log(`Starting server on port ${serverPort}`);

  const serverPath = findServerPath();

  serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: serverPort.toString(),
      ELECTROBUN_MODE: 'true',
    },
    cwd: path.dirname(serverPath),
  });

  serverProcess.stdout.on('data', (data: Buffer) => {
    console.log(`[Server] ${data.toString()}`);
  });

  serverProcess.stderr.on('data', (data: Buffer) => {
    console.error(`[Server Error] ${data.toString()}`);
  });

  serverProcess.on('close', (code: number) => {
    console.log(`Server process exited with code ${code}`);
  });

  // 等待服务器启动
  await new Promise(resolve => setTimeout(resolve, 2000));

  return serverPort;
}

// 启动应用
async function main() {
  const port = await startServer();

  const win = new BrowserWindow({
    title: 'Project Manager',
    url: `http://localhost:${port}`,
    frame: {
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
    },
  });
}

// 清理进程
process.on('beforeExit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

process.on('SIGINT', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  process.exit();
});

main().catch(console.error);

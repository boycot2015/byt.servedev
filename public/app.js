let projects = [];
let groups = ['默认分组'];
let scanResults = [];
let currentLogsProjectId = null;
let logsInterval = null;
let currentGroup = '全部';
let pendingDeleteId = null;
let pendingDeleteIds = null;
let pendingStopId = null;
// 侧边栏切换功能
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('show');
  overlay.classList.toggle('show');
}

// 选择分组后自动关闭侧边栏（移动端）
function selectGroup(group) {
  currentGroup = group;
  renderGroups();
  // 重置筛选字段
  const statusFilter = document.getElementById('statusFilter');
  const searchInput = document.getElementById('searchInput');
  if (statusFilter) statusFilter.value = 'all';
  if (searchInput) searchInput.value = '';
  renderProjects();
  document.getElementById('currentGroupTitle').textContent = group === '全部' ? '项目列表' : `${group} - 项目列表`;
  updateBatchDeleteBtn();
  
  // 移动端选择后自动关闭侧边栏
  if (window.innerWidth <= 768) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('show');
    overlay.classList.remove('show');
  }
}

// 主题切换功能
function toggleTheme() {
  const body = document.body;
  const themeToggle = document.getElementById('themeToggle');
  body.classList.toggle('dark');
  const isDark = body.classList.contains('dark');
  themeToggle.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
  
  if (shouldUseDark) {
    document.body.classList.add('dark');
    document.getElementById('themeToggle').textContent = '☀️';
  }
}

async function loadGroups() {
  const response = await fetch('/api/groups');
  groups = await response.json();
  renderGroups();
  updateGroupSelects();
}

function renderGroups() {
  const groupList = document.getElementById('groupList');
  const allCount = projects.length;
  
  document.getElementById('allCount').textContent = allCount;
  
  let html = `
    <li class="group-item ${currentGroup === '全部' ? 'active' : ''}" onclick="selectGroup('全部')">
      <span class="group-name">全部项目</span>
      <span class="group-count" id="allCount">${allCount}</span>
    </li>
  `;

  groups.forEach(group => {
    const count = projects.filter(p => p.group === group).length;
    html += `
      <li class="group-item ${currentGroup === group ? 'active' : ''} ${group == '默认分组'?'default':''}" onclick="selectGroup('${group}')">
        <span class="group-name">${group}</span>
        <span class="group-count">${count}</span>
        <div class="group-actions">
          ${group !== '默认分组' ? `<button class="group-action-btn" onclick="event.stopPropagation(); openRenameGroupModal('${group}')">✏️</button>` : ''}
          ${group !== '默认分组' ? `<button class="group-action-btn" onclick="event.stopPropagation(); deleteGroup('${group}')">🗑️</button>` : ''}
        </div>
      </li>
    `;
  });

  groupList.innerHTML = html;
}



function updateGroupSelects() {
  const selects = ['importGroup', 'scanGroup', 'editGroup', 'gitImportGroup'];
  selects.forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');
    }
  });
}

async function browseFolderForImport() {
  const response = await fetch('/api/browse-folder', { method: 'POST' });
  const result = await response.json();
  if (result.path) {
    document.getElementById('importPath').value = result.path;
  }
}

async function browseFolderForScan() {
  const response = await fetch('/api/browse-folder', { method: 'POST' });
  const result = await response.json();
  if (result.path) {
    document.getElementById('scanPath').value = result.path;
  }
}

let gitImportState = {
  action: null,
  conflictChecked: false
};

function openGitImportModal() {
  document.getElementById('gitRepoUrl').value = '';
  document.getElementById('gitTargetPath').value = '';
  document.getElementById('gitConflictInfo').style.display = 'none';
  document.getElementById('gitImportBtn').textContent = '导入';
  document.getElementById('gitImportBtn').disabled = false;
  gitImportState = { action: null, conflictChecked: false };
  document.getElementById('gitImportModal').classList.add('show');
}

function closeGitImportModal() {
  document.getElementById('gitImportModal').classList.remove('show');
}

async function browseFolderForGitImport() {
  const response = await fetch('/api/browse-folder', { method: 'POST' });
  const result = await response.json();
  if (result.path) {
    document.getElementById('gitTargetPath').value = result.path;
  }
}

function setGitAction(action) {
  gitImportState.action = action;
  const btn = document.getElementById('gitImportBtn');
  btn.textContent = action === 'skip' ? '确认跳过' : '确认覆盖';
  btn.disabled = false;
}

async function importFromGit() {
  const repoUrl = document.getElementById('gitRepoUrl').value.trim();
  const targetPath = document.getElementById('gitTargetPath').value.trim();
  const group = document.getElementById('gitImportGroup').value;

  if (!repoUrl) {
    alert('请输入仓库地址');
    return;
  }
  if (!targetPath) {
    alert('请选择保存路径');
    return;
  }

  const btn = document.getElementById('gitImportBtn');

  // 如果还没有检查冲突，先检查冲突
  if (!gitImportState.conflictChecked) {
    btn.disabled = true;
    btn.textContent = '检查中...';

    const checkResponse = await fetch('/api/git/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl, targetPath, action: 'check' })
    });

    const checkResult = await checkResponse.json();

    if (checkResult.conflict) {
      gitImportState.conflictChecked = true;
      const conflictInfo = document.getElementById('gitConflictInfo');
      const conflictMessage = document.getElementById('conflictMessage');
      
      let message = `项目 "${checkResult.projectName}" 已存在于: ${checkResult.projectPath}`;
      if (checkResult.existsInList) {
        message += '\n（该项目已在列表中）';
      }
      conflictMessage.textContent = message;
      conflictInfo.style.display = 'block';
      
      btn.textContent = '请选择操作';
      btn.disabled = true;
      return;
    }

    // 没有冲突，直接导入
    gitImportState.conflictChecked = true;
    gitImportState.action = 'new';
  }

  btn.disabled = true;
  btn.textContent = '克隆中...';

  const response = await fetch('/api/git/clone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      repoUrl, 
      targetPath, 
      action: gitImportState.action,
      group 
    })
  });

  const result = await response.json();

  if (result.error) {
    alert(result.error);
    btn.disabled = false;
    btn.textContent = '导入';
    return;
  }

  if (result.skipped) {
    alert('已跳过该项目');
  } else if (result.warning) {
    alert(result.warning);
  } else if (result.overwritten) {
    alert('项目已覆盖并重新导入');
  } else {
    alert('导入成功');
  }

  await loadProjects();
  closeGitImportModal();
}

async function loadProjects() {
  const response = await fetch('/api/projects');
  projects = await response.json();
  renderGroups();
  renderProjects();
  updateBatchDeleteBtn();
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  
  // 按凌晨0点分界计算天数差
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((todayMidnight - dateMidnight) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    // 今天，显示时间
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    // 昨天
    return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays < 7) {
    // 一周内
    return `${diffDays}天前`;
  } else {
    // 超过一周显示日期
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }
}

function renderProjects() {
  const container = document.getElementById('projectList');
  const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase() || '';
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  
  let filtered = projects.filter(p => (!searchTerm || (p.name && p.name?.toLowerCase().includes(searchTerm))));
  
  if (currentGroup !== '全部') {
    filtered = filtered.filter(p => p.group === currentGroup);
  }
  
  if (statusFilter !== 'all') {
    filtered = filtered.filter(p => p.status === statusFilter);
  }
  
  // 按修改时间倒序排序，新的在前面
  // 兼容旧数据：优先用 updatedAt，其次 createdAt，最后用 id
  filtered.sort((a, b) => (b.updatedAt || b.createdAt || b.id) - (a.updatedAt || a.createdAt || a.id));
  
  document.getElementById('projectCount').textContent = `共 ${filtered.length} 个项目`;
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>暂无项目</h3>
        <p>点击上方按钮导入或扫描项目</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(project => `
    <div class="project-item ${project.status || 'stopped'}" id="project-${project.id}">
      <div class="project-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" class="project-checkbox" value="${project.id}" onchange="updateBatchDeleteBtn()">
          <span class="project-name">${project.name}</span>
          <span class="project-version">${project.version}</span>
          <span class="group-tag">${project.group || '默认分组'}</span>
          <span class="package-json-tag" onclick="viewPackageJson(${project.id})" title="点击查看 package.json">📦 package.json</span>
          <span class="status-badge ${project.status === 'running' ? 'status-running' : project.status === 'starting' ? 'status-starting' : 'status-stopped'}">
            ${project.status === 'running' ? '运行中' : project.status === 'starting' ? '启动中...' : '已停止'}
          </span>
        </div>
      </div>
      <div class="project-info">
        <div class="info-item">
          <span class="icon">📍</span>
          <span class="path-clickable" onclick="openEditor('${project.projectPath}')" title="点击在 VS Code 中打开">${project.projectPath}</span>
        </div>
        <div class="info-item">
          <span class="icon">🟢</span>
          <span>Node: ${project.nodeVersion}</span>
        </div>
        <div class="info-item">
          <span class="icon">🔌</span>
          <span>端口: ${project.port}</span>
        </div>
        <div class="info-item" style="margin-left: auto;">
          <span class="icon">🕐</span>
          <span class="time-label">创建: ${formatTimestamp(project.createdAt || project.id || Date.now())}</span>
          ${project.updatedAt ? `<span class="time-label time-label-edited" style="margin-left: 8px;">编辑: ${formatTimestamp(project.updatedAt)}</span>` : ''}
        </div>
      </div>
      ${project.description ? `<div class="project-description"><div class="line-clamp-2" title="${project.description}">${project.description}</div></div>` : ''}
      <div class="project-actions">
        ${project.status === 'running' 
          ? `<button class="btn btn-danger btn-sm" onclick="stopProject(${project.id})">停止</button>`
          : project.status === 'starting'
            ? `<button class="btn btn-success btn-sm" disabled>启动中...</button>`
            : `<button class="btn btn-success btn-sm" onclick="startProject(${project.id})">启动</button>`
        }
        <button class="btn btn-secondary btn-sm" onclick="editProject(${project.id})">编辑</button>
        <button class="btn btn-secondary btn-sm" onclick="viewLogs(${project.id})">日志</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProject(${project.id})">删除</button>
      </div>
    </div>
  `).join('');
}

function filterProjects() {
  renderProjects();
  updateBatchDeleteBtn();
}

function openImportModal() {
  document.getElementById('importPath').value = '';
  document.getElementById('importModal').classList.add('show');
}

function openScanModal() {
  document.getElementById('scanPath').value = '';
  document.getElementById('scanResults').style.display = 'none';
  document.getElementById('scanActions').style.display = 'none';
  document.getElementById('scanModal').classList.add('show');
}

function openAddGroupModal() {
  document.getElementById('newGroupName').value = '';
  document.getElementById('addGroupModal').classList.add('show');
}

function openRenameGroupModal(oldName) {
  document.getElementById('renameOldName').value = oldName;
  document.getElementById('renameNewName').value = oldName;
  document.getElementById('renameGroupModal').classList.add('show');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
  if (modalId === 'logsModal') {
    clearInterval(logsInterval);
    currentLogsProjectId = null;
  }
}

async function addGroup() {
  const name = document.getElementById('newGroupName').value.trim();
  if (!name) return;

  const response = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  const result = await response.json();
  if (result.error) {
    alert(result.error);
  } else {
    groups = result.groups;
    updateGroupSelects();
    await loadProjects();
    closeModal('addGroupModal');
  }
}

async function renameGroup() {
  const oldName = document.getElementById('renameOldName').value;
  const newName = document.getElementById('renameNewName').value.trim();
  if (!newName) return;

  const response = await fetch('/api/groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldName, newName })
  });

  const result = await response.json();
  if (result.error) {
    alert(result.error);
  } else {
    groups = result.groups;
    if (currentGroup === oldName) {
      currentGroup = newName;
    }
    await loadProjects();
    closeModal('renameGroupModal');
  }
}

async function deleteGroup(name) {
  if (!confirm(`确定要删除分组 "${name}" 吗？该分组下的项目将移动到默认分组。`)) return;

  const response = await fetch('/api/groups', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  const result = await response.json();
  if (result.error) {
    alert(result.error);
  } else {
    groups = result.groups;
    if (currentGroup === name) {
      currentGroup = '全部';
    }
    await loadProjects();
  }
}

async function importProject() {
  const path = document.getElementById('importPath').value.trim();
  const group = document.getElementById('importGroup').value;
  if (!path) return;

  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath: path, group })
  });

  const result = await response.json();
  if (result.error) {
    alert(result.error);
  } else {
    await loadProjects();
    closeModal('importModal');
  }
}

async function scanProjects() {
  const path = document.getElementById('scanPath').value.trim();
  if (!path) return;

  const response = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanPath: path })
  });

  scanResults = await response.json();
  
  if (scanResults.length === 0) {
    document.getElementById('scanResults').innerHTML = '<p style="text-align:center; color:#9ca3af;">未找到项目</p>';
  } else {
    document.getElementById('scanResults').innerHTML = scanResults.map((p, index) => `
      <div class="scan-item">
        <input type="checkbox" id="scan-${index}" checked>
        <div class="scan-item-info">
          <div class="scan-item-name">${p.name} <span style="font-size:12px; color:#9ca3af;">${p.version}</span></div>
          <div class="scan-item-path">${p.path}</div>
        </div>
      </div>
    `).join('');
  }
  
  document.getElementById('scanResults').style.display = 'block';
  document.getElementById('scanActions').style.display = 'flex';
}

async function importScannedProjects() {
  const selectedPaths = [];
  const group = document.getElementById('scanGroup').value;
  scanResults.forEach((p, index) => {
    if (document.getElementById(`scan-${index}`)?.checked) {
      selectedPaths.push(p.path);
    }
  });

  if (selectedPaths.length === 0) return;

  const response = await fetch('/api/projects/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: selectedPaths, group })
  });

  await response.json();
  await loadProjects();
  closeModal('scanModal');
}

function editProject(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;

  document.getElementById('editId').value = project.id;
  document.getElementById('editName').value = project.name;
  document.getElementById('editGroup').value = project.group || '默认分组';
  document.getElementById('editPort').value = project.port;
  document.getElementById('editNodeVersion').value = project.nodeVersion;
  document.getElementById('editModal').classList.add('show');
}

async function saveEdit(event) {
  if (event) event.preventDefault();
  const id = parseFloat(document.getElementById('editId').value);
  const updates = {
    name: document.getElementById('editName').value,
    group: document.getElementById('editGroup').value,
    port: parseInt(document.getElementById('editPort').value),
    nodeVersion: document.getElementById('editNodeVersion').value
  };

  const response = await fetch(`/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });

  const result = await response.json();
  if (result.error) {
    alert(result.error);
  } else {
    await loadProjects();
    closeModal('editModal');
  }
}

function deleteProject(id) {
  const project = projects.find(p => p.id === id);
  const name = project?.name || '该项目';
  document.getElementById('confirmTitle').textContent = '确认删除';
  document.getElementById('confirmMessage').textContent = `确定要删除 "${name}" 吗？此操作不可撤销。`;
  document.getElementById('confirmActionBtn').textContent = '确认删除';
  document.getElementById('confirmActionBtn').onclick = confirmDelete;
  pendingDeleteId = id;
  document.getElementById('confirmModal').classList.add('show');
}

async function confirmDelete() {
  if (pendingDeleteId === null) return;
  
  await fetch(`/api/projects/${pendingDeleteId}`, { method: 'DELETE' });
  await loadProjects();
  pendingDeleteId = null;
  closeModal('confirmModal');
}

function toggleSelectAll() {
  const checkboxes = document.querySelectorAll('.project-checkbox');
  const selectAll = document.getElementById('selectAll');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
  updateBatchDeleteBtn();
}

function updateBatchDeleteBtn() {
  const checked = document.querySelectorAll('.project-checkbox:checked');
  const btn = document.getElementById('batchDeleteBtn');
  btn.disabled = checked.length === 0;
  document.getElementById('selectAll').checked = checked.length > 0 && checked.length === document.querySelectorAll('.project-checkbox').length;
}

async function batchDelete() {
  const checked = document.querySelectorAll('.project-checkbox:checked');
  const ids = Array.from(checked).map(cb => parseFloat(cb.value));
  const names = ids.map(id => {
    const p = projects.find(project => project.id === id);
    return p ? p.name : id;
  });
  
  document.getElementById('confirmTitle').textContent = '确认批量删除';
  document.getElementById('confirmMessage').textContent = `确定要删除以下 ${ids.length} 个项目吗？此操作不可撤销。\n${names.join('\n')}`;
  document.getElementById('confirmActionBtn').textContent = '确认删除';
  document.getElementById('confirmActionBtn').onclick = confirmBatchDelete;
  pendingDeleteIds = ids;
  document.getElementById('confirmModal').classList.add('show');
}

async function confirmBatchDelete() {
  if (!pendingDeleteIds || pendingDeleteIds.length === 0) return;
  
  await fetch('/api/projects/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: pendingDeleteIds })
  });
  await loadProjects();
  pendingDeleteIds = null;
  document.getElementById('selectAll').checked = false;
  closeModal('confirmModal');
}

async function startProject(id) {
  const response = await fetch(`/api/projects/${id}/start`, { method: 'POST' });
  const result = await response.json();
  
  if (result.error) {
    const project = projects.find(p => p.id === id);
    const port = extractPortFromLog(result.error);
    if (port && project) {
      document.getElementById('confirmTitle').textContent = '端口被占用';
      document.getElementById('confirmMessage').textContent = `端口 ${port} 被占用，是否杀掉占用进程并重新启动 "${project.name}"？`;
      document.getElementById('confirmActionBtn').textContent = '杀掉端口并重启';
      document.getElementById('confirmActionBtn').onclick = () => killPortAndRestart(id, port);
      pendingStopId = id;
      document.getElementById('confirmModal').classList.add('show');
    } else {
      alert(result.error);
    }
  } else {
    await loadProjects();
    viewLogs(id);
    setTimeout(() => pollProjectStatus(id), 1000);
  }
}

async function openEditor(path) {
  await fetch('/api/open-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
}

async function killPortAndRestart(projectId, port) {
  closeModal('confirmModal');
  const response = await fetch('/api/kill-port', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port: parseInt(port) })
  });
  const result = await response.json();
  if (result.success) {
    startProject(projectId);
  } else {
    alert('无法杀掉占用端口的进程，请手动处理');
  }
}

function pollProjectStatus(id) {
  let attempts = 0;
  const maxAttempts = 60;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const response = await fetch(`/api/projects/${id}/status`);
      const result = await response.json();
      if (result.error) {
        clearInterval(interval);
        return;
      }
      const project = projects.find(p => p.id === id);
      const statusChanged = project && project.status !== result.status;
      
      if (statusChanged) {
        await loadProjects();
        if (currentLogsProjectId === id) {
          updateStopButton(id);
        }
      }
      
      if (result.status === 'running' || result.status === 'stopped' || attempts >= maxAttempts) {
        clearInterval(interval);
        // 状态变成 running 或 stopped 时都刷新一次，确保"启动中"正确变成"运行中"
        if ((result.status === 'running' || result.status === 'stopped') && attempts < maxAttempts) {
          if (!statusChanged) {
            await loadProjects();
          }
          if (currentLogsProjectId === id) {
            updateStopButton(id);
          }
        }
      }
    } catch (e) {
      clearInterval(interval);
    }
  }, 1000);
}

function stopProject(id) {
  const project = projects.find(p => p.id === id);
  const name = project?.name || '该项目';
  document.getElementById('confirmTitle').textContent = '确认停止';
  document.getElementById('confirmMessage').textContent = `确定要停止 "${name}" 吗？`;
  document.getElementById('confirmActionBtn').textContent = '确认停止';
  document.getElementById('confirmActionBtn').onclick = confirmStop;
  pendingStopId = id;
  document.getElementById('confirmModal').classList.add('show');
}

async function confirmStop() {
  if (pendingStopId === null) return;
  
  await fetch(`/api/projects/${pendingStopId}/stop`, { method: 'POST' });
  const stoppedId = pendingStopId;
  pendingStopId = null;
  closeModal('confirmModal');
  await loadProjects();
  
  if (currentLogsProjectId === stoppedId) {
    updateStopButton(stoppedId);
  }
}

function stopProjectFromLogs() {
    if (currentLogsProjectId) {
        updateStopButton(currentLogsProjectId);
        stopProject(currentLogsProjectId);
    }
}

function viewLogs(id) {
  currentLogsProjectId = id;
  const project = projects.find(p => p.id === id);
  document.getElementById('logsTitle').textContent = `${project.name} - 日志`;
  updateStopButton(id);
  document.getElementById('logsModal').classList.add('show');
  loadLogs(id);
  
  logsInterval = setInterval(() => loadLogs(id), 2000);
}

function syntaxHighlight(json) {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  }
  
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

async function viewPackageJson(id) {
  const project = projects.find(p => p.id === id);
  const response = await fetch(`/api/projects/${id}/package-json`);
  const result = await response.json();
  
  if (result.error) {
    alert(result.error);
    return;
  }
  
  document.getElementById('packageJsonTitle').textContent = `${project.name} - package.json`;
  document.getElementById('packageJsonContent').innerHTML = '<pre><code>' + syntaxHighlight(result.content) + '</code></pre>';
  document.getElementById('packageJsonModal').classList.add('show');
}

function updateStopButton(id) {
  const project = projects.find(p => p.id === id);
  const stopBtn = document.getElementById('stopProjectBtn');
  if (project && project.status === 'running') {
    stopBtn.style.display = 'inline-block';
  } else {
    stopBtn.style.display = 'none';
  }
}

async function loadLogs(id) {
  let loading = true;
  const response = await fetch(`/api/projects/${id}/logs`);
  const logs = await response.json();
  loading = false;
  const container = document.getElementById('logsContent');
  if (logs.length === 0 && !loading) {
    container.innerHTML = `
      <div class="logs-placeholder">
        <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
        <div style="color: #999; font-size: 14px;">暂无日志信息</div>
        <div style="color: #bbb; font-size: 12px; margin-top: 8px;">启动项目后将显示运行日志</div>
      </div>
    `;
  } else {
    container.innerHTML = logs.map(log => `
      <div class="log-line ${log.type}">${log.content.replace(/\n/g, '<br>')}</div>
    `).join('');
    container.scrollTop = container.scrollHeight;
  }
  
  checkPortConflictInLogs(id, logs);
}

function checkPortConflictInLogs(id, logs) {
  const portRegex = /(?:EADDRINUSE|port.*already in use|address already in use)/i;
  for (const log of logs) {
    if (portRegex.test(log.content)) {
      const port = extractPortFromLog(log.content);
      if (port) {
        showPortConflictAlert(id, port);
        return;
      }
    }
  }
}

function extractPortFromLog(content) {
  const patterns = [
    /:::(\d+)/,
    /0\.0\.0\.0:(\d+)/,
    /127\.0\.0\.1:(\d+)/,
    /localhost:(\d+)/,
    /:\*:(\d+)/,
    /:(\d+)$/
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  const allNumbers = content.match(/(\d{4,5})/g);
  if (allNumbers && allNumbers.length > 0) {
    for (const num of allNumbers) {
      const port = parseInt(num);
      if (port >= 1 && port <= 65535) {
        return num;
      }
    }
  }
  
  return null;
}

function showPortConflictAlert(projectId, port) {
  const existingAlert = document.getElementById('portConflictAlert');
  if (existingAlert) return;
  
  const project = projects.find(p => p.id === projectId);
  const alertDiv = document.createElement('div');
  alertDiv.id = 'portConflictAlert';
  alertDiv.style.cssText = 'background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px;';
  alertDiv.innerHTML = `
    <span style="font-size: 18px;">⚠️</span>
    <div style="flex: 1;">
      <div style="font-weight: 500; color: #991b1b;">端口 ${port} 被占用</div>
      <div style="font-size: 12px; color: #b91c1c;">${project ? `"${project.name}"` : '项目'} 启动失败，请杀掉占用进程后重试</div>
    </div>
    <button class="btn btn-danger btn-sm" onclick="killPortAndRestart(${projectId}, ${port}); this.parentElement.remove();">杀掉端口并重启</button>
  `;
  
  const logsContent = document.getElementById('logsContent');
  logsContent.parentElement.insertBefore(alertDiv, logsContent);
}

window.onclick = function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('show');
  }
}

const scrollToTopBtn = document.getElementById('scrollToTopBtn');

window.addEventListener('scroll', () => {
  if (window.scrollY > 300) {
    scrollToTopBtn.classList.add('show');
  } else {
    scrollToTopBtn.classList.remove('show');
  }
});

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

initTheme();
loadGroups();
loadProjects();

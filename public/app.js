let projects = [];
let groups = ['默认分组'];
let scanResults = [];
let currentLogsProjectId = null;
let logsInterval = null;
let currentGroup = '全部';
let pendingDeleteId = null;
let pendingDeleteIds = null;
let pendingDeleteGroup = null;
let pendingStopId = null;
let gitInfoCache = {};

// 分页状态
let paginationState = {
  page: 1,
  pageSize: 20,
  hasMore: true,
  total: 0,
  loading: false,
  groupStats: {}
};

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Toast 消息提示函数
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  // 3秒后自动消失
  setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 创建 Loading 元素并插入到目标元素中
function createLoading(targetElementOrId, loadingId = null) {
  const target = typeof targetElementOrId === 'string' 
    ? document.getElementById(targetElementOrId) 
    : targetElementOrId;
  
  if (!target) return null;
  
  // 使用传入的 ID 或自动生成
  const id = loadingId || `loading-${Date.now()}`;
  
  // 如果目标元素下已存在此 loading，直接返回
  const existing = target.querySelector(`#${id}`);
  if (existing) return existing;
  
  // 创建 Loading HTML
  const loadingHtml = `
    <div id="${id}" class="page-loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">加载中...</div>
    </div>
  `;
  
  // 插入到目标元素开头
  target.insertAdjacentHTML('afterbegin', loadingHtml);
  
  return document.getElementById(id);
}

// 显示 Loading（默认全局 pageLoading，支持传入元素ID或元素对象）
function showLoading(elementOrId = 'pageLoading') {
  let element = typeof elementOrId === 'string' 
    ? document.getElementById(elementOrId) 
    : elementOrId;
  
  // 如果元素不存在，尝试创建（默认全局 loading 插入到 body）
  if (!element && elementOrId === 'pageLoading') {
    element = createLoading(document.body, 'pageLoading');
  }
  
  if (element) {
    element.classList.add('show');
  }
  return element;
}

// 隐藏 Loading（默认全局 pageLoading，支持传入元素ID或元素对象）
function hideLoading(elementOrId = 'pageLoading') {
  const element = typeof elementOrId === 'string' 
    ? document.getElementById(elementOrId) 
    : elementOrId;
  
  if (element) {
    element.classList.remove('show');
  }
}

// 设置按钮 Loading 状态
function setButtonLoading(btnOrId, isLoading) {
  const btn = typeof btnOrId === 'string' 
    ? document.querySelector(btnOrId) 
    : btnOrId;
  
  if (!btn) return;
  
  if (isLoading) {
    btn.dataset.originalText = btn.textContent;
    btn.disabled = true;
    btn.classList.add('btn-loading');
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
  }
}

// 初始化自定义下拉选择组件
function initCustomSelect(selectId, onChange) {
  const originalSelect = document.getElementById(selectId);
  if (!originalSelect) return null;

  // 隐藏原生 select
  originalSelect.style.display = 'none';

  // 创建自定义选择器容器
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  wrapper.id = `custom-${selectId}`;

  // 创建触发器
  const trigger = document.createElement('div');
  trigger.className = 'custom-select-trigger';
  
  const currentText = document.createElement('span');
  currentText.className = 'custom-select-text';
  currentText.textContent = originalSelect.options[originalSelect.selectedIndex]?.text || '';

  const arrow = document.createElement('div');
  arrow.className = 'custom-select-arrow';

  trigger.appendChild(currentText);
  trigger.appendChild(arrow);

  // 创建下拉菜单
  const dropdown = document.createElement('div');
  dropdown.className = 'custom-select-dropdown';

  // 生成选项
  function renderOptions() {
    dropdown.innerHTML = '';
    Array.from(originalSelect.options).forEach((option, index) => {
      const optElement = document.createElement('div');
      optElement.className = `custom-select-option ${index === originalSelect.selectedIndex ? 'selected' : ''}`;
      optElement.textContent = option.text;
      optElement.dataset.value = option.value;
      optElement.onclick = () => {
        originalSelect.selectedIndex = index;
        currentText.textContent = option.text;
        wrapper.classList.remove('open');
        // 更新选中样式
        Array.from(dropdown.children).forEach(child => child.classList.remove('selected'));
        optElement.classList.add('selected');
        if (onChange) onChange(option.value);
      };
      dropdown.appendChild(optElement);
    });
  }

  renderOptions();

  // 点击触发器切换菜单
  trigger.onclick = (e) => {
    e.stopPropagation();
    // 关闭其他所有下拉
    document.querySelectorAll('.custom-select').forEach(s => {
      if (s !== wrapper) s.classList.remove('open');
    });
    wrapper.classList.toggle('open');
  };

  // 点击外部关闭
  document.addEventListener('click', () => {
    wrapper.classList.remove('open');
  });

  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);

  // 插入到原生 select 后面
  originalSelect.parentNode.insertBefore(wrapper, originalSelect.nextSibling);

  // 返回更新方法
  return {
    update: renderOptions,
    setValue: (value) => {
      const index = Array.from(originalSelect.options).findIndex(o => o.value === value);
      if (index >= 0) {
        originalSelect.selectedIndex = index;
        currentText.textContent = originalSelect.options[index].text;
        renderOptions();
      }
    },
    getValue: () => originalSelect.value
  };
}

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
  resetFilters();
  loadProjects(true, true); // 重置分页，重新加载（获取 git info）
  document.getElementById('currentGroupTitle').textContent = group === '全部' ? '全部项目' : `${group}`;
  
  // 移动端选择后自动关闭侧边栏
  if (window.innerWidth <= 768) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('show');
    overlay.classList.remove('show');
  }
  scrollToTop();
}

// 设置主题色
function setThemeColor(color) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', color);
  localStorage.setItem('themeColor', color);
  
  // 更新颜色选择器的激活状态
  document.querySelectorAll('.color-option').forEach(option => {
    if (option.dataset.color === color) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });
  
  // showToast('主题色已更新', 'success');
}

// 主题切换功能
function toggleTheme() {
  const body = document.body;
  const themeToggle = document.getElementById('themeToggle');
  body.classList.toggle('dark');
  const isDark = body.classList.contains('dark');
  themeToggle.innerHTML = isDark ? '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="M11.288 4.713Q11 4.425 11 4V2q0-.425.288-.712T12 1t.713.288T13 2v2q0 .425-.288.713T12 5t-.712-.288M16.95 7.05q-.275-.275-.275-.687t.275-.713l1.4-1.425q.3-.3.712-.3t.713.3q.275.275.275.7t-.275.7L18.35 7.05q-.275.275-.7.275t-.7-.275M20 13q-.425 0-.713-.288T19 12t.288-.712T20 11h2q.425 0 .713.288T23 12t-.288.713T22 13zm-8.712 9.713Q11 22.425 11 22v-2q0-.425.288-.712T12 19t.713.288T13 20v2q0 .425-.288.713T12 23t-.712-.288M5.65 7.05l-1.425-1.4q-.3-.3-.3-.725t.3-.7q.275-.275.7-.275t.7.275L7.05 5.65q.275.275.275.7t-.275.7q-.3.275-.7.275t-.7-.275m12.7 12.725l-1.4-1.425q-.275-.3-.275-.712t.275-.688t.688-.275t.712.275l1.425 1.4q.3.275.288.7t-.288.725q-.3.3-.725.3t-.7-.3M2 13q-.425 0-.712-.288T1 12t.288-.712T2 11h2q.425 0 .713.288T5 12t-.288.713T4 13zm2.225 6.775q-.275-.275-.275-.7t.275-.7L5.65 16.95q.275-.275.687-.275t.713.275q.3.3.3.713t-.3.712l-1.4 1.4q-.3.3-.725.3t-.7-.3M7.75 16.25Q6 14.5 6 12t1.75-4.25T12 6t4.25 1.75T18 12t-1.75 4.25T12 18t-4.25-1.75"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="M12 21q-3.75 0-6.375-2.625T3 12t2.625-6.375T12 3q.35 0 .688.025t.662.075q-1.025.725-1.638 1.888T11.1 7.5q0 2.25 1.575 3.825T16.5 12.9q1.375 0 2.525-.613T20.9 10.65q.05.325.075.662T21 12q0 3.75-2.625 6.375T12 21"/></svg>';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
  
  if (shouldUseDark) {
    document.body.classList.add('dark');
    document.getElementById('themeToggle').innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE --><path fill="currentColor" d="M11.288 4.713Q11 4.425 11 4V2q0-.425.288-.712T12 1t.713.288T13 2v2q0 .425-.288.713T12 5t-.712-.288M16.95 7.05q-.275-.275-.275-.687t.275-.713l1.4-1.425q.3-.3.712-.3t.713.3q.275.275.275.7t-.275.7L18.35 7.05q-.275.275-.7.275t-.7-.275M20 13q-.425 0-.713-.288T19 12t.288-.712T20 11h2q.425 0 .713.288T23 12t-.288.713T22 13zm-8.712 9.713Q11 22.425 11 22v-2q0-.425.288-.712T12 19t.713.288T13 20v2q0 .425-.288.713T12 23t-.712-.288M5.65 7.05l-1.425-1.4q-.3-.3-.3-.725t.3-.7q.275-.275.7-.275t.7.275L7.05 5.65q.275.275.275.7t-.275.7q-.3.275-.7.275t-.7-.275m12.7 12.725l-1.4-1.425q-.275-.3-.275-.712t.275-.688t.688-.275t.712.275l1.425 1.4q.3.275.288.7t-.288.725q-.3.3-.725.3t-.7-.3M2 13q-.425 0-.712-.288T1 12t.288-.712T2 11h2q.425 0 .713.288T5 12t-.288.713T4 13zm2.225 6.775q-.275-.275-.275-.7t.275-.7L5.65 16.95q.275-.275.687-.275t.713.275q.3.3.3.713t-.3.712l-1.4 1.4q-.3.3-.725.3t-.7-.3M7.75 16.25Q6 14.5 6 12t1.75-4.25T12 6t4.25 1.75T18 12t-1.75 4.25T12 18t-4.25-1.75"/></svg>';
  }
  
  // 加载保存的主题色
  const savedColor = localStorage.getItem('themeColor');
  if (savedColor) {
    setThemeColor(savedColor);
  }
}

// 初始化颜色选择器点击事件
function initColorPicker() {
  document.querySelectorAll('.color-option').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = option.dataset.color;
      setThemeColor(color);
    });
  });
  
  // 设置初始激活状态
  const savedColor = localStorage.getItem('themeColor');
  if (savedColor) {
    document.querySelectorAll('.color-option').forEach(option => {
      if (option.dataset.color === savedColor) {
        option.classList.add('active');
      }
    });
  } else {
    // 默认选中第一个颜色
    const firstOption = document.querySelector('.color-option');
    if (firstOption) {
      firstOption.classList.add('active');
    }
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
  const allCount = Object.values(paginationState.groupStats || {}).reduce((sum, count) => sum + count, 0) || 0;
  
  let html = `
    <li class="group-item ${currentGroup === '全部' ? 'active' : ''}" onclick="selectGroup('全部')">
      <span class="group-name">全部项目</span>
      <span class="group-count">${allCount}</span>
    </li>
  `;

  groups.forEach(group => {
    const count = paginationState.groupStats?.[group] || 0;
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



// 存储所有自定义下拉实例
const customSelectInstances = {};

function updateGroupSelects() {
  const selects = ['importGroup', 'scanGroup', 'editGroup', 'gitImportGroup'];
  selects.forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');
      // 更新自定义下拉组件
      if (customSelectInstances[id]) {
        customSelectInstances[id].update();
      }
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

async function fetchGitInfo(projectId) {
  try {
    const response = await fetch(`/api/projects/${projectId}/git/info`);
    const result = await response.json();
    gitInfoCache[projectId] = result;
    return result;
  } catch {
    gitInfoCache[projectId] = { isGitRepo: false };
    return { isGitRepo: false };
  }
}

async function fetchGitBranches(projectId) {
  try {
    const response = await fetch(`/api/projects/${projectId}/git/branches`);
    const result = await response.json();
    return result;
  } catch {
    return { branches: [], isGitRepo: false };
  }
}

function getGitInfo(projectId) {
  const info = gitInfoCache[projectId] || { isGitRepo: false };
  return {
    isGitRepo: info.isGitRepo || false,
    currentBranch: info.currentBranch || '',
    commitId: info.commitId || '',
    commitMessage: info.commitMessage || '',
    commitAuthor: info.commitAuthor || '',
    commitTime: info.commitTime || '',
    aheadCount: info.aheadCount || 0,
    behindCount: info.behindCount || 0
  };
}

function truncateCommitMessage(message, maxLength = 80) {
  if (!message) return '';
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + '...';
}

function formatCommitId(commitId) {
  if (!commitId) return '';
  return commitId.substring(0, 7);
}

function formatGitTimestamp(timestamp) {
  if (!timestamp) return '';
  // git %ct 返回的是 unix 时间戳（秒），需要转成毫秒
  const date = new Date(parseInt(timestamp) * 1000);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
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

let branchModalProjectId = null;

function openBranchModal(projectId) {
  branchModalProjectId = projectId;
  const modal = document.getElementById('branchModal');
  const branchSelect = document.getElementById('branchSelect');
  const currentBranchDisplay = document.getElementById('currentBranchDisplay');
  
  branchSelect.innerHTML = '<option value="">加载中...</option>';
  
  fetchGitBranches(projectId).then(result => {
    if (!result.isGitRepo) {
      branchSelect.innerHTML = '<option value="">非 Git 仓库</option>';
      if (customSelectInstances.branchSelect) {
        customSelectInstances.branchSelect.update();
      }
      return;
    }
    
    const gitInfo = getGitInfo(projectId);
    currentBranchDisplay.textContent = gitInfo.currentBranch || '';
    
    branchSelect.innerHTML = result.branches.map(b => 
      `<option value="${b.name}" ${b.isCurrent ? 'selected' : ''}>${b.name}${b.isRemote ? ' (远程)' : ''}</option>`
    ).join('');
    
    // 更新自定义下拉组件
    if (customSelectInstances.branchSelect) {
      customSelectInstances.branchSelect.update();
    }
  });
  
  openModal('branchModal');
}

function closeBranchModal() {
  closeModal('branchModal');
  branchModalProjectId = null;
}

async function checkoutBranch() {
  if (!branchModalProjectId) return;
  
  const branch = document.getElementById('branchSelect').value;
  if (!branch) return;
  
  const btn = document.getElementById('checkoutBtn');
  btn.disabled = true;
  btn.textContent = '切换中...';
  
  try {
    const response = await fetch(`/api/projects/${branchModalProjectId}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    });
    
    const result = await response.json();
    
    if (result.error) {
      if (result.hasConflict) {
        showToast(`切换分支失败，存在冲突。正在打开编辑器...`, 'error');
        const project = projects.find(p => p.id === branchModalProjectId);
        if (project) {
          openEditor(project.projectPath);
        }
      } else {
        showToast(`切换失败: ${result.error}`, 'error');
      }
    } else {
      gitInfoCache[branchModalProjectId] = {
        ...gitInfoCache[branchModalProjectId],
        currentBranch: result.branch,
        commitId: result.commitId,
        commitMessage: result.commitMessage
      };
      renderProjects();
      closeBranchModal();
      showToast(`切换成功！已切换到分支 "${result.branch}"`, 'success');
    }
  } catch (e) {
    showToast('切换失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '切换分支';
  }
}

async function gitPull(projectId) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  
  const btn = document.querySelector(`[onclick="gitPull(${projectId})"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '拉取中...';
  }
  
  try {
    const response = await fetch(`/api/projects/${projectId}/git/pull`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (result.error) {
      if (result.hasConflict) {
        showToast(`拉取失败，存在冲突。正在打开编辑器...`, 'error');
        openEditor(project.projectPath);
      } else {
        showToast(`拉取失败: ${result.error}`, 'error');
      }
    } else {
      // 重新获取 git 信息（包含 aheadCount 和 behindCount）
      await fetchGitInfo(projectId);
      renderProjects();
      showToast('拉取成功！代码已更新到最新版本', 'success');
    }
  } catch (e) {
    showToast('拉取失败', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
}

async function gitPush(projectId) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  
  const btn = document.querySelector(`[onclick="gitPush(${projectId})"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '同步中...';
  }
  
  try {
    const response = await fetch(`/api/projects/${projectId}/git/push`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (result.error) {
      showToast(`同步失败: ${result.error}`, 'error');
    } else {
      // 重新获取 git 信息（包含 aheadCount 和 behindCount）
      await fetchGitInfo(projectId);
      renderProjects();
      showToast('同步成功！代码已推送到远程仓库', 'success');
    }
  } catch (e) {
    showToast('同步失败', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
}

let mergeModalProjectId = null;

function openMergeModal(projectId) {
  mergeModalProjectId = projectId;
  const modal = document.getElementById('mergeModal');
  const mergeBranchSelect = document.getElementById('mergeBranchSelect');
  
  mergeBranchSelect.innerHTML = '<option value="">加载中...</option>';
  
  fetchGitBranches(projectId).then(result => {
    if (!result.isGitRepo) {
      mergeBranchSelect.innerHTML = '<option value="">非 Git 仓库</option>';
      if (customSelectInstances.mergeBranchSelect) {
        customSelectInstances.mergeBranchSelect.update();
      }
      return;
    }
    
    const gitInfo = getGitInfo(projectId);
    mergeBranchSelect.innerHTML = result.branches
      .filter(b => !b.isCurrent && !b.name.startsWith('HEAD'))
      .map(b => 
        `<option value="${b.name}">${b.name}${b.isRemote ? ' (远程)' : ''}</option>`
      ).join('');
    
    // 更新自定义下拉组件
    if (customSelectInstances.mergeBranchSelect) {
      customSelectInstances.mergeBranchSelect.update();
    }
  });
  
  openModal('mergeModal');
}

function closeMergeModal() {
  closeModal('mergeModal');
  mergeModalProjectId = null;
}

async function executeMerge() {
  if (!mergeModalProjectId) return;
  
  const branch = document.getElementById('mergeBranchSelect').value;
  if (!branch) return;
  
  const btn = document.getElementById('mergeBtn');
  btn.disabled = true;
  btn.textContent = '合并中...';
  
  try {
    const response = await fetch(`/api/projects/${mergeModalProjectId}/git/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    });
    
    const result = await response.json();
    
    if (result.error) {
      if (result.hasConflict) {
        showToast(`合并失败，存在冲突。正在打开编辑器...`, 'error');
        const project = projects.find(p => p.id === mergeModalProjectId);
        if (project) {
          openEditor(project.projectPath);
        }
      } else {
        showToast(`合并失败: ${result.error}`, 'error');
      }
    } else {
      gitInfoCache[mergeModalProjectId] = {
        ...gitInfoCache[mergeModalProjectId],
        commitId: result.commitId,
        commitMessage: result.commitMessage
      };
      renderProjects();
      closeMergeModal();
      showToast(`合并成功！已将分支合并到当前分支`, 'success');
    }
  } catch (e) {
    showToast('合并失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '执行合并';
  }
}

function openGitImportModal() {
  document.getElementById('gitRepoUrl').value = '';
  document.getElementById('gitTargetPath').value = '';
  document.getElementById('gitConflictInfo').style.display = 'none';
  document.getElementById('gitImportBtn').textContent = '导入';
  document.getElementById('gitImportBtn').disabled = false;
  gitImportState = { action: null, conflictChecked: false };
  openModal('gitImportModal');
}

function closeGitImportModal() {
  closeModal('gitImportModal');
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
    showToast('请输入仓库地址', 'warning');
    return;
  }
  if (!targetPath) {
    showToast('请选择保存路径', 'warning');
    return;
  }

  const btn = document.getElementById('gitImportBtn');

  // 如果还没有检查冲突，先检查冲突
  if (!gitImportState.conflictChecked) {
    setButtonLoading(btn, true);
    btn.classList.remove('btn-loading');
    btn.style.color = '';
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

  setButtonLoading(btn, true);
  btn.classList.remove('btn-loading');
  btn.style.color = '';
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
    showToast(result.error, 'error');
    setButtonLoading(btn, false);
    btn.textContent = '导入';
    return;
  }

  if (result.skipped) {
    showToast('已跳过该项目', 'info');
  } else if (result.warning) {
    showToast(result.warning, 'warning');
  } else if (result.overwritten) {
    showToast('项目已覆盖并重新导入', 'success');
  } else {
    showToast('导入成功', 'success');
  }

  closeGitImportModal();
  loadProjects();
}

// Git 信息定时刷新定时器
let gitInfoRefreshInterval = null;

// 刷新所有项目的 Git 信息
async function refreshAllGitInfo() {
  if (projects.length === 0) return;
  
  try {
    await Promise.all(projects.map(p => fetchGitInfo(p.id)));
    renderProjects();
  } catch (e) {
    console.error('刷新 Git 信息失败:', e);
  }
}

// 启动 Git 信息定时刷新（每30秒刷新一次）
function startGitInfoRefresh() {
  if (gitInfoRefreshInterval) {
    clearInterval(gitInfoRefreshInterval);
  }
  gitInfoRefreshInterval = setInterval(refreshAllGitInfo, 30000);
}

// 停止 Git 信息定时刷新
function stopGitInfoRefresh() {
  if (gitInfoRefreshInterval) {
    clearInterval(gitInfoRefreshInterval);
    gitInfoRefreshInterval = null;
  }
}
/**
 * 加载项目列表
 * @param {boolean} shouldFetchGitInfo - 是否在加载时刷新 Git 信息
 */
async function loadProjects(shouldFetchGitInfo = false, resetPagination = true) {
  if (paginationState.loading) return;
  
  if (resetPagination) {
    paginationState.page = 1;
    paginationState.hasMore = true;
    projects = [];
    const container = document.getElementById('projectList');
    if (container) {
      container.innerHTML = '';
    }
  }
  
  if (!paginationState.hasMore && !resetPagination) return;
  
  paginationState.loading = true;
  
  // 有数据时才显示加载中（加载更多场景）
  if (projects.length > 0) {
    const loaderId = 'loadMoreLoader';
    let loader = document.getElementById(loaderId);
    if (!loader) {
      // loader 不存在时先创建
      const container = document.getElementById('projectList');
      if (container && container.parentNode) {
        loader = document.createElement('div');
        loader.id = loaderId;
        loader.style.cssText = 'text-align: center; padding: 20px; color: var(--text-muted);';
        container.parentNode.appendChild(loader);
      }
    }
    if (loader) {
      loader.innerHTML = '<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border-color); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></span><span style="vertical-align: middle;">加载中...</span>';
    }
  }
  
  try {
    const searchTerm = document.getElementById('searchInput')?.value || '';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const groupFilter = currentGroup === '全部' ? '' : currentGroup;
    
    const params = new URLSearchParams({
      page: paginationState.page,
      pageSize: paginationState.pageSize,
      search: searchTerm,
      status: statusFilter,
      group: groupFilter
    });
    
    const response = await fetch(`/api/projects?${params}`);
    const result = await response.json();
    
    if (resetPagination) {
      projects = result.projects;
    } else {
      // 追加模式，避免重复
      const existingIds = new Set(projects.map(p => p.id));
      const newProjects = result.projects.filter(p => !existingIds.has(p.id));
      projects = [...projects, ...newProjects];
    }
    
    paginationState.total = result.total;
    paginationState.hasMore = result.hasMore;
    paginationState.page = result.page;
    if (result.groupStats) {
      paginationState.groupStats = result.groupStats;
    }
    
    resetPagination && showLoading();
    if (shouldFetchGitInfo) {
      // 页面加载时，刷新所有项目的 Git 信息
      gitInfoCache = {};
      await Promise.all(projects.map(p => fetchGitInfo(p.id)));
    }
    resetPagination && hideLoading();
    
    // 加载完成，设置 loading 为 false
    paginationState.loading = false;
    
    renderGroups();
    renderProjects(!resetPagination); // resetPagination=false 时是追加模式
    updateBatchDeleteBtn();
    
    // 只有首次加载时启动定时刷新
    if (resetPagination) {
      startGitInfoRefresh();
    }
  } catch (error) {
    paginationState.loading = false;
    console.error('加载项目失败:', error);
  } finally {
    // 确保 loading 状态最终是 false
    paginationState.loading = false;
  }
}

// 加载更多项目
async function loadMoreProjects() {
  if (paginationState.loading || !paginationState.hasMore) return;
  
  paginationState.page += 1;
  await loadProjects(true, false);
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

function renderProjects(appendMode = false) {
  const container = document.getElementById('projectList');
  
  document.getElementById('projectCount').textContent = `共 ${paginationState.total} 个项目`;
  
  if (projects.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>暂无项目</h3>
        <p>点击上方按钮导入或扫描项目</p>
      </div>
    `;
    return;
  }

  // 生成单个项目的 HTML
  const renderProject = (project) => {
    const gitInfo = getGitInfo(project.id);
    const isGitRepo = gitInfo.isGitRepo;
    const currentBranch = gitInfo.currentBranch;
    const commitId = gitInfo.commitId;
    const commitMessage = gitInfo.commitMessage;
    
    return `
    <div class="project-item ${project.status || 'stopped'}" id="project-${project.id}">
      <div class="project-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <label class="custom-checkbox">
            <input type="checkbox" class="project-checkbox" value="${project.id}" onchange="updateBatchDeleteBtn()">
            <span class="checkbox-checkmark"></span>
          </label>
          <span class="project-name">${project.name}</span>
          <span class="project-version">${project.version}</span>
          ${isGitRepo && currentBranch ? `<span class="git-branch-tag" onclick="openBranchModal(${project.id})" title="点击切换分支">🌿 ${currentBranch}</span>` : ''}
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
        <div class="info-item flex gap-4">
          <div class="info-item flex flex-col md:flex-row">
            <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 128 128"><path fill="url(#SVGfJo5KBID)" d="M66.958.825a6.07 6.07 0 0 0-6.035 0L11.103 29.76c-1.895 1.072-2.96 3.095-2.96 5.24v57.988c0 2.143 1.183 4.167 2.958 5.24l49.82 28.934a6.07 6.07 0 0 0 6.036 0l49.82-28.935c1.894-1.072 2.958-3.096 2.958-5.24V35c0-2.144-1.183-4.167-2.958-5.24z"/><path fill="url(#SVGO7R9ibnx)" d="M116.897 29.76L66.841.825A8 8 0 0 0 65.302.23L9.21 96.798a6.3 6.3 0 0 0 1.657 1.43l50.057 28.934c1.42.833 3.076 1.072 4.615.595l52.66-96.925a3.7 3.7 0 0 0-1.302-1.072"/><path fill="url(#SVGXTTu2b3u)" d="M116.898 98.225c1.42-.833 2.485-2.262 2.958-3.81L65.066.108c-1.42-.238-2.959-.119-4.26.715L11.104 29.639l53.606 98.355c.71-.12 1.54-.358 2.25-.715z"/><defs><linearGradient id="SVGfJo5KBID" x1="34.513" x2="27.157" y1="15.535" y2="30.448" gradientTransform="translate(-129.242 -73.715)scale(6.18523)" gradientUnits="userSpaceOnUse"><stop stop-color="#3f873f"/><stop offset=".33" stop-color="#3f8b3d"/><stop offset=".637" stop-color="#3e9638"/><stop offset=".934" stop-color="#3da92e"/><stop offset="1" stop-color="#3dae2b"/></linearGradient><linearGradient id="SVGO7R9ibnx" x1="30.009" x2="50.533" y1="23.359" y2="8.288" gradientTransform="translate(-129.242 -73.715)scale(6.18523)" gradientUnits="userSpaceOnUse"><stop offset=".138" stop-color="#3f873f"/><stop offset=".402" stop-color="#52a044"/><stop offset=".713" stop-color="#64b749"/><stop offset=".908" stop-color="#6abf4b"/></linearGradient><linearGradient id="SVGXTTu2b3u" x1="21.917" x2="40.555" y1="22.261" y2="22.261" gradientTransform="translate(-129.242 -73.715)scale(6.18523)" gradientUnits="userSpaceOnUse"><stop offset=".092" stop-color="#6abf4b"/><stop offset=".287" stop-color="#64b749"/><stop offset=".598" stop-color="#52a044"/><stop offset=".862" stop-color="#3f873f"/></linearGradient></defs></svg></span>
            <span>Node: ${project.nodeVersion}</span>
          </div>
          <div class="info-item flex-col md:flex-row">
            <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><!-- Icon from Akar Icons by Arturo Wibawa - https://github.com/artcoholic/akar-icons/blob/master/LICENSE --><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm6 14h8"/></svg></span>
            <span>端口: ${project.port}</span>
          </div>
          <div class="info-item flex-col md:flex-row" style="margin-left: auto;">
            <span class="icon time">🕐</span>
            <span class="time-label">创建: ${formatTimestamp(project.createdAt || project.id || Date.now())}</span>
            ${project.updatedAt ? `<span class="time-label time-label-edited" style="margin-left: 8px;">编辑: ${formatTimestamp(project.updatedAt)}</span>` : ''}
          </div>
        </div>
      </div>
      ${project.description ? `<div class="project-description"><div class="line-clamp-2" title="${project.description}">${project.description}</div></div>` : ''}
      ${isGitRepo && commitId ? `<div class="git-commit-info">
        <span class="git-commit-id" title="${commitId}">${formatCommitId(commitId)}</span>
        <span class="git-commit-author" title="提交人">👤 ${gitInfo.commitAuthor}</span>
        <span class="git-commit-time" title="提交时间">🕐 ${gitInfo.commitTime ? formatGitTimestamp(gitInfo.commitTime) : ''}</span>
        <span class="git-commit-message line-clamp-1" title="${commitMessage}">${truncateCommitMessage(commitMessage)}</span>
      </div>` : ''}
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
        ${isGitRepo ? `<div class="git-actions">
          <button class="btn btn-git btn-sm ${gitInfo.behindCount > 0 ? 'btn-git-badge' : ''}" onclick="gitPull(${project.id})">
            ⬇️ 拉取 ${gitInfo.behindCount > 0 ? `<span class="git-count-badge">${gitInfo.behindCount}</span>` : ''}
          </button>
          <button class="btn btn-git btn-sm ${gitInfo.aheadCount > 0 ? 'btn-git-badge' : ''}" onclick="gitPush(${project.id})">
            ⬆️ 同步 ${gitInfo.aheadCount > 0 ? `<span class="git-count-badge">${gitInfo.aheadCount}</span>` : ''}
          </button>
          <button class="btn btn-git btn-sm" onclick="openBranchModal(${project.id})">🌿 迁出</button>
          <button class="btn btn-git btn-sm" onclick="openMergeModal(${project.id})">🔀 合并</button>
        </div>` : ''}
      </div>
    </div>
    `;
  };

  if (appendMode) {
    // 追加模式：只渲染新增的项目（最后一页的项目）
    const lastPageProjects = projects.slice(-paginationState.pageSize);
    const newHtml = lastPageProjects.map(renderProject).join('');
    container.insertAdjacentHTML('beforeend', newHtml);
  } else {
    // 全量渲染模式
    container.innerHTML = projects.map(renderProject).join('');
  }
  
  // 添加加载更多提示
  const loaderId = 'loadMoreLoader';
  let loader = document.getElementById(loaderId);
  if (!loader) {
    loader = document.createElement('div');
    loader.id = loaderId;
    loader.style.cssText = 'text-align: center; padding: 20px; color: var(--text-muted);';
    container.parentNode.appendChild(loader);
  }
  
  // 显示加载状态（有数据时才显示加载中/已加载全部，数据大于20且已加载全部才显示"已加载全部项目"）
  if (projects.length > 0 && paginationState.loading) {
    loader.innerHTML = '<span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border-color); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></span><span style="vertical-align: middle;">加载中...</span>';
  } else if (!paginationState.hasMore && projects.length > 20) {
    loader.textContent = '已加载全部项目';
  } else {
    loader.textContent = '';
  }
}

function filterProjects() {
  // 使用防抖避免频繁请求
  if (window.searchTimeout) clearTimeout(window.searchTimeout);
  window.searchTimeout = setTimeout(() => {
    loadProjects(true, true); // 重置分页，重新加载（获取 git info）
  }, 300);
}

// 重置筛选条件
function resetFilters() {
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  
  if (searchInput) {
    searchInput.value = '';
  }
  if (statusFilter) {
    statusFilter.value = 'all';
    // 更新自定义下拉选择器
    if (customSelectInstances.statusFilter) {
      customSelectInstances.statusFilter.setValue('all');
    }
  }
}

function openImportModal() {
  document.getElementById('importPath').value = '';
  openModal('importModal');
}

function openScanModal() {
  document.getElementById('scanPath').value = '';
  document.getElementById('scanResults').style.display = 'none';
  document.getElementById('scanActions').style.display = 'none';
  openModal('scanModal');
}

function openAddGroupModal() {
  document.getElementById('newGroupName').value = '';
  openModal('addGroupModal');
}

function openRenameGroupModal(oldName) {
  document.getElementById('renameOldName').value = oldName;
  document.getElementById('renameNewName').value = oldName;
  openModal('renameGroupModal');
}

// 所有弹框ID列表
const modalIds = [
  'importModal', 'gitImportModal', 'scanModal', 'editModal',
  'addGroupModal', 'renameGroupModal', 'branchModal', 'mergeModal',
  'logsModal', 'confirmModal', 'packageJsonModal'
];

// 检查是否有弹框打开
function hasOpenModal() {
  return modalIds.some(id => document.getElementById(id)?.classList.contains('show'));
}

// 更新body滚动状态
function updateBodyScroll() {
  if (hasOpenModal()) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
}

// 打开弹框
function openModal(modalId) {
  document.getElementById(modalId).classList.add('show');
  updateBodyScroll();
}

// 关闭弹框
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
  if (modalId === 'logsModal') {
    clearInterval(logsInterval);
    currentLogsProjectId = null;
  }
  updateBodyScroll();
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
    showToast(result.error, 'error');
  } else {
    groups = result.groups;
    selectGroup(name);
    resetFilters();
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
    showToast(result.error, 'error');
  } else {
    groups = result.groups;
    if (currentGroup === oldName) {
      currentGroup = newName;
    }
    resetFilters();
    await loadProjects();
    closeModal('renameGroupModal');
  }
}

function deleteGroup(name) {
  document.getElementById('confirmTitle').textContent = '确认删除分组';
  document.getElementById('confirmMessage').textContent = `确定要删除分组 "${name}" 吗？该分组下的项目将移动到默认分组。`;
  document.getElementById('confirmActionBtn').textContent = '确认删除';
  document.getElementById('confirmActionBtn').onclick = confirmDeleteGroup;
  pendingDeleteGroup = name;
  openModal('confirmModal');
}

async function confirmDeleteGroup() {
  if (!pendingDeleteGroup) return;

  const response = await fetch('/api/groups', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: pendingDeleteGroup })
  });

  const result = await response.json();
  if (result.error) {
    showToast(result.error, 'error');
  } else {
    groups = result.groups;
    if (currentGroup === pendingDeleteGroup) {
      currentGroup = '全部';
    }
    selectGroup(currentGroup);
    await loadProjects(true); // 重新加载并获取 git info
  }
  pendingDeleteGroup = null;
  closeModal('confirmModal');
}

async function importProject() {
  const path = document.getElementById('importPath').value.trim();
  const group = document.getElementById('importGroup').value;
  if (!path) return;

  // 找到导入按钮并设置 loading 状态
  const importBtn = event.target;
  setButtonLoading(importBtn, true);

  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: path, group })
    });

    const result = await response.json();
    if (result.error) {
      showToast(result.error, 'error');
    } else {
      closeModal('importModal');
      loadProjects(true);
    }
  } finally {
    setButtonLoading(importBtn, false);
  }
}

async function scanProjects() {
  const path = document.getElementById('scanPath').value.trim();
  if (!path) return;

  const scanBtn = event.target;
  setButtonLoading(scanBtn, true);

  try {
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
  } finally {
    setButtonLoading(scanBtn, false);
  }
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

  const importBtn = event.target;
  setButtonLoading(importBtn, true);

  try {
    const response = await fetch('/api/projects/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: selectedPaths, group })
    });

    await response.json();
    closeModal('scanModal');
    loadProjects(true);
  } finally {
    setButtonLoading(importBtn, false);
  }
}

function editProject(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;

  document.getElementById('editId').value = project.id;
  document.getElementById('editName').value = project.name;
  document.getElementById('editGroup').value = project.group || '默认分组';
  document.getElementById('editPort').value = project.port;
  document.getElementById('editNodeVersion').value = project.nodeVersion;
  
  // 更新自定义下拉组件显示
  if (customSelectInstances.editGroup) {
    customSelectInstances.editGroup.setValue(project.group || '默认分组');
  }
  
  openModal('editModal');
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
    showToast(result.error, 'error');
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
  openModal('confirmModal');
}

async function confirmDelete() {
  if (pendingDeleteId === null) return;
  
  await fetch(`/api/projects/${pendingDeleteId}`, { method: 'DELETE' });
  resetFilters();
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
  const btnDesktop = document.getElementById('batchDeleteBtnDesktop');
  const btnMobile = document.getElementById('batchDeleteBtnMobile');
  if (btnDesktop) btnDesktop.disabled = checked.length === 0;
  if (btnMobile) btnMobile.disabled = checked.length === 0;
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
  openModal('confirmModal');
}

async function confirmBatchDelete() {
  if (!pendingDeleteIds || pendingDeleteIds.length === 0) return;
  
  await fetch('/api/projects/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: pendingDeleteIds })
  });
  resetFilters();
  await loadProjects();
  pendingDeleteIds = null;
  document.getElementById('selectAll').checked = false;
  closeModal('confirmModal');
}

async function startProject(id) {
  // 先打开日志弹窗，显示启动中提示
  const project = projects.find(p => p.id === id);
  currentLogsProjectId = id;
  document.getElementById('logsTitle').textContent = `${project.name} - 日志`;
  updateStopButton(id);
  openModal('logsModal');
  
  // 显示启动中提示
  const container = document.getElementById('logsContent');
  container.innerHTML = `
    <div class="logs-placeholder">
      <div style="font-size: 48px; margin-bottom: 16px;">⏳</div>
      <div style="color: #89b4fa; font-size: 14px;">项目启动中，请稍后...</div>
      <div style="color: #bbb; font-size: 12px; margin-top: 8px;">正在准备启动服务...</div>
    </div>
  `;
  
  // 开启日志轮询
  logsInterval = setInterval(() => loadLogs(id, true), 2000);
  
  // 异步请求启动接口，不阻塞交互
  fetch(`/api/projects/${id}/start`, { method: 'POST' })
    .then(response => response.json())
    .then(result => {
      if (result.error) {
        const port = extractPortFromLog(result.error);
        if (port && project) {
          document.getElementById('confirmTitle').textContent = '端口被占用';
          document.getElementById('confirmMessage').textContent = `端口 ${port} 被占用，是否杀掉占用进程并重新启动 "${project.name}"？`;
          document.getElementById('confirmActionBtn').textContent = '杀掉端口并重启';
          document.getElementById('confirmActionBtn').onclick = () => killPortAndRestart(id, port);
          pendingStopId = id;
          openModal('confirmModal');
        } else {
          showToast(result.error, 'error');
        }
      } else {
        resetFilters();
        loadProjects();
        setTimeout(() => pollProjectStatus(id), 1000);
      }
    })
    .catch(error => {
      showToast('启动失败: ' + error.message, 'error');
    });
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
    showToast('无法杀掉占用端口的进程，请手动处理', 'error');
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
  openModal('confirmModal');
}

async function confirmStop() {
  if (pendingStopId === null) return;
  
  await fetch(`/api/projects/${pendingStopId}/stop`, { method: 'POST' });
  const stoppedId = pendingStopId;
  pendingStopId = null;
  closeModal('confirmModal');
  resetFilters();
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

// 记录每个项目的最后日志索引
const lastLogIndexMap = {};

function viewLogs(id) {
  currentLogsProjectId = id;
  const project = projects.find(p => p.id === id);
  document.getElementById('logsTitle').textContent = `${project.name} - 日志`;
  updateStopButton(id);
  openModal('logsModal');
  // 清空日志容器并重置索引
  document.getElementById('logsContent').innerHTML = '';
  lastLogIndexMap[id] = 0;
  loadLogs(id, false);
  
  logsInterval = setInterval(() => loadLogs(id, false), 2000);
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
    showToast(result.error, 'error');
    return;
  }
  
  document.getElementById('packageJsonTitle').textContent = `${project.name} - package.json`;
  document.getElementById('packageJsonContent').innerHTML = '<pre><code>' + syntaxHighlight(result.content) + '</code></pre>';
  openModal('packageJsonModal');
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

async function loadLogs(id, isStarting = false) {
  const lastIndex = lastLogIndexMap[id] || 0;
  const response = await fetch(`/api/projects/${id}/logs?since=${lastIndex}`);
  const result = await response.json();
  const { logs, nextIndex } = result;
  const container = document.getElementById('logsContent');
  
  if (nextIndex === 0) {
    if (!isStarting && !container.querySelector('.log-line')) {
      // 非启动中状态才显示暂无日志占位符
      container.innerHTML = `
        <div class="logs-placeholder">
          <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
          <div style="color: #999; font-size: 14px;">暂无日志信息</div>
          <div style="color: #bbb; font-size: 12px; margin-top: 8px;">启动项目后将显示运行日志</div>
        </div>
      `;
    }
    // 启动中状态保持显示启动中提示
  } else if (logs.length > 0) {
    // 有日志输出时，移除启动中提示
    const placeholder = container.querySelector('.logs-placeholder');
    if (placeholder) {
      placeholder.remove();
    }
    // 增量追加日志，不重新渲染全部
    const newLogsHtml = logs.map(log => `
      <div class="log-line ${log.type}">${log.content.replace(/\n/g, '<br>')}</div>
    `).join('');
    container.insertAdjacentHTML('beforeend', newLogsHtml);
    container.scrollTop = container.scrollHeight;
    // 更新最后索引
    lastLogIndexMap[id] = nextIndex;
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

// 初始化全局 Loading，插入到项目列表的父容器中
const projectListContainer = document.getElementById('projectList')?.parentElement;
if (projectListContainer) {
  createLoading(projectListContainer, 'pageLoading');
}

loadProjects(true);
showLoading('pageLoading');
// 初始化所有自定义下拉选择组件
function initAllCustomSelects() {
  // 状态筛选器
  customSelectInstances.statusFilter = initCustomSelect('statusFilter', filterProjects);
  // 分组选择器
  customSelectInstances.importGroup = initCustomSelect('importGroup');
  customSelectInstances.scanGroup = initCustomSelect('scanGroup');
  customSelectInstances.editGroup = initCustomSelect('editGroup');
  customSelectInstances.gitImportGroup = initCustomSelect('gitImportGroup');
  // 分支选择器
  customSelectInstances.branchSelect = initCustomSelect('branchSelect');
  customSelectInstances.mergeBranchSelect = initCustomSelect('mergeBranchSelect');
}

// 页面可见性变化时暂停/恢复 Git 刷新
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopGitInfoRefresh();
  } else {
    // 页面恢复可见时，立即刷新一次并重新启动定时器
    refreshAllGitInfo();
    startGitInfoRefresh();
  }
});

// 页面卸载时清理定时器
window.addEventListener('beforeunload', () => {
  stopGitInfoRefresh();
});

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
  initAllCustomSelects();
  initColorPicker();
  
  // 无限滚动监听
  window.addEventListener('scroll', debounce(() => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    // 滚动到底部附近（提前200px触发加载）
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      if (!paginationState.loading && paginationState.hasMore) {
        loadMoreProjects();
      }
    }
  }, 100));
});

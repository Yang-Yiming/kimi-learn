const chatInner = document.getElementById('chat-inner');
const userInput = document.getElementById('user-input');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusContext = document.getElementById('status-context');
const btnCancel = document.getElementById('btn-cancel');
const btnSend = document.getElementById('btn-send');
const planToggle = document.getElementById('plan-toggle');
const modalContainer = document.getElementById('modal-container');

let ws = null;
let isBusy = false;
let planMode = false;
let reconnectTimer = null;

function connect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => { setStatus('connected', '已连接'); };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    setStatus('error', '已断开，5秒后重连...');
    setBusy(false);
    reconnectTimer = setTimeout(connect, 5000);
  };

  ws.onerror = () => { setStatus('error', '连接错误'); };
}

function setStatus(cls, text) {
  statusDot.className = 'dot ' + cls;
  statusText.textContent = text;
}

function setBusy(busy) {
  isBusy = busy;
  btnCancel.disabled = !busy;
  btnSend.disabled = busy;
  userInput.disabled = busy;
  if (busy) {
    statusText.textContent = '思考中...';
    statusDot.className = 'dot busy';
  }
}

function appendRow(className, html) {
  const row = document.createElement('div');
  row.className = 'message-row ' + className;
  row.innerHTML = html;
  chatInner.appendChild(row);
  scrollToBottom();
  return row;
}

function scrollToBottom() {
  const chat = document.getElementById('chat');
  chat.scrollTop = chat.scrollHeight;
}

let currentAssistantRow = null;
let currentAssistantText = '';
let currentThinkRow = null;

function getAssistantRow() {
  if (!currentAssistantRow) {
    currentAssistantRow = appendRow('assistant', `
      <div class="avatar ai">AI</div>
      <div class="bubble assistant" id="current-bubble"></div>
    `);
  }
  return currentAssistantRow.querySelector('.bubble');
}

function handleMessage(msg) {
  const kind = msg.kind;
  const data = msg.data;

  if (kind === 'system') {
    const s = data.status;
    if (s === 'connected') setStatus('connected', '已连接');
    else if (s === 'disconnected') setStatus('error', '已断开');
    else if (s === 'error') setStatus('error', data.message || '错误');
    if (data.message && s !== 'connected') {
      appendRow('system', `<div class="bubble system">${escapeHtml(data.message)}</div>`);
    }
    return;
  }

  if (kind === 'error') {
    appendRow('system', `<div class="bubble error">错误: ${escapeHtml(data.message || JSON.stringify(data))}</div>`);
    setBusy(false);
    return;
  }

  if (kind === 'usage') {
    updateUsage(data);
    return;
  }

  if (kind !== 'wire') return;

  const wire = data;
  const method = wire.method;

  if (method === 'event') {
    handleEvent(wire.params);
    return;
  }

  if (method === 'request') {
    handleRequest(wire.id, wire.params);
    return;
  }

  if (wire.result || wire.error) {
    if (wire.error) {
      appendRow('system', `<div class="bubble error">请求错误: ${escapeHtml(wire.error.message)}</div>`);
    }
    if (kind === 'prompt_result') setBusy(false);
    return;
  }
}

function handleEvent(params) {
  const type = params.type;
  const payload = params.payload;

  switch (type) {
    case 'TurnBegin':
      setBusy(true);
      currentAssistantRow = null;
      currentAssistantText = '';
      currentThinkRow = null;
      const input = typeof payload.user_input === 'string' ? payload.user_input : '(多模态输入)';
      appendRow('user', `
        <div class="bubble user">${escapeHtml(input)}</div>
        <div class="avatar user">我</div>
      `);
      break;

    case 'TurnEnd':
      setBusy(false);
      flushAssistantText();
      currentAssistantRow = null;
      currentAssistantText = '';
      currentThinkRow = null;
      document.querySelectorAll('pre code').forEach((block) => {
        if (window.hljs && !block.dataset.highlighted) { hljs.highlightElement(block); block.dataset.highlighted = 'yes'; }
      });
      break;

    case 'StepBegin':
      break;

    case 'ContentPart':
      if (payload.type === 'text') {
        currentAssistantText += payload.text;
        const bubble = getAssistantRow();
        bubble.innerHTML = marked.parse(currentAssistantText);
        scrollToBottom();
      } else if (payload.type === 'think') {
        if (!currentThinkRow) {
          currentThinkRow = appendRow('assistant', `
            <div class="avatar ai" style="visibility:hidden"></div>
            <div class="bubble think">
              <div class="think-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">思考过程</div>
              <div class="think-content"></div>
            </div>
          `);
        }
        currentThinkRow.querySelector('.think-content').textContent += payload.think;
        scrollToBottom();
      } else if (payload.type === 'image_url') {
        const bubble = getAssistantRow();
        bubble.innerHTML += `<img src="${escapeHtml(payload.image_url.url)}" alt="image">`;
        scrollToBottom();
      }
      break;

    case 'ToolCall':
      {
        const name = payload.function?.name || 'unknown';
        const args = payload.function?.arguments || '{}';
        let argsObj = {};
        try { argsObj = JSON.parse(args); } catch(e) {}
        const html = `<div class="avatar ai" style="visibility:hidden"></div>
          <div class="bubble tool">
            <div style="font-weight:600;color:var(--accent);margin-bottom:6px;">🔧 ${escapeHtml(name)}</div>
            <pre><code>${escapeHtml(JSON.stringify(argsObj, null, 2))}</code></pre>
          </div>`;
        appendRow('tool', html);
      }
      break;

    case 'ToolResult':
      {
        const rv = payload.return_value;
        let html = `<div class="avatar ai" style="visibility:hidden"></div><div class="bubble tool">`;
        if (rv.is_error) {
          html += `<div style="color:var(--danger);font-weight:600;">❌ 工具错误</div>`;
        } else {
          html += `<div style="color:var(--success);font-weight:600;">✅ 工具结果</div>`;
        }
        if (rv.message) html += `<p>${escapeHtml(rv.message)}</p>`;
        if (typeof rv.output === 'string') {
          html += `<pre><code>${escapeHtml(rv.output)}</code></pre>`;
        }
        if (rv.display) {
          rv.display.forEach(block => { html += renderDisplayBlock(block); });
        }
        html += `</div>`;
        appendRow('tool', html);
      }
      break;

    case 'StatusUpdate':
      if (payload.context_usage != null) {
        const pct = Math.round(payload.context_usage * 100);
        statusContext.textContent = pct + '% context';
        if (pct > 80) statusContext.style.color = 'var(--danger)';
        else if (pct > 60) statusContext.style.color = '#ff9800';
        else statusContext.style.color = 'var(--text-secondary)';
      }
      if (payload.plan_mode !== null && payload.plan_mode !== undefined) {
        planMode = payload.plan_mode;
        planToggle.checked = planMode;
      }
      break;

    case 'PlanDisplay':
      {
        const html = `<div class="avatar ai">AI</div>
          <div class="bubble assistant">
            <div style="font-weight:600;margin-bottom:8px;">📋 计划 <span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(payload.file_path)}</span></div>
            <div>${marked.parse(payload.content)}</div>
          </div>`;
        appendRow('assistant', html);
      }
      break;

    case 'SteerInput':
      appendRow('system', `<div class="bubble system">📝 追加输入已接收</div>`);
      break;

    default:
      break;
  }
}

function flushAssistantText() {
  if (currentAssistantRow && currentAssistantText) {
    const bubble = currentAssistantRow.querySelector('.bubble');
    bubble.innerHTML = marked.parse(currentAssistantText);
  }
}

function renderDisplayBlock(block) {
  if (!block) return '';
  if (block.type === 'brief') return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === 'diff') return renderDiff(block.path, block.old_text, block.new_text);
  if (block.type === 'todo') return renderTodo(block.items);
  if (block.type === 'shell') return `<div class="shell-box">$ ${escapeHtml(block.command)}</div>`;
  return `<pre><code>${escapeHtml(JSON.stringify(block, null, 2))}</code></pre>`;
}

function renderDiff(path, oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  let diffHtml = '';
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i] || '';
    const n = newLines[i] || '';
    if (o === n) {
      diffHtml += escapeHtml(n) + '\n';
    } else {
      if (o) diffHtml += `<span class="diff-del">- ${escapeHtml(o)}</span>\n`;
      if (n) diffHtml += `<span class="diff-add">+ ${escapeHtml(n)}</span>\n`;
    }
  }
  return `<div class="diff-box">
    <div class="diff-header">${escapeHtml(path)}</div>
    <div class="diff-content">${diffHtml}</div>
  </div>`;
}

function renderTodo(items) {
  if (!items || !items.length) return '';
  let html = '<div class="todo-box">';
  items.forEach(item => {
    const icon = item.status === 'done' ? '✅' : item.status === 'in_progress' ? '⏳' : '⬜';
    html += `<div class="todo-item"><span class="todo-icon">${icon}</span><span>${escapeHtml(item.title)}</span></div>`;
  });
  html += '</div>';
  return html;
}

function handleRequest(id, params) {
  const type = params.type;
  const payload = params.payload;

  if (type === 'ApprovalRequest') {
    showApprovalModal(id, payload);
  } else if (type === 'QuestionRequest') {
    showQuestionModal(id, payload);
  } else if (type === 'ToolCallRequest') {
    sendResponse(id, { tool_call_id: payload.id, return_value: { is_error: true, output: "External tool not implemented", message: "External tool not implemented", display: [] }});
  }
}

function showApprovalModal(id, payload) {
  let displayHtml = '';
  if (payload.display) {
    payload.display.forEach(block => { displayHtml += renderDisplayBlock(block); });
  }
  window._lastApprovalPayload = payload;

  const html = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>🔒 需要确认</h3>
        <p><strong>操作:</strong> ${escapeHtml(payload.action)}</p>
        <p><strong>说明:</strong> ${escapeHtml(payload.description)}</p>
        ${displayHtml}
        <div class="buttons">
          <button class="btn danger" onclick="sendApproval('${id}', 'reject')">拒绝</button>
          <button class="btn" onclick="sendApproval('${id}', 'approve')">批准</button>
          <button class="btn primary" onclick="sendApproval('${id}', 'approve_for_session')">本会话批准</button>
        </div>
      </div>
    </div>
  `;
  modalContainer.innerHTML = html;
}

function showQuestionModal(id, payload) {
  const questions = payload.questions || [];
  window._lastQuestionPayload = payload;
  let html = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal"><h3>❓ 请回答</h3>`;
  questions.forEach((q, qi) => {
    html += `<div style="margin-bottom:16px;" data-q="${escapeHtml(q.question)}">
      <p style="font-weight:600;margin-bottom:8px;">${escapeHtml(q.question)}</p>
      <div class="options" id="q-${qi}">`;
    q.options.forEach((opt) => {
      const inputType = q.multi_select ? 'checkbox' : 'radio';
      const name = q.multi_select ? `name="q-${qi}-opt"` : `name="q-${qi}"`;
      html += `<label class="option">
        <input type="${inputType}" ${name} value="${escapeHtml(opt.label)}" onchange="selectOption(this, ${qi})">
        <div>
          <div class="option-label">${escapeHtml(opt.label)}</div>
          <div class="option-desc">${escapeHtml(opt.description || '')}</div>
        </div>
      </label>`;
    });
    html += `</div></div>`;
  });
  html += `<div class="buttons">
    <button class="btn" onclick="closeModal()">跳过</button>
    <button class="btn primary" onclick="sendQuestionAnswer('${id}')">确认</button>
  </div></div></div>`;
  modalContainer.innerHTML = html;
}

function selectOption(input, qIndex) {
  const container = document.getElementById('q-' + qIndex);
  container.querySelectorAll('.option').forEach(lbl => lbl.classList.remove('selected'));
  container.querySelectorAll('input:checked').forEach(inp => {
    inp.closest('.option').classList.add('selected');
  });
}

function sendApproval(id, response) {
  const payload = window._lastApprovalPayload;
  closeModal();
  sendResponse(id, { request_id: payload ? payload.id : id, response });
}

function sendQuestionAnswer(id) {
  const payload = window._lastQuestionPayload;
  const answers = {};
  document.querySelectorAll('.modal [data-q]').forEach(container => {
    const qText = container.getAttribute('data-q');
    const checked = Array.from(container.querySelectorAll('input:checked')).map(i => i.value);
    if (checked.length) answers[qText] = checked.join(',');
  });
  closeModal();
  sendResponse(id, { request_id: payload ? payload.id : id, answers });
}

function closeModal() {
  modalContainer.innerHTML = '';
}

function sendResponse(id, result) {
  ws.send(JSON.stringify({ kind: 'response', data: { id, result } }));
}

function sendPrompt() {
  const text = userInput.value.trim();
  if (!text || isBusy) return;
  userInput.value = '';
  userInput.style.height = 'auto';
  ws.send(JSON.stringify({ kind: 'prompt', data: { user_input: text } }));
}

function sendCancel() {
  if (!isBusy) return;
  ws.send(JSON.stringify({ kind: 'cancel', data: {} }));
}

function sendSteer(text) {
  if (!isBusy) return;
  ws.send(JSON.stringify({ kind: 'steer', data: { user_input: text } }));
}

function togglePlanMode() {
  ws.send(JSON.stringify({ kind: 'set_plan_mode', data: { enabled: !planMode } }));
}

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
});

function _renderUsageBar(barId, textId, used, limit) {
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  const pct = Math.min(used / limit * 100, 100);
  bar.style.width = pct + '%';
  bar.className = 'usage-bar ' + (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green');
  text.textContent = used + '/' + limit;
}

function updateUsage(data) {
  const usage = data.usage;
  if (usage) {
    _renderUsageBar('bar-week', 'text-week', parseInt(usage.used) || 0, parseInt(usage.limit) || 1);
  }
  if (data.limits && data.limits.length > 0) {
    const detail = data.limits[0].detail;
    _renderUsageBar('bar-5h', 'text-5h', parseInt(detail.used) || 0, parseInt(detail.limit) || 1);
  }
}

function escapeHtml(text) {
  if (text == null) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* File Sidebar */
let fileSidebarPath = '';
let fileSidebarItems = [];
let showAllFiles = false;

function toggleShowAll() {
  showAllFiles = document.getElementById('show-all-toggle').checked;
  loadFileSidebar(fileSidebarPath);
}

async function loadFileSidebar(path) {
  try {
    const url = '/api/files?path=' + encodeURIComponent(path) + '&show_all=' + showAllFiles;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) return;
    fileSidebarPath = data.current_path;
    fileSidebarItems = data.items || [];
    renderFileSidebar();
  } catch (e) {
    console.error('加载文件列表失败:', e);
  }
}

function renderFileSidebar() {
  const container = document.getElementById('file-sidebar-tree');
  if (!container) return;
  let html = '';

  // Breadcrumb
  html += '<div class="file-sidebar-breadcrumb">';
  if (fileSidebarPath) {
    html += '<span onclick="loadFileSidebar(\'\')">根目录</span>';
    const parts = fileSidebarPath.split('/').filter(Boolean);
    let acc = '';
    parts.forEach((part, i) => {
      acc += (acc ? '/' : '') + part;
      const isLast = i === parts.length - 1;
      html += ' / ';
      if (isLast) {
        html += '<span class="current">' + escapeHtml(part) + '</span>';
      } else {
        html += '<span onclick="loadFileSidebar(\'' + escapeHtml(acc) + '\')">' + escapeHtml(part) + '</span>';
      }
    });
  } else {
    html += '<span class="current">根目录</span>';
  }
  html += '</div>';

  // File list
  if (fileSidebarPath) {
    const parent = fileSidebarPath.split('/').slice(0, -1).join('/');
    html += '<div class="file-sidebar-item" onclick="loadFileSidebar(\'' + escapeHtml(parent) + '\')">';
    html += '<span class="file-sidebar-icon">📁</span><span class="file-sidebar-name">..</span>';
    html += '</div>';
  }
  fileSidebarItems.forEach(item => {
    const icon = item.is_dir ? '📁' : '📄';
    const onclick = item.is_dir
      ? 'loadFileSidebar(\'' + escapeHtml(item.path) + '\')'
      : 'openFile(\'' + escapeHtml(item.path) + '\')';
    html += '<div class="file-sidebar-item" data-path="' + escapeHtml(item.path) + '" onclick="' + onclick + '">';
    html += '<span class="file-sidebar-icon">' + icon + '</span><span class="file-sidebar-name">' + escapeHtml(item.name) + '</span>';
    html += '</div>';
  });
  container.innerHTML = html;
}

async function openFile(path) {
  // Highlight selected file
  document.querySelectorAll('.file-sidebar-item').forEach(el => el.classList.remove('selected'));
  const selected = document.querySelector('.file-sidebar-item[data-path="' + CSS.escape(path) + '"]');
  if (selected) selected.classList.add('selected');

  // Show file panel
  const panel = document.getElementById('file-panel');
  const content = document.getElementById('file-panel-content');
  const title = document.getElementById('file-panel-title');
  panel.style.display = 'flex';
  title.textContent = path;
  content.innerHTML = '<div class="file-panel-empty">加载中...</div>';

  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(path));
    const data = await res.json();
    if (!res.ok) {
      content.innerHTML = '<div class="file-panel-error">' + escapeHtml(data.detail || '读取失败') + '</div>';
      return;
    }
    const ext = path.split('.').pop().toLowerCase();
    const codeLang = {
      'js': 'javascript', 'ts': 'typescript', 'py': 'python', 'md': 'markdown',
      'html': 'xml', 'css': 'css', 'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
      'sh': 'bash', 'bash': 'bash', 'zsh': 'bash', 'go': 'go', 'rs': 'rust',
      'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
      'sql': 'sql', 'xml': 'xml', 'dockerfile': 'dockerfile'
    }[ext] || '';

    let html = '';
    if (codeLang) {
      html += '<pre><code class="language-' + codeLang + '">' + escapeHtml(data.content) + '</code></pre>';
    } else {
      html += '<pre>' + escapeHtml(data.content) + '</pre>';
    }
    content.innerHTML = html;
    if (window.hljs) {
      content.querySelectorAll('pre code').forEach((block) => {
        if (!block.dataset.highlighted) { hljs.highlightElement(block); block.dataset.highlighted = 'yes'; }
      });
    }
  } catch (e) {
    content.innerHTML = '<div class="file-panel-error">读取失败: ' + escapeHtml(e.message) + '</div>';
  }
}

function closeFilePanel() {
  document.getElementById('file-panel').style.display = 'none';
  document.querySelectorAll('.file-sidebar-item').forEach(el => el.classList.remove('selected'));
}

// Init file sidebar on load
loadFileSidebar('');
connect();

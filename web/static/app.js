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
let pendingAttachments = []; // {file, uploadedPath, mimeType, previewUrl}
let activeSkill = null; // currently selected skill name

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
    if (s === 'connected') {
      setStatus('connected', '已连接');
      if (data.init && data.init.slash_commands) {
        slashCommands = data.init.slash_commands;
      }
      if (data.session_id) {
        currentSessionId = data.session_id;
      }
      loadSessions();
    }
    else if (s === 'disconnected') setStatus('error', '已断开');
    else if (s === 'error') setStatus('error', data.message || '错误');
    else if (s === 'switching') {
      setStatus('error', data.message || '切换中...');
    }
    if (data.message && s !== 'connected') {
      appendRow('system', `<div class="bubble system">${escapeHtml(data.message)}</div>`);
    }
    return;
  }

  if (kind === 'session_switched') {
    onSessionSwitched(data);
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
      // Check if user_input contains attachment references and render them
      let userHtml = escapeHtml(input);
      const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let imgMatch;
      let hasImages = false;
      let imgHtml = '';
      while ((imgMatch = imgRegex.exec(input)) !== null) {
        hasImages = true;
        imgHtml += `<img src="${escapeHtml(imgMatch[2])}" alt="${escapeHtml(imgMatch[1])}" class="user-attachment-img">`;
      }
      if (hasImages) {
        userHtml += '<div class="user-attachments">' + imgHtml + '</div>';
      }
      appendRow('user', `
        <div class="bubble user">${userHtml}</div>
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
            <div style="font-weight:600;color:var(--accent);margin-bottom:6px;"><span class="icon icon-tool"></span> ${escapeHtml(name)}</div>
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
          html += `<div style="color:var(--danger);font-weight:600;"><span class="icon icon-error"></span> 工具错误</div>`;
        } else {
          html += `<div style="color:var(--success);font-weight:600;"><span class="icon icon-success"></span> 工具结果</div>`;
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
            <div style="font-weight:600;margin-bottom:8px;"><span class="icon icon-plan"></span> 计划 <span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(payload.file_path)}</span></div>
            <div>${marked.parse(payload.content)}</div>
          </div>`;
        appendRow('assistant', html);
      }
      break;

    case 'SteerInput':
      appendRow('system', `<div class="bubble system"><span class="icon icon-note"></span> 追加输入已接收</div>`);
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
    const iconClass = item.status === 'done' ? 'icon-success' : item.status === 'in_progress' ? 'icon-progress' : 'icon-pending';
    html += `<div class="todo-item"><span class="todo-icon icon ${iconClass}"></span><span>${escapeHtml(item.title)}</span></div>`;
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
        <h3><span class="icon icon-lock"></span> 需要确认</h3>
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
    <div class="modal"><h3><span class="icon icon-question"></span> 请回答</h3>`;
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

function triggerCamera() {
  document.getElementById('camera-input').click();
}

function handleFileSelect(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  uploadFiles(files);
  event.target.value = '';
}

async function uploadFiles(files) {
  const previewContainer = document.getElementById('attachment-preview');
  previewContainer.style.display = 'flex';

  for (const file of files) {
    const previewUrl = URL.createObjectURL(file);
    const attachment = {
      file: file,
      uploadedPath: null,
      mimeType: file.type,
      previewUrl: previewUrl,
      name: file.name,
      uploading: true,
    };
    pendingAttachments.push(attachment);
    renderAttachments();

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        attachment.uploadedPath = data.path;
        attachment.uploading = false;
      } else {
        attachment.error = data.detail || '上传失败';
        attachment.uploading = false;
      }
    } catch (e) {
      attachment.error = '网络错误';
      attachment.uploading = false;
    }
    renderAttachments();
  }
}

function renderAttachments() {
  const container = document.getElementById('attachment-preview');
  if (!pendingAttachments.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = 'flex';
  let html = '';
  pendingAttachments.forEach((att, idx) => {
    const isImage = att.mimeType && att.mimeType.startsWith('image/');
    html += `<div class="attachment-item ${att.uploading ? 'uploading' : ''} ${att.error ? 'error' : ''}">`;
    if (isImage && att.previewUrl) {
      html += `<img src="${att.previewUrl}" alt="${escapeHtml(att.name)}" class="attachment-thumb">`;
    } else {
      html += `<div class="attachment-file"><span class="icon icon-file"></span></div>`;
    }
    html += `<span class="attachment-name">${escapeHtml(att.name)}</span>`;
    if (att.uploading) {
      html += `<span class="attachment-status"><span class="icon icon-progress"></span></span>`;
    } else if (att.error) {
      html += `<span class="attachment-status" title="${escapeHtml(att.error)}"><span class="icon icon-error"></span></span>`;
    } else {
      html += `<span class="attachment-status"><span class="icon icon-success"></span></span>`;
    }
    html += `<button class="attachment-remove" onclick="removeAttachment(${idx})"><span class="icon icon-close"></span></button>`;
    html += `</div>`;
  });
  container.innerHTML = html;
}

function removeAttachment(index) {
  const att = pendingAttachments[index];
  if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
  pendingAttachments.splice(index, 1);
  renderAttachments();
}

function clearAttachments() {
  pendingAttachments.forEach(att => {
    if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
  });
  pendingAttachments = [];
  renderAttachments();
}

function activateSkill(skill, label) {
  if (activeSkill === skill) {
    clearSkill();
    return;
  }
  activeSkill = skill;
  document.querySelectorAll('.skill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.skill === skill);
  });
}

function clearSkill() {
  activeSkill = null;
  document.querySelectorAll('.skill-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('skill-pill-container').style.display = 'none';
}

function sendPrompt() {
  const text = userInput.value.trim();
  const hasAttachments = pendingAttachments.length > 0;
  const readyAttachments = pendingAttachments.filter(a => a.uploadedPath && !a.error);

  if ((!text && !hasAttachments) || isBusy) return;
  if (hasAttachments && readyAttachments.length !== pendingAttachments.length) {
    alert('请等待所有附件上传完成');
    return;
  }

  // Intercept web-native slash commands
  if (text === '/help' || text === '/h' || text === '/?') {
    userInput.value = '';
    userInput.style.height = 'auto';
    showHelpModal(mergeCommands());
    return;
  }
  if (text === '/sessions' || text === '/resume') {
    userInput.value = '';
    userInput.style.height = 'auto';
    loadSessions();
    return;
  }

  userInput.value = '';
  userInput.style.height = 'auto';

  let userInputText = text || '(附件)';
  if (activeSkill) {
    userInputText = `使用 ${activeSkill} skill\n\n${userInputText}`;
    clearSkill();
  }

  const data = { user_input: userInputText };
  if (readyAttachments.length > 0) {
    data.attachments = readyAttachments.map(a => ({
      path: a.uploadedPath,
      name: a.name,
      mime_type: a.mimeType,
    }));
  }

  ws.send(JSON.stringify({ kind: 'prompt', data }));

  // Clear attachments after sending
  clearAttachments();
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
    html += '<span class="file-sidebar-icon icon icon-folder"></span><span class="file-sidebar-name">..</span>';
    html += '</div>';
  }
  fileSidebarItems.forEach(item => {
    const iconClass = item.is_dir ? 'icon-folder' : 'icon-file';
    const displayName = item.display_name || item.name;
    const onclick = item.is_dir
      ? 'loadFileSidebar(\'' + escapeHtml(item.path) + '\')'
      : 'openFile(\'' + escapeHtml(item.path) + '\')';
    html += '<div class="file-sidebar-item" data-path="' + escapeHtml(item.path) + '" onclick="' + onclick + '">';
    html += '<span class="file-sidebar-icon icon ' + iconClass + '"></span><span class="file-sidebar-name">' + escapeHtml(displayName) + '</span>';
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

/* ======== Session Management ======== */

let currentSessionId = null;

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    if (!res.ok) return;
    currentSessionId = data.current_session_id;
    renderSessions(data.sessions);
  } catch (e) {
    console.error('加载会话列表失败:', e);
  }
}

function renderSessions(sessions) {
  const container = document.getElementById('session-list');
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = '<div class="session-item"><span>暂无会话</span></div>';
    return;
  }

  let html = '';
  sessions.forEach(s => {
    const isActive = s.id === currentSessionId;
    const timeStr = formatRelativeTime(s.updated_at);
    html += `<div class="session-item${isActive ? ' active' : ''}" data-id="${escapeHtml(s.id)}" onclick="switchSession('${escapeHtml(s.id)}')">
      <span>${escapeHtml(s.title)}</span>
      <span class="session-time">${escapeHtml(timeStr)}</span>
    </div>`;
  });
  container.innerHTML = html;
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const dt = new Date(isoStr);
  const now = new Date();
  const diffMs = now - dt;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return diffMin + 'm';
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return diffH + 'h';
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return diffD + 'd';
  return dt.toLocaleDateString('zh-CN');
}

function switchSession(sessionId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (sessionId === currentSessionId) return; // already on this session
  ws.send(JSON.stringify({ kind: 'switch_session', data: { session_id: sessionId } }));
  chatInner.innerHTML = '';
}

function newSession() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ kind: 'new_session', data: {} }));
  chatInner.innerHTML = '';
}

// Handle session_switched event
function onSessionSwitched(data) {
  currentSessionId = data.session_id;
  // Remove the "switching" / "creating" indicator messages
  const rows = chatInner.querySelectorAll('.message-row.system');
  rows.forEach(row => {
    const text = row.textContent || '';
    if (text.includes('切换会话中') || text.includes('创建新会话')) {
      row.remove();
    }
  });
  // Show success feedback
  if (data.title) {
    appendRow('system', `<div class="bubble system"><span class="icon icon-success"></span> 已切换到: ${escapeHtml(data.title)}</div>`);
  }
  loadSessions();
  loadSessionHistory(data.session_id);
}

async function loadSessionHistory(sessionId) {
  if (!sessionId) return;
  try {
    const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/history');
    const data = await res.json();
    if (!res.ok || !data.events || !data.events.length) return;

    // Reset state before replaying history
    currentAssistantRow = null;
    currentAssistantText = '';
    currentThinkRow = null;

    for (const evt of data.events) {
      handleEvent(evt);
    }
    // Ensure UI is not stuck in busy state after replay
    setBusy(false);
  } catch (e) {
    console.error('加载历史记录失败:', e);
  }
}

/* ======== Slash Command Palette ======== */

let slashCommands = []; // populated from wire init
let webNativeCommands = [
  { name: 'help', aliases: ['h', '?'], description: '显示帮助信息（Web 端实现）' },
  { name: 'sessions', aliases: ['resume'], description: '列出所有会话并切换' },
];

let paletteVisible = false;
let paletteIdx = -1;
let paletteFiltered = [];

function mergeCommands() {
  // Start with web-native commands, then add wire commands that don't conflict
  const names = new Set(webNativeCommands.map(c => c.name));
  const merged = [...webNativeCommands];
  for (const cmd of slashCommands) {
    if (!names.has(cmd.name)) {
      names.add(cmd.name);
      merged.push(cmd);
    }
  }
  return merged;
}

function showPalette(filter) {
  const all = mergeCommands();
  const q = (filter || '').toLowerCase();
  paletteFiltered = q ? all.filter(c => {
    return c.name.toLowerCase().includes(q) ||
      (c.description && c.description.toLowerCase().includes(q)) ||
      (c.aliases || []).some(a => a.toLowerCase().includes(q));
  }) : all;
  paletteIdx = paletteFiltered.length > 0 ? 0 : -1;

  let existing = document.getElementById('slash-palette');
  if (existing) existing.remove();

  if (!paletteFiltered.length) {
    paletteVisible = false;
    return;
  }

  const palette = document.createElement('div');
  palette.id = 'slash-palette';
  palette.className = 'slash-palette';
  let html = '<div class="slash-palette-header">命令</div>';
  paletteFiltered.forEach((cmd, i) => {
    const aliases = (cmd.aliases || []).map(a => '/' + a).join(' ');
    html += `<div class="slash-palette-item${i === 0 ? ' selected' : ''}" data-idx="${i}">
      <span class="slash-cmd-name">/${escapeHtml(cmd.name)}</span>
      <span class="slash-cmd-aliases">${escapeHtml(aliases)}</span>
      <span class="slash-cmd-desc">${escapeHtml(cmd.description || '')}</span>
    </div>`;
  });
  palette.innerHTML = html;
  document.body.appendChild(palette);

  // Position above input
  const inputPanel = document.querySelector('.input-panel');
  const rect = inputPanel.getBoundingClientRect();
  palette.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  palette.style.left = rect.left + 'px';
  palette.style.width = rect.width + 'px';

  paletteVisible = true;

  // Click handler
  palette.querySelectorAll('.slash-palette-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      selectPaletteItem(idx);
    });
  });
}

function updatePaletteSelection() {
  const items = document.querySelectorAll('.slash-palette-item');
  items.forEach((el, i) => el.classList.toggle('selected', i === paletteIdx));
}

function navigatePalette(down) {
  if (!paletteFiltered.length) return;
  paletteIdx += down ? 1 : -1;
  if (paletteIdx >= paletteFiltered.length) paletteIdx = 0;
  if (paletteIdx < 0) paletteIdx = paletteFiltered.length - 1;
  updatePaletteSelection();
}

function selectPaletteItem(idx) {
  if (idx < 0 || idx >= paletteFiltered.length) return;
  const cmd = paletteFiltered[idx];
  // Handle web-native commands directly
  if (webNativeCommands.some(c => c.name === cmd.name)) {
    userInput.value = '';
    hidePalette();
    if (cmd.name === 'help') {
      showHelpModal(mergeCommands());
    } else if (cmd.name === 'sessions') {
      // Trigger session list refresh and show
      loadSessions();
    }
    return;
  }
  userInput.value = '/' + cmd.name + ' ';
  userInput.focus();
  userInput.dispatchEvent(new Event('input'));
  hidePalette();
}

function hidePalette() {
  const palette = document.getElementById('slash-palette');
  if (palette) palette.remove();
  paletteVisible = false;
  paletteIdx = -1;
  paletteFiltered = [];
}

function showHelpModal(commands) {
  let html = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">';
  html += '<div class="modal help-modal"><h3>可用命令</h3><div class="help-commands">';

  // Keyboard shortcuts
  html += '<div class="help-section"><div class="help-section-title">键盘快捷键</div>';
  const shortcuts = [
    ['Enter', '发送消息'],
    ['Shift + Enter', '换行'],
    ['/', '打开命令面板'],
    ['↑↓', '导航命令面板'],
    ['Esc', '关闭面板'],
  ];
  shortcuts.forEach(([key, desc]) => {
    html += `<div class="help-item"><span class="help-key">${escapeHtml(key)}</span><span class="help-desc">${escapeHtml(desc)}</span></div>`;
  });
  html += '</div>';

  // Commands
  html += '<div class="help-section"><div class="help-section-title">斜杠命令</div>';
  commands.forEach(cmd => {
    const isWebNative = webNativeCommands.some(c => c.name === cmd.name);
    html += `<div class="help-item${isWebNative ? ' web-native' : ''}">
      <span class="help-key">/${escapeHtml(cmd.name)}</span>
      <span class="help-desc">${escapeHtml(cmd.description || '')}${isWebNative ? ' (Web)' : ''}</span>
    </div>`;
  });
  html += '</div></div>';
  html += '<div class="buttons"><button class="btn primary" onclick="closeModal()">关闭</button></div>';
  html += '</div></div>';
  modalContainer.innerHTML = html;
}

// Update input keydown handler for slash palette
userInput.addEventListener('keydown', (e) => {
  if (paletteVisible) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigatePalette(true);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigatePalette(false);
      return;
    }
    if (e.key === 'Enter' && paletteIdx >= 0) {
      e.preventDefault();
      selectPaletteItem(paletteIdx);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hidePalette();
      return;
    }
  }

  // Existing Enter handling
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
    return;
  }
});

userInput.addEventListener('keyup', (e) => {
  const val = userInput.value;
  const cursorPos = userInput.selectionStart;

  if (e.key === '/' && val === '/' && cursorPos === 1) {
    showPalette('');
    return;
  }

  if (paletteVisible && val.startsWith('/')) {
    const filter = val.slice(1);
    showPalette(filter);
    return;
  }

  if (paletteVisible && !val.startsWith('/')) {
    hidePalette();
  }
});

// Close palette on outside click
document.addEventListener('click', (e) => {
  if (paletteVisible && !e.target.closest('#slash-palette') && !e.target.closest('#user-input')) {
    hidePalette();
  }
});

/* ── Sidebar & Drawer ─────────────────────────────────────────────── */

const SIDEBAR_STATE_KEY = 'sidebar_collapsed';
const FILE_SIDEBAR_STATE_KEY = 'file_sidebar_collapsed';

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  localStorage.setItem(SIDEBAR_STATE_KEY, sb.classList.contains('collapsed'));
}

function toggleFileSidebar() {
  const fsb = document.getElementById('file-sidebar');
  fsb.classList.toggle('collapsed');
  localStorage.setItem(FILE_SIDEBAR_STATE_KEY, fsb.classList.contains('collapsed'));
}

function initSidebarState() {
  const sb = document.getElementById('sidebar');
  const fsb = document.getElementById('file-sidebar');
  if (localStorage.getItem(SIDEBAR_STATE_KEY) === 'true') sb.classList.add('collapsed');
  if (localStorage.getItem(FILE_SIDEBAR_STATE_KEY) === 'true') fsb.classList.add('collapsed');
}

/* Mobile drawers */
function openSessionDrawer() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('show');
}

function closeSessionDrawer() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('show');
}

function openFileDrawer() {
  document.getElementById('file-sidebar').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('show');
}

function closeFileDrawer() {
  document.getElementById('file-sidebar').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('show');
}

function closeDrawers() {
  closeSessionDrawer();
  closeFileDrawer();
}

/* ESC closes drawers (and palette) */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawers();
  }
});

/* ── Network Info (mobile access) ─────────────────────────────────── */

async function loadNetworkInfo() {
  try {
    const res = await fetch('/api/network');
    if (!res.ok) return;
    const data = await res.json();
    const el = document.getElementById('status-ip');
    if (!el || !data.url) return;
    // Only show if we have a non-localhost IP
    if (data.host && data.host !== '127.0.0.1' && !data.host.startsWith('127.')) {
      el.textContent = data.host + ':' + data.port;
      el.style.display = 'inline-flex';
      el.onclick = () => copyToClipboard(data.url, el);
    }
  } catch (e) {
    // Silently ignore — this is optional UX enhancement
  }
}

async function copyToClipboard(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    const original = el.textContent;
    el.textContent = '已复制';
    el.classList.add('copied');
    setTimeout(() => {
      el.textContent = original;
      el.classList.remove('copied');
    }, 1200);
  } catch (e) {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// Init on load
initSidebarState();
loadFileSidebar('');
loadNetworkInfo();
connect();

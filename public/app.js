/**
 * 吃瓜日报 - 前端逻辑
 * 功能：表单提交、文件预览、拖拽上传、SSE 实时推送
 */

(function () {
  'use strict';

  // ---- DOM refs ----
  const form = document.getElementById('submit-form');
  const titleInput = document.getElementById('title');
  const contentInput = document.getElementById('content');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const dropPlaceholder = document.getElementById('drop-placeholder');
  const filePreview = document.getElementById('file-preview');
  const previewImg = document.getElementById('preview-img');
  const previewVideo = document.getElementById('preview-video');
  const removeFileBtn = document.getElementById('remove-file');
  const feed = document.getElementById('feed');
  const emptyState = document.getElementById('empty-state');
  const submitBtn = document.getElementById('submit-btn');

  let selectedFile = null;

  // ---- Get owner token from cookie ----
  function getCookie(name) {
    const match = document.cookie.match('(?:^|;\\s*)' + name + '=([^;]*)');
    return match ? decodeURIComponent(match[1]) : '';
  }
  let pendingLocalIds = new Set(); // IDs rendered locally, should skip SSE re-render
  let myToken = getCookie('owner_token') || '';

  // ---- File handling ----
  function handleFile(file) {
    if (!file) return;
    selectedFile = file;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      alert('仅支持图片和视频文件');
      return;
    }

    dropPlaceholder.classList.add('hidden');
    filePreview.classList.remove('hidden');

    const url = URL.createObjectURL(file);
    if (isImage) {
      previewImg.src = url;
      previewImg.classList.remove('hidden');
      previewVideo.classList.add('hidden');
      previewVideo.pause();
    } else {
      previewVideo.src = url;
      previewVideo.classList.remove('hidden');
      previewImg.classList.add('hidden');
    }
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    filePreview.classList.add('hidden');
    dropPlaceholder.classList.remove('hidden');
    previewImg.src = '';
    previewVideo.src = '';
    previewImg.classList.add('hidden');
    previewVideo.classList.add('hidden');
  }

  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
  removeFileBtn.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); });

  // Drag & drop
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  });
  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length) handleFile(files[0]);
  });

  // ---- Form submission ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = '发布中…';

    const formData = new FormData();
    formData.append('title', titleInput.value.trim());
    formData.append('content', contentInput.value.trim());
    if (selectedFile) formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/submit', { method: 'POST', body: formData });
      // Handle non-JSON responses (e.g., HTML error pages from server errors)
      const contentType = res.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        // Server returned HTML (likely a 5xx or 413 error page)
        throw new Error(`服务器返回非 JSON 响应 (${res.status})`);
      }
      if (data.ok) {
        // Mark as owner since we just submitted it
        data.item.isOwner = true;
        myToken = getCookie('owner_token') || '';
        // Clear form on success
        titleInput.value = '';
        contentInput.value = '';
        clearFile();
        // If not yet connected to SSE, manually add the card
        pendingLocalIds.add(data.item.id);
        renderCard(data.item);
        setTimeout(() => pendingLocalIds.delete(data.item.id), 2000);
      } else if (res.status === 429) {
        alert('提交太频繁，请稍后再试');
      } else {
        alert('提交失败：' + (data.error || '未知错误'));
      }
    } catch (err) {
      console.error('提交失败:', err);
      alert('提交失败：' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '发布 🚀';
    }
  });

  // ---- Render card into feed ----
  function renderCard(item) {
    emptyState?.classList.add('hidden');

    const tagLabel = { video: '视频', image: '图片', text: '文字' }[item.category] || '投稿';
    const tagClass = { video: 'tag-video', image: 'tag-image', text: 'tag-text' }[item.category] || '';

    let mediaHTML = '';
    if (item.category === 'video' && item.file) {
      mediaHTML = `<div class="card-media"><video src="/uploads/videos/${item.file}" controls muted playsinline></video></div>`;
    } else if (item.category === 'image' && item.file) {
      mediaHTML = `<div class="card-media"><img src="/uploads/images/${item.file}" alt="${esc(item.title)}" loading="lazy"></div>`;
    }

    const date = new Date(item.createdAt);
    const timeStr = `${date.getMonth()+1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    const cardId = `card-${item.id}`;
    const isOwner = item.isOwner && myToken;

    const card = document.createElement('article');
    card.className = 'card';
    card.id = cardId;
    card.dataset.id = item.id;
    card.dataset.owner = isOwner ? 'true' : 'false';

    // Build comments HTML
    const commentCount = (item.comments || []).length;
    let commentsHTML = '';
    if (commentCount) {
      commentsHTML = item.comments.map(c => {
        const cd = new Date(c.createdAt);
        const ct = `${cd.getMonth()+1}/${cd.getDate()} ${pad(cd.getHours())}:${pad(cd.getMinutes())}`;
        return `<div class="comment" data-cid="${c.id}">
          <span class="comment-text">${esc(c.text)}</span>
          ${isOwner ? `<button class="comment-delete" data-cid="${c.id}" title="删除评论">✕</button>` : ''}
          <span class="comment-time">${ct}</span>
        </div>`;
      }).join('');
    }

    // Build appends HTML
    const appendCount = (item.appends || []).length;
    let appendsHTML = '';
    if (appendCount) {
      appendsHTML = item.appends.map(a => {
        const ad = new Date(a.createdAt);
        const at = `${ad.getMonth()+1}/${ad.getDate()} ${pad(ad.getHours())}:${pad(ad.getMinutes())}`;
        return `<div class="append-item" data-aid="${a.id}">
          <span class="append-label">追加</span>
          <span class="append-text">${esc(a.text)}</span>
          ${isOwner ? `<button class="append-delete" data-aid="${a.id}" title="删除追加">✕</button>` : ''}
          <span class="append-time">${at}</span>
        </div>`;
      }).join('');
    }

    card.innerHTML = `
      ${mediaHTML}
      <div class="card-body">
        ${item.title ? `<h3 class="card-title">${esc(item.title)}</h3>` : ''}
        ${item.content ? `<p class="card-text">${esc(item.content)}</p>` : ''}
        <div class="card-meta">
          <span class="card-tag ${tagClass}">${tagLabel}</span>
          <span>${timeStr}</span>
        </div>

        <!-- Comments Section (collapsible) -->
        <details class="comments-section" ${commentCount > 0 || appendCount > 0 ? 'open' : ''}>
          <summary class="comments-header">
            <span>💬 ${commentCount} 条评论</span>
            ${appendCount > 0 ? `<span class="append-badge">📝 ${appendCount} 条追加</span>` : ''}
          </summary>
          <div class="comments-body">
            <div class="comments-list">${commentsHTML}</div>
            <div class="comment-input-row">
              <input type="text" class="comment-input" placeholder="发表评论…" maxlength="500">
              <button class="btn-comment" data-id="${item.id}">发送</button>
            </div>

            <!-- Appends Section (always present) -->
            <details class="appends-section">
              <summary class="appends-header">📝 追加内容 (${appendCount})</summary>
              <div class="appends-body">
                <div class="appends-list">${appendsHTML}</div>
                ${isOwner ? `
                <div class="append-input-row">
                  <input type="text" class="append-input" placeholder="追加内容…" maxlength="500">
                  <button class="btn-append" data-id="${item.id}">追加</button>
                </div>` : `
                <p style="font-size:.78rem;color:var(--text-muted);opacity:.6;padding:.3rem 0;">只有瓜主可以追加内容</p>`}
              </div>
            </details>
          </div>
        </details>

        <!-- Delete (only owner) -->
        ${isOwner ? `
        <div class="card-actions">
          <button class="btn-delete" data-id="${item.id}">🗑️ 删除此瓜条</button>
        </div>` : ''}
      </div>
    `;

    feed.insertBefore(card, feed.firstChild);

    // ---- Event delegation for comments ----
    const commentInput = card.querySelector('.comment-input');
    const commentBtn = card.querySelector('.btn-comment');
    commentBtn.addEventListener('click', () => submitComment(item.id, commentInput, card));
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(item.id, commentInput, card); }
    });

    // ---- Event delegation for appends (only if owner) ----
    const appendInput = card.querySelector('.append-input');
    const appendBtn = card.querySelector('.btn-append');
    if (appendBtn) {
      appendBtn.addEventListener('click', () => submitAppend(item.id, appendInput, card));
    }
    if (appendInput) {
      appendInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAppend(item.id, appendInput, card); }
      });
    }

    // ---- Delete comment ----
    card.querySelectorAll('.comment-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteComment(item.id, btn.dataset.cid, card));
    });

    // ---- Delete append ----
    card.querySelectorAll('.append-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteAppend(item.id, btn.dataset.aid, card));
    });

    // ---- Delete card (only owner) ----
    if (isOwner) {
      card.querySelector('.btn-delete').addEventListener('click', () => deleteSubmission(item.id, card));
    }
  }

  // ---- Submit comment ----
  async function submitComment(id, input, card) {
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/submission/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.ok) {
        input.value = '';
        // Add comment to DOM immediately
        addCommentToDOM(card, data.comment);
      } else if (res.status === 429) {
        alert('评论太频繁，请稍后再试');
      }
    } catch(err) { console.error('评论失败:', err); }
  }

  // ---- Submit append ----
  async function submitAppend(id, input, card) {
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/submission/${id}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.ok) {
        input.value = '';
        addAppendToDOM(card, data.entry);
      }
    } catch(err) { console.error('追加失败:', err); }
  }

  // ---- Delete comment ----
  async function deleteComment(subId, cid, card) {
    try {
      const res = await fetch(`/api/submission/${subId}/comment/${cid}`, { method: 'DELETE' });
      if (res.ok) removeCommentFromDOM(card, cid);
    } catch(err) { console.error('删除评论失败:', err); }
  }

  // ---- Delete append ----
  async function deleteAppend(subId, aid, card) {
    try {
      const res = await fetch(`/api/submission/${subId}/append/${aid}`, { method: 'DELETE' });
      if (res.ok) removeAppendFromDOM(card, aid);
    } catch(err) { console.error('删除追加失败:', err); }
  }

  // ---- Delete submission ----
  async function deleteSubmission(id, card) {
    if (!confirm('确定要删除这条瓜条吗？')) return;
    try {
      const res = await fetch(`/api/submission/${id}`, { method: 'DELETE' });
      if (res.ok) {
        card.style.animation = 'slideDown .3s ease-in forwards';
        setTimeout(() => {
          card.remove();
          // Check if feed is empty
          if (!feed.querySelectorAll('.card').length) {
            emptyState?.classList.remove('hidden');
          }
        }, 300);
      }
    } catch(err) { console.error('删除失败:', err); }
  }

  // ---- Helpers: add/remove from DOM without re-fetching ----
  function addCommentToDOM(card, comment) {
    const list = card.querySelector('.comments-list');
    const d = new Date(comment.createdAt);
    const t = `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const el = document.createElement('div');
    el.className = 'comment';
    el.dataset.cid = comment.id;
    const isOwner = card.dataset.owner === 'true';
    el.innerHTML = `
      <span class="comment-text">${esc(comment.text)}</span>
      ${isOwner ? `<button class="comment-delete" data-cid="${comment.id}" title="删除评论">✕</button>` : ''}
      <span class="comment-time">${t}</span>
    `;
    if (isOwner) {
      el.querySelector('.comment-delete').addEventListener('click', () => deleteComment(card.dataset.id, comment.id, card));
    }
    list.appendChild(el);
  }

  function removeCommentFromDOM(card, cid) {
    const el = card.querySelector(`.comment[data-cid="${cid}"]`);
    if (el) el.remove();
  }

  function addAppendToDOM(card, entry) {
    const list = card.querySelector('.appends-list');
    const d = new Date(entry.createdAt);
    const t = `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const el = document.createElement('div');
    el.className = 'append-item';
    el.dataset.aid = entry.id;
    const isOwner = card.dataset.owner === 'true';
    el.innerHTML = `
      <span class="append-label">追加</span>
      <span class="append-text">${esc(entry.text)}</span>
      ${isOwner ? `<button class="append-delete" data-aid="${entry.id}" title="删除追加">✕</button>` : ''}
      <span class="append-time">${t}</span>
    `;
    if (isOwner) {
      el.querySelector('.append-delete').addEventListener('click', () => deleteAppend(card.dataset.id, entry.id, card));
    }
    list.appendChild(el);
  }

  function removeAppendFromDOM(card, aid) {
    const el = card.querySelector(`.append-item[data-aid="${aid}"]`);
    if (el) el.remove();
  }

  // ---- SSE: listen for real-time updates ----
  function connectStream() {
    const evtSource = new EventSource('/stream');

    evtSource.addEventListener('new_submission', (e) => {
      const item = JSON.parse(e.data);
      // Skip if we already rendered this locally OR it already exists in DOM
      if (pendingLocalIds.has(item.id) || feed.querySelector(`[data-id="${item.id}"]`)) return;
      // Determine ownership via token comparison
      item.isOwner = !!((item.ownerToken || '') && myToken === item.ownerToken);
      renderCard(item);
    });

    evtSource.addEventListener('deleted', (e) => {
      const data = JSON.parse(e.data);
      const card = feed.querySelector(`[data-id="${data.id}"]`);
      if (card) {
        card.style.animation = 'slideDown .3s ease-in forwards';
        setTimeout(() => {
          card.remove();
          if (!feed.querySelectorAll('.card').length) emptyState?.classList.remove('hidden');
        }, 300);
      }
    });

    evtSource.addEventListener('commented', (e) => {
      const data = JSON.parse(e.data);
      const card = feed.querySelector(`[data-id="${data.id}"]`);
      if (card) {
        addCommentToDOM(card, data.comment);
        // Update comment count without destroying other elements
        const summary = card.querySelector('.comments-header span');
        if (summary) {
          const current = parseInt(summary.textContent.match(/\d+/)?.at(0) || '0', 10);
          summary.textContent = `💬 ${current + 1} 条评论`;
        }
      }
    });

    evtSource.addEventListener('appended', (e) => {
      const data = JSON.parse(e.data);
      const card = feed.querySelector(`[data-id="${data.id}"]`);
      if (card) {
        addAppendToDOM(card, data.entry);
        // Update append count in header
        const summary = card.querySelector('.appends-header');
        if (summary) {
          const current = parseInt(summary.textContent.match(/\d+/)?.at(0) || '0', 10);
          summary.textContent = `📝 追加内容 (${current + 1})`;
        }
      }
    });

    evtSource.addEventListener('commentDeleted', (e) => {
      const data = JSON.parse(e.data);
      const card = feed.querySelector(`[data-id="${data.id}"]`);
      if (card) {
        removeCommentFromDOM(card, data.commentId);
        // Update comment count
        const summary = card.querySelector('.comments-header span');
        if (summary) {
          const current = parseInt(summary.textContent.match(/\d+/)?.at(0) || '0', 10);
          summary.textContent = `💬 ${Math.max(0, current - 1)} 条评论`;
        }
      }
    });

    evtSource.addEventListener('appendDeleted', (e) => {
      const data = JSON.parse(e.data);
      const card = feed.querySelector(`[data-id="${data.id}"]`);
      if (card) removeAppendFromDOM(card, data.appendId);
    });

    evtSource.onerror = () => {
      console.log('SSE 重连中…');
    };
  }

  // ---- Load existing submissions on page load ----
  async function loadExisting() {
    try {
      const res = await fetch('/api/submissions');
      const items = await res.json();
      if (items.length) {
        // Show newest first (already sorted), but render oldest-to-newest so animation flows up
        items.slice().reverse().forEach(renderCard);
      }
    } catch (err) {
      console.error('加载投稿失败:', err);
    }
  }

  // ---- Helpers ----
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  // ---- Init ----
  loadExisting();
  connectStream();
})();

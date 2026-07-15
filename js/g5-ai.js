/* ============================================
   g5-ai.js — G5 AI Agent Chatbot (Dashboard Only)
   Gadget 5tore
   ============================================
   - Dashboard-only FAB + popup
   - Kirim ke N8N_G5_AI_URL (webhook)
   - Semua role bisa akses
   - [FEAT 1] Streaming Response — SSE support + progressive reveal
   - [FEAT 2] Chat History Persistence — localStorage, survive refresh
   - [FEAT 3] Regenerate Response — re-send last user query
   ============================================ */

(function () {
  'use strict';
  if (window.__G5AI_LOADED__) return;
  window.__G5AI_LOADED__ = true;

  var $ = function (id) { return document.getElementById(id); };

  // ── Config ──────────────────────────────────────
  var N8N_G5_AI_URL = (typeof window.N8N_G5_AI_URL !== 'undefined') ? window.N8N_G5_AI_URL : '';
  var AI_NAME = 'G5 Assistant';
  var WELCOME_CHIPS = [];

  // ── Internal State ──────────────────────────────
  var ctx = {
    messages: [],
    isOpen: false,
    isSending: false,
    fabEl: null,
    popupEl: null,
    observer: null,
    sessionId: null,
    _chatLoaded: false,
    // [FEAT 1] Streaming state
    isStreaming: false,
    streamAbortController: null,
    _streamRevealTimer: null,
    // Drag state
    drag: {
      active: false,
      startX: 0, startY: 0,
      offsetX: 0, offsetY: 0,
      moved: false,
      fabX: 0, fabY: 0,
      fabW: 56, fabH: 56,
    },
  };

  // ── [FEAT 2] Chat History Persistence ──────────
  var STORAGE_KEY = 'g5ai_chat_history';
  var MAX_STORED_MESSAGES = 100;
  var _saveTimer = null;

  function saveChat() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        var toSave = ctx.messages
          .filter(function (m) { return (m.role === 'user' || m.role === 'bot') && m.text; })
          .slice(-MAX_STORED_MESSAGES)
          .map(function (m) {
            var obj = { role: m.role, text: m.text, time: m.time };
            if (m.followups && m.followups.length) obj.followups = m.followups;
            return obj;
          });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          sid: ctx.sessionId,
          ts: Date.now(),
          msgs: toSave
        }));
      } catch (e) {
        try {
          var existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
          if (existing.msgs && existing.msgs.length > 20) {
            existing.msgs = existing.msgs.slice(-30);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
          }
        } catch (e2) { /* give up */ }
      }
    }, 500);
  }

  function loadChat() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.msgs) || !data.msgs.length) return false;
      var age = Date.now() - (data.ts || 0);
      if (age > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      if (data.sid) ctx.sessionId = data.sid;
      ctx.messages = data.msgs.filter(function (m) {
        return m.role === 'user' || m.role === 'bot';
      });
      return ctx.messages.length > 0;
    } catch (e) {
      return false;
    }
  }

  function clearPersistedChat() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ── Helpers ─────────────────────────────────────
  function esc(s) {
    if (typeof window.esc === 'function') return window.esc(s);
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function timeStr() {
    return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function isDashboardActive() {
    var dash = $('view-dashboard');
    return dash && dash.classList.contains('active');
  }

  function isAllowedRole() {
    if (!state || !state.session || !state.session.currentUser) return false;
    return true;
  }

  function refreshStoreData() {
    if (typeof window.loadAllData === 'function') {
      window.loadAllData();
    }
  }

  /**
   * Centralized reply extraction — supports all webhook response formats.
   */
  function extractReply(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (typeof data === 'object') {
      return data.reply || data.message || data.output || data.text || data.response || '';
    }
    return String(data);
  }

  /**
   * Extract follow-up questions from response data.
   */
  function extractFollowups(data) {
    if (!data || typeof data !== 'object') return [];
    var raw = data.followups || data.suggestions || data.follow_up || [];
    if (!Array.isArray(raw)) raw = [];
    return raw.filter(function (f) { return typeof f === 'string' && f.trim(); }).slice(0, 3);
  }

  // ── Demo Questions ──────────────────────────────
  var DEMO_QUESTIONS = [
    { cat: '📦 Produk — Baca', items: [
      'Berapa total produk di toko saya?',
      'Produk apa saja yang stoknya habis?',
      'Produk mana yang stoknya di bawah 5?',
      'Produk apa saja di kategori Smartphone?',
      'Produk mana yang sedang diskon?',
    ]},
    { cat: '📈 Analisa Produk', items: [
      'Kategori apa yang punya produk paling banyak?',
      'Rata-rata harga produk per kategori berapa?',
      'Produk mana yang harganya di atas rata-rata?',
      'Celah kategori apa yang belum ada produknya?',
    ]},
    { cat: '🏷️ Promo — Baca', items: [
      'Promo apa saja yang sedang aktif?',
      'Promo apa saja yang sudah nonaktif?',
      'Detail promo Flash Sale Weekend apa?',
    ]},
    { cat: '🏷️ Promo — Buat/Ubah', items: [
      'Buat promo "Flash Sale Weekend" diskon 20% untuk semua HP',
      'Buat promo "Gratis Ongkir" dengan deskripsi menarik',
      'Ubah deskripsi promo Flash Sale Weekend jadi lebih menarik',
      'Nonaktifkan promo Flash Sale Weekend yang udah selesai',
      'Buat promo "Trade-In" dengan syarat tukar gadget lama',
    ]},
    { cat: '📝 Deskripsi Produk', items: [
      'Buatkan deskripsi menarik untuk produk Samsung Galaxy S24 Ultra',
      'Perbaiki deskripsi semua produk di kategori Aksesoris jadi lebih menarik',
    ]},
    { cat: '⚙️ Setting & Cabang', items: [
      'Ubah tagline toko jadi "Gadget Terlengkap dengan Harga Terbaik"',
      'Update jam operasional cabang Gadget 5tore Jakarta (Utama) jadi Senin-Jumat 08.00-21.00, Sabtu-Minggu 09.00-18.00',
      'Dimana saja lokasi cabang toko?',
    ]},
    { cat: '💡 Rekomendasi & Insight', items: [
      'Produk mana yang sebaiknya dipromokan minggu ini berdasarkan stok terbanyak?',
      'Bandingkan harga Samsung Galaxy S24 Ultra dan iPhone 15 Pro Max, mana yang lebih worth it?',
      'Rekomendasi 3 produk terbaik untuk customer budget 2-3 juta',
    ]},
  ];

  var demoPickerOpen = false;

  function toggleDemoPicker() {
    var dd = $('g5aiDemoPicker');
    if (!dd) return;
    demoPickerOpen = !demoPickerOpen;
    dd.classList.toggle('g5ai-demo-open', demoPickerOpen);
    if (demoPickerOpen) dd.scrollTop = 0;
  }

  function closeDemoPicker() {
    var dd = $('g5aiDemoPicker');
    if (dd) dd.classList.remove('g5ai-demo-open');
    demoPickerOpen = false;
  }

  function pickDemoQuestion(text) {
    var input = $('g5aiInput');
    if (input) {
      input.value = text;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      input.focus();
    }
    closeDemoPicker();
  }

  function buildDemoPickerHTML() {
    var html = '<div class="g5ai-demo-picker" id="g5aiDemoPicker">';
    html += '<div class="g5ai-demo-search"><i data-lucide="search"></i><input type="text" id="g5aiDemoSearch" placeholder="Cari pertanyaan..."></div>';
    html += '<div class="g5ai-demo-list" id="g5aiDemoList">';
    DEMO_QUESTIONS.forEach(function (group) {
      html += '<div class="g5ai-demo-cat">' + esc(group.cat) + '</div>';
      group.items.forEach(function (q) {
        html += '<button class="g5ai-demo-item" data-q="' + esc(q).replace(/"/g, '&quot;') + '">' + esc(q) + '</button>';
      });
    });
    html += '</div></div>';
    return html;
  }

  // ── Draggable FAB ─────────────────────────────
  var DRAG_THRESHOLD = 6;
  var IDLE_BEFORE_SHRINK = 3000;
  var POS_KEY = 'g5ai_fab_pos';
  var shrinkTimer = null;
  var DOT_SIZE = 22;
  var FULL_SIZE = 56;

  function saveFabPos() {
    try {
      var fab = ctx.fabEl;
      localStorage.setItem(POS_KEY, JSON.stringify({
        x: ctx.drag.fabX,
        y: ctx.drag.fabY,
        side: fab.classList.contains('snapped-left') ? 'left' : 'right'
      }));
    } catch (e) { /* ignore */ }
  }

  function loadFabPos() {
    try {
      var s = JSON.parse(localStorage.getItem(POS_KEY));
      if (s && typeof s.x === 'number' && typeof s.y === 'number') return s;
    } catch (e) { /* ignore */ }
    return null;
  }

  function initDrag() {
    var fab = ctx.fabEl;
    if (!fab) return;

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var margin = 12;
    var fabW = 56;
    var fabH = 56;
    ctx.drag.fabW = fabW;
    ctx.drag.fabH = fabH;

    var saved = loadFabPos();
    if (saved) {
      ctx.drag.fabX = saved.x;
      ctx.drag.fabY = Math.max(margin, Math.min(saved.y, vh - fabH - margin));
      fab.classList.add(saved.side === 'left' ? 'snapped-left' : 'snapped-right');
    } else {
      ctx.drag.fabX = vw - fabW - margin;
      ctx.drag.fabY = vh - fabH - 28;
      fab.classList.add('snapped-right');
    }

    fab.style.bottom = 'auto';
    fab.style.right = 'auto';
    fab.style.left = ctx.drag.fabX + 'px';
    fab.style.top = ctx.drag.fabY + 'px';

    fab.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    fab.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    fab.addEventListener('mouseenter', function () {
      if (fab.classList.contains('mini-dot')) { expandFromDot(); cancelShrink(); }
    });
    fab.addEventListener('mouseleave', function () {
      if (!ctx.isOpen && !ctx.drag.active) scheduleShrink();
    });

    setTimeout(function () {
      if (!ctx.isOpen) shrinkToDot();
    }, 600);
  }

  function getPointerPos(e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function onDragStart(e) {
    if (ctx.fabEl.classList.contains('mini-dot')) {
      expandFromDot();
      cancelShrink();
      setTimeout(function () { if (!ctx.isOpen) openPopup(); }, 300);
      return;
    }

    var pos = getPointerPos(e);
    var fab = ctx.fabEl;
    var rect = fab.getBoundingClientRect();

    ctx.drag.startX = pos.x;
    ctx.drag.startY = pos.y;
    ctx.drag.offsetX = pos.x - rect.left;
    ctx.drag.offsetY = pos.y - rect.top;
    ctx.drag.moved = false;
    ctx.drag.fabW = rect.width;
    ctx.drag.fabH = rect.height;
    ctx.drag.active = true;
    cancelShrink();
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!ctx.drag.active) return;
    e.preventDefault();

    var pos = getPointerPos(e);
    var dx = pos.x - ctx.drag.startX;
    var dy = pos.y - ctx.drag.startY;

    if (!ctx.drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    ctx.drag.moved = true;

    var fab = ctx.fabEl;
    fab.classList.add('dragging');
    fab.classList.remove('mini-dot');

    var newX = pos.x - ctx.drag.offsetX;
    var newY = pos.y - ctx.drag.offsetY;

    var maxX = window.innerWidth - ctx.drag.fabW;
    var maxY = window.innerHeight - ctx.drag.fabH;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    ctx.drag.fabX = newX;
    ctx.drag.fabY = newY;

    fab.style.bottom = 'auto';
    fab.style.right = 'auto';
    fab.style.left = newX + 'px';
    fab.style.top = newY + 'px';

    if (ctx.isOpen) positionPopup();
  }

  function onDragEnd(e) {
    if (!ctx.drag.active) return;
    ctx.drag.active = false;

    var fab = ctx.fabEl;
    fab.classList.remove('dragging');

    if (!ctx.drag.moved) { togglePopup(); return; }

    snapToEdge();
    saveFabPos();
    if (!ctx.isOpen) setTimeout(shrinkToDot, 800);
  }

  function snapToEdge() {
    var fab = ctx.fabEl;
    var centerX = ctx.drag.fabX + ctx.drag.fabW / 2;
    var vw = window.innerWidth;
    var margin = 12;

    var snapLeft = margin;
    var snapRight = vw - ctx.drag.fabW - margin;
    var targetX = centerX < vw / 2 ? snapLeft : snapRight;
    var targetY = Math.max(margin, Math.min(ctx.drag.fabY, window.innerHeight - ctx.drag.fabH - margin));

    ctx.drag.fabX = targetX;
    ctx.drag.fabY = targetY;

    fab.style.transition = 'left 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), top 0.35s cubic-bezier(0.25, 0.8, 0.25, 1)';
    fab.style.left = targetX + 'px';
    fab.style.top = targetY + 'px';
    setTimeout(function () { fab.style.transition = ''; }, 380);

    fab.classList.toggle('snapped-left', targetX <= vw / 2);
    fab.classList.toggle('snapped-right', targetX > vw / 2);
    saveFabPos();
    if (ctx.isOpen) setTimeout(positionPopup, 380);
  }

  // ── Mini-Dot Shrink / Expand ─────────────────
  function getFabFullSize() {
    var vw = window.innerWidth;
    if (vw <= 480) return 48;
    if (vw <= 768) return 50;
    return FULL_SIZE;
  }

  function getFabDotSize() {
    var vw = window.innerWidth;
    if (vw <= 768) return getFabFullSize();
    return DOT_SIZE;
  }

  function shrinkToDot() {
    if (ctx.isOpen || ctx.drag.active) return;
    var fab = ctx.fabEl;
    if (!fab) return;
    if (window.innerWidth <= 768) return;

    var isLeft = fab.classList.contains('snapped-left');
    var margin = 12;
    var dotSize = DOT_SIZE;
    var fullSize = FULL_SIZE;
    var sizeDiff = fullSize - dotSize;

    var newX = isLeft ? margin : window.innerWidth - dotSize - margin;
    var newY = ctx.drag.fabY + (sizeDiff / 2);
    newY = Math.max(margin, Math.min(newY, window.innerHeight - dotSize - margin));

    ctx.drag.fabX = newX;
    ctx.drag.fabY = newY;

    fab.style.transition = 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1), top 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    fab.style.left = newX + 'px';
    fab.style.top = newY + 'px';
    fab.classList.add('mini-dot');
    setTimeout(function () { fab.style.transition = ''; }, 380);
  }

  function expandFromDot() {
    var fab = ctx.fabEl;
    if (!fab || !fab.classList.contains('mini-dot')) return;

    var isLeft = fab.classList.contains('snapped-left');
    var margin = 12;
    var fullSize = FULL_SIZE;
    var dotSize = DOT_SIZE;
    var sizeDiff = fullSize - dotSize;

    var newX = isLeft ? margin : window.innerWidth - fullSize - margin;
    var newY = ctx.drag.fabY - (sizeDiff / 2);
    newY = Math.max(margin, Math.min(newY, window.innerHeight - fullSize - margin));

    ctx.drag.fabX = newX;
    ctx.drag.fabY = newY;
    ctx.drag.fabW = fullSize;
    ctx.drag.fabH = fullSize;

    fab.style.transition = 'left 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1), top 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1)';
    fab.style.left = newX + 'px';
    fab.style.top = newY + 'px';
    fab.classList.remove('mini-dot');
    setTimeout(function () { fab.style.transition = ''; }, 320);
  }

  function scheduleShrink() {
    cancelShrink();
    shrinkTimer = setTimeout(function () { shrinkToDot(); }, IDLE_BEFORE_SHRINK);
  }

  function cancelShrink() {
    if (shrinkTimer) { clearTimeout(shrinkTimer); shrinkTimer = null; }
  }

  // ── Popup Positioning ──────────────────────────
  function positionPopup() {
    var fab = ctx.fabEl;
    var popup = ctx.popupEl;
    if (!fab || !popup) return;

    popup.style.height = '';
    popup.style.maxHeight = '';

    var rect = fab.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var isMobile = vw <= 480;
    var MARGIN = 8;

    if (isMobile) {
      popup.style.left = '0';
      popup.style.right = '0';
      popup.style.bottom = (vh - rect.top + 8) + 'px';
      popup.style.top = 'auto';
      popup.style.width = '100%';
      popup.style.transformOrigin = 'bottom right';
    } else {
      var popupW = Math.min(400, vw - 32);
      var popupMargin = 12;
      var popupMaxH = Math.min(540, vh - 140);
      var fabCenterX = rect.left + rect.width / 2;
      var popupLeft, popupRight;

      if (fabCenterX < vw / 2) {
        popupLeft = rect.right + popupMargin;
        popupRight = 'auto';
        if (popupLeft + popupW > vw - MARGIN) {
          popupLeft = Math.max(MARGIN, rect.left - popupW - popupMargin);
        }
        if (popupLeft < MARGIN) { popupLeft = MARGIN; popupW = Math.min(popupW, vw - MARGIN * 2); }
      } else {
        popupLeft = 'auto';
        popupRight = vw - rect.left + popupMargin;
        var neededLeft = vw - popupRight - popupW;
        if (neededLeft < MARGIN) {
          popupRight = 'auto';
          popupLeft = Math.max(MARGIN, rect.right + popupMargin);
          if (popupLeft + popupW > vw - MARGIN) { popupLeft = MARGIN; popupW = Math.min(popupW, vw - MARGIN * 2); }
        }
      }

      var popupBottom = vh - rect.top + 8;
      var maxBottom = vh - popupMaxH - MARGIN;
      if (popupBottom > maxBottom) popupBottom = maxBottom;
      if (popupBottom < MARGIN) popupBottom = MARGIN;

      popup.style.left = popupLeft === 'auto' ? 'auto' : popupLeft + 'px';
      popup.style.right = popupRight === 'auto' ? 'auto' : popupRight + 'px';
      popup.style.bottom = popupBottom + 'px';
      popup.style.top = 'auto';
      popup.style.width = popupW + 'px';
      popup.style.transformOrigin = fabCenterX < vw / 2 ? 'bottom left' : 'bottom right';
    }
  }

  // ── Build DOM ───────────────────────────────────
  function buildUI() {
    if (ctx.fabEl) return;

    var fab = document.createElement('button');
    fab.className = 'g5ai-fab';
    fab.id = 'g5aiFab';
    fab.title = 'G5 Assistant';
    fab.innerHTML = '<i data-lucide="bot" class="g5ai-fab-icon"></i><span class="g5ai-fab-badge" id="g5aiFabBadge">0</span>';
    document.body.appendChild(fab);
    ctx.fabEl = fab;

    var popup = document.createElement('div');
    popup.className = 'g5ai-popup';
    popup.id = 'g5aiPopup';
    popup.style.display = 'none';
    popup.innerHTML =
      '<div class="g5ai-header">'
      + '<div class="g5ai-header-avatar"><i data-lucide="bot"></i></div>'
      + '<div class="g5ai-header-info">'
      + '<div class="g5ai-header-name">' + esc(AI_NAME) + '</div>'
      + '<div class="g5ai-header-status"><span class="g5ai-status-dot"></span> <span id="g5aiStatusText">Online</span></div>'
      + '</div>'
      + '<button class="g5ai-header-demo" id="g5aiDemoBtn" title="Demo Pertanyaan"><i data-lucide="list-checks"></i></button>'
      + '<button class="g5ai-header-clear" id="g5aiClearBtn" title="Hapus riwayat"><i data-lucide="trash-2"></i></button>'
      + '<button class="g5ai-header-maximize" id="g5aiMaxBtn" title="Perbesar"><i data-lucide="maximize-2"></i></button>'
      + '<button class="g5ai-header-close" id="g5aiCloseBtn" title="Tutup"><i data-lucide="x"></i></button>'
      + '</div>'
      + buildDemoPickerHTML()
      + '<div class="g5ai-messages" id="g5aiMessages"></div>'
      + '<div class="g5ai-input-area">'
      + '<button class="g5ai-stop-btn" id="g5aiStopBtn" title="Hentikan"><i data-lucide="square"></i></button>'
      + '<textarea class="g5ai-input" id="g5aiInput" placeholder="Tanya apa saja tentang toko..." rows="1"></textarea>'
      + '<button class="g5ai-send" id="g5aiSendBtn" title="Kirim"><i data-lucide="send"></i></button>'
      + '</div>';
    document.body.appendChild(popup);
    ctx.popupEl = popup;

    // Events
    $('g5aiCloseBtn').onclick = function () { closePopup(); };
    $('g5aiMaxBtn').onclick = function () { toggleMaximize(); };
    $('g5aiSendBtn').onclick = function () { sendMessage(); };
    $('g5aiInput').onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };
    $('g5aiInput').oninput = function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    };
    $('g5aiClearBtn').onclick = clearChat;

    // [FEAT 1] Stop streaming button
    $('g5aiStopBtn').onclick = function () { stopStreaming(); };
    $('g5aiStopBtn').style.display = 'none';

    // Demo picker events
    $('g5aiDemoBtn').onclick = function (e) { e.stopPropagation(); toggleDemoPicker(); };
    $('g5aiDemoList').addEventListener('click', function (e) {
      var item = e.target.closest('.g5ai-demo-item');
      if (item) pickDemoQuestion(item.getAttribute('data-q'));
    });
    $('g5aiDemoSearch').addEventListener('input', function () {
      var q = this.value.toLowerCase();
      var items = $('g5aiDemoList').querySelectorAll('.g5ai-demo-item');
      var cats = $('g5aiDemoList').querySelectorAll('.g5ai-demo-cat');
      items.forEach(function (item) {
        var show = !q || item.getAttribute('data-q').toLowerCase().indexOf(q) !== -1;
        item.style.display = show ? '' : 'none';
        if (show) {
          var prev = item.previousElementSibling;
          while (prev) {
            if (prev.classList.contains('g5ai-demo-cat')) { prev.style.display = ''; break; }
            prev = prev.previousElementSibling;
          }
        }
      });
      cats.forEach(function (cat) {
        var next = cat.nextElementSibling;
        var hasVisible = false;
        while (next && !next.classList.contains('g5ai-demo-cat')) {
          if (next.style.display !== 'none') { hasVisible = true; break; }
          next = next.nextElementSibling;
        }
        cat.style.display = hasVisible ? '' : 'none';
      });
    });
    document.addEventListener('click', function (e) {
      if (demoPickerOpen && !e.target.closest('.g5ai-demo-picker') && !e.target.closest('#g5aiDemoBtn')) {
        closeDemoPicker();
      }
    });
  }

  // ── Toggle Popup ────────────────────────────────
  function togglePopup() {
    if (ctx.isOpen) closePopup(); else openPopup();
  }

  function openPopup() {
    expandFromDot();
    cancelShrink();

    ctx.isOpen = true;
    ctx.popupEl.style.display = 'flex';
    ctx.popupEl.classList.remove('closing');
    ctx.fabEl.classList.add('open');

    setTimeout(positionPopup, 100);

    // [FEAT 2] Load persisted chat on first open
    if (!ctx.messages.length && !ctx._chatLoaded) {
      ctx._chatLoaded = true;
      if (loadChat()) {
        renderMessages();
      } else {
        renderWelcome();
      }
    } else if (!ctx.messages.length) {
      renderWelcome();
    }

    if (!ctx.sessionId) {
      ctx.sessionId = 'g5ai_' + Date.now();
    }
    setTimeout(function () { $('g5aiInput').focus(); }, 150);
  }

  function toggleMaximize() {
    var popup = ctx.popupEl;
    if (!popup) return;
    var isMax = popup.classList.toggle('maximized');
    var btn = $('g5aiMaxBtn');
    if (btn) btn.innerHTML = isMax ? '<i data-lucide="minimize-2"></i>' : '<i data-lucide="maximize-2"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (ctx.isOpen) setTimeout(positionPopup, 50);
  }

  function closePopup() {
    closeDemoPicker();
    if (ctx.isStreaming) stopStreaming();
    ctx.popupEl.classList.remove('maximized');
    ctx.popupEl.classList.add('closing');
    ctx.fabEl.classList.remove('open');
    setTimeout(function () {
      ctx.popupEl.style.display = 'none';
      ctx.popupEl.classList.remove('closing');
      ctx.isOpen = false;
      scheduleShrink();
    }, 250);
  }

  // ── Render ──────────────────────────────────────
  function renderWelcome() {
    var el = $('g5aiMessages');
    el.innerHTML =
      '<div class="g5ai-welcome">'
      + '<div class="g5ai-welcome-icon"><i data-lucide="bot"></i></div>'
      + '<h3>Halo! Saya ' + esc(AI_NAME) + '</h3>'
      + '<p>Asisten AI untuk membantu mengelola toko Anda. Tanyakan apa saja!</p>'
      + '<div class="g5ai-welcome-chips">'
      + WELCOME_CHIPS.map(function (c) { return '<button class="g5ai-welcome-chip" onclick="window.__g5aiSend(\'' + esc(c).replace(/'/g, "\\'") + '\')">' + esc(c) + '</button>'; }).join('')
      + '</div>'
      + '</div>';
  }

  function copyBotMsg(btn) {
    var msgEl = btn.closest('.g5ai-msg--bot');
    if (!msgEl) return;
    var bodyEl = msgEl.querySelector('.g5ai-msg-body');
    var text = bodyEl ? (bodyEl.textContent || bodyEl.innerText || '') : (msgEl.textContent || msgEl.innerText || '');
    text = text.replace(/\d{1,2}:\d{2}\s*$/, '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      btn.innerHTML = '<i data-lucide="check"></i>';
      btn.classList.add('copied');
      if (typeof lucide !== 'undefined') lucide.createIcons();
      setTimeout(function () {
        btn.innerHTML = '<i data-lucide="copy"></i>';
        btn.classList.remove('copied');
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }, 1500);
    });
  }

  function renderMessages() {
    var el = $('g5aiMessages');
    if (!ctx.messages.length) { renderWelcome(); return; }

    // Find last bot message index for [FEAT 3] regenerate button
    var lastBotMsgIdx = -1;
    for (var bi = ctx.messages.length - 1; bi >= 0; bi--) {
      if (ctx.messages[bi].role === 'bot') { lastBotMsgIdx = bi; break; }
    }

    var html = ctx.messages.map(function (m, idx) {
      var cls = m.role === 'user' ? 'g5ai-msg--user' : 'g5ai-msg--bot';
      if (m.role === 'system') cls = 'g5ai-msg--system';
      var isNew = idx === ctx.messages.length - 1;
      var isStreamMsg = ctx.isStreaming && idx === ctx.messages.length - 1 && m.role === 'bot';
      var content = '';

      if (m.role === 'bot') {
        content = typeof marked !== 'undefined' ? marked.parse(m.text || '') : esc(m.text || '');
      } else {
        content = esc(m.text);
      }

      // Copy button (hide during streaming)
      var copyBtn = '';
      if (m.role === 'bot' && !isStreamMsg) {
        copyBtn = '<button class="g5ai-msg-copy" onclick="window.__g5aiCopy(this)" title="Salin"><i data-lucide="copy"></i></button>';
      }

      // [FEAT 3] Regenerate button — only on LAST bot message
      var regenBtn = '';
      if (m.role === 'bot' && !isStreamMsg && idx === lastBotMsgIdx) {
        regenBtn = '<button class="g5ai-msg-regen" onclick="window.__g5aiRegen()" title="Regenerasi jawaban"><i data-lucide="refresh-cw"></i></button>';
      }

      var streamCls = isStreamMsg ? ' g5ai-streaming' : '';

      // Build action buttons row (below text, never overlap)
      var actionsHtml = '';
      if (regenBtn || copyBtn) {
        actionsHtml = '<div class="g5ai-msg-actions">' + regenBtn + copyBtn + '</div>';
      }

      return '<div class="g5ai-msg ' + cls + (isNew ? ' g5ai-msg--new' : '') + streamCls + '">'
        + '<div class="g5ai-msg-body">' + content + '</div>'
        + actionsHtml
        + '<span class="g5ai-msg-time">' + m.time + '</span>'
        + '</div>';
    }).join('');

    // Follow-ups for last bot message (only if not streaming)
    var lastBot = null;
    for (var i = ctx.messages.length - 1; i >= 0; i--) {
      if (ctx.messages[i].role === 'bot') { lastBot = ctx.messages[i]; break; }
    }
    if (lastBot && lastBot.followups && lastBot.followups.length && !ctx.isStreaming) {
      var chips = lastBot.followups.map(function (q) {
        return '<button class="g5ai-followup-chip" onclick="window.__g5aiSend(\'' + esc(q).replace(/'/g, "\\'") + '\')">'
          + '<i data-lucide="arrow-up-right"></i> ' + esc(q) + '</button>';
      }).join('');
      html += '<div class="g5ai-followups">' + chips + '</div>';
    }

    // Typing indicator (hidden during streaming)
    if (!ctx.isStreaming) {
      html += '<div class="g5ai-typing" id="g5aiTyping"><div class="g5ai-typing-dot"></div><div class="g5ai-typing-dot"></div><div class="g5ai-typing-dot"></div></div>';
    }

    el.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    el.scrollTop = el.scrollHeight;
  }

  function showTyping(show) {
    var el = $('g5aiTyping');
    if (el) el.classList.toggle('show', show);
    if (show) {
      var msgEl = $('g5aiMessages');
      if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
    }
  }

  // ── [FEAT 1] Streaming / Progressive Reveal ─────

  /**
   * Update the streaming message body directly (no full re-render).
   */
  var _streamRenderTimer = null;

  function updateStreamContent(text) {
    clearTimeout(_streamRenderTimer);
    _streamRenderTimer = setTimeout(function () {
      var bodyEl = document.querySelector('.g5ai-msg--bot.g5ai-streaming .g5ai-msg-body');
      if (!bodyEl) return;
      bodyEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(text || '') : esc(text || '');
      var msgEl = $('g5aiMessages');
      if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
    }, 60);
  }

  function finalizeStreamContent(text) {
    clearTimeout(_streamRenderTimer);
    var bodyEl = document.querySelector('.g5ai-msg--bot.g5ai-streaming .g5ai-msg-body');
    if (bodyEl) {
      bodyEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(text || '') : esc(text || '');
    }
    var msgEl = $('g5aiMessages');
    if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
  }

  function showStopButton(show) {
    var btn = $('g5aiStopBtn');
    var sendBtn = $('g5aiSendBtn');
    if (btn) btn.style.display = show ? 'flex' : 'none';
    if (sendBtn) sendBtn.style.display = show ? 'none' : 'flex';
  }

  function setStatusStreaming(isStreaming) {
    var statusText = $('g5aiStatusText');
    if (statusText) statusText.textContent = isStreaming ? 'Mengetik...' : 'Online';
  }

  /**
   * Stop the current streaming/reveal response.
   */
  function stopStreaming() {
    if (!ctx.isStreaming) return;
    if (ctx.streamAbortController) {
      ctx.streamAbortController.abort();
      ctx.streamAbortController = null;
    }
    clearTimeout(ctx._streamRevealTimer);
    clearTimeout(_streamRenderTimer);

    var lastMsg = ctx.messages[ctx.messages.length - 1];
    if (lastMsg && lastMsg.role === 'bot') {
      finalizeStreamContent(lastMsg.text);
      if (!lastMsg.text.trim()) ctx.messages.pop();
    }

    ctx.isStreaming = false;
    showStopButton(false);
    setStatusStreaming(false);
    ctx.isSending = false;
    renderMessages();
    saveChat();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /**
   * [FEAT 1] Progressive reveal — reveals text word by word for non-SSE responses.
   * Gives a streaming-like feel without complex stream parsing.
   */
  function progressiveReveal(fullText, followups, msgIdx) {
    var words = fullText.split(/(\s+)/);
    var currentIdx = 0;
    var accumulated = '';

    ctx.messages[msgIdx] = { role: 'bot', text: '', time: timeStr(), followups: [] };
    ctx.isStreaming = true;
    renderMessages();
    showTyping(false);
    showStopButton(true);
    setStatusStreaming(true);

    function revealNext() {
      if (currentIdx >= words.length || !ctx.isStreaming) {
        // Done or stopped
        ctx.messages[msgIdx].text = accumulated;
        ctx.messages[msgIdx].followups = followups;
        ctx.isStreaming = false;
        showStopButton(false);
        setStatusStreaming(false);
        finalizeStreamContent(accumulated);
        renderMessages();
        saveChat();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }

      // Reveal 2-3 words per tick for natural speed
      var chunk = Math.min(3, words.length - currentIdx);
      for (var i = 0; i < chunk; i++) {
        accumulated += words[currentIdx];
        currentIdx++;
      }

      ctx.messages[msgIdx].text = accumulated;
      updateStreamContent(accumulated);

      // ~20ms per word group
      ctx._streamRevealTimer = setTimeout(revealNext, 20 * chunk);
    }

    revealNext();
  }

  /**
   * [FEAT 1] Handle real SSE streaming response (only when content-type is text/event-stream).
   */
  function handleSSEResponse(res, msgIdx) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var accumulated = '';
    var followups = [];
    var buffer = '';

    ctx.messages[msgIdx] = { role: 'bot', text: '', time: timeStr(), followups: [] };
    ctx.isStreaming = true;
    renderMessages();
    showTyping(false);
    showStopButton(true);
    setStatusStreaming(true);

    reader.read().then(function processResult(result) {
      if (result.done) {
        // Stream complete — finalize
        ctx.messages[msgIdx].text = accumulated;
        ctx.messages[msgIdx].followups = followups;
        ctx.isStreaming = false;
        showStopButton(false);
        setStatusStreaming(false);
        if (!accumulated.trim()) {
          ctx.messages.pop();
        } else {
          finalizeStreamContent(accumulated);
        }
        renderMessages();
        saveChat();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }

      var chunk = decoder.decode(result.value, { stream: true });
      buffer += chunk;

      var lines = buffer.split('\n');
      buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        // SSE format: "data: ..."
        if (line.indexOf('data: ') === 0) {
          var payload = line.substring(6).trim();
          if (payload === '[DONE]') continue;
          try {
            var parsed = JSON.parse(payload);
            var token = parsed.text || parsed.token || parsed.delta || parsed.content
              || parsed.reply || parsed.message || parsed.output || parsed.response || '';
            if (token) {
              accumulated += token;
              ctx.messages[msgIdx].text = accumulated;
              updateStreamContent(accumulated);
            }
            if (parsed.followups || parsed.suggestions || parsed.follow_up) {
              followups = (parsed.followups || parsed.suggestions || parsed.follow_up || [])
                .filter(function (f) { return typeof f === 'string' && f.trim(); }).slice(0, 3);
            }
          } catch (e) {
            if (payload) {
              accumulated += payload;
              ctx.messages[msgIdx].text = accumulated;
              updateStreamContent(accumulated);
            }
          }
        } else if (line.indexOf('data:') === 0) {
          var payload2 = line.substring(5).trim();
          if (payload2 !== '[DONE]' && payload2) {
            accumulated += payload2;
            ctx.messages[msgIdx].text = accumulated;
            updateStreamContent(accumulated);
          }
        } else {
          // Plain text
          accumulated += line;
          ctx.messages[msgIdx].text = accumulated;
          updateStreamContent(accumulated);
        }
      }

      return reader.read().then(processResult);
    }).catch(function (e) {
      if (e.name === 'AbortError') return; // handled by stopStreaming
      console.error('[g5-ai] SSE read error:', e);
      if (!accumulated) {
        ctx.messages[msgIdx].text = 'Maaf, terjadi kesalahan saat menerima respons dari AI.';
      }
      ctx.messages[msgIdx].text = accumulated;
      ctx.messages[msgIdx].followups = followups;
      ctx.isStreaming = false;
      showStopButton(false);
      setStatusStreaming(false);
      if (!accumulated.trim()) ctx.messages.pop();
      else finalizeStreamContent(accumulated);
      renderMessages();
      saveChat();
    });
  }

  // ── Send Message ────────────────────────────────
  async function sendMessage(text) {
    if (ctx.isSending || ctx.isStreaming) return;

    var input = $('g5aiInput');
    var msg = (typeof text === 'string' && text) || (input ? input.value.trim() : '');
    if (!msg) return;

    if (input) { input.value = ''; input.style.height = 'auto'; }

    // Add user message
    ctx.messages.push({ role: 'user', text: msg, time: timeStr() });
    renderMessages();
    saveChat();

    // If no webhook URL
    if (!N8N_G5_AI_URL) {
      showTyping(true);
      setTimeout(function () {
        showTyping(false);
        ctx.messages.push({
          role: 'bot',
          text: 'Webhook belum dikonfigurasi. Set URL n8n di variabel N8N_G5_AI_URL untuk mengaktifkan AI.',
          time: timeStr()
        });
        renderMessages();
      }, 1200);
      return;
    }

    // Send to webhook
    ctx.isSending = true;
    showTyping(true);
    $('g5aiSendBtn').disabled = true;

    // Build history
    var history = ctx.messages
      .filter(function (m) { return m.role === 'user' || m.role === 'bot'; })
      .map(function (m) { return (m.role === 'user' ? 'Customer: ' : 'AI: ') + m.text; });

    try {
      // Build store data context
      var db = (state && state.db) || {};
      var products = (db.products || []).map(function (p) {
        return {
          id: p.id, name: p.name, brand: p.brand, category: p.category,
          price: p.price, discount_price: p.discount_price, discount_percent: p.discount_percent,
          stock: p.stock, sold: p.sold || 0, featured: p.featured, archived: p.archived,
          description: p.description,
          images: (p.images || []).length,
          variants: (p.variants || []).map(function (v) { return { name: v.name, diff: v.diff, stock: v.stock }; }),
        };
      });
      var promos = (db.promos || []).map(function (p) {
        return { id: p.id, title: p.title, description: p.description, active: p.active, sort_order: p.sort_order };
      });
      var branches = (db.branches || []).map(function (b) {
        return { id: b.id, name: b.name, is_default: b.is_default, address: b.address, phone: b.phone, wa_numbers: b.wa_numbers, hours: b.hours };
      });
      var settings = db.settings || {};
      var cats = [];
      products.forEach(function (p) { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });

      // Fetch dengan timeout 60 detik
      ctx.streamAbortController = new AbortController();
      var timeoutId = setTimeout(function () { ctx.streamAbortController.abort(); }, 60000);

      var res = await fetch(N8N_G5_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctx.streamAbortController.signal,
        body: JSON.stringify({
          message: msg,
          session_id: ctx.sessionId,
          history: history,
          stream: true,
          context: {
            store_name: settings.store_name || 'Gadget 5tore',
            role: (state && state.session && state.session.currentUser && state.session.currentUser.role) || 'viewer',
            display_name: (state && state.session && state.session.currentUser && state.session.currentUser.display_name) || '',
            store_data: {
              products: products,
              categories: cats,
              promos: promos,
              branches: branches,
              settings: {
                tagline: settings.tagline || '',
                description: settings.description || '',
                whatsapp: settings.whatsapp || '',
                footer_text: settings.footer_text || '',
              },
            }
          }
        })
      });

      clearTimeout(timeoutId);
      showTyping(false);

      if (!res.ok) {
        var errText = '';
        try { errText = await res.text(); } catch (_) {}
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.substring(0, 200) : ''));
      }

      // ── Determine response type ──
      var contentType = (res.headers.get('content-type') || '').toLowerCase();
      var isSSE = contentType.indexOf('text/event-stream') !== -1;
      var msgIdx = ctx.messages.length;

      if (isSSE) {
        // Real SSE streaming — read body as stream
        handleSSEResponse(res, msgIdx);
      } else {
        // Normal response — read full body, parse as JSON, progressive reveal
        var responseText = await res.text();
        var data = null;
        try { data = JSON.parse(responseText); } catch (e) { /* not JSON */ }

        var reply = '';
        var followups = [];

        if (data && typeof data === 'object') {
          reply = extractReply(data);
          followups = extractFollowups(data);
        } else if (typeof data === 'string') {
          reply = data;
        } else if (responseText) {
          reply = responseText;
        }

        if (!reply) {
          reply = 'Maaf, AI tidak mengembalikan respons yang valid.';
        }

        // Use progressive reveal for visual streaming effect
        progressiveReveal(reply, followups, msgIdx);
      }

      refreshStoreData();
    } catch (e) {
      showTyping(false);
      showStopButton(false);
      setStatusStreaming(false);
      ctx.isStreaming = false;
      clearTimeout(ctx._streamRevealTimer);
      console.error('[g5-ai] webhook error:', e);
      var errMsg = 'Maaf, terjadi kesalahan saat menghubungi AI.';
      if (e.name === 'AbortError') {
        errMsg = 'Maaf, AI tidak merespons dalam 60 detik. Silakan coba lagi.';
      } else if (e.message && e.message.indexOf('Failed to fetch') > -1) {
        errMsg = 'Maaf, tidak bisa terhubung ke server AI. Periksa koneksi internet Anda.';
      } else if (e.message && e.message.indexOf('HTTP ') === 0) {
        errMsg = 'Maaf, server AI mengembalikan error: ' + e.message + '. Coba lagi nanti.';
      }
      ctx.messages.push({ role: 'bot', text: errMsg, time: timeStr() });
      renderMessages();
      saveChat();
    } finally {
      ctx.isSending = false;
      ctx.streamAbortController = null;
      $('g5aiSendBtn').disabled = false;
      // Only reset stop button if not actively streaming/revealing
      if (!ctx.isStreaming) {
        showStopButton(false);
        setStatusStreaming(false);
      }
      if (input) input.focus();
    }
  }

  // ── [FEAT 3] Regenerate Response ─────────────────
  function regenerateResponse() {
    if (ctx.isSending || ctx.isStreaming) return;

    // Find last user message
    var lastUserIdx = -1;
    for (var i = ctx.messages.length - 1; i >= 0; i--) {
      if (ctx.messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;

    // Remove all messages after last user message
    while (ctx.messages.length > lastUserIdx + 1) ctx.messages.pop();

    var userText = ctx.messages[lastUserIdx].text;

    renderMessages();
    saveChat();

    // Add spinning animation
    var regenBtns = document.querySelectorAll('.g5ai-msg-regen');
    regenBtns.forEach(function (b) { b.classList.add('regenerating'); });

    _sendForRegenerate(userText);
  }

  /**
   * Internal: Send AI request for regeneration (without re-adding user message).
   */
  async function _sendForRegenerate(msg) {
    if (!N8N_G5_AI_URL) {
      ctx.messages.push({
        role: 'bot',
        text: 'Webhook belum dikonfigurasi. Set URL n8n di variabel N8N_G5_AI_URL untuk mengaktifkan AI.',
        time: timeStr()
      });
      renderMessages();
      return;
    }

    ctx.isSending = true;
    showTyping(true);
    $('g5aiSendBtn').disabled = true;

    var history = ctx.messages
      .filter(function (m) { return m.role === 'user' || m.role === 'bot'; })
      .map(function (m) { return (m.role === 'user' ? 'Customer: ' : 'AI: ') + m.text; });

    try {
      var db = (state && state.db) || {};
      var products = (db.products || []).map(function (p) {
        return {
          id: p.id, name: p.name, brand: p.brand, category: p.category,
          price: p.price, discount_price: p.discount_price, discount_percent: p.discount_percent,
          stock: p.stock, sold: p.sold || 0, featured: p.featured, archived: p.archived,
          description: p.description,
          images: (p.images || []).length,
          variants: (p.variants || []).map(function (v) { return { name: v.name, diff: v.diff, stock: v.stock }; }),
        };
      });
      var promos = (db.promos || []).map(function (p) {
        return { id: p.id, title: p.title, description: p.description, active: p.active, sort_order: p.sort_order };
      });
      var branches = (db.branches || []).map(function (b) {
        return { id: b.id, name: b.name, is_default: b.is_default, address: b.address, phone: b.phone, wa_numbers: b.wa_numbers, hours: b.hours };
      });
      var settings = db.settings || {};
      var cats = [];
      products.forEach(function (p) { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });

      ctx.streamAbortController = new AbortController();
      var timeoutId = setTimeout(function () { ctx.streamAbortController.abort(); }, 60000);

      var res = await fetch(N8N_G5_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctx.streamAbortController.signal,
        body: JSON.stringify({
          message: msg,
          session_id: ctx.sessionId,
          history: history,
          stream: true,
          context: {
            store_name: settings.store_name || 'Gadget 5tore',
            role: (state && state.session && state.session.currentUser && state.session.currentUser.role) || 'viewer',
            display_name: (state && state.session && state.session.currentUser && state.session.currentUser.display_name) || '',
            store_data: {
              products: products,
              categories: cats,
              promos: promos,
              branches: branches,
              settings: {
                tagline: settings.tagline || '',
                description: settings.description || '',
                whatsapp: settings.whatsapp || '',
                footer_text: settings.footer_text || '',
              },
            }
          }
        })
      });

      clearTimeout(timeoutId);
      showTyping(false);

      if (!res.ok) {
        var errText = '';
        try { errText = await res.text(); } catch (_) {}
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.substring(0, 200) : ''));
      }

      var contentType = (res.headers.get('content-type') || '').toLowerCase();
      var isSSE = contentType.indexOf('text/event-stream') !== -1;
      var msgIdx = ctx.messages.length;

      if (isSSE) {
        handleSSEResponse(res, msgIdx);
      } else {
        var responseText = await res.text();
        var data = null;
        try { data = JSON.parse(responseText); } catch (e) {}

        var reply = '';
        var followups = [];

        if (data && typeof data === 'object') {
          reply = extractReply(data);
          followups = extractFollowups(data);
        } else if (typeof data === 'string') {
          reply = data;
        } else if (responseText) {
          reply = responseText;
        }

        if (!reply) reply = 'Maaf, AI tidak mengembalikan respons yang valid.';
        progressiveReveal(reply, followups, msgIdx);
      }

      refreshStoreData();
    } catch (e) {
      showTyping(false);
      showStopButton(false);
      setStatusStreaming(false);
      ctx.isStreaming = false;
      clearTimeout(ctx._streamRevealTimer);
      console.error('[g5-ai] regenerate error:', e);
      var errMsg = 'Maaf, terjadi kesalahan saat menghubungi AI.';
      if (e.name === 'AbortError') {
        errMsg = 'Maaf, AI tidak merespons dalam 60 detik. Silakan coba lagi.';
      } else if (e.message && e.message.indexOf('Failed to fetch') > -1) {
        errMsg = 'Maaf, tidak bisa terhubung ke server AI. Periksa koneksi internet Anda.';
      } else if (e.message && e.message.indexOf('HTTP ') === 0) {
        errMsg = 'Maaf, server AI mengembalikan error: ' + e.message + '. Coba lagi nanti.';
      }
      ctx.messages.push({ role: 'bot', text: errMsg, time: timeStr() });
      renderMessages();
      saveChat();
    } finally {
      ctx.isSending = false;
      ctx.streamAbortController = null;
      $('g5aiSendBtn').disabled = false;
      if (!ctx.isStreaming) {
        showStopButton(false);
        setStatusStreaming(false);
      }
    }
  }

  function clearChat() {
    if (ctx.isStreaming) stopStreaming();
    ctx.messages = [];
    ctx.sessionId = null;
    clearPersistedChat();
    ctx._chatLoaded = false;
    renderWelcome();
  }

  // ── Watch Dashboard View ───────────────────────
  function watchDashboard() {
    if (ctx.observer) return;
    var dashView = $('view-dashboard');
    if (!dashView) return;

    ctx.observer = new MutationObserver(function () {
      var show = isDashboardActive() && isAllowedRole() && !isChatPanelActive();
      if (ctx.fabEl) ctx.fabEl.style.display = show ? '' : 'none';
      if (!show && ctx.isOpen) closePopup();
    });

    ctx.observer.observe(dashView, { attributes: true, attributeFilter: ['class'] });

    var show = isDashboardActive() && isAllowedRole();
    if (ctx.fabEl) ctx.fabEl.style.display = show ? '' : 'none';
  }

  // ── Watch Login State ──────────────────────────
  function isChatPanelActive() {
    return state && state.admin && state.admin.panel === 'chat';
  }

  function showFabIfAllowed() {
    var show = isDashboardActive() && isAllowedRole() && !isChatPanelActive();
    if (ctx.fabEl) ctx.fabEl.style.display = show ? '' : 'none';
  }

  function watchLoginState() {
    var origDoLogin = window.doLogin;
    var origDoAccessLogin = window.doAccessLogin;
    var origDoVisitorLogin = window.doVisitorLogin;
    var origDoLogout = window.doLogout;

    function afterLogin() {
      setTimeout(showFabIfAllowed, 200);
    }

    if (origDoLogin) {
      window.doLogin = function () { origDoLogin.apply(this, arguments); afterLogin(); };
    }
    if (origDoAccessLogin) {
      window.doAccessLogin = function () { origDoAccessLogin.apply(this, arguments); afterLogin(); };
    }
    if (origDoVisitorLogin) {
      window.doVisitorLogin = function () { origDoVisitorLogin.apply(this, arguments); afterLogin(); };
    }

    window.doLogout = function () {
      if (ctx.isOpen) closePopup();
      if (ctx.isStreaming) stopStreaming();
      ctx.messages = [];
      if (ctx.fabEl) ctx.fabEl.style.display = 'none';
      if (origDoLogout) origDoLogout.apply(this, arguments);
    };
  }

  // ── Close on Escape ────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ctx.isOpen) closePopup();
  });

  // ── PUBLIC API ─────────────────────────────────
  window.__g5aiSend = function (text) { sendMessage(text); };
  window.__g5aiCopy = function (btn) { copyBotMsg(btn); };
  window.__g5aiStop = function () { stopStreaming(); };
  window.__g5aiRegen = function () { regenerateResponse(); };
  window.__g5aiGetHistory = function () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  window.__g5aiClearHistory = function () { clearChat(); };

  // ── INIT ────────────────────────────────────────
  function init() {
    buildUI();
    initDrag();
    watchDashboard();
    watchLoginState();
    console.log('[g5-ai] module loaded (v3 — streaming + history + regenerate)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
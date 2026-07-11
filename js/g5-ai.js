/* ============================================
   g5-ai.js — G5 AI Agent Chatbot (Dashboard Only)
   Gadget 5tore
   ============================================
   - Dashboard-only FAB + popup
   - Kirim ke N8N_G5_AI_URL (webhook)
   - Session only, no DB storage
   - Semua role bisa akses
   ============================================ */

(function () {
  'use strict';
  if (window.__G5AI_LOADED__) return;
  window.__G5AI_LOADED__ = true;

  const $ = (id) => document.getElementById(id);

  // ── Config ──────────────────────────────────────
  var N8N_G5_AI_URL = (typeof window.N8N_G5_AI_URL !== 'undefined') ? window.N8N_G5_AI_URL : '';
  var AI_NAME = 'G5 Assistant';
  var WELCOME_CHIPS = [];

  // ── Internal State ──────────────────────────────
  const ctx = {
    messages: [],
    isOpen: false,
    isSending: false,
    fabEl: null,
    popupEl: null,
    observer: null,
    sessionId: null,
    // Drag state
    drag: {
      active: false,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      moved: false,
      fabX: 0,
      fabY: 0,
      fabW: 56,
      fabH: 56,
    },
  };

  // ── Helpers ─────────────────────────────────────
  function esc(s) {
    if (typeof window.esc === 'function') return window.esc(s);
    const d = document.createElement('div');
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
    var role = state.session.currentUser.role;
    return role === 'admin' || role === 'editor';
  }

  // ── Demo Questions ─────────────────────────────
  var DEMO_QUESTIONS = [
    { cat: '📊 Baca Data Produk', items: [
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
    if (demoPickerOpen) {
      // scroll to top of list
      dd.scrollTop = 0;
    }
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
  var DRAG_THRESHOLD = 6; // px — di bawah ini dianggap klik
  var EDGE_HIDE_RATIO = 0.55; // 55% FAB tersembunyi di balik edge
  var IDLE_BEFORE_HIDE = 3000; // 3 detik idle sebelum nempel ke edge
  var POS_KEY = 'g5ai_fab_pos'; // localStorage key untuk posisi
  var edgeIdleTimer = null;

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

    // Load saved position atau default ke kanan
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

    // Set posisi dari saved/default (override CSS)
    fab.style.bottom = 'auto';
    fab.style.right = 'auto';
    fab.style.left = ctx.drag.fabX + 'px';
    fab.style.top = ctx.drag.fabY + 'px';

    // Mouse
    fab.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // Touch
    fab.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    // Hover: slide out dari edge
    fab.addEventListener('mouseenter', function () {
      if (fab.classList.contains('edge-hidden')) {
        slideOutFromEdge();
        resetIdleTimer();
      }
    });
    fab.addEventListener('mouseleave', function () {
      if (!ctx.isOpen && !ctx.drag.active) {
        scheduleEdgeHide();
      }
    });

    // Hide ke edge setelah animasi masuk
    setTimeout(function () {
      if (!ctx.isOpen) hideToEdge();
    }, 600);
  }

  function getPointerPos(e) {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function onDragStart(e) {
    // Kalau lagi edge-hidden, slide out lalu langsung buka popup
    if (ctx.fabEl.classList.contains('edge-hidden')) {
      slideOutFromEdge();
      cancelEdgeHide();
      // Langsung buka popup setelah slide out selesai (~350ms)
      setTimeout(function () {
        if (!ctx.isOpen) openPopup();
      }, 360);
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

    cancelEdgeHide();
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
    fab.classList.remove('edge-hidden');

    var newX = pos.x - ctx.drag.offsetX;
    var newY = pos.y - ctx.drag.offsetY;

    // Clamp ke viewport
    var maxX = window.innerWidth - ctx.drag.fabW;
    var maxY = window.innerHeight - ctx.drag.fabH;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    ctx.drag.fabX = newX;
    ctx.drag.fabY = newY;

    // Switch ke top/left positioning
    fab.style.bottom = 'auto';
    fab.style.right = 'auto';
    fab.style.left = newX + 'px';
    fab.style.top = newY + 'px';

    // Update popup position real-time kalau sedang buka
    if (ctx.isOpen) {
      positionPopup();
    }
  }

  function onDragEnd(e) {
    if (!ctx.drag.active) return;
    ctx.drag.active = false;

    var fab = ctx.fabEl;
    fab.classList.remove('dragging');

    // Kalau gak ada gerakan signifikan → anggap klik
    if (!ctx.drag.moved) {
      togglePopup();
      return;
    }

    // Snap ke edge kiri/kanan
    snapToEdge();
    saveFabPos();
    // Setelah snap, hide ke edge setelah delay
    if (!ctx.isOpen) {
      setTimeout(hideToEdge, 800);
    }
  }

  function snapToEdge() {
    var fab = ctx.fabEl;
    var centerX = ctx.drag.fabX + ctx.drag.fabW / 2;
    var vw = window.innerWidth;
    var margin = 12;

    // Tentukan snap ke kiri atau kanan
    var snapLeft = margin;
    var snapRight = vw - ctx.drag.fabW - margin;
    var targetX = centerX < vw / 2 ? snapLeft : snapRight;

    // Keep Y position, clamp ke viewport
    var targetY = Math.max(margin, Math.min(ctx.drag.fabY, window.innerHeight - ctx.drag.fabH - margin));

    ctx.drag.fabX = targetX;
    ctx.drag.fabY = targetY;

    fab.style.transition = 'left 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), top 0.35s cubic-bezier(0.25, 0.8, 0.25, 1)';
    fab.style.left = targetX + 'px';
    fab.style.top = targetY + 'px';

    setTimeout(function () {
      fab.style.transition = '';
    }, 380);

    // Update snap class buat popup positioning
    fab.classList.toggle('snapped-left', targetX <= vw / 2);
    fab.classList.toggle('snapped-right', targetX > vw / 2);

    saveFabPos();

    // Update popup kalau buka
    if (ctx.isOpen) {
      setTimeout(positionPopup, 380);
    }
  }

  // ── Edge Hiding ──────────────────────────────────
  function hideToEdge() {
    if (ctx.isOpen || ctx.drag.active) return;
    var fab = ctx.fabEl;
    if (!fab) return;

    var isLeft = fab.classList.contains('snapped-left');
    var hideX;

    if (isLeft) {
      // Sembunyikan ke kiri — geser keluar layar kiri
      hideX = -(ctx.drag.fabW * EDGE_HIDE_RATIO);
    } else {
      // Sembunyikan ke kanan — geser keluar layar kanan
      hideX = window.innerWidth - ctx.drag.fabW * (1 - EDGE_HIDE_RATIO);
    }

    ctx.drag.fabX = hideX;
    fab.style.transition = 'left 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    fab.style.left = hideX + 'px';
    fab.classList.add('edge-hidden');

    setTimeout(function () {
      fab.style.transition = '';
    }, 420);
  }

  function slideOutFromEdge() {
    var fab = ctx.fabEl;
    if (!fab || !fab.classList.contains('edge-hidden')) return;

    var isLeft = fab.classList.contains('snapped-left');
    var vw = window.innerWidth;
    var margin = 12;
    var snapX = isLeft ? margin : (vw - ctx.drag.fabW - margin);

    ctx.drag.fabX = snapX;
    fab.style.transition = 'left 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.1)';
    fab.style.left = snapX + 'px';
    fab.classList.remove('edge-hidden');

    setTimeout(function () {
      fab.style.transition = '';
    }, 380);
  }

  function scheduleEdgeHide() {
    cancelEdgeHide();
    edgeIdleTimer = setTimeout(function () {
      hideToEdge();
    }, IDLE_BEFORE_HIDE);
  }

  function cancelEdgeHide() {
    if (edgeIdleTimer) {
      clearTimeout(edgeIdleTimer);
      edgeIdleTimer = null;
    }
  }

  function resetIdleTimer() {
    cancelEdgeHide();
  }

  // ── Popup Positioning ──────────────────────────
  function positionPopup() {
    var fab = ctx.fabEl;
    var popup = ctx.popupEl;
    if (!fab || !popup) return;

    // Reset inline sizing — biar CSS yang handle height/maxHeight
    popup.style.height = '';
    popup.style.maxHeight = '';

    var rect = fab.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var isMobile = vw <= 480;
    var MARGIN = 8;

    if (isMobile) {
      // Mobile: full width, di atas FAB
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

      // Tentukan popup di kiri atau kanan FAB
      var fabCenterX = rect.left + rect.width / 2;
      var popupLeft, popupRight;

      if (fabCenterX < vw / 2) {
        // FAB di kiri → popup di kanan FAB
        popupLeft = rect.right + popupMargin;
        popupRight = 'auto';
        if (popupLeft + popupW > vw - MARGIN) {
          popupLeft = Math.max(MARGIN, rect.left - popupW - popupMargin);
        }
        if (popupLeft < MARGIN) {
          popupLeft = MARGIN;
          popupW = Math.min(popupW, vw - MARGIN * 2);
        }
      } else {
        // FAB di kanan → popup di kiri FAB
        popupLeft = 'auto';
        popupRight = vw - rect.left + popupMargin;
        var neededLeft = vw - popupRight - popupW;
        if (neededLeft < MARGIN) {
          popupRight = 'auto';
          popupLeft = Math.max(MARGIN, rect.right + popupMargin);
          if (popupLeft + popupW > vw - MARGIN) {
            popupLeft = MARGIN;
            popupW = Math.min(popupW, vw - MARGIN * 2);
          }
        }
      }

      // Vertical: popup muncul di atas FAB, di-clamp biar gak keluar layar
      var popupBottom = vh - rect.top + 8;
      // Clamp: top edge popup >= MARGIN
      // top edge = vh - popupBottom - popupMaxH >= MARGIN
      var maxBottom = vh - popupMaxH - MARGIN;
      if (popupBottom > maxBottom) {
        popupBottom = maxBottom;
      }
      if (popupBottom < MARGIN) {
        popupBottom = MARGIN;
      }

      popup.style.left = popupLeft === 'auto' ? 'auto' : popupLeft + 'px';
      popup.style.right = popupRight === 'auto' ? 'auto' : popupRight + 'px';
      popup.style.bottom = popupBottom + 'px';
      popup.style.top = 'auto';
      popup.style.width = popupW + 'px';

      // transform-origin sesuai posisi
      if (fabCenterX < vw / 2) {
        popup.style.transformOrigin = 'bottom left';
      } else {
        popup.style.transformOrigin = 'bottom right';
      }
    }
  }

  // ── Build DOM ───────────────────────────────────
  function buildUI() {
    if (ctx.fabEl) return;

    // FAB
    var fab = document.createElement('button');
    fab.className = 'g5ai-fab';
    fab.id = 'g5aiFab';
    fab.title = 'G5 Assistant';
    fab.innerHTML = '<i data-lucide="bot" class="g5ai-fab-icon"></i><span class="g5ai-fab-badge" id="g5aiFabBadge">0</span>';
    // Jangan pakai onclick langsung — drag handler akan handle klik
    document.body.appendChild(fab);
    ctx.fabEl = fab;

    // Popup
    var popup = document.createElement('div');
    popup.className = 'g5ai-popup';
    popup.id = 'g5aiPopup';
    popup.style.display = 'none';
    popup.innerHTML =
      '<div class="g5ai-header">'
      + '<div class="g5ai-header-avatar"><i data-lucide="bot"></i></div>'
      + '<div class="g5ai-header-info">'
      + '<div class="g5ai-header-name">' + esc(AI_NAME) + '</div>'
      + '<div class="g5ai-header-status"><span class="g5ai-status-dot"></span> Online</div>'
      + '</div>'
      + '<button class="g5ai-header-demo" id="g5aiDemoBtn" title="Demo Pertanyaan"><i data-lucide="list-checks"></i></button>'
      + '<button class="g5ai-header-clear" id="g5aiClearBtn" title="Hapus riwayat"><i data-lucide="trash-2"></i></button>'
      + '<button class="g5ai-header-maximize" id="g5aiMaxBtn" title="Perbesar"><i data-lucide="maximize-2"></i></button>'
      + '<button class="g5ai-header-close" id="g5aiCloseBtn" title="Tutup"><i data-lucide="x"></i></button>'
      + '</div>'
      + buildDemoPickerHTML()
      + '<div class="g5ai-messages" id="g5aiMessages"></div>'
      + '<div class="g5ai-input-area">'
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

    // Demo picker events
    $('g5aiDemoBtn').onclick = function (e) {
      e.stopPropagation();
      toggleDemoPicker();
    };
    $('g5aiDemoList').addEventListener('click', function (e) {
      var item = e.target.closest('.g5ai-demo-item');
      if (item) {
        pickDemoQuestion(item.getAttribute('data-q'));
      }
    });
    $('g5aiDemoSearch').addEventListener('input', function () {
      var q = this.value.toLowerCase();
      var items = $('g5aiDemoList').querySelectorAll('.g5ai-demo-item');
      var cats = $('g5aiDemoList').querySelectorAll('.g5ai-demo-cat');
      var lastCatIdx = -1;
      items.forEach(function (item) {
        var show = !q || item.getAttribute('data-q').toLowerCase().indexOf(q) !== -1;
        item.style.display = show ? '' : 'none';
        if (show) {
          // show parent category
          var prev = item.previousElementSibling;
          while (prev) {
            if (prev.classList.contains('g5ai-demo-cat')) { prev.style.display = ''; break; }
            prev = prev.previousElementSibling;
          }
        }
      });
      // hide empty categories
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
    // close demo picker when clicking outside
    document.addEventListener('click', function (e) {
      if (demoPickerOpen && !e.target.closest('.g5ai-demo-picker') && !e.target.closest('#g5aiDemoBtn')) {
        closeDemoPicker();
      }
    });
  }

  // ── Toggle Popup ────────────────────────────────
  function togglePopup() {
    if (ctx.isOpen) {
      closePopup();
    } else {
      openPopup();
    }
  }

  function openPopup() {
    // Pastikan FAB keluar dari edge dulu
    slideOutFromEdge();
    cancelEdgeHide();

    ctx.isOpen = true;
    ctx.popupEl.style.display = 'flex';
    ctx.popupEl.classList.remove('closing');
    ctx.fabEl.classList.add('open');

    // Position popup berdasarkan posisi FAB
    setTimeout(positionPopup, 100);

    // Buat session_id konsisten sekali per sesi chat
    if (!ctx.sessionId) {
      ctx.sessionId = 'g5ai_' + Date.now();
    }

    if (!ctx.messages.length) {
      renderWelcome();
    }
    setTimeout(function () {
      $('g5aiInput').focus();
    }, 150);
  }

  function toggleMaximize() {
    var popup = ctx.popupEl;
    if (!popup) return;
    var isMax = popup.classList.toggle('maximized');
    var btn = $('g5aiMaxBtn');
    if (btn) btn.innerHTML = isMax ? '<i data-lucide="minimize-2"></i>' : '<i data-lucide="maximize-2"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    // Re-position popup after size change
    if (ctx.isOpen) setTimeout(positionPopup, 50);
  }

  function closePopup() {
    closeDemoPicker();
    ctx.popupEl.classList.remove('maximized');
    ctx.popupEl.classList.add('closing');
    ctx.fabEl.classList.remove('open');
    setTimeout(function () {
      ctx.popupEl.style.display = 'none';
      ctx.popupEl.classList.remove('closing');
      ctx.isOpen = false;
      // Setelah tutup, hide FAB ke edge
      scheduleEdgeHide();
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

  function renderMessages() {
    var el = $('g5aiMessages');
    if (!ctx.messages.length) { renderWelcome(); return; }

    var html = ctx.messages.map(function (m, idx) {
  var cls = m.role === 'user' ? 'g5ai-msg--user' : 'g5ai-msg--bot';
  if (m.role === 'system') cls = 'g5ai-msg--system';
  // FIX: Hanya pesan terakhir yang dapat animasi (--new), cegah overlap
  var isNew = idx === ctx.messages.length - 1;
  var content = m.role === 'bot' && typeof marked !== 'undefined'
    ? marked.parse(m.text)
    : esc(m.text);
  return '<div class="g5ai-msg ' + cls + (isNew ? ' g5ai-msg--new' : '') + '">'
    + content
    + '<span class="g5ai-msg-time">' + m.time + '</span>'
    + '</div>';
}).join('');

    // Add typing indicator placeholder
    html += '<div class="g5ai-typing" id="g5aiTyping"><div class="g5ai-typing-dot"></div><div class="g5ai-typing-dot"></div><div class="g5ai-typing-dot"></div></div>';

    el.innerHTML = html;
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

  // ── Send Message ────────────────────────────────
  async function sendMessage(text) {
    if (ctx.isSending) return;

    var input = $('g5aiInput');
    var msg = (typeof text === 'string' && text) || (input ? input.value.trim() : '');
    if (!msg) return;

    if (input) { input.value = ''; input.style.height = 'auto'; }

    // Add user message
    ctx.messages.push({ role: 'user', text: msg, time: timeStr() });
    renderMessages();

    // If no webhook URL, show placeholder response
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

    // Build history dari pesan sebelumnya (skip system messages)
      var history = ctx.messages
        .filter(function (m) { return m.role === 'user' || m.role === 'bot'; })
        .map(function (m) {
          return (m.role === 'user' ? 'Customer: ' : 'AI: ') + m.text;
        });

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

      var res = await fetch(N8N_G5_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          session_id: ctx.sessionId,
          history: history,
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

      showTyping(false);

      if (!res.ok) throw new Error('HTTP ' + res.status);

      var data = await res.json();
      var reply = '';

      // Support various webhook response formats
      if (typeof data === 'string') {
        reply = data;
      } else if (data.reply) {
        reply = data.reply;
      } else if (data.message) {
        reply = data.message;
      } else if (data.output) {
        reply = data.output;
      } else if (data.text) {
        reply = data.text;
      } else if (data.response) {
        reply = data.response;
      } else {
        reply = JSON.stringify(data);
      }

      // Cleanup: kalau reply masih berisi JSON mentah di awal, extract reply-nya aja
      if (reply && typeof reply === 'string' && reply.trim().startsWith('{')) {
        try {
          var parsed = JSON.parse(reply);
          if (parsed.reply) reply = parsed.reply;
        } catch (e) { /* bukan JSON valid, biarin apa adanya */ }
      }
      // Cleanup: kalau reply mengandung blok JSON di awal sebelum teks asli
      if (reply && typeof reply === 'string') {
        reply = reply.replace(/^\s*\{[\s\S]*?\}\s*\n*/, '').trim();
      }

      ctx.messages.push({ role: 'bot', text: reply, time: timeStr() });
      renderMessages();
    } catch (e) {
      showTyping(false);
      console.error('[g5-ai] webhook error:', e);
      ctx.messages.push({
        role: 'bot',
        text: 'Maaf, terjadi kesalahan saat menghubungi AI. Pastikan webhook URL benar dan aktif.',
        time: timeStr()
      });
      renderMessages();
    } finally {
      ctx.isSending = false;
      $('g5aiSendBtn').disabled = false;
      if (input) input.focus();
    }
  }

  function clearChat() {
    ctx.messages = [];
    ctx.sessionId = null;  // reset session, chat baru = konteks baru
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

    // Initial check
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
      window.doLogin = function () {
        origDoLogin.apply(this, arguments);
        afterLogin();
      };
    }
    if (origDoAccessLogin) {
      window.doAccessLogin = function () {
        origDoAccessLogin.apply(this, arguments);
        afterLogin();
      };
    }
    if (origDoVisitorLogin) {
      window.doVisitorLogin = function () {
        origDoVisitorLogin.apply(this, arguments);
        afterLogin();
      };
    }

    window.doLogout = function () {
      if (ctx.isOpen) closePopup();
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

  /**
   * Kirim pesan dari welcome chip.
   */
  window.__g5aiSend = function (text) {
    sendMessage(text);
  };

  // ── INIT ────────────────────────────────────────
  function init() {
    buildUI();
    initDrag();
    watchDashboard();
    watchLoginState();
    console.log('[g5-ai] module loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
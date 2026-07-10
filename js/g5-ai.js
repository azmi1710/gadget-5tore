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
  var AI_NAME = 'G5 AI';
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
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    edge: 'right',
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
    html += '<div class="g5ai-demo-search"><i class="fas fa-search"></i><input type="text" id="g5aiDemoSearch" placeholder="Cari pertanyaan..."></div>';
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

  // ── Build DOM ───────────────────────────────────
  function buildUI() {
    if (ctx.fabEl) return;

    // FAB (bubble)
    var fab = document.createElement('div');
    fab.className = 'g5ai-fab';
    fab.id = 'g5aiFab';
    fab.title = 'G5 AI Assistant';
    fab.innerHTML = '<i class="fas fa-robot g5ai-fab-icon"></i><span class="g5ai-fab-badge" id="g5aiFabBadge">0</span>';
    document.body.appendChild(fab);
    ctx.fabEl = fab;

    // Restore saved position
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('g5ai_bubble_pos')); } catch (e) { /* */ }
    if (saved) {
      ctx.edge = saved.edge || 'right';
      positionBubble(saved.y, saved.edge);
    } else {
      positionBubble(window.innerHeight * 0.5, 'right');
    }

    // Click to open (primary)
    fab.addEventListener('click', function (e) {
      if (ctx._wasDragged) { ctx._wasDragged = false; return; }
      togglePopup();
    });
    // Drag events
    fab.addEventListener('mousedown', onFabDown);
    fab.addEventListener('touchstart', onFabDown, { passive: false });

    // Popup
    var popup = document.createElement('div');
    popup.className = 'g5ai-popup';
    popup.id = 'g5aiPopup';
    popup.style.display = 'none';
    popup.innerHTML =
      '<div class="g5ai-header">'
      + '<div class="g5ai-header-avatar"><i class="fas fa-robot"></i></div>'
      + '<div class="g5ai-header-info">'
      + '<div class="g5ai-header-name">' + esc(AI_NAME) + '</div>'
      + '<div class="g5ai-header-status"><span class="g5ai-status-dot"></span> Online</div>'
      + '</div>'
      + '<button class="g5ai-header-demo" id="g5aiDemoBtn" title="Demo Pertanyaan"><i class="fas fa-list-check"></i></button>'
      + '<button class="g5ai-header-clear" id="g5aiClearBtn" title="Hapus riwayat"><i class="fas fa-trash-alt"></i></button>'
      + '<button class="g5ai-header-close" id="g5aiCloseBtn" title="Tutup"><i class="fas fa-xmark"></i></button>'
      + '</div>'
      + buildDemoPickerHTML()
      + '<div class="g5ai-messages" id="g5aiMessages"></div>'
      + '<div class="g5ai-input-area">'
      + '<textarea class="g5ai-input" id="g5aiInput" placeholder="Tanya apa saja tentang toko..." rows="1"></textarea>'
      + '<button class="g5ai-send" id="g5aiSendBtn" title="Kirim"><i class="fas fa-paper-plane"></i></button>'
      + '</div>';
    document.body.appendChild(popup);
    ctx.popupEl = popup;

    // Events
    $('g5aiSendBtn').onclick = function () { sendMessage(); };
    $('g5aiInput').onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };
    $('g5aiInput').oninput = function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    };
    $('g5aiClearBtn').onclick = clearChat;
    $('g5aiCloseBtn').onclick = function (e) {
      e.stopPropagation();
      closePopup();
    };

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

  // ── Bubble Positioning & Drag ──────────────────
  function positionBubble(y, edge) {
    var b = ctx.fabEl;
    if (!b) return;
    var h = b.offsetHeight || 38;
    y = Math.max(10, Math.min(y, window.innerHeight - h - 10));
    ctx.edge = edge;
    b.style.top = y + 'px';
    b.style.left = edge === 'left' ? '0' : 'auto';
    b.style.right = edge === 'right' ? '0' : 'auto';
    b.style.borderRadius = edge === 'right' ? '50% 0 0 50%' : '0 50% 50% 0';
  }

  function saveBubblePos() {
    try {
      localStorage.setItem('g5ai_bubble_pos', JSON.stringify({
        y: parseFloat(ctx.fabEl.style.top),
        edge: ctx.edge
      }));
    } catch (e) { /* */ }
  }

  function positionPopup() {
    var p = ctx.popupEl;
    var b = ctx.fabEl;
    if (!p || !b) return;
    var bRect = b.getBoundingClientRect();
    var pW = p.offsetWidth || 400;
    var pH = p.offsetHeight || 540;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var gap = 12;

    // Clear all position
    p.style.top = '';
    p.style.bottom = '';
    p.style.left = '';
    p.style.right = '';

    if (vw <= 480) {
      // Full width on mobile
      p.style.left = '0';
      p.style.right = '0';
      p.style.bottom = '0';
      p.style.top = 'auto';
      return;
    }

    if (vw <= 768) {
      // Nearly full width on tablet
      p.style.left = '8px';
      p.style.right = '8px';
      p.style.bottom = '10px';
      p.style.top = 'auto';
      return;
    }

    // Desktop: position next to bubble
    if (ctx.edge === 'right') {
      p.style.right = gap + 'px';
      p.style.left = 'auto';
    } else {
      p.style.left = gap + 'px';
      p.style.right = 'auto';
    }

    // Vertically center near bubble, but constrain
    var bCenter = bRect.top + bRect.height / 2;
    var top = bCenter - pH / 2;
    top = Math.max(10, Math.min(top, vh - pH - 10));
    p.style.top = top + 'px';
    p.style.bottom = 'auto';
  }

  function onFabDown(e) {
    ctx.dragging = true;
    ctx.moved = false;
    ctx._wasDragged = false;
    var pt = e.touches ? e.touches[0] : e;
    ctx.startX = pt.clientX;
    ctx.startY = pt.clientY;
    var rect = ctx.fabEl.getBoundingClientRect();
    ctx.startLeft = rect.left;
    ctx.startTop = rect.top;
    document.addEventListener('mousemove', onFabMove);
    document.addEventListener('mouseup', onFabUp);
    document.addEventListener('touchmove', onFabMove, { passive: false });
    document.addEventListener('touchend', onFabUp);
  }

  function onFabMove(e) {
    if (!ctx.dragging) return;
    e.preventDefault();
    var pt = e.touches ? e.touches[0] : e;
    var dx = pt.clientX - ctx.startX;
    var dy = pt.clientY - ctx.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) ctx.moved = true;
    var b = ctx.fabEl;
    var h = b.offsetHeight || 38;
    var newY = Math.max(10, Math.min(ctx.startTop + dy, window.innerHeight - h - 10));
    var newX = Math.max(0, Math.min(ctx.startLeft + dx, window.innerWidth - h));
    b.style.top = newY + 'px';
    b.style.left = newX + 'px';
    b.style.right = 'auto';
    b.style.borderRadius = '50%';
  }

  function onFabUp(e) {
    if (!ctx.dragging) return;
    ctx.dragging = false;
    document.removeEventListener('mousemove', onFabMove);
    document.removeEventListener('mouseup', onFabUp);
    document.removeEventListener('touchmove', onFabMove);
    document.removeEventListener('touchend', onFabUp);

    if (ctx.moved) {
      ctx._wasDragged = true;
      // Snap to nearest edge
      var rect = ctx.fabEl.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var edge = centerX < window.innerWidth / 2 ? 'left' : 'right';
      positionBubble(rect.top, edge);
      saveBubblePos();
    }
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
    ctx.isOpen = true;
    ctx.popupEl.style.display = 'flex';
    ctx.popupEl.classList.remove('closing');
    ctx.fabEl.classList.add('open');
    positionPopup();

    // Buat session_id konsisten sekali per sesi chat
    if (!ctx.sessionId) {
      ctx.sessionId = 'g5ai_' + Date.now();
    }

    if (!ctx.messages.length) {
      renderWelcome();
    }
    setTimeout(function () {
      $('g5aiInput').focus();
    }, 100);
  }

  function closePopup() {
    closeDemoPicker();
    ctx.popupEl.classList.add('closing');
    ctx.fabEl.classList.remove('open');
    setTimeout(function () {
      ctx.popupEl.style.display = 'none';
      ctx.popupEl.classList.remove('closing');
      ctx.isOpen = false;
    }, 250);
  }

  // ── Render ──────────────────────────────────────
  function renderWelcome() {
    var el = $('g5aiMessages');
    el.innerHTML =
      '<div class="g5ai-welcome">'
      + '<div class="g5ai-welcome-icon"><i class="fas fa-robot"></i></div>'
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

    var html = ctx.messages.map(function (m) {
  var cls = m.role === 'user' ? 'g5ai-msg--user' : 'g5ai-msg--bot';
  if (m.role === 'system') cls = 'g5ai-msg--system';
  var content = m.role === 'bot' && typeof marked !== 'undefined'
    ? marked.parse(m.text)
    : esc(m.text);
  return '<div class="g5ai-msg ' + cls + '">'
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
      showFabIfAllowed();
      if (!isDashboardActive() && ctx.isOpen) closePopup();
    });

    ctx.observer.observe(dashView, { attributes: true, attributeFilter: ['class'] });

    // Also hook renderDash to catch panel switches
    var origRD = window.renderDash;
    if (origRD) {
      window.renderDash = function () {
        origRD.apply(this, arguments);
        showFabIfAllowed();
      };
    }

    // Initial check
    showFabIfAllowed();
  }

  // ── Watch Login State ──────────────────────────
  function isChatPanelActive() {
    return state && state.admin && state.admin.panel === 'chat';
  }

function showFabIfAllowed() {
  var show = isDashboardActive() && isAllowedRole() && !isChatPanelActive();
  if (ctx.fabEl) ctx.fabEl.style.display = show ? 'flex' : 'none';
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

  // ── Close on click outside popup ─────────────
  document.addEventListener('mousedown', function (e) {
    if (!ctx.isOpen) return;
    if (ctx.popupEl.contains(e.target)) return;
    if (ctx.fabEl && ctx.fabEl.contains(e.target)) return;
    closePopup();
  });
  document.addEventListener('touchstart', function (e) {
    if (!ctx.isOpen) return;
    if (ctx.popupEl.contains(e.target)) return;
    if (ctx.fabEl && ctx.fabEl.contains(e.target)) return;
    closePopup();
  }, { passive: true });

  // Reposition popup on resize
  window.addEventListener('resize', function () {
    if (ctx.isOpen) positionPopup();
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
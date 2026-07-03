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
  var WELCOME_CHIPS = [
    'Stok produk apa yang kurang?',
    'Buat ringkasan penjualan',
    'Tips meningkatkan penjualan',
  ];

  // ── Internal State ──────────────────────────────
  const ctx = {
    messages: [],
    isOpen: false,
    isSending: false,
    fabEl: null,
    popupEl: null,
    observer: null,
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
    return true; // semua role bisa akses
  }

  // ── Build DOM ───────────────────────────────────
  function buildUI() {
    if (ctx.fabEl) return;

    // FAB
    var fab = document.createElement('button');
    fab.className = 'g5ai-fab';
    fab.id = 'g5aiFab';
    fab.title = 'G5 AI Assistant';
    fab.innerHTML = '<i class="fas fa-robot g5ai-fab-icon"></i><span class="g5ai-fab-badge" id="g5aiFabBadge">0</span>';
    fab.onclick = togglePopup;
    document.body.appendChild(fab);
    ctx.fabEl = fab;

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
      + '<button class="g5ai-header-clear" id="g5aiClearBtn" title="Hapus riwayat"><i class="fas fa-trash-alt"></i></button>'
      + '</div>'
      + '<div class="g5ai-messages" id="g5aiMessages"></div>'
      + '<div class="g5ai-input-area">'
      + '<textarea class="g5ai-input" id="g5aiInput" placeholder="Tanya apa saja tentang toko..." rows="1"></textarea>'
      + '<button class="g5ai-send" id="g5aiSendBtn" title="Kirim"><i class="fas fa-paper-plane"></i></button>'
      + '</div>';
    document.body.appendChild(popup);
    ctx.popupEl = popup;

    // Events
    $('g5aiSendBtn').onclick = sendMessage;
    $('g5aiInput').onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };
    $('g5aiInput').oninput = function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    };
    $('g5aiClearBtn').onclick = clearChat;
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

    if (!ctx.messages.length) {
      renderWelcome();
    }
    setTimeout(function () {
      $('g5aiInput').focus();
    }, 100);
  }

  function closePopup() {
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
      return '<div class="g5ai-msg ' + cls + '">'
        + esc(m.text)
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
    var msg = text || (input ? input.value.trim() : '');
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

    try {
      var res = await fetch(N8N_G5_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          session_id: 'g5ai_' + Date.now(),
          context: {
            store_name: (state && state.db && state.db.settings && state.db.settings.store_name) || 'Gadget 5tore',
            role: (state && state.session && state.session.currentUser && state.session.currentUser.role) || 'viewer',
            display_name: (state && state.session && state.session.currentUser && state.session.currentUser.display_name) || '',
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
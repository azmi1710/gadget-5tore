
(function () {
  'use strict';
  if (window.__LIVECHAT_LOADED__) return;
  window.__LIVECHAT_LOADED__ = true;

  var $ = function (id) { return document.getElementById(id); };

  // ── Config ──────────────────────────────────────
  var N8N_LIVE_CHAT_URL = window.N8N_LIVE_CHAT_URL || '';
  var LS_KEY = 'g5chat_session';

  // ── Internal State ──────────────────────────────
  var ctx = {
    // Customer
    fabEl: null,
    popupEl: null,
    isOpen: false,
    sessionId: null,
    customerName: '',
    customerPhone: '',
    rtChannel: null,
    messages: [],
    pendingMessage: null,
    _typingChannel: null,
    _adminTypingTimer: null,
    _customerTypingCh: null,
    _customerTypingTimer: null,

    // Admin
    activeSessionId: null,
    adminRtChannel: null,
    sessions: [],
    adminMessages: {},
    inboxObserver: null,
    activeTab: 'active',
    closedSessions: [],
    closedCount: 0,
    activeFilter: null, // null = all, 'ai', 'connecting', 'admin'
    _inboxObsSetup: false,
    _naggingTimer: null,
    // Admin typing broadcast
    adminTypingCh: null,
    _lastTypingSession: null,
    _customerTypingCh: null,
    _customerTypingTimer: null,
  };

  // ── Helpers ─────────────────────────────────────
  function esc(s) {
    if (typeof window.esc === 'function') return window.esc(s);
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function timeStr(date) {
    var d = date || new Date();
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var now = new Date();
    var diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Baru saja';
    if (diff < 3600) return Math.floor(diff / 60) + 'm lalu';
    if (diff < 86400) return Math.floor(diff / 3600) + 'j lalu';
    return Math.floor(diff / 86400) + 'h lalu';
  }

  // ── Waiting Time Helper (untuk mode 'connecting') ──
  function waitingMinutes(dateStr) {
    if (!dateStr) return 0;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  }

  function waitingTimeStr(dateStr) {
    var m = waitingMinutes(dateStr);
    if (m < 1) return 'Baru saja';
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    var rm = m % 60;
    return h + 'j' + (rm > 0 ? rm + 'm' : '');
  }

  function getAdminName() {
    if (typeof window.__presenceGetMyName === 'function') {
      return window.__presenceGetMyName();
    }
    return (state && state.session && state.session.currentUser && state.session.currentUser.display_name) || 'Admin';
  }

  function getMyId() {
    // Unique per tab session
    return (state && state.session && state.session.currentUser) ?
      ('admin_' + state.session.currentUser.id + '_' + Date.now()) :
      'customer_' + Date.now();
  }

  // ═══════════════════════════════════════════════════
  //  CUSTOMER SIDE
  // ═══════════════════════════════════════════════════

  // ── Load session from localStorage ──────────────
  function loadCustomerSession() {
    try {
      var saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (saved && saved.sessionId && saved.name) {
        ctx.sessionId = saved.sessionId;
        ctx.customerName = saved.name;
        ctx.customerPhone = saved.phone || '';
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function saveCustomerSession() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        sessionId: ctx.sessionId,
        name: ctx.customerName,
        phone: ctx.customerPhone,
      }));
    } catch (e) { /* ignore */ }
  }

  function clearCustomerSession() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
  }

  async function createNewSession() {
    if (!state || !state.session || !state.session.sb) return null;
    try {
      var { data, error } = await state.session.sb
        .from('chat_sessions')
        .insert([{
          customer_name: ctx.customerName || 'Customer',
          customer_phone: ctx.customerPhone || '',
          mode: 'ai',
          status: 'active',
        }])
        .select()
        .single();

      if (error) throw error;
      ctx.sessionId = data.session_id;
      saveCustomerSession();
      return data;
    } catch (e) {
      console.error('[live-chat] create session error:', e);
      try { ctx.sessionId = crypto.randomUUID(); } catch (ex) { /* ignore */ }
      saveCustomerSession();
      return null;
    }
  }

  // ── Build Customer UI ──────────────────────────
  function buildCustomerUI() {
    if (ctx.fabEl) return;

    // FAB
    var fab = document.createElement('button');
    fab.className = 'lc-fab';
    fab.id = 'lcFab';
    fab.title = 'Live Chat';
    fab.innerHTML = '<i data-lucide="messages-square" class="lc-fab-icon"></i><span class="lc-fab-badge" id="lcFabBadge">0</span>';
    fab.onclick = toggleCustomerPopup;
    document.body.appendChild(fab);
    ctx.fabEl = fab;

    // Popup
    var popup = document.createElement('div');
    popup.className = 'lc-popup';
    popup.id = 'lcPopup';
    popup.style.display = 'none';
    document.body.appendChild(popup);
    ctx.popupEl = popup;

    // Watch catalog/dashboard view to show/hide FAB
    var catalogView = $('view-catalog');
    var dashView = $('view-dashboard');
    if (catalogView) {
      function shouldShowFab() {
        // Jika sedang di dashboard, jangan tampilkan FAB customer
        if (dashView && dashView.classList.contains('active')) return false;
        return catalogView.classList.contains('active');
      }

      // Watch catalog view
      var obs1 = new MutationObserver(function () {
        var show = shouldShowFab();
        fab.style.display = show ? '' : 'none';
        if (!show && ctx.isOpen) closeCustomerPopup();
      });
      obs1.observe(catalogView, { attributes: true, attributeFilter: ['class'] });

      // Watch dashboard view juga (biar pas pindah dari dashboard ke katalog, FAB muncul)
      if (dashView) {
        var obs2 = new MutationObserver(function () {
          var show = shouldShowFab();
          fab.style.display = show ? '' : 'none';
          if (!show && ctx.isOpen) closeCustomerPopup();
        });
        obs2.observe(dashView, { attributes: true, attributeFilter: ['class'] });
      }

      // Initial
      fab.style.display = shouldShowFab() ? '' : 'none';
    }
  }

  function toggleCustomerPopup() {
    if (ctx.isOpen) closeCustomerPopup();
    else openCustomerPopup();
  }

  async function openCustomerPopup() {
    ctx.isOpen = true;
    ctx.popupEl.style.display = 'flex';
    ctx.popupEl.classList.remove('closing');
    ctx.fabEl.classList.add('open');

    if (loadCustomerSession() && ctx.sessionId) {
      // Validate session still exists and is active in DB
      var session = await getSessionFromDB(ctx.sessionId);
      if (!session || session.status !== 'active') {
        // Session deleted/closed by admin — clear and show form
        clearCustomerSession();
        ctx.sessionId = null;
        ctx.messages = [];
        renderCustomerForm();
        return;
      }
      renderCustomerChat();
      loadCustomerMessages();
      subscribeCustomerRealtime();
    } else {
      renderCustomerForm();
    }
  }

  function toggleCustomerMaximize() {
    var popup = ctx.popupEl;
    if (!popup) return;
    var isMax = popup.classList.toggle('maximized');
    // Update icon on both possible maximize buttons
    document.querySelectorAll('.lc-header-maximize').forEach(function (btn) {
      btn.innerHTML = isMax ? '<i data-lucide="minimize-2"></i>' : '<i data-lucide="maximize-2"></i>';
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function closeCustomerPopup() {
    ctx.popupEl.classList.add('closing');
    ctx.popupEl.classList.remove('maximized');
    ctx.fabEl.classList.remove('open');
    setTimeout(function () {
      ctx.popupEl.style.display = 'none';
      ctx.popupEl.classList.remove('closing');
      ctx.isOpen = false;
    }, 250);
  }

  // ── Customer Form ──────────────────────────────
  function renderCustomerForm() {
    ctx.popupEl.innerHTML =
      '<div class="lc-header">'
      + '<div class="lc-header-avatar"><i data-lucide="messages-square"></i></div>'
      + '<div class="lc-header-info">'
      + '<div class="lc-header-name">Live Chat</div>'
      + '<div class="lc-header-status"><span class="lc-status-dot"></span> Kami siap membantu</div>'
      + '</div>'
      + '<button class="lc-header-maximize" onclick="window.__lcMaximize()"><i data-lucide="maximize-2"></i></button>'
      + '<button class="lc-header-close" onclick="window.__lcToggle()"><i data-lucide="x"></i></button>'
      + '</div>'
      + '<div class="lc-form">'
      + '<div class="lc-form-icon"><i data-lucide="headset"></i></div>'
      + '<h3>Mulai Chat</h3>'
      + '<p>Isi data Anda untuk memulai percakapan dengan tim kami</p>'
      + '<div class="lc-form-fields">'
      + '<input class="lc-form-input" id="lcFormName" placeholder="Nama Anda" maxlength="50">'
      + '<input class="lc-form-input" id="lcFormPhone" placeholder="No. HP (opsional)" type="tel" maxlength="20">'
      + '<button class="lc-form-submit" id="lcFormSubmit"><i data-lucide="send" style="margin-right:6px"></i> Mulai Chat</button>'
      + '</div>'
      + '</div>';

    $('lcFormSubmit').onclick = submitCustomerForm;
    $('lcFormName').onkeydown = function (e) { if (e.key === 'Enter') $('lcFormPhone').focus(); };
    $('lcFormPhone').onkeydown = function (e) { if (e.key === 'Enter') submitCustomerForm(); };
    setTimeout(function () { $('lcFormName').focus(); }, 150);
  }

  async function submitCustomerForm() {
    var name = $('lcFormName').value.trim();
    var phone = $('lcFormPhone').value.trim();

    if (!name) {
      $('lcFormName').style.borderColor = 'var(--danger, #B91C1C)';
      setTimeout(function () { $('lcFormName').style.borderColor = ''; }, 2000);
      return;
    }

    ctx.customerName = name;
    ctx.customerPhone = phone;

    // Create session in DB
    if (state && state.session && state.session.sb) {
      try {
        var { data, error } = await state.session.sb
          .from('chat_sessions')
          .insert([{
            customer_name: name,
            customer_phone: phone,
            mode: 'ai',
            status: 'active',
          }])
          .select()
          .single();

        if (error) throw error;
        ctx.sessionId = data.session_id;
        saveCustomerSession();
      } catch (e) {
        console.error('[live-chat] create session error:', e);
        // Fallback: generate client-side session ID
        ctx.sessionId = '00000000-0000-0000-0000-000000000000';
        // Try to generate a proper UUID
        try { ctx.sessionId = crypto.randomUUID(); } catch (ex) { /* ignore */ }
        saveCustomerSession();
      }
    } else {
      // No Supabase - use local UUID
      try { ctx.sessionId = crypto.randomUUID(); } catch (e) { /* ignore */ }
      saveCustomerSession();
    }

    renderCustomerChat();
    loadCustomerMessages();
    subscribeCustomerRealtime();
  }

  // ── Customer Chat UI ───────────────────────────
  function renderCustomerChat() {
    ctx.popupEl.innerHTML =
      '<div class="lc-header">'
      + '<div class="lc-header-avatar"><i data-lucide="messages-square"></i></div>'
      + '<div class="lc-header-info">'
      + '<div class="lc-header-name">Live Chat</div>'
      + '<div class="lc-header-status"><span class="lc-status-dot" id="lcStatusDot"></span> <span id="lcHeaderStatusText">Terhubung</span> <span class="lc-mode-badge lc-mode-badge--ai" id="lcModeBadge">\uD83E\uDD16 AI</span></div>'
      + '</div>'
      + '<button class="lc-header-maximize" onclick="window.__lcMaximize()"><i data-lucide="maximize-2"></i></button>'
      + '<button class="lc-header-close" onclick="window.__lcToggle()"><i data-lucide="x"></i></button>'
      + '</div>'
      + '<div class="lc-messages" id="lcMessages"></div>'
      + '<div class="lc-reply-indicator" id="lcReplyIndicator"></div>'
      + '<div class="lc-input-area">'
      + '<textarea class="lc-input" id="lcInput" placeholder="Ketik pesan..." rows="1"></textarea>'
      + '<button class="lc-send" id="lcSendBtn" title="Kirim"><i data-lucide="send"></i></button>'
      + '</div>';

    $('lcSendBtn').onclick = sendCustomerMessage;
    $('lcInput').onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCustomerMessage(); }
    };
    $('lcInput').oninput = function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
      // Broadcast typing to admin
      if (ctx._typingChannel) {
        try {
          ctx._typingChannel.send({ type: 'broadcast', event: 'customer_typing', payload: {} });
        } catch (e) { /* channel not ready */ }
      }
    };

    // Pre-fill pending message dari tombol produk
    if (ctx.pendingMessage) {
      var pInp = $('lcInput');
      if (pInp) {
        pInp.value = ctx.pendingMessage;
        pInp.style.height = 'auto';
        pInp.style.height = Math.min(pInp.scrollHeight, 100) + 'px';
        pInp.focus();
      }
      ctx.pendingMessage = null;
    }
  }

  async function loadCustomerMessages() {
    if (!ctx.sessionId || !state || !state.session || !state.session.sb) return;

    // Fetch current session mode from DB to sync UI
    var currentMode = 'ai';
    var currentHandledBy = '';
    try {
      var sess = await getSessionFromDB(ctx.sessionId);
      if (sess) {
        currentMode = sess.mode || 'ai';
        currentHandledBy = sess.handled_by || '';
      }
    } catch (e) { /* ignore */ }

    // Set initial mode tracking
    if (ctx._prevMode == null) {
      ctx._prevMode = currentMode;
    }

    try {
      var { data } = await state.session.sb
        .from('chat_messages')
        .select('*')
        .eq('session_id', ctx.sessionId)
        .order('created_at', { ascending: true });

      ctx.messages = (data || []).map(function (m) {
        return {
          id: m.id,
          sender_type: m.sender_type,
          sender_name: m.sender_name || '',
          message: m.message,
          created_at: m.created_at,
        };
      });

      renderCustomerMessages();

      // Sync header UI with actual session mode (handles page reload mid-escalation)
      // silent=true so we don't push duplicate system messages
      if (currentMode === 'connecting') {
        updateCustomerChatStatus('connecting', null, true);
      } else if (currentMode === 'admin') {
        updateCustomerChatStatus('admin', currentHandledBy || 'Admin', true);
      }
      // mode === 'ai' is the default UI, no update needed

      // Mark customer messages as read
      if (state.session.dbOk) {
        await state.session.sb
          .from('chat_sessions')
          .update({ unread_by_customer: 0 })
          .eq('session_id', ctx.sessionId);
      }
    } catch (e) {
      console.error('[live-chat] load messages error:', e);
    }
  }

  // ── Helper: detect system message type ──
  function getSystemPillType(m) {
    if (m.sender_type === 'system') {
      if (/memerlukan bantuan admin|Mohon tunggu/i.test(m.message)) return 'escalate';
      if (/telah terhubung/i.test(m.message)) return 'connected';
      return 'info';
    }
    if (m.sender_name === 'Sistem' || m.sender_name === 'System') {
      if (/mengambil alih|takeover/i.test(m.message)) return 'takeover';
      return 'info';
    }
    return null;
  }

  function isSystemMessage(m) {
    return m.sender_type === 'system' || m.sender_name === 'Sistem' || m.sender_name === 'System';
  }

  // ── Render System Pill ──
  function renderSystemPill(message, pillType, createdAt) {
    var icons = {
      escalate: 'loader',
      connected: 'user-check',
      takeover: 'hand-metal',
      info: 'info',
    };
    var t = createdAt ? new Date(createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    return '<div class="lc-pill lc-pill--' + (pillType || 'info') + '">'
      + '<i data-lucide="' + (icons[pillType] || icons.info) + '" class="lc-pill-icon"></i>'
      + '<span class="lc-pill-text">' + esc(message) + '</span>'
      + '<span class="lc-pill-time">' + t + '</span>'
      + '</div>';
  }

  // ── Reply Time Indicator ────────────────────────
  function updateReplyIndicator() {
    var el = $('lcReplyIndicator');
    if (!el) return;

    // Hide when there are messages (not in welcome state)
    if (ctx.messages.length > 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';

    // Check if any admin is online via presence
    var isOnline = false;
    try {
      if (window.__presenceState && window.__presenceState.admins && window.__presenceState.admins.length > 0) {
        isOnline = true;
      }
    } catch (e) { /* ignore */ }

    if (isOnline) {
      el.innerHTML = '<span class="lc-reply-indicator-dot online"></span> Admin sedang online · Biasanya membalas dalam hitungan menit';
    } else {
      el.innerHTML = '<span class="lc-reply-indicator-dot offline"></span> Admin sedang offline · Pesan akan dijawab oleh AI';
    }
  }

  function renderCustomerMessages() {
    var el = $('lcMessages');
    if (!el) return;

    if (!ctx.messages.length) {
      var name = esc(ctx.customerName || 'kamu');
      var chips = [
        { icon: 'package-search', label: 'Tanya Stok Produk' },
        { icon: 'tag', label: 'Cek Harga' },
        { icon: 'shield-check', label: 'Info Garansi' },
        { icon: 'headphones', label: 'Hubungin Admin' },
      ];
      var chipsHtml = chips.map(function (c, i) {
        return '<button class="lc-quick-chip" data-q="' + c.label + '">'
          + '<i data-lucide="' + c.icon + '"></i> ' + c.label
          + '</button>';
      }).join('');

      el.innerHTML = '<div class="lc-welcome">'
        + '<div class="lc-welcome-avatar"><i data-lucide="message-circle-heart"></i></div>'
        + '<div class="lc-welcome-text">Hai <strong>' + name + '</strong>! Ada yang bisa kami bantu? Tanya tentang produk, stok, atau harga aja ya.</div>'
        + '<div class="lc-quick-chips" id="lcQuickChips">' + chipsHtml + '</div>'
        + '</div>'
        + '<div class="lc-typing" id="lcTyping"><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div></div>';

      // Bind chip clicks
      if (typeof lucide !== 'undefined') lucide.createIcons();
      var chipContainer = document.getElementById('lcQuickChips');
      if (chipContainer) {
        chipContainer.addEventListener('click', function (e) {
          var chip = e.target.closest('.lc-quick-chip');
          if (!chip) return;
          var q = chip.getAttribute('data-q');
          if (q) {
            var inp = $('lcInput');
            if (inp) {
              inp.value = q;
              inp.style.height = 'auto';
              inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
              sendCustomerMessage();
            }
          }
        });
      }
      updateReplyIndicator();
      return;
    }

    el.innerHTML = ctx.messages.map(function (m) {
      // System message → centered pill
      if (isSystemMessage(m)) {
        var pillType = getSystemPillType(m);
        return renderSystemPill(m.message, pillType, m.created_at);
      }

      var cls = 'lc-msg--' + m.sender_type;
      if (m.sender_type === 'customer') cls = 'lc-msg--customer';
      else if (m.sender_type === 'admin') cls = 'lc-msg--admin';
      else cls = 'lc-msg--ai';

      var senderHtml = '';
      if (m.sender_type === 'admin') {
        senderHtml = '<span class="lc-msg-sender">' + esc(m.sender_name || 'Admin') + '</span>';
      }

      var t = m.created_at ? new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';

      // Cleanup JSON fragment dari pesan (termasuk pesan lama dari DB)
      var cleanMsg = m.message || '';
      if (typeof cleanMsg === 'string') {
        cleanMsg = cleanMsg.replace(/,\s*"\s*escalate\s*"\s*:\s*(true|false)\s*\}\s*$/, '');
        cleanMsg = cleanMsg.replace(/"\s*escalate\s*"\s*:\s*(true|false)\s*\}\s*$/, '');
        cleanMsg = cleanMsg.replace(/^\s*\{[^}]*"escalate"\s*:\s*(true|false)\s*\}\s*/, '');
        cleanMsg = cleanMsg.trim();
      }

      var msgContent = '';
      if (m.sender_type === 'admin' && typeof marked !== 'undefined') {
        msgContent = marked.parse(cleanMsg);
      } else {
        msgContent = esc(cleanMsg).replace(/\n/g, '<br>');
      }

      var checkHtml = (cls.indexOf('customer') !== -1) ? '<span class="lc-msg-check">\u2713\u2713</span>' : '';
      return '<div class="lc-msg ' + cls + '">'
        + senderHtml
        + '<div class="lc-msg-body">' + msgContent + '</div>'
        + '<span class="lc-msg-time">' + t + checkHtml + '</span>'
        + '</div>';
    }).join('')
    + '<div class="lc-typing" id="lcTyping"><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div></div>';

    el.scrollTop = el.scrollHeight;
    updateReplyIndicator();
  }

  async function sendCustomerMessage() {
    var input = $('lcInput');
    var text = input ? input.value.trim() : '';
    if (!text || !ctx.sessionId) return;

    if (input) { input.value = ''; input.style.height = 'auto'; }

    // Optimistic add
    var tempMsg = {
      id: Date.now(),
      sender_type: 'customer',
      sender_name: ctx.customerName,
      message: text,
      created_at: new Date().toISOString(),
    };
    ctx.messages.push(tempMsg);
    renderCustomerMessages();

    // Insert to DB
    if (state && state.session && state.session.sb) {
      try {
        var { error } = await state.session.sb
          .from('chat_messages')
          .insert([{
            session_id: ctx.sessionId,
            sender_type: 'customer',
            sender_name: ctx.customerName,
            message: text,
          }]);

        if (error) throw error;

        // Update session last_message
        var { error: uErr } = await state.session.sb
          .from('chat_sessions')
          .update({
            last_message: text,
            last_message_at: new Date().toISOString(),
            unread_by_admin: 1,
          })
          .eq('session_id', ctx.sessionId);

        // If session update failed (deleted/closed), recreate session
        if (uErr) {
          console.warn('[live-chat] session update failed, recreating...');
          // Remove the message that went to dead session
          ctx.messages = ctx.messages.filter(function (m) { return m.id !== tempMsg.id; });

          var newSess = await createNewSession();
          if (newSess) {
            // Re-insert message under new session
            await state.session.sb
              .from('chat_messages')
              .insert([{
                session_id: ctx.sessionId,
                sender_type: 'customer',
                sender_name: ctx.customerName,
                message: text,
              }]);
            ctx.messages.push(tempMsg);
            renderCustomerMessages();
            // Re-subscribe realtime to new session
            subscribeCustomerRealtime();
          }
        }

        // If mode is 'ai', forward to webhook
        var session = await getSessionFromDB(ctx.sessionId);
        if (session && session.mode === 'ai' && N8N_LIVE_CHAT_URL) {
          forwardToWebhook(text, session);
        }
      } catch (e) {
        console.error('[live-chat] send message error:', e);
        // Remove optimistic message on failure
        ctx.messages = ctx.messages.filter(function (m) { return m.id !== tempMsg.id; });
        renderCustomerMessages();
      }
    }
  }

  async function getSessionFromDB(sessionId) {
    if (!state || !state.session || !state.session.sb) return null;
    try {
      var { data } = await state.session.sb
        .from('chat_sessions')
        .select('*')
        .eq('session_id', sessionId)
        .single();
      return data;
    } catch (e) { return null; }
  }

  async function forwardToWebhook(message, session) {
    // Show typing
    var typingEl = $('lcTyping');
    if (typingEl) {
      typingEl.classList.add('show');
      var msgEl = $('lcMessages');
      if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
    }

    try {
      var res = await fetch(N8N_LIVE_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          session_id: ctx.sessionId,
          customer_name: ctx.customerName,
          customer_phone: ctx.customerPhone,
          mode: 'ai',
          context: {
            store_name: (state && state.db && state.db.settings && state.db.settings.store_name) || 'Gadget 5tore',
          }
        })
      });

      var reply = '';
      var shouldEscalate = false;

      if (res.ok) {
        var data = await res.json();
        reply = data.reply || data.message || data.output || data.text || data.response || '';
        if (typeof reply !== 'string' || !reply) {
          reply = JSON.stringify(data);
        }
        shouldEscalate = !!data.escalate;

        // Cleanup JSON mentah dari response
        // 1. Kalau reply murni JSON di awal, extract reply-nya
        if (reply && typeof reply === 'string' && reply.trim().startsWith('{')) {
          try {
            var parsed = JSON.parse(reply);
            if (typeof parsed.reply === 'string') reply = parsed.reply;
          } catch (e) { /* bukan JSON valid */ }
        }
        // 2. Strip JSON blok yang nempel di awal
        if (reply && typeof reply === 'string') {
          reply = reply.replace(/^\s*\{[^}]*"escalate"\s*:\s*(true|false)\s*\}\s*/, '').trim();
        }
        // 3. Strip fragment JSON yang nempel di akhir (misal: ", "escalate": false})
        if (reply && typeof reply === 'string') {
          reply = reply.replace(/,\s*"\s*escalate\s*"\s*:\s*(true|false)\s*\}\s*$/, '').trim();
          reply = reply.replace(/"\s*escalate\s*"\s*:\s*(true|false)\s*\}\s*$/, '').trim();
        }
      } else {
        reply = 'Maaf, sedang ada gangguan. Silakan coba lagi.';
      }

      // Insert AI reply as 'admin' type with sender_name='AI Assistant'
      var { error } = await state.session.sb
        .from('chat_messages')
        .insert([{
          session_id: ctx.sessionId,
          sender_type: 'admin',
          sender_name: 'AI Assistant',
          message: reply,
        }]);

      if (!error) {
        ctx.messages.push({
          id: Date.now(),
          sender_type: 'admin',
          sender_name: 'AI Assistant',
          message: reply,
          created_at: new Date().toISOString(),
        });
        renderCustomerMessages();
      }

      // ── Auto-escalation: switch session to 'connecting' ──
      if (shouldEscalate) {
        console.log('[live-chat] AI escalated, switching session to connecting');
        // Update UI dulu biar customer langsung lihat
        updateCustomerChatStatus('connecting');
        ctx._prevMode = 'connecting';
        // Lalu update DB
        if (ctx.sessionId && state && state.session && state.session.sb) {
          try {
            var { error: escErr } = await state.session.sb
              .from('chat_sessions')
              .update({ mode: 'connecting' })
              .eq('session_id', ctx.sessionId);
            if (escErr) console.error('[live-chat] escalation DB update error:', escErr);
            else console.log('[live-chat] escalation DB updated to connecting');
          } catch (escEx) {
            console.error('[live-chat] escalation DB update exception:', escEx);
          }
        } else {
          console.warn('[live-chat] escalation skipped — no sb or sessionId', {
            hasSb: !!(state && state.session && state.session.sb),
            sessionId: ctx.sessionId
          });
        }
      }
    } catch (e) {
      console.error('[live-chat] webhook error:', e);
    } finally {
      if (typingEl) typingEl.classList.remove('show');
    }
  }

  // ── Customer Status & Input Control ─────────────
  // silent = true → hanya update header UI, jangan push system message (untuk page reload)
  function updateCustomerChatStatus(mode, adminName, silent) {
    var statusText = $('lcHeaderStatusText');
    var statusDot = $('lcStatusDot');
    var modeBadge = $('lcModeBadge');
    var input = $('lcInput');
    var sendBtn = $('lcSendBtn');
    if (!statusText) return;

    if (mode === 'ai') {
      statusText.textContent = 'Terhubung';
      if (statusDot) { statusDot.classList.remove('offline', 'connecting'); }
      if (modeBadge) { modeBadge.textContent = '\uD83E\uDD16 AI'; modeBadge.className = 'lc-mode-badge lc-mode-badge--ai'; modeBadge.style.display = ''; }
      if (input) { input.disabled = false; input.placeholder = 'Ketik pesan...'; }
      if (sendBtn) sendBtn.disabled = false;
    } else if (mode === 'connecting') {
      statusText.textContent = 'Menunggu admin...';
      if (statusDot) { statusDot.classList.remove('offline'); statusDot.classList.add('connecting'); }
      if (modeBadge) { modeBadge.style.display = 'none'; }
      if (input) { input.disabled = true; input.placeholder = 'Menunggu admin menghubungi Anda...'; }
      if (sendBtn) sendBtn.disabled = true;
      if (!silent) {
        ctx.messages.push({
          id: Date.now(),
          sender_type: 'system',
          sender_name: '',
          message: 'Pertanyaan Anda memerlukan bantuan admin. Mohon tunggu sebentar...',
          created_at: new Date().toISOString(),
        });
        renderCustomerMessages();
      }
    } else if (mode === 'admin') {
      statusText.textContent = 'Terhubung';
      if (statusDot) { statusDot.classList.remove('offline', 'connecting'); }
      if (modeBadge) {
        modeBadge.textContent = '👤 ' + (adminName || 'Admin');
        modeBadge.className = 'lc-mode-badge lc-mode-badge--admin';
        modeBadge.style.display = '';
      }
      if (input) { input.disabled = false; input.placeholder = 'Ketik pesan...'; }
      if (sendBtn) sendBtn.disabled = false;
      if (!silent) {
        ctx.messages.push({
          id: Date.now() + 1,
          sender_type: 'system',
          sender_name: '',
          message: adminName ? (adminName + ' telah terhubung.') : 'Admin telah terhubung.',
          created_at: new Date().toISOString(),
        });
        renderCustomerMessages();
      }
    }
  }

  // ── Customer Realtime ──────────────────────────
  function subscribeCustomerRealtime() {
    if (!ctx.sessionId || !state || !state.session || !state.session.sb) return;
    if (ctx.rtChannel) { try { ctx.rtChannel.unsubscribe(); } catch (e) { /* */ } }

    var channelName = 'chat:' + ctx.sessionId;
    ctx.rtChannel = state.session.sb.channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: 'session_id=eq.' + ctx.sessionId,
      }, function (payload) {
        var m = payload.new;
        if (!m) return;
        // Don't add if it's our own message (already added optimistically)
        var exists = ctx.messages.some(function (existing) {
          return existing.id === m.id ||
            (existing.message === m.message && existing.sender_type === m.sender_type &&
             Math.abs(new Date(existing.created_at) - new Date(m.created_at)) < 5000);
        });
        if (!exists) {
          ctx.messages.push({
            id: m.id,
            sender_type: m.sender_type,
            sender_name: m.sender_name || '',
            message: m.message,
            created_at: m.created_at,
          });
          renderCustomerMessages();
          // Hide typing indicator when message arrives
          var typingEl = $('lcTyping');
          if (typingEl) typingEl.classList.remove('show');
          clearTimeout(ctx._adminTypingTimer);
        }

        // If admin replied, mark as read
        if (m.sender_type === 'admin' && state && state.session && state.session.sb) {
          state.session.sb
            .from('chat_sessions')
            .update({ unread_by_customer: 0 })
            .eq('session_id', ctx.sessionId);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_sessions',
        filter: 'session_id=eq.' + ctx.sessionId,
      }, function (payload) {
        var s = payload.new;
        if (!s) return;

        // Session closed by admin
        if (s.status === 'closed') {
          ctx.messages.push({
            id: Date.now(),
            sender_type: 'system',
            sender_name: '',
            message: 'Sesi chat telah ditutup oleh admin.',
            created_at: new Date().toISOString(),
          });
          renderCustomerMessages();

          // Replace input area with "Mulai Chat Baru" button
          var inputArea = ctx.popupEl.querySelector('.lc-input-area');
          if (inputArea && !inputArea.querySelector('#lcNewSessionBtn')) {
            inputArea.innerHTML = '<button class="lc-form-submit" id="lcNewSessionBtn" style="width:100%;margin-top:0"><i data-lucide="plus" style="margin-right:6px"></i>Mulai Chat Baru</button>';
            $('lcNewSessionBtn').onclick = function () {
              clearCustomerSession();
              ctx.sessionId = null;
              ctx.messages = [];
              cleanupCustomerRealtime();
              renderCustomerForm();
            };
          }

          // Update header status
          var statusText = $('lcHeaderStatusText');
          if (statusText) statusText.textContent = 'Sesi ditutup';
          var statusDot = ctx.popupEl.querySelector('.lc-status-dot');
          if (statusDot) statusDot.classList.add('offline');
          return;
        }

        // Handle mode changes for customer UI
        if (s.mode === 'admin' && (ctx._prevMode === 'connecting' || ctx._prevMode === 'ai')) {
          updateCustomerChatStatus('admin', s.handled_by || 'Admin');
        } else if (s.mode === 'connecting' && ctx._prevMode !== 'connecting') {
          updateCustomerChatStatus('connecting');
        } else if (s.mode === 'ai') {
          updateCustomerChatStatus('ai');
        } else {
          var statusText = $('lcHeaderStatusText');
          var modeBadge = $('lcModeBadge');
          if (statusText) {
            if (s.mode === 'admin') {
              statusText.textContent = 'Terhubung';
              if (modeBadge) {
                modeBadge.textContent = '👤 ' + (s.handled_by || 'Admin');
                modeBadge.className = 'lc-mode-badge lc-mode-badge--admin';
                modeBadge.style.display = '';
              }
            } else {
              statusText.textContent = 'Terhubung';
            }
          }
        }
        ctx._prevMode = s.mode;
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          console.log('[live-chat] customer realtime subscribed');
        }
      });

    // Subscribe to admin typing channel
    subscribeCustomerTyping();
  }

  // ── Customer Typing Channel (receives admin typing events) ──
  function subscribeCustomerTyping() {
    if (!ctx.sessionId || !state || !state.session || !state.session.sb) return;
    if (ctx._typingChannel) {
      try { ctx._typingChannel.unsubscribe(); } catch (e) { /* */ }
    }
    var typingChannelName = 'lc-typing:' + ctx.sessionId;
    ctx._typingChannel = state.session.sb.channel(typingChannelName)
      .on('broadcast', { event: 'admin_typing' }, function () {
        var typingEl = $('lcTyping');
        if (typingEl) {
          typingEl.classList.add('show');
          // Scroll to bottom to show typing indicator
          var msgContainer = typingEl.parentElement;
          if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
          // Auto-hide after 2.5 seconds of no typing
          clearTimeout(ctx._adminTypingTimer);
          ctx._adminTypingTimer = setTimeout(function () {
            if (typingEl) typingEl.classList.remove('show');
          }, 2500);
        }
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          console.log('[live-chat] customer typing channel subscribed');
        }
      });
  }

  // ── Customer Cleanup ───────────────────────────
  function cleanupCustomerRealtime() {
    if (ctx.rtChannel) {
      try { ctx.rtChannel.unsubscribe(); } catch (e) { /* */ }
      ctx.rtChannel = null;
    }
    // Cleanup typing channel
    if (ctx._typingChannel) {
      try { ctx._typingChannel.unsubscribe(); } catch (e) { /* */ }
      ctx._typingChannel = null;
    }
    clearTimeout(ctx._adminTypingTimer);
  }

  window.addEventListener('beforeunload', cleanupCustomerRealtime);


  // ═══════════════════════════════════════════════════
  //  ADMIN SIDE
  // ═══════════════════════════════════════════════════

  // ── Inject Chat into Sidebar ────────────────────
  function injectSidebarItem() {
    var sideNav = $('sideNav');
    if (!sideNav) return;

    // Hanya admin & editor yang bisa akses live chat panel
    if (state && state.session && state.session.currentUser) {
      var role = state.session.currentUser.role;
      if (role !== 'admin' && role !== 'editor') return;
    }

    // Check if already in DOM (reliable check, not a flag)
    if (sideNav.querySelector('[data-lc-panel="chat"]')) return;

    // Find the "Konten" label
    var children = Array.from(sideNav.children);
    var kontenLabel = children.find(function (c) {
      return c.classList && c.classList.contains('nav-label') && c.textContent.trim() === 'Konten';
    });

    if (!kontenLabel) return;

    var chatItem = document.createElement('div');
    chatItem.className = 'nav-item' + (state && state.admin && state.admin.panel === 'chat' ? ' active' : '');
    chatItem.dataset.lcPanel = 'chat';
    chatItem.innerHTML = '<i data-lucide="headset"></i> Chat <span class="nav-badge" id="lcSidebarBadge" style="display:none">0</span>';
    chatItem.onclick = function () {
      if (state) state.admin.panel = 'chat';
      if (typeof renderSide === 'function') renderSide();
      if (typeof renderDash === 'function') renderDash();
      if (typeof closeSidebar === 'function') closeSidebar();
    };

    sideNav.insertBefore(chatItem, kontenLabel);
  }

  // ── Hook into renderDash for chat panel ────────
  function hookRenderDash() {
    var origRenderDash = window.renderDash;
    if (!origRenderDash) return;

    window.renderDash = function () {
      origRenderDash();
      injectSidebarItem();
      ensureInboxStable();

      // Hide G5 AI FAB when chat panel is active (avoid overlap), show when not
      var isChatPanel = state && state.admin && state.admin.panel === 'chat';
      var g5Fab = document.querySelector('#g5aiFab');
      if (g5Fab) {
        g5Fab.style.display = isChatPanel ? 'none' : '';
      }

      if (isChatPanel) {
        // Blokir viewer dari mengakses chat panel
        var curRole = state && state.session && state.session.currentUser && state.session.currentUser.role;
        if (curRole !== 'admin' && curRole !== 'editor') {
          state.admin.panel = '';
          if (typeof renderDash === 'function') renderDash();
          return;
        }
        var el = $('dashContent');
        var ti = $('dashTitle');
        if (ti) ti.textContent = 'Live Chat';
        if (el) renderAdminInbox(el);
      }
    };
  }

  // ── Notif Sound ──────────────────────────────
  function playNotifSound() {
    try {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ac.currentTime);
      osc.frequency.setValueAtTime(1100, ac.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.4);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.4);
    } catch (e) { /* ignore */ }
  }

  // ── Escalation Sound (2x beep, lebih urgent) ──
  function playEscalationSound() {
    try {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      for (var i = 0; i < 2; i++) {
        (function(idx) {
          var osc = ac.createOscillator();
          var gain = ac.createGain();
          osc.connect(gain);
          gain.connect(ac.destination);
          osc.type = 'sine';
          var t = ac.currentTime + idx * 0.35;
          osc.frequency.setValueAtTime(660, t);
          osc.frequency.setValueAtTime(990, t + 0.08);
          osc.frequency.setValueAtTime(880, t + 0.16);
          gain.gain.setValueAtTime(0.35, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.28);
          osc.start(t);
          osc.stop(t + 0.28);
        })(i);
      }
    } catch (e) { /* ignore */ }
  }

  // ── Escalation / Nagging Toast (unified, with progress bar, stacking, avatar) ──
  var _toastContainer = null;
  var _activeToasts = 0;

  function getToastContainer() {
    if (_toastContainer && _toastContainer.parentNode) return _toastContainer;
    _toastContainer = document.createElement('div');
    _toastContainer.id = 'lcToastContainer';
    _toastContainer.className = 'lc-toast-container';
    document.body.appendChild(_toastContainer);
    return _toastContainer;
  }

  /**
   * showAlertToast(opts)
   * opts.customerName, opts.sessionId, opts.customerPhone,
   * opts.urgency: 'initial' | 'normal' | 'warn' | 'urgent',
   * opts.autoDismiss: ms (default 8000)
   */
  function showAlertToast(opts) {
    var container = getToastContainer();
    var urgency = opts.urgency || 'initial';
    var duration = opts.autoDismiss || 8000;

    // Tentukan warna berdasarkan urgency
    var theme = {
      initial: { bg: 'rgba(254,243,199,0.92)', border: '#F59E0B', color: '#92400E', icon: 'triangle-alert', accent: '#F59E0B', label: 'butuh bantuan admin' },
      normal:  { bg: 'rgba(254,243,199,0.92)', border: '#F59E0B', color: '#92400E', icon: 'clock',        accent: '#F59E0B', label: 'menunggu' },
      warn:    { bg: 'rgba(255,247,237,0.92)', border: '#F97316', color: '#9A3412', icon: 'triangle-alert', accent: '#F97316', label: 'sudah' },
      urgent:  { bg: 'rgba(254,242,242,0.92)', border: '#EF4444', color: '#991B1B', icon: 'circle-alert',  accent: '#EF4444', label: 'sudah' },
    }[urgency];

    var initial = (opts.customerName || 'C').charAt(0).toUpperCase();
    var wm = waitingMinutes(null);
    // Cek waiting time dari sessions
    var sessionData = ctx.sessions.find(function(s) { return s.session_id === opts.sessionId; });
    if (sessionData) {
      wm = waitingMinutes(sessionData.updated_at || sessionData.last_message_at);
    }
    var waitStr = urgency === 'initial' ? '' : (' ' + waitingTimeStr(sessionData ? (sessionData.updated_at || sessionData.last_message_at) : null) + '!');

    // Buat toast element
    var toast = document.createElement('div');
    toast.className = 'lc-toast lc-toast--' + urgency;
    toast.innerHTML =
      '<div class="lc-toast-accent-bar" style="background:' + theme.accent + '"></div>'
      + '<div class="lc-toast-body">'
      +   '<div class="lc-toast-avatar" style="background:' + theme.accent + '">' + esc(initial) + '</div>'
      +   '<div class="lc-toast-content">'
      +     '<div class="lc-toast-title"><i data-lucide="' + theme.icon + '" class="lc-toast-icon" style="color:' + theme.accent + '"></i> <strong>' + esc(opts.customerName || 'Customer') + '</strong> <span class="lc-toast-label">' + theme.label + waitStr + '</span></div>'
      +     (opts.customerPhone ? '<div class="lc-toast-sub"><i data-lucide="phone" style="font-size:10px"></i> ' + esc(opts.customerPhone) + '</div>' : '')
      +   '</div>'
      +   '<button class="lc-toast-btn" style="background:' + theme.accent + '">Ambil Alih</button>'
      +   '<button class="lc-toast-close" title="Tutup"><i data-lucide="x" style="pointer-events:none"></i></button>'
      + '</div>'
      + '<div class="lc-toast-progress" style="background:' + theme.accent + '"><div class="lc-toast-progress-bar"></div></div>';

    // Progress bar animation
    var progressBar = toast.querySelector('.lc-toast-progress-bar');
    requestAnimationFrame(function () {
      progressBar.style.transition = 'width ' + duration + 'ms linear';
      progressBar.style.width = '0%';
    });

    // Tombol Ambil Alih
    toast.querySelector('.lc-toast-btn').onclick = function (e) {
      e.stopPropagation();
      dismissToast(toast);
      takeoverSession(opts.sessionId);
      if (state) state.admin.panel = 'chat';
      if (typeof renderSide === 'function') renderSide();
      if (typeof renderDash === 'function') renderDash();
      setTimeout(function () {
        if (typeof selectSession === 'function') selectSession(opts.sessionId);
      }, 100);
    };

    // Tombol close
    toast.querySelector('.lc-toast-close').onclick = function (e) {
      e.stopPropagation();
      dismissToast(toast);
    };

    // Auto dismiss
    var timer = setTimeout(function () { dismissToast(toast); }, duration);
    toast._dismissTimer = timer;

    // Tambahkan ke container (prepend biar yang baru di atas)
    container.prepend(toast);
    _activeToasts++;

    // Re-init lucide icons di dalam toast
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons({ nodes: [toast] });
    }
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentNode || toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._dismissTimer);
    toast.classList.add('lc-toast--out');
    setTimeout(function () {
      if (toast.parentNode) {
        toast.remove();
        _activeToasts--;
        // Hapus container kalau udah kosong
        if (_activeToasts <= 0 && _toastContainer) {
          _activeToasts = 0;
          // Biarkan container, cuma kosong
        }
      }
    }, 350);
  }

  // ── showEscalationToast (backward compat) ──
  function showEscalationToast(customerName, sessionId) {
    var sessionData = ctx.sessions.find(function(s) { return s.session_id === sessionId; });
    showAlertToast({
      customerName: customerName,
      sessionId: sessionId,
      customerPhone: sessionData ? sessionData.customer_phone : '',
      urgency: 'initial',
    });
  }

  // ── Admin Inbox ────────────────────────────────
  function renderAdminInbox(el) {
    if (!state || !state.session || !state.session.currentUser) {
      el.innerHTML = '<div class="empty-state"><i data-lucide="lock"></i><p>Akses ditolak</p></div>';
      return;
    }

    el.innerHTML =
      '<div class="lc-inbox" id="lcInbox">'
      + '<div class="lc-inbox-sessions">'
      + '<div class="lc-inbox-sessions-head">'
      + '<h3><i data-lucide="messages-square"></i> Sesi Chat</h3>'
      + '<span class="lc-inbox-sessions-count" id="lcSessionCount">0</span>'
      + '</div>'
      + '<div class="lc-inbox-tabs" id="lcInboxTabs">'
      + '<button class="lc-inbox-tab active" data-tab="active" onclick="window.__lcSwitchTab(\'active\')">'
      + 'Aktif <span class="lc-inbox-tab-badge lc-inbox-tab-badge--active" id="lcTabBadgeActive">0</span>'
      + '</button>'
      + '<button class="lc-inbox-tab" data-tab="history" onclick="window.__lcSwitchTab(\'history\')">'
      + 'Riwayat <span class="lc-inbox-tab-badge lc-inbox-tab-badge--history" id="lcTabBadgeHistory">0</span>'
      + '</button>'
      + '<span id="lcClearHistoryWrap" style="display:none;margin-left:auto;padding:3px 0">'
      + '<button class="lc-clear-history-link" onclick="window.__lcClearHistory()"><i data-lucide="trash-2" style="margin-right:3px;font-size:10px"></i>Hapus Semua</button>'
      + '</span>'
      + '</div>'
      + '<div class="lc-inbox-summary" id="lcInboxSummary"></div>'
      + '<div class="lc-inbox-sessions-list" id="lcSessionList"></div>'
      + '</div>'
      + '<div class="lc-inbox-chat" id="lcInboxChat">'
      + '<div class="lc-inbox-empty" id="lcInboxEmpty">'
      + '<i data-lucide="messages-square"></i>'
      + '<h3>Inbox Chat</h3>'
      + '<p>Pilih sesi chat untuk melihat percakapan</p>'
      + '</div>'
      + '</div>'
      + '</div>';

    loadAdminSessions();
    // Note: subscribeAdminRealtime() is called once on admin login via initAdminChat()
  }

  async function loadAdminSessions() {
    if (!state || !state.session || !state.session.sb) return;

    try {
      var { data } = await state.session.sb
        .from('chat_sessions')
        .select('*')
        .eq('status', 'active')
        .order('last_message_at', { ascending: false, nullsFirst: false });

      ctx.sessions = data || [];
      renderSessionList();
      renderInboxSummary();
      updateTabBadges();
      updateSidebarBadge();

      // Also load closed count
      loadClosedCount();
    } catch (e) {
      console.error('[live-chat] load sessions error:', e);
      renderSessionList();
    }
  }

  function getStatusInfo(s) {
    if (s.status === 'closed') return { label: 'Ditutup', cls: 'lc-session-mode--closed' };
    if (s.mode === 'connecting') return { label: 'Menunggu', cls: 'lc-session-mode--connecting' };
    if (s.mode === 'admin') return { label: 'Aktif', cls: 'lc-session-mode--admin' };
    return { label: 'AI', cls: 'lc-session-mode--ai' };
  }

  function renderSessionList() {
    var listEl = $('lcSessionList');
    var countEl = $('lcSessionCount');
    if (!listEl) return;

    var isHistory = ctx.activeTab === 'history';
    var list = isHistory ? ctx.closedSessions : ctx.sessions;

    // Apply filter if on active tab
    if (!isHistory && ctx.activeFilter) {
      list = list.filter(function (s) { return s.mode === ctx.activeFilter; });
    }

    if (countEl) countEl.textContent = list.length;

    if (!list.length) {
      var emptyMsg = isHistory ? 'Belum ada riwayat'
        : (ctx.activeFilter === 'ai' ? 'Tidak ada sesi AI'
          : ctx.activeFilter === 'connecting' ? 'Tidak ada sesi menunggu'
            : ctx.activeFilter === 'admin' ? 'Tidak ada sesi aktif'
              : 'Belum ada sesi chat');
      listEl.innerHTML =
        '<div class="lc-sessions-empty">'
        + '<i data-lucide="inbox"></i>'
        + '<span>' + emptyMsg + '</span>'
        + '</div>';
      return;
    }

    listEl.innerHTML = list.map(function (s) {
      var isActive = ctx.activeSessionId === s.session_id;
      var initial = (s.customer_name || 'C').charAt(0).toUpperCase();
      var statusInfo = getStatusInfo(s);
      var unreadCls = s.unread_by_admin > 0 ? 'show' : '';
      var isConnecting = s.mode === 'connecting';

      // Waiting time indicator untuk session yang menunggu admin
      var waitEl = '';
      if (isConnecting) {
        var wm = waitingMinutes(s.updated_at || s.last_message_at);
        var wCls = wm >= 6 ? 'lc-waiting-time lc-waiting-time--urgent' : (wm >= 3 ? 'lc-waiting-time lc-waiting-time--warn' : 'lc-waiting-time');
        waitEl = '<span class="' + wCls + '">' + waitingTimeStr(s.updated_at || s.last_message_at) + '</span>';
      }

      return '<div class="lc-session-item' + (isActive ? ' active' : '') + (s.unread_by_admin > 0 ? ' has-unread' : '') + (isConnecting ? ' is-waiting' : '') + '" '
        + 'onclick="window.__lcSelectSession(\'' + s.session_id + '\')">'
        + '<div class="lc-session-avatar">' + esc(initial) + '</div>'
        + '<div class="lc-session-info">'
        + '<div class="lc-session-name">' + esc(s.customer_name) + ' <span class="lc-session-mode ' + statusInfo.cls + '">' + statusInfo.label + '</span></div>'
        + '<div class="lc-session-preview">' + esc(s.last_message || 'Belum ada pesan') + '</div>'
        + '</div>'
        + '<div class="lc-session-meta">'
        + '<span class="lc-session-time">' + timeAgo(s.last_message_at) + '</span>'
        + waitEl
        + '<span class="lc-session-unread ' + unreadCls + '">' + s.unread_by_admin + '</span>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function updateSidebarBadge() {
    var badge = $('lcSidebarBadge');
    if (!badge) return;

    var unread = ctx.sessions.reduce(function (sum, s) { return sum + (s.unread_by_admin || 0); }, 0);
    var waiting = ctx.sessions.filter(function (s) { return s.mode === 'connecting'; }).length;
    var total = unread + waiting;
    if (total > 0) {
      badge.style.display = '';
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.background = waiting > 0 ? '#F59E0B' : '';
      badge.classList.toggle('lc-badge-pulse', waiting > 0);
    } else {
      badge.style.display = 'none';
      badge.style.background = '';
      badge.classList.remove('lc-badge-pulse');
    }
  }

  // ── Inbox Summary Cards ───────────────────────
  function renderInboxSummary() {
    var el = $('lcInboxSummary');
    if (!el) return;

    var ai = 0, waiting = 0, active = 0;
    for (var i = 0; i < ctx.sessions.length; i++) {
      var s = ctx.sessions[i];
      if (s.mode === 'connecting') waiting++;
      else if (s.mode === 'admin') active++;
      else ai++;
    }

    var f = ctx.activeFilter;
    var sel = function (val) { return f === val ? ' lc-inbox-summary-card--selected' : ''; };

    el.innerHTML =
      '<div class="lc-inbox-summary-card lc-inbox-summary-card--ai' + sel('ai') + '" onclick="window.__lcSwitchFilter(\'ai\')">'
      + '<span class="lc-inbox-summary-num">' + ai + '</span>'
      + '<span class="lc-inbox-summary-label">AI</span>'
      + '</div>'
      + '<div class="lc-inbox-summary-card lc-inbox-summary-card--waiting' + sel('connecting') + '" onclick="window.__lcSwitchFilter(\'connecting\')">'
      + '<span class="lc-inbox-summary-num">' + waiting + '</span>'
      + '<span class="lc-inbox-summary-label">Menunggu</span>'
      + '</div>'
      + '<div class="lc-inbox-summary-card lc-inbox-summary-card--active' + sel('admin') + '" onclick="window.__lcSwitchFilter(\'admin\')">'
      + '<span class="lc-inbox-summary-num">' + active + '</span>'
      + '<span class="lc-inbox-summary-label">Aktif</span>'
      + '</div>'
      + '<div class="lc-inbox-summary-card lc-inbox-summary-card--closed" onclick="window.__lcSwitchFilter(\'closed\')">'
      + '<span class="lc-inbox-summary-num">' + ctx.closedCount + '</span>'
      + '<span class="lc-inbox-summary-label">Selesai</span>'
      + '</div>';
  }

  // ── Tab Badges ──────────────────────────────────
  function updateTabBadges() {
    var activeBadge = $('lcTabBadgeActive');
    var historyBadge = $('lcTabBadgeHistory');
    if (activeBadge) activeBadge.textContent = ctx.sessions.length;
    if (historyBadge) historyBadge.textContent = ctx.closedCount;
  }

  // ── Filter Switching (Summary Cards) ────────────
  function switchInboxFilter(filter) {
    // "closed" → switch to history tab
    if (filter === 'closed') {
      ctx.activeFilter = null;
      switchInboxTab('history');
      return;
    }

    // If on history tab, switch back to active first
    if (ctx.activeTab === 'history') {
      switchInboxTab('active');
    }

    // Toggle: klik filter yang sama → reset ke semua
    if (ctx.activeFilter === filter) {
      ctx.activeFilter = null;
    } else {
      ctx.activeFilter = filter;
    }

    ctx.activeSessionId = null;
    renderInboxSummary();
    renderSessionList();

    // Reset chat area
    var chatEl = $('lcInboxChat');
    if (chatEl) {
      chatEl.innerHTML =
        '<div class="lc-inbox-empty">'
        + '<i data-lucide="messages-square"></i>'
        + '<h3>Inbox Chat</h3>'
        + '<p>Pilih sesi chat untuk melihat percakapan</p>'
        + '</div>';
    }
  }

  // ── Tab Switching ───────────────────────────────
  function switchInboxTab(tab) {
    ctx.activeTab = tab;
    ctx.activeSessionId = null;
    ctx.activeFilter = null; // reset filter when switching tabs

    // Update tab buttons
    var tabs = document.querySelectorAll('.lc-inbox-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
    }

    // Hide/show summary (only show on active tab)
    var summary = $('lcInboxSummary');
    if (summary) summary.style.display = tab === 'active' ? '' : 'none';

    // Re-render summary to clear filter selected state
    if (tab === 'active') renderInboxSummary();

    if (tab === 'history') {
      loadClosedSessions();
      var cw = $('lcClearHistoryWrap');
      if (cw) cw.style.display = ctx.closedCount > 0 ? '' : 'none';
    } else {
      renderSessionList();
      var cw = $('lcClearHistoryWrap');
      if (cw) cw.style.display = 'none';
    }

    // Reset chat area
    var chatEl = $('lcInboxChat');
    if (chatEl) {
      chatEl.innerHTML =
        '<div class="lc-inbox-empty">'
        + '<i data-lucide="messages-square"></i>'
        + '<h3>' + (tab === 'history' ? 'Riwayat Chat' : 'Inbox Chat') + '</h3>'
        + '<p>Pilih sesi untuk melihat percakapan</p>'
        + '</div>';
    }
  }

  // ── Load Closed Count ───────────────────────────
  function loadClosedCount() {
    if (!state || !state.session || !state.session.sb) return;
    state.session.sb
      .from('chat_sessions')
      .select('session_id', { count: 'exact', head: true })
      .eq('status', 'closed')
      .then(function (res) {
        ctx.closedCount = res.count || 0;
        updateTabBadges();
        renderInboxSummary();
        // Update clear history link visibility
        var cw = $('lcClearHistoryWrap');
        if (cw) cw.style.display = (ctx.closedCount > 0 && ctx.activeTab === 'history') ? '' : 'none';
      })
      .catch(function () { /* ignore */ });
  }

  // ── Load Closed Sessions ────────────────────────
  function loadClosedSessions() {
    if (!state || !state.session || !state.session.sb) return;

    state.session.sb
      .from('chat_sessions')
      .select('*')
      .eq('status', 'closed')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(50)
      .then(function (res) {
        ctx.closedSessions = res.data || [];
        renderSessionList();
      })
      .catch(function (e) {
        console.error('[live-chat] load closed sessions error:', e);
        renderSessionList();
      });
  }

  // ── Select Session ─────────────────────────────
  async function selectSession(sessionId) {
    ctx.activeSessionId = sessionId;
    renderSessionList();

    // Mark as read (only for active sessions)
    if (state && state.session && state.session.sb) {
      var isClosed = ctx.activeTab === 'history';
      if (!isClosed) {
        await state.session.sb
          .from('chat_sessions')
          .update({ unread_by_admin: 0 })
          .eq('session_id', sessionId);
      }
    }

    // Reload to get updated unread
    if (ctx.activeTab !== 'history') loadAdminSessions();

    // Subscribe to typing broadcast channel for this session
    if (state && state.session && state.session.sb && ctx.activeTab !== 'history') {
      // Cleanup previous typing channels if switching sessions
      if (ctx.adminTypingCh && ctx._lastTypingSession !== sessionId) {
        try { ctx.adminTypingCh.unsubscribe(); } catch (e) { /* */ }
      }
      if (ctx._customerTypingCh && ctx._lastTypingSession !== sessionId) {
        try { ctx._customerTypingCh.unsubscribe(); } catch (e) { /* */ }
      }
      if (!ctx.adminTypingCh || ctx._lastTypingSession !== sessionId) {
        var typingChName = 'lc-typing:' + sessionId;
        ctx.adminTypingCh = state.session.sb.channel(typingChName)
          .on('broadcast', { event: 'customer_typing' }, function () {
            var typingEl = $('lcCustomerTyping');
            if (typingEl) {
              typingEl.classList.add('show');
              var msgContainer = typingEl.parentElement;
              if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
              clearTimeout(ctx._customerTypingTimer);
              ctx._customerTypingTimer = setTimeout(function () {
                if (typingEl) typingEl.classList.remove('show');
              }, 2500);
            }
          })
          .subscribe(function (status) {
            if (status === 'SUBSCRIBED') {
              console.log('[live-chat] admin typing channel subscribed for', sessionId);
            }
          });
        ctx._lastTypingSession = sessionId;
      }
    }

    loadAdminMessages(sessionId);
  }

  async function loadAdminMessages(sessionId) {
    if (!state || !state.session || !state.session.sb) return;

    var chatEl = $('lcInboxChat');
    if (!chatEl) return;

    var isHistory = ctx.activeTab === 'history';
    var sessionList = isHistory ? ctx.closedSessions : ctx.sessions;
    var session = sessionList.find(function (s) { return s.session_id === sessionId; });
    if (!session) return;

    var isClosed = session.status === 'closed';
    var isAdmin = !isClosed && session.mode === 'admin' &&
      session.handled_by === getAdminName();

    chatEl.innerHTML =
      '<div class="lc-inbox-chat-head">'
      + '<div class="lc-session-avatar" style="width:36px;height:36px;font-size:13px;border-radius:10px">' + esc((session.customer_name || 'C').charAt(0).toUpperCase()) + '</div>'
      + '<div>'
      + '<div class="lc-inbox-chat-name">' + esc(session.customer_name) + '</div>'
      + '<div class="lc-inbox-chat-phone">' + (session.customer_phone ? esc(session.customer_phone) : 'Tidak ada nomor HP') + '</div>'
      + '</div>'
      + '<div class="lc-inbox-chat-actions">'
      + (isClosed
        ? '<span style="font-size:11px;color:var(--muted,#6E6A5E);font-weight:600"><i data-lucide="lock" style="margin-right:4px"></i>Ditutup</span>'
        : (session.mode === 'admin'
          ? '<button class="lc-takeover-btn taken" disabled><i data-lucide="check" style="margin-right:4px"></i>' + esc(session.handled_by || 'Ditangani') + '</button>'
          : '<button class="lc-takeover-btn" onclick="window.__lcTakeover(\'' + sessionId + '\')"><i data-lucide="hand" style="margin-right:4px"></i>Takeover</button>'))
      + (isClosed ? '<button class="lc-delete-session-btn" onclick="window.__lcDeleteSession(\'' + s.session_id + '\')" title="Hapus sesi"><i data-lucide="trash-2"></i></button>' : '<button class="lc-close-session-btn" onclick="window.__lcCloseSession(\'' + sessionId + '\')"><i data-lucide="x" style="margin-right:3px"></i>Tutup</button>')
      + '</div>'
      + '</div>'
      + '<div class="lc-inbox-messages" id="lcAdminMessages">'
      + '<div class="lc-typing" id="lcCustomerTyping"><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div></div>'
      + '</div>'
      + '<div class="lc-inbox-input-area">'
      + (isClosed
        ? '<textarea class="lc-inbox-input" disabled placeholder="Sesi telah ditutup" rows="1" style="opacity:0.5"></textarea>'
          + '<button class="lc-inbox-send" disabled style="opacity:0.4"><i data-lucide="send"></i></button>'
        : (isAdmin
          ? '<textarea class="lc-inbox-input" id="lcAdminInput" placeholder="Balas pesan..." rows="1"></textarea>'
            + '<button class="lc-inbox-send" id="lcAdminSendBtn"><i data-lucide="send"></i></button>'
          : '<textarea class="lc-inbox-input" id="lcAdminInput" disabled placeholder="' + (session.mode === 'admin' ? 'Ditangani oleh ' + esc(session.handled_by || 'admin lain') : 'Klik Takeover untuk mengambil alih dan membalas') + '" rows="1" style="opacity:0.6"></textarea>'
            + '<button class="lc-inbox-send" id="lcAdminSendBtn" disabled style="opacity:0.6"><i data-lucide="send"></i></button>'))
      + '</div>';

    // Load messages
    try {
      var { data } = await state.session.sb
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      var msgEl = $('lcAdminMessages');
      if (!msgEl) return;

      ctx.adminMessages[sessionId] = data || [];

      if (!ctx.adminMessages[sessionId].length) {
        msgEl.innerHTML = '<div class="lc-pill lc-pill--info"><i data-lucide="message-circle" class="lc-pill-icon"></i><span class="lc-pill-text">Belum ada pesan</span></div>';
      } else {
        renderAdminMessages(sessionId);
      }
    } catch (e) {
      console.error('[live-chat] load admin messages error:', e);
    }

    // Bind send + typing broadcast
    var sendBtn = $('lcAdminSendBtn');
    var adminInput = $('lcAdminInput');
    if (sendBtn && isAdmin) {
      sendBtn.onclick = function () { sendAdminReply(sessionId); };
      adminInput.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAdminReply(sessionId); }
      };
      adminInput.oninput = function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        // Broadcast typing to customer
        if (ctx.adminTypingCh) {
          try {
            ctx.adminTypingCh.send({ type: 'broadcast', event: 'admin_typing', payload: {} });
          } catch (e) { /* channel not ready */ }
        }
      };
    }
  }

  function renderAdminMessages(sessionId) {
    var msgEl = $('lcAdminMessages');
    if (!msgEl) return;

    var msgs = ctx.adminMessages[sessionId] || [];
    msgEl.innerHTML = msgs.map(function (m) {
      // System message → centered pill
      if (isSystemMessage(m)) {
        var pillType = getSystemPillType(m);
        return renderSystemPill(m.message, pillType, m.created_at);
      }

      // FIX BUG 1: Gunakan sender_type === 'ai' sebagai primary check,
      // fallback ke pengecekan nama kalau sender_type tidak tersedia.
      var isAi = m.sender_type === 'ai' || /\bai\s*assistant\b/i.test(m.sender_name || '');
      var cls;
      if (m.sender_type === 'customer') {
        cls = 'lc-msg--customer';
      } else if (isAi) {
        cls = 'lc-msg--ai';
      } else {
        cls = 'lc-msg--admin';
      }

      // FIX BUG 2: Tampilkan sender label untuk AI juga, bukan hanya admin
      var senderHtml = '';
      if (m.sender_type === 'admin') {
        senderHtml = '<span class="lc-msg-sender">' + esc(m.sender_name || 'Admin') + '</span>';
      } else if (isAi) {
        senderHtml = '<span class="lc-msg-sender lc-msg-sender--ai">G5 AI</span>';
      }

      var t = m.created_at ? new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';

      // Cleanup JSON fragment dari pesan lama di DB
      var cleanMsg = m.message || '';
      if (typeof cleanMsg === 'string') {
        cleanMsg = cleanMsg.replace(/,\s*"\s*escalate\s*"\s*:\s*(true|false)\s*\}\s*$/, '');
        cleanMsg = cleanMsg.replace(/"\s*escalate\s*"\s*:\s*(true|false)\s*\}\s*$/, '');
        cleanMsg = cleanMsg.replace(/^\s*\{[^}]*"escalate"\s*:\s*(true|false)\s*\}\s*/, '');
        cleanMsg = cleanMsg.trim();
      }

      // FIX: AI juga pakai markdown parsing sama seperti admin
      var msgContent = '';
      if ((m.sender_type === 'admin' || isAi) && typeof marked !== 'undefined') {
        msgContent = marked.parse(cleanMsg);
      } else {
        msgContent = esc(cleanMsg).replace(/\n/g, '<br>');
      }

      // FIX BUG 3: Tambah badge AI icon di bubble
      var aiBadge = isAi ? '<span class="lc-ai-badge" title="G5 AI Assistant">&#x2728;</span>' : '';
      var checkHtml = (cls.indexOf('customer') !== -1) ? '<span class="lc-msg-check">\u2713\u2713</span>' : '';
      return '<div class="lc-msg ' + cls + '">'
        + senderHtml
        + aiBadge
        + '<div class="lc-msg-body">' + msgContent + '</div>'
        + '<span class="lc-msg-time">' + t + checkHtml + '</span>'
        + '</div>';
    }).join('');

    msgEl.scrollTop = msgEl.scrollHeight;
  }

  async function sendAdminReply(sessionId) {
    var input = $('lcAdminInput');
    var text = input ? input.value.trim() : '';
    if (!text) return;

    if (input) { input.value = ''; input.style.height = 'auto'; }

    var adminName = getAdminName();

    try {
      var { data: inserted, error } = await state.session.sb
        .from('chat_messages')
        .insert([{
          session_id: sessionId,
          sender_type: 'admin',
          sender_name: adminName,
          message: text,
        }])
        .select()
        .single();

      if (error) throw error;

      // Update session
      await state.session.sb
        .from('chat_sessions')
        .update({
          last_message: text,
          last_message_at: new Date().toISOString(),
          unread_by_customer: 1,
        })
        .eq('session_id', sessionId);

      // Push with real DB ID so realtime echo won't duplicate
      if (!ctx.adminMessages[sessionId]) ctx.adminMessages[sessionId] = [];
      if (inserted) {
        ctx.adminMessages[sessionId].push(inserted);
        renderAdminMessages(sessionId);
      }

      // Reload sessions for updated last_message
      loadAdminSessions();
    } catch (e) {
      console.error('[live-chat] send admin reply error:', e);
    }
  }

  // ── Takeover ───────────────────────────────────
  async function takeoverSession(sessionId) {
    var adminName = getAdminName();

    try {
      // Race guard: only update if mode is NOT already 'admin' (prevents double takeover)
      var { data: updated, error } = await state.session.sb
        .from('chat_sessions')
        .update({
          mode: 'admin',
          handled_by: adminName,
        })
        .eq('session_id', sessionId)
        .neq('mode', 'admin')
        .select()
        .single();

      if (error) throw error;

      // If no rows were updated, another admin already took over
      if (!updated) {
        if (typeof toast === 'function') toast('Chat sudah diambil alih admin lain', 'warning');
        loadAdminSessions();
        return;
      }

      // Update local session data immediately so UI reflects without waiting for reload
      var localSession = ctx.sessions.find(function (s) { return s.session_id === sessionId; });
      if (localSession) {
        localSession.mode = 'admin';
        localSession.handled_by = adminName;
      }

      // Add system message
      await state.session.sb
        .from('chat_messages')
        .insert([{
          session_id: sessionId,
          sender_type: 'admin',
          sender_name: 'Sistem',
          message: adminName + ' telah mengambil alih percakapan ini.',
        }]);

      if (typeof toast === 'function') toast('Chat diambil alih');
      loadAdminSessions();
      loadAdminMessages(sessionId);
    } catch (e) {
      console.error('[live-chat] takeover error:', e);
      if (typeof toast === 'function') toast('Gagal mengambil alih', 'error');
    }
  }

  // ── Close Session ──────────────────────────────
  async function closeSession(sessionId) {
    if (typeof showConfirm === 'function') {
      var ok = await showConfirm('Tutup sesi chat ini? Customer tidak bisa mengirim pesan lagi.', 'Tutup Sesi?', 'warning');
      if (!ok) return;
    }

    try {
      await state.session.sb
        .from('chat_sessions')
        .update({ status: 'closed' })
        .eq('session_id', sessionId);

      if (ctx.activeSessionId === sessionId) {
        ctx.activeSessionId = null;
        var chatEl = $('lcInboxChat');
        if (chatEl) {
          chatEl.innerHTML =
            '<div class="lc-inbox-empty">'
            + '<i data-lucide="messages-square"></i>'
            + '<h3>Inbox Chat</h3>'
            + '<p>Pilih sesi chat untuk melihat percakapan</p>'
            + '</div>';
        }
      }

      loadAdminSessions();
      loadClosedCount();
      if (typeof toast === 'function') toast('Sesi chat ditutup');
    } catch (e) {
      console.error('[live-chat] close session error:', e);
    }
  }

  // ── Admin Realtime ─────────────────────────────
  function subscribeAdminRealtime() {
    if (!state || !state.session || !state.session.sb) return;
    if (ctx.adminRtChannel) {
      try { ctx.adminRtChannel.unsubscribe(); } catch (e) { /* */ }
    }

    ctx.adminRtChannel = state.session.sb.channel('chat:admin:all')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      }, function (payload) {
        var m = payload.new;
        if (!m) return;

        // Notif bunyi hanya untuk customer message, dan hanya admin/editor di dashboard
        if (m.sender_type === 'customer') {
          var curRole = state && state.session && state.session.currentUser && state.session.currentUser.role;
          var isDashboard = $('view-dashboard') && $('view-dashboard').classList.contains('active');
          if ((curRole === 'admin' || curRole === 'editor') && isDashboard) {
            playNotifSound();
          }
        }

        // If we're viewing this session, add the message
        if (ctx.activeSessionId === m.session_id) {
          if (!ctx.adminMessages[m.session_id]) ctx.adminMessages[m.session_id] = [];
          var exists = ctx.adminMessages[m.session_id].some(function (existing) {
            return existing.id === m.id ||
              (existing.message === m.message && existing.sender_type === m.sender_type &&
               Math.abs(new Date(existing.created_at) - new Date(m.created_at)) < 5000);
          });
          if (!exists) {
            ctx.adminMessages[m.session_id].push(m);
            renderAdminMessages(m.session_id);
            // Hide customer typing indicator when message arrives
            var custTypingEl = $('lcCustomerTyping');
            if (custTypingEl) custTypingEl.classList.remove('show');
            clearTimeout(ctx._customerTypingTimer);
          }
        }

        // Reload sessions to update last_message and unread
        loadAdminSessions();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_sessions',
      }, function (payload) {
        var s = payload.new;
        var old = payload.old;
        // Escalation: mode berubah ke 'connecting'
        if (s && s.mode === 'connecting' && old && old.mode !== 'connecting') {
          var curRole = state && state.session && state.session.currentUser && state.session.currentUser.role;
          var isDashboard = $('view-dashboard') && $('view-dashboard').classList.contains('active');
          if ((curRole === 'admin' || curRole === 'editor') && isDashboard) {
            playEscalationSound();
            showEscalationToast(s.customer_name, s.session_id);
          }
        }
        loadAdminSessions();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_sessions',
      }, function () {
        loadAdminSessions();
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          console.log('[live-chat] admin realtime subscribed');
        }
      });
  }


  // ── Delete Session ──────────────────────────
  async function deleteSession(sessionId) {
    if (!state || !state.session || !state.session.sb) return;
    var ok = typeof showConfirm === 'function' ? await showConfirm('Hapus sesi chat ini? Pesan-pesan akan ikut terhapus.', 'Hapus Sesi', 'delete') : confirm('Hapus sesi chat ini?');
    if (!ok) return;

    try {
      await state.session.sb.from('chat_messages').delete().eq('session_id', sessionId);
      await state.session.sb.from('chat_sessions').delete().eq('session_id', sessionId);
      ctx.closedSessions = ctx.closedSessions.filter(function(s) { return s.session_id !== sessionId; });
      ctx.closedCount = Math.max(0, ctx.closedCount - 1);
      updateTabBadges();
      renderInboxSummary();
      renderSessionList();
      if (ctx.activeSessionId === sessionId) {
        ctx.activeSessionId = null;
        var chatEl = $('lcInboxChat');
        if (chatEl) {
          chatEl.innerHTML = '<div class="lc-inbox-empty"><i data-lucide="messages-square"></i><h3>Riwayat Chat</h3><p>Pilih sesi untuk melihat percakapan</p></div>';
        }
      }
    } catch (e) {
      console.error('[live-chat] delete session error:', e);
    }
  }

  // ── Clear All History ──────────────────────────
  async function clearAllHistory() {
    if (!state || !state.session || !state.session.sb) return;
    var ok = typeof showConfirm === 'function' ? await showConfirm('Hapus semua riwayat chat? Tindakan ini tidak bisa dibatalkan.', 'Hapus Semua Riwayat', 'delete') : confirm('Hapus semua riwayat chat?');
    if (!ok) return;

    try {
      await state.session.sb.from('chat_messages').delete().in('session_id', ctx.closedSessions.map(function(s) { return s.session_id; }));
      await state.session.sb.from('chat_sessions').delete().in('session_id', ctx.closedSessions.map(function(s) { return s.session_id; }));
      ctx.closedSessions = [];
      ctx.closedCount = 0;
      ctx.activeSessionId = null;
      updateTabBadges();
      renderInboxSummary();
      renderSessionList();
      var chatEl = $('lcInboxChat');
      if (chatEl) {
        chatEl.innerHTML = '<div class="lc-inbox-empty"><i data-lucide="circle-check" style="color:#15803D"></i><h3>Riwayat Dihapus</h3><p>Semua riwayat chat telah dihapus.</p></div>';
      }
      var cw = $('lcClearHistoryWrap');
      if (cw) cw.style.display = 'none';
    } catch (e) {
      console.error('[live-chat] clear history error:', e);
    }
  }

  // ═══════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════

  window.__lcToggle = function () { toggleCustomerPopup(); };

  window.__lcMaximize = function () { toggleCustomerMaximize(); };

  window.__lcSelectSession = function (id) { selectSession(id); };

  window.__lcTakeover = function (id) { takeoverSession(id); };

  window.__lcCloseSession = function (id) { closeSession(id); };

  window.__lcSwitchTab = function (tab) { switchInboxTab(tab); };

  window.__lcSwitchFilter = function (filter) { switchInboxFilter(filter); };

  window.__lcDeleteSession = function (id) { deleteSession(id); };

  window.__lcClearHistory = function () { clearAllHistory(); };

  window.__lcOpenWithMessage = function (msg) {
    ctx.pendingMessage = msg;
    if (!ctx.isOpen) {
      toggleCustomerPopup();
    } else {
      var inp = $('lcInput');
      if (inp) {
        inp.value = msg;
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
        inp.focus();
        ctx.pendingMessage = null;
      }
    }
  };



  // ═══════════════════════════════════════════════════
  //  NAGGING TIMER (Reminder berulang buat session 'connecting')
  // ═══════════════════════════════════════════════════

  function stopNaggingTimer() {
    if (ctx._naggingTimer) {
      clearInterval(ctx._naggingTimer);
      ctx._naggingTimer = null;
    }
  }

  function startNaggingTimer() {
    stopNaggingTimer();
    // Cek tiap 30 detik, tapi toast muncul tiap 2 menit (diatur via _lastNag)
    var lastNagTimes = {}; // sessionId → timestamp terakhir nag
    var CHECK_INTERVAL = 30000; // 30 detik
    var NAG_INTERVAL = 120000; // 2 menit antar nag per session

    ctx._naggingTimer = setInterval(function () {
      // Pastikan admin masih login dan di dashboard
      var isDashboard = $('view-dashboard') && $('view-dashboard').classList.contains('active');
      var curRole = state && state.session && state.session.currentUser && state.session.currentUser.role;
      if (!isDashboard || (curRole !== 'admin' && curRole !== 'editor')) return;

      // Cari session yang masih connecting dan belum di-nag dalam 2 menit terakhir
      var now = Date.now();
      var waitingSessions = ctx.sessions.filter(function (s) {
        if (s.mode !== 'connecting') return false;
        var lastNag = lastNagTimes[s.session_id] || 0;
        return (now - lastNag) >= NAG_INTERVAL;
      });

      if (!waitingSessions.length) return;

      // Tampilkan nagging toast (paling lama menunggu dulu)
      waitingSessions.sort(function (a, b) {
        return new Date(a.updated_at || a.last_message_at) - new Date(b.updated_at || b.last_message_at);
      });

      // Ambil maksimal 1 session per cycle biar ga spam
      var target = waitingSessions[0];
      lastNagTimes[target.session_id] = now;

      var wm = waitingMinutes(target.updated_at || target.last_message_at);
      var urgency = wm >= 6 ? 'urgent' : (wm >= 3 ? 'warn' : 'normal');

      showAlertToast({
        customerName: target.customer_name,
        sessionId: target.session_id,
        customerPhone: target.customer_phone || '',
        urgency: urgency,
      });

      playEscalationSound();

      // Cleanup lastNagTimes untuk session yang sudah bukan connecting
      for (var id in lastNagTimes) {
        var stillWaiting = ctx.sessions.some(function (s) { return s.session_id === id && s.mode === 'connecting'; });
        if (!stillWaiting) delete lastNagTimes[id];
      }
    }, CHECK_INTERVAL);
  }

  // ═══════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════

  // ── Initialize admin chat features (sessions + realtime) ──
  function initAdminChat() {
    if (!state || !state.session || !state.session.currentUser) return;
    loadAdminSessions();
    loadClosedCount();
    subscribeAdminRealtime();
    startNaggingTimer();
    // Auto-refresh session list tiap 30 detik biar waiting time indicator update
    if (ctx._sessionListTimer) clearInterval(ctx._sessionListTimer);
    ctx._sessionListTimer = setInterval(function () {
      var isDashboard = $('view-dashboard') && $('view-dashboard').classList.contains('active');
      if (isDashboard && ctx.sessions.some(function (s) { return s.mode === 'connecting'; })) {
        renderSessionList();
      }
    }, 30000);
  }

  // ── Ensure inbox panel stays stable via MutationObserver ──
  function ensureInboxStable() {
    if (ctx._inboxObsSetup) return;
    var dc = $('dashContent');
    if (!dc) return;
    ctx._inboxObsSetup = true;
    var obs = new MutationObserver(function () {
      if (state && state.admin && state.admin.panel === 'chat' && !$('lcInbox')) {
        var el = $('dashContent');
        var ti = $('dashTitle');
        if (ti) ti.textContent = 'Live Chat';
        if (el) renderAdminInbox(el);
      }
    });
    obs.observe(dc, { childList: true });
    if (ctx.inboxObserver) {
      try { ctx.inboxObserver.disconnect(); } catch (e) { /* */ }
    }
    ctx.inboxObserver = obs;
  }

  function init() {
    buildCustomerUI();
    hookRenderDash();

    // If already logged in and on dashboard, inject sidebar item
    if (state && state.session && state.session.currentUser) {
      var dashView = $('view-dashboard');
      if (dashView && dashView.classList.contains('active')) {
        injectSidebarItem();
        ensureInboxStable();
      }
      initAdminChat();
    }

    // Watch for login → inject sidebar + init admin chat
    var origDoLogin = window.doLogin;
    var origDoAccessLogin = window.doAccessLogin;
    var origDoVisitorLogin = window.doVisitorLogin;

    // Helper: hide customer FAB saat masuk dashboard
    function hideCustomerFab() {
      if (ctx.fabEl && $('view-dashboard') && $('view-dashboard').classList.contains('active')) {
        ctx.fabEl.style.display = 'none';
        if (ctx.isOpen) closeCustomerPopup();
      }
    }

    // Helper: tampilkan customer FAB saat kembali ke katalog
    function showCustomerFab() {
      if (ctx.fabEl) {
        var catalogView = $('view-catalog');
        var isCatalog = catalogView && catalogView.classList.contains('active');
        ctx.fabEl.style.display = isCatalog ? '' : 'none';
      }
    }

    if (origDoLogin) {
      window.doLogin = function () {
        origDoLogin.apply(this, arguments);
        hideCustomerFab();
        setTimeout(function () { injectSidebarItem(); ensureInboxStable(); initAdminChat(); }, 200);
      };
    }
    if (origDoAccessLogin) {
      window.doAccessLogin = function () {
        origDoAccessLogin.apply(this, arguments);
        hideCustomerFab();
        setTimeout(function () { injectSidebarItem(); ensureInboxStable(); initAdminChat(); }, 200);
      };
    }
    if (origDoVisitorLogin) {
      window.doVisitorLogin = function () {
        origDoVisitorLogin.apply(this, arguments);
        hideCustomerFab();
        setTimeout(function () { injectSidebarItem(); ensureInboxStable(); initAdminChat(); }, 200);
      };
    }

    // Hook logout → kembalikan FAB customer kalau di katalog
    var origDoLogout = window.doLogout;
    if (origDoLogout) {
      window.doLogout = function () {
        if (ctx.isOpen) closeCustomerPopup();
        origDoLogout.apply(this, arguments);
        setTimeout(function () {
          showCustomerFab();
        }, 300);
      };
    }

    console.log('[live-chat] module loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

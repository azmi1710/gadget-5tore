
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

    // Admin
    activeSessionId: null,
    adminRtChannel: null,
    sessions: [],
    adminMessages: {},
    inboxObserver: null,
    activeTab: 'active',
    closedSessions: [],
    closedCount: 0,
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
    fab.innerHTML = '<i class="fas fa-comments lc-fab-icon"></i><span class="lc-fab-badge" id="lcFabBadge">0</span>';
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

  function closeCustomerPopup() {
    ctx.popupEl.classList.add('closing');
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
      + '<div class="lc-header-avatar"><i class="fas fa-comments"></i></div>'
      + '<div class="lc-header-info">'
      + '<div class="lc-header-name">Live Chat</div>'
      + '<div class="lc-header-status"><span class="lc-status-dot"></span> Kami siap membantu</div>'
      + '</div>'
      + '<button class="lc-header-close" onclick="window.__lcToggle()"><i class="fas fa-times"></i></button>'
      + '</div>'
      + '<div class="lc-form">'
      + '<div class="lc-form-icon"><i class="fas fa-headset"></i></div>'
      + '<h3>Mulai Chat</h3>'
      + '<p>Isi data Anda untuk memulai percakapan dengan tim kami</p>'
      + '<div class="lc-form-fields">'
      + '<input class="lc-form-input" id="lcFormName" placeholder="Nama Anda" maxlength="50">'
      + '<input class="lc-form-input" id="lcFormPhone" placeholder="No. HP (opsional)" type="tel" maxlength="20">'
      + '<button class="lc-form-submit" id="lcFormSubmit"><i class="fas fa-paper-plane" style="margin-right:6px"></i> Mulai Chat</button>'
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
      + '<div class="lc-header-avatar"><i class="fas fa-comments"></i></div>'
      + '<div class="lc-header-info">'
      + '<div class="lc-header-name">Live Chat</div>'
      + '<div class="lc-header-status"><span class="lc-status-dot" id="lcStatusDot"></span> <span id="lcHeaderStatusText">Terhubung</span> <span class="lc-mode-badge lc-mode-badge--ai" id="lcModeBadge">\uD83E\uDD16 AI</span></div>'
      + '</div>'
      + '<button class="lc-header-close" onclick="window.__lcToggle()"><i class="fas fa-times"></i></button>'
      + '</div>'
      + '<div class="lc-messages" id="lcMessages"></div>'
      + '<div class="lc-input-area">'
      + '<textarea class="lc-input" id="lcInput" placeholder="Ketik pesan..." rows="1"></textarea>'
      + '<button class="lc-send" id="lcSendBtn" title="Kirim"><i class="fas fa-paper-plane"></i></button>'
      + '</div>';

    $('lcSendBtn').onclick = sendCustomerMessage;
    $('lcInput').onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCustomerMessage(); }
    };
    $('lcInput').oninput = function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
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
    // Set initial mode tracking
    if (ctx._prevMode == null && state && state.session) {
      ctx._prevMode = state.session.mode || 'ai';
    }
    if (!ctx.sessionId || !state || !state.session || !state.session.sb) return;

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

  function renderCustomerMessages() {
    var el = $('lcMessages');
    if (!el) return;

    if (!ctx.messages.length) {
      el.innerHTML = '<div class="lc-msg lc-msg--system">Percakapan dimulai. Silakan kirim pesan!</div>';
      return;
    }

    el.innerHTML = ctx.messages.map(function (m) {
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

      return '<div class="lc-msg ' + cls + '">'
        + senderHtml
        + esc(cleanMsg)
        + '<span class="lc-msg-time">' + t + '</span>'
        + '</div>';
    }).join('')
    + '<div class="lc-typing" id="lcTyping"><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div></div>';

    el.scrollTop = el.scrollHeight;
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
      if (shouldEscalate && state && state.session && state.session.sb) {
        console.log('[live-chat] AI escalated, switching session to connecting');
        await state.session.sb
          .from('chat_sessions')
          .update({ mode: 'connecting' })
          .eq('session_id', ctx.sessionId);
        // Update local mode so subsequent messages don't go to AI
        if (state.session) state.session.mode = 'connecting';
        // Update customer UI immediately
        updateCustomerChatStatus('connecting');
        ctx._prevMode = 'connecting';
      }
    } catch (e) {
      console.error('[live-chat] webhook error:', e);
    } finally {
      if (typingEl) typingEl.classList.remove('show');
    }
  }

  // ── Customer Status & Input Control ─────────────
  function updateCustomerChatStatus(mode, adminName) {
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
      ctx.messages.push({
        id: Date.now(),
        sender_type: 'system',
        sender_name: '',
        message: 'Pertanyaan Anda memerlukan bantuan admin. Mohon tunggu sebentar...',
        created_at: new Date().toISOString(),
      });
      renderCustomerMessages();
    } else if (mode === 'admin') {
      statusText.textContent = adminName ? 'Admin: ' + adminName : 'Admin sedang melayani';
      if (statusDot) { statusDot.classList.remove('offline', 'connecting'); }
      if (modeBadge) { modeBadge.style.display = 'none'; }
      if (input) { input.disabled = false; input.placeholder = 'Ketik pesan...'; }
      if (sendBtn) sendBtn.disabled = false;
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
            inputArea.innerHTML = '<button class="lc-form-submit" id="lcNewSessionBtn" style="width:100%;margin-top:0"><i class="fas fa-plus" style="margin-right:6px"></i>Mulai Chat Baru</button>';
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
          if (statusText) {
            if (s.mode === 'admin') {
              statusText.textContent = 'Admin: ' + (s.handled_by || '');
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
  }

  // ── Customer Cleanup ───────────────────────────
  function cleanupCustomerRealtime() {
    if (ctx.rtChannel) {
      try { ctx.rtChannel.unsubscribe(); } catch (e) { /* */ }
      ctx.rtChannel = null;
    }
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
    chatItem.innerHTML = '<i class="fas fa-headset"></i> Chat <span class="nav-badge" id="lcSidebarBadge" style="display:none">0</span>';
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

      // Hide G5A FAB when chat panel is active (avoid overlap)
      var isChatPanel = state && state.admin && state.admin.panel === 'chat';
      var g5Fab = $('g5aFab');
      if (g5Fab) g5Fab.style.display = isChatPanel ? 'none' : '';

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

  // ── Admin Inbox ────────────────────────────────
  function renderAdminInbox(el) {
    if (!state || !state.session || !state.session.currentUser) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><p>Akses ditolak</p></div>';
      return;
    }

    el.innerHTML =
      '<div class="lc-inbox" id="lcInbox">'
      + '<div class="lc-inbox-sessions">'
      + '<div class="lc-inbox-sessions-head">'
      + '<h3><i class="fas fa-comments"></i> Sesi Chat</h3>'
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
      + '<button class="lc-clear-history-link" onclick="window.__lcClearHistory()"><i class="fas fa-trash-alt" style="margin-right:3px;font-size:10px"></i>Hapus Semua</button>'
      + '</span>'
      + '</div>'
      + '<div class="lc-inbox-summary" id="lcInboxSummary"></div>'
      + '<div class="lc-inbox-sessions-list" id="lcSessionList"></div>'
      + '</div>'
      + '<div class="lc-inbox-chat" id="lcInboxChat">'
      + '<div class="lc-inbox-empty" id="lcInboxEmpty">'
      + '<i class="fas fa-comments"></i>'
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

    if (countEl) countEl.textContent = list.length;

    if (!list.length) {
      listEl.innerHTML =
        '<div class="lc-sessions-empty">'
        + '<i class="fas fa-inbox"></i>'
        + '<span>' + (isHistory ? 'Belum ada riwayat' : 'Belum ada sesi chat') + '</span>'
        + '</div>';
      return;
    }

    listEl.innerHTML = list.map(function (s) {
      var isActive = ctx.activeSessionId === s.session_id;
      var initial = (s.customer_name || 'C').charAt(0).toUpperCase();
      var statusInfo = getStatusInfo(s);
      var unreadCls = s.unread_by_admin > 0 ? 'show' : '';

      return '<div class="lc-session-item' + (isActive ? ' active' : '') + (s.unread_by_admin > 0 ? ' has-unread' : '') + '" '
        + 'onclick="window.__lcSelectSession(\'' + s.session_id + '\')">'
        + '<div class="lc-session-avatar">' + esc(initial) + '</div>'
        + '<div class="lc-session-info">'
        + '<div class="lc-session-name">' + esc(s.customer_name) + ' <span class="lc-session-mode ' + statusInfo.cls + '">' + statusInfo.label + '</span></div>'
        + '<div class="lc-session-preview">' + esc(s.last_message || 'Belum ada pesan') + '</div>'
        + '</div>'
        + '<div class="lc-session-meta">'
        + '<span class="lc-session-time">' + timeAgo(s.last_message_at) + '</span>'
        + '<span class="lc-session-unread ' + unreadCls + '">' + s.unread_by_admin + '</span>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function updateSidebarBadge() {
    var badge = $('lcSidebarBadge');
    if (!badge) return;

    var total = ctx.sessions.reduce(function (sum, s) { return sum + (s.unread_by_admin || 0); }, 0);
    if (total > 0) {
      badge.style.display = '';
      badge.textContent = total > 99 ? '99+' : total;
    } else {
      badge.style.display = 'none';
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

    el.innerHTML =
      '<div class="lc-inbox-summary-card lc-inbox-summary-card--ai">'
      + '<span class="lc-inbox-summary-num">' + ai + '</span>'
      + '<span class="lc-inbox-summary-label">AI</span>'
      + '</div>'
      + '<div class="lc-inbox-summary-card lc-inbox-summary-card--waiting">'
      + '<span class="lc-inbox-summary-num">' + waiting + '</span>'
      + '<span class="lc-inbox-summary-label">Menunggu</span>'
      + '</div>'
      + '<div class="lc-inbox-summary-card lc-inbox-summary-card--active">'
      + '<span class="lc-inbox-summary-num">' + active + '</span>'
      + '<span class="lc-inbox-summary-label">Aktif</span>'
      + '</div>'
      + '<div class="lc-inbox-summary-card lc-inbox-summary-card--closed">'
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

  // ── Tab Switching ───────────────────────────────
  function switchInboxTab(tab) {
    ctx.activeTab = tab;
    ctx.activeSessionId = null;

    // Update tab buttons
    var tabs = document.querySelectorAll('.lc-inbox-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
    }

    // Hide/show summary (only show on active tab)
    var summary = $('lcInboxSummary');
    if (summary) summary.style.display = tab === 'active' ? '' : 'none';

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
        + '<i class="fas fa-comments"></i>'
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
        ? '<span style="font-size:11px;color:var(--muted,#6E6A5E);font-weight:600"><i class="fas fa-lock" style="margin-right:4px"></i>Ditutup</span>'
        : (session.mode === 'admin'
          ? '<button class="lc-takeover-btn taken" disabled><i class="fas fa-check" style="margin-right:4px"></i>' + esc(session.handled_by || 'Ditangani') + '</button>'
          : '<button class="lc-takeover-btn" onclick="window.__lcTakeover(\'' + sessionId + '\')"><i class="fas fa-hand-paper" style="margin-right:4px"></i>Takeover</button>'))
      + (isClosed ? '<button class="lc-delete-session-btn" onclick="window.__lcDeleteSession(\'' + s.session_id + '\')" title="Hapus sesi"><i class="fas fa-trash"></i></button>' : '<button class="lc-close-session-btn" onclick="window.__lcCloseSession(\'' + sessionId + '\')"><i class="fas fa-times" style="margin-right:3px"></i>Tutup</button>')
      + '</div>'
      + '</div>'
      + '<div class="lc-inbox-messages" id="lcAdminMessages"></div>'
      + '<div class="lc-inbox-input-area">'
      + (isClosed
        ? '<textarea class="lc-inbox-input" disabled placeholder="Sesi telah ditutup" rows="1" style="opacity:0.5"></textarea>'
          + '<button class="lc-inbox-send" disabled style="opacity:0.4"><i class="fas fa-paper-plane"></i></button>'
        : (isAdmin
          ? '<textarea class="lc-inbox-input" id="lcAdminInput" placeholder="Balas pesan..." rows="1"></textarea>'
            + '<button class="lc-inbox-send" id="lcAdminSendBtn"><i class="fas fa-paper-plane"></i></button>'
          : '<textarea class="lc-inbox-input" id="lcAdminInput" disabled placeholder="' + (session.mode === 'admin' ? 'Ditangani oleh ' + esc(session.handled_by || 'admin lain') : 'Klik Takeover untuk mengambil alih dan membalas') + '" rows="1" style="opacity:0.6"></textarea>'
            + '<button class="lc-inbox-send" id="lcAdminSendBtn" disabled style="opacity:0.6"><i class="fas fa-paper-plane"></i></button>'))
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
        msgEl.innerHTML = '<div class="lc-msg lc-msg--system">Belum ada pesan</div>';
      } else {
        renderAdminMessages(sessionId);
      }
    } catch (e) {
      console.error('[live-chat] load admin messages error:', e);
    }

    // Bind send
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
      };
    }
  }

  function renderAdminMessages(sessionId) {
    var msgEl = $('lcAdminMessages');
    if (!msgEl) return;

    var msgs = ctx.adminMessages[sessionId] || [];
    msgEl.innerHTML = msgs.map(function (m) {
      var cls = m.sender_type === 'customer' ? 'lc-msg--customer' : 'lc-msg--admin';
      if (m.sender_name === 'AI Assistant') cls = 'lc-msg--ai';

      var senderHtml = '';
      if (m.sender_type === 'admin') {
        senderHtml = '<span class="lc-msg-sender">' + esc(m.sender_name || 'Admin') + '</span>';
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

      return '<div class="lc-msg ' + cls + '">'
        + senderHtml
        + esc(cleanMsg)
        + '<span class="lc-msg-time">' + t + '</span>'
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
            + '<i class="fas fa-comments"></i>'
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
          }
        }

        // Reload sessions to update last_message and unread
        loadAdminSessions();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_sessions',
      }, function () {
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
          chatEl.innerHTML = '<div class="lc-inbox-empty"><i class="fas fa-comments"></i><h3>Riwayat Chat</h3><p>Pilih sesi untuk melihat percakapan</p></div>';
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
        chatEl.innerHTML = '<div class="lc-inbox-empty"><i class="fas fa-check-circle" style="color:#15803D"></i><h3>Riwayat Dihapus</h3><p>Semua riwayat chat telah dihapus.</p></div>';
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

  window.__lcSelectSession = function (id) { selectSession(id); };

  window.__lcTakeover = function (id) { takeoverSession(id); };

  window.__lcCloseSession = function (id) { closeSession(id); };

  window.__lcSwitchTab = function (tab) { switchInboxTab(tab); };

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
  //  INIT
  // ═══════════════════════════════════════════════════

  // ── Initialize admin chat features (sessions + realtime) ──
  function initAdminChat() {
    if (!state || !state.session || !state.session.currentUser) return;
    loadAdminSessions();
    loadClosedCount();
    subscribeAdminRealtime();
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
          // Setelah logout, currentUser sudah hilang, tampilkan FAB lagi
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

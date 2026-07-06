/* ============================================
   presence.js — Online Presence untuk Dashboard
   Gadget 5tore
   ============================================ */

(function () {
  'use strict';
  if (window.__PRESENCE_LOADED__) return;
  window.__PRESENCE_LOADED__ = true;

  const $ = (id) => document.getElementById(id);

  // ── Internal State ──────────────────────────────────
  const ctx = {
    channel: null,
    myKey: '',
    myName: '',
    myRole: '',
    presences: {},          // { key: { name, role, joinedAt } }
    active: false,          // apakah presence sedang aktif
    cleanupDone: false,
    viewObserver: null,
  };

  // ── Helpers ────────────────────────────────────────
  function roleLabel(r) {
    if (r === 'admin') return 'Admin';
    if (r === 'editor') return 'Editor';
    return 'Viewer';
  }

  function esc(s) {
    if (typeof window.esc === 'function') return window.esc(s);
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Auto-Naming ────────────────────────────────────
  // Urutkan semua user di channel ini berdasarkan joinedAt.
  // Posisi saya dalam urutan itu = nomor saya.
  function calcMyName() {
    const mine = ctx.presences[ctx.myKey];
    if (!mine) return '';

    // Filter hanya user dengan role yang sama dengan saya
    const sameRole = Object.values(ctx.presences)
      .filter(p => p.role === ctx.myRole)
      .sort((a, b) => a.joinedAt - b.joinedAt);

    let num = 1;
    for (const p of sameRole) {
      if (p._key === ctx.myKey) break;
      num++;
    }
    return roleLabel(ctx.myRole) + ' ' + num;
  }

  function recalcAllNames() {
    // Hitung ulang nama untuk semua user di channel yang sama
    // User dari DB (isDBUser) pakai nama asli, lainnya auto-number
    const byRole = {};
    for (const [key, val] of Object.entries(ctx.presences)) {
      if (!byRole[val.role]) byRole[val.role] = [];
      byRole[val.role].push({ ...val, _key: key });
    }
    for (const role of Object.keys(byRole)) {
      byRole[role].sort((a, b) => a.joinedAt - b.joinedAt);
      let autoNum = 1;
      for (const p of byRole[role]) {
        if (p.isDBUser && p.name) {
          // Login via username/password dari DB → pakai nama asli
          ctx.presences[p._key].name = p.name;
        } else {
          // Login via trigger button / viewer → auto-number
          ctx.presences[p._key].name = roleLabel(role) + ' ' + autoNum;
          autoNum++;
        }
      }
    }
  }

  // ── Render Indicator ───────────────────────────────
  function renderIndicator() {
    const container = $('presenceIndicator');
    if (!container) return;

    // Hanya tampil di dashboard dan kalau ada user online
    const dashView = $('view-dashboard');
    const isDashActive = dashView && dashView.classList.contains('active');
    if (!isDashActive || !Object.keys(ctx.presences).length) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'flex';

    // Kelompokkan per role
    const byRole = {};
    for (const val of Object.values(ctx.presences)) {
      if (!byRole[val.role]) byRole[val.role] = [];
      byRole[val.role].push(val);
    }

    // Urutan: admin, editor, viewer
    const roleOrder = ['admin', 'editor', 'viewer'];
    let html = '';
    for (const role of roleOrder) {
      const users = byRole[role];
      if (!users || !users.length) continue;
      const colorClass = role;
      html += '<div class="presence-group presence-group--' + colorClass + '" onclick="window.__presenceTogglePopover(event,\'' + role + '\')">'
        + '<span class="presence-dot"></span>'
        + '<span class="presence-label">' + roleLabel(role) + '</span>'
        + '<span class="presence-count">' + users.length + '</span>'
        + '</div>';
    }
    container.innerHTML = html;
  }

  // ── Render Popover ─────────────────────────────────
  function renderPopover(role) {
    removePopover();

    const users = Object.values(ctx.presences)
      .filter(p => p.role === role)
      .sort((a, b) => a.joinedAt - b.joinedAt);

    if (!users.length) return;

    const popover = document.createElement('div');
    popover.id = 'presencePopover';
    popover.className = 'presence-popover';
    popover.dataset.role = role;

    let listHtml = users.map(function (u) {
      var time = new Date(u.joinedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      var isMe = u._key === ctx.myKey;
      return '<div class="presence-popover-item' + (isMe ? ' is-me' : '') + '">'
        + '<span class="presence-dot-sm"></span>'
        + '<span class="presence-popover-name">' + esc(u.name) + '</span>'
        + '<span class="presence-popover-time">' + time + '</span>'
        + '</div>';
    }).join('');

    popover.innerHTML =
      '<div class="presence-popover-head">'
      + '<span class="presence-popover-title">' + roleLabel(role) + ' Online</span>'
      + '<span class="presence-popover-count">' + users.length + '</span>'
      + '</div>'
      + '<div class="presence-popover-list">' + listHtml + '</div>';

    // Cari trigger yang diklik, taruh popover di sana
    var trigger = document.querySelector('.presence-group--' + role);
    if (trigger) {
      trigger.style.position = 'relative';
      trigger.appendChild(popover);
    }
  }

  function removePopover() {
    var existing = $('presencePopover');
    if (existing) existing.remove();
  }

  // ── Supabase Presence ──────────────────────────────
  function joinPresence() {
    if (!state.session.sb || !state.session.currentUser) return;

    // Force cleanup channel lama kalau masih nyangkut
    if (ctx.channel) {
      try { ctx.channel.untrack(); } catch (e) {}
      try { ctx.channel.unsubscribe(); } catch (e) {}
      ctx.channel = null;
    }
    ctx.cleanupDone = false;
    ctx.active = false;

    var role = state.session.currentUser.role;
    if (!role) return;

    ctx.myRole = role;
    var channelName = 'presence:' + role;
    ctx.myKey = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    try {
      ctx.channel = state.session.sb.channel(channelName, {
        config: { presence: { key: ctx.myKey } }
      });

      ctx.channel
        .on('presence', { event: 'sync' }, function () {
          var raw = ctx.channel.presenceState();
          ctx.presences = {};
          for (var key in raw) {
            if (raw[key] && raw[key][0]) {
              ctx.presences[key] = raw[key][0];
              ctx.presences[key]._key = key;
            }
          }
          recalcAllNames();
          renderIndicator();
        })
        .on('presence', { event: 'join' }, function (payload) {
          var newP = payload.newPresences || [];
          for (var i = 0; i < newP.length; i++) {
            var p = newP[i];
            ctx.presences[p.key || ctx.myKey] = p;
            if (p.key) ctx.presences[p.key]._key = p.key;
          }
          recalcAllNames();
          renderIndicator();
          // Update popover kalau sedang terbuka untuk role ini
          var popover = $('presencePopover');
          if (popover && popover.dataset.role) renderPopover(popover.dataset.role);
        })
        .on('presence', { event: 'leave' }, function (payload) {
          var leftP = payload.leftPresences || [];
          for (var i = 0; i < leftP.length; i++) {
            delete ctx.presences[leftP[i].key || leftP[i]._key];
          }
          recalcAllNames();
          renderIndicator();
          var popover = $('presencePopover');
          if (popover && popover.dataset.role) renderPopover(popover.dataset.role);
        })
        .subscribe(async function (status, err) {
          if (status === 'SUBSCRIBED') {
            try {
              var curUser = state.session.currentUser || {};
              await ctx.channel.track({
                role: ctx.myRole,
                name: curUser.display_name || curUser.username || '',
                joinedAt: Date.now(),
                isDBUser: !!(curUser._isDBLogin),
              });
            } catch (e) {
              console.error('[presence] track error:', e);
            }
            ctx.active = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[presence] channel status:', status, err);
          }
        });
    } catch (e) {
      console.error('[presence] join error:', e);
    }
  }

  async function leavePresence() {
    if (ctx.cleanupDone) return;
    ctx.cleanupDone = true;
    ctx.active = false;

    // Set channel null SEBELUM await — biar joinPresence() gak ke-block
    var oldChannel = ctx.channel;
    ctx.channel = null;
    ctx.presences = {};
    ctx.myName = '';
    removePopover();
    renderIndicator();

    // Cleanup di background (gak perlu nunggu)
    if (oldChannel) {
      try { await oldChannel.untrack(); } catch (e) { /* ignore */ }
      try { await oldChannel.unsubscribe(); } catch (e) { /* ignore */ }
    }
  }

  // ── Watch View Switch ──────────────────────────────
  // Hanya aktifkan presence saat dashboard aktif
  function watchViewSwitch() {
    var dashView = $('view-dashboard');
    if (!dashView || ctx.viewObserver) return;

    ctx.viewObserver = new MutationObserver(function () {
      var isDash = dashView.classList.contains('active');
      var isLoggedIn = !!state.session.currentUser;

      if (isDash && isLoggedIn && !ctx.active) {
        // Rejoin karena sebelumnya leave (switch ke katalog)
        ctx.cleanupDone = false;
        joinPresence();
      } else if (!isDash && ctx.active) {
        // Leave saat pindah ke katalog
        leavePresence();
      }
    });

    ctx.viewObserver.observe(dashView, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  // ── Close popover on outside click ─────────────────
  document.addEventListener('click', function (e) {
    var popover = $('presencePopover');
    if (!popover) return;
    if (popover.contains(e.target)) return;
    if (e.target.closest('.presence-group')) return;
    removePopover();
  });

  // ── Cleanup on page unload ─────────────────────────
  window.addEventListener('beforeunload', function () {
    if (ctx.channel) {
      try { ctx.channel.untrack(); } catch (e) { /* ignore */ }
    }
  });

  // ── PUBLIC API ─────────────────────────────────────

  /**
   * Dipanggil setelah login berhasil.
   * Join ke presence channel sesuai role.
   */
  window.__presenceInit = function () {
    if (!state.session.currentUser) return;
    if (!state.session.sb) {
      console.warn('[presence] Supabase tidak tersedia');
      return;
    }

    // Tampilkan container
    var container = $('presenceIndicator');
    if (container) container.style.display = 'flex';

    // Join kalau dashboard sedang aktif
    var dashView = $('view-dashboard');
    var isDash = dashView && dashView.classList.contains('active');
    if (isDash) {
      joinPresence();
    }

    // Watch view switch
    watchViewSwitch();

    console.log('[presence] initialized, role:', state.session.currentUser.role);
  };

  /**
   * Dipanggil saat logout.
   * Leave presence channel dan cleanup.
   */
  window.__presenceLeave = function () {
    leavePresence();
    if (ctx.viewObserver) {
      ctx.viewObserver.disconnect();
      ctx.viewObserver = null;
    }
    var container = $('presenceIndicator');
    if (container) container.style.display = 'none';
    console.log('[presence] left');
  };

  /**
   * Toggle popover daftar user online per role.
   * Dipanggil dari onclick di HTML.
   */
  window.__presenceTogglePopover = function (event, role) {
    event.stopPropagation();
    var popover = $('presencePopover');
    if (popover && popover.dataset.role === role) {
      removePopover();
      return;
    }
    renderPopover(role);
  };

  /**
   * Ambil nama presence saya saat ini (misal "Admin 1").
   * Berguna untuk fitur live chat nanti (handled_by).
   */
  window.__presenceGetMyName = function () {
    // Pastikan nama ter-update
    var mine = ctx.presences[ctx.myKey];
    return mine ? mine.name : '';
  };

  /**
   * Cek apakah presence aktif.
   */
  window.__presenceIsActive = function () {
    return ctx.active;
  };

  // ── Auto-Hook Login/Logout ─────────────────────────
  function autoHook() {
    var origDoLogin = window.doLogin;
    var origDoAccessLogin = window.doAccessLogin;
    var origDoVisitorLogin = window.doVisitorLogin;
    var origDoLogout = window.doLogout;

    function afterLogin() {
      // Retry up to 10x (every 300ms) until currentUser is ready
      var attempts = 0;
      function tryInit() {
        attempts++;
        if (state && state.session && state.session.currentUser) {
          __presenceInit();
        } else if (attempts < 10) {
          setTimeout(tryInit, 300);
        } else {
          console.warn('[presence] login hook timeout — currentUser not set after 3s');
        }
      }
      setTimeout(tryInit, 150);
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
    if (origDoLogout) {
      window.doLogout = function () {
        __presenceLeave();
        if (origDoLogout) origDoLogout.apply(this, arguments);
      };
    }

    // If already logged in on page load
    if (state && state.session && state.session.currentUser) {
      __presenceInit();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoHook, { once: true });
  } else {
    autoHook();
  }

  console.log('[presence] module loaded');
})();
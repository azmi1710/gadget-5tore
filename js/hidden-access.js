
(function initHiddenAccess() {
  'use strict';
  if (window.__HIDDEN_ACCESS_LOADED__) return;
  window.__HIDDEN_ACCESS_LOADED__ = true;
  const CONFIG = {
    REQUIRED_CLICKS: 3,     // jumlah klik yang dibutuhkan
    CLICK_WINDOW_MS: 3000,  // jendela waktu maksimal antar-klik pertama → terakhir
    STORAGE_KEY: 'ha_last_role', // ingat role terakhir yang dipilih (opsional UX)
  };

  /** State internal modul (tidak bocor ke global) */
  const ctx = {
    clickCount: 0,
    firstClickTs: 0,
    resetTimer: null,
  };

  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════
  const $ = (id) => document.getElementById(id);

  /** Reset penghitung klik — dipanggil saat jeda terlalu lama atau
   *  setelah modal berhasil dipicu. Tidak menimbulkan efek visual. */
  function resetClickTracker() {
    ctx.clickCount = 0;
    ctx.firstClickTs = 0;
    if (ctx.resetTimer) {
      clearTimeout(ctx.resetTimer);
      ctx.resetTimer = null;
    }
  }

  /** Handler klik logo. Mengecek apakah pola 3-klik-dalam-3-detik
   *  terpenuhi. Bila ya → trigger modal akses. */
  function handleLogoClick() {
    const now = Date.now();

    // Klik pertama atau klik setelah jeda panjang → mulai dari awal
    if (ctx.clickCount === 0 || now - ctx.firstClickTs > CONFIG.CLICK_WINDOW_MS) {
      ctx.clickCount = 1;
      ctx.firstClickTs = now;
    } else {
      ctx.clickCount += 1;
    }

    // Bersihkan timer reset sebelumnya lalu pasang ulang
    if (ctx.resetTimer) clearTimeout(ctx.resetTimer);
    ctx.resetTimer = setTimeout(resetClickTracker, CONFIG.CLICK_WINDOW_MS);

    // Cukup klik → buka modal akses
    if (ctx.clickCount >= CONFIG.REQUIRED_CLICKS) {
      resetClickTracker();
      openAccessModal();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL AKSES (ROLE CHOOSER)
  // ═══════════════════════════════════════════════════════════════

  /** Definisi role yang tersedia di modal akses.
   *  Hanya admin & editor yang ditampilkan sesuai requirement.
   *  Setiap role punya kredensial demo yang dipakai untuk auto-login
   *  (tanpa perlu user mengetik username/password). */
  const ACCESS_ROLES = [
    {
      key: 'admin',
      label: 'Admin',
      desc: 'Akses penuh ke seluruh modul dashboard',
      icon: 'fas fa-user-shield',
      accent: 'admin',
      demoUser: 'admin',
      demoPass: 'admin123',
    },
    {
      key: 'editor',
      label: 'Editor',
      desc: 'Kelola produk, cabang & promo',
      icon: 'fas fa-user-pen',
      accent: 'editor',
      demoUser: 'editor1',
      demoPass: 'editor123',
    },
  ];

  /** Bangun markup modal akses (dipanggil sekali saat DOM ready). */
  function buildAccessModal() {
    if ($('accessModal')) return; // sudah dibangun

    const modal = document.createElement('div');
    modal.className = 'modal-bg access-modal-bg';
    modal.id = 'accessModal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="access-card" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
        <button class="detail-close access-close-btn" id="accessCloseBtn"
                aria-label="Tutup" title="Tutup">
          <i class="fas fa-times"></i>
        </button>

        <div class="access-head">
          <div class="access-head-icon"><i class="fas fa-shield-halved"></i></div>
          <h2 id="accessTitle">Pilih Akses</h2>
          <p>Pilih jenis akun yang ingin Anda gunakan</p>
        </div>

        <div class="access-body">
          <div class="access-grid" id="accessGrid">
            ${ACCESS_ROLES.map(buildRoleCard).join('')}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Tutup saat klik backdrop
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAccessModal();
    });

    // Tombol X
    $('accessCloseBtn')?.addEventListener('click', closeAccessModal);

    // Card role → auto-login langsung (tanpa form username/password)
    modal.querySelectorAll('[data-role-key]').forEach((card) => {
      card.addEventListener('click', () => {
        const key = card.dataset.roleKey;
        pickRole(key);
      });
    });
  }

  /** Template satu card role */
  function buildRoleCard(r) {
    return `
      <button type="button" class="role-card role-card--${r.accent}"
              data-role-key="${r.key}">
        <div class="role-card-icon"><i class="${r.icon}"></i></div>
        <div class="role-card-body">
          <div class="role-card-title">${r.label}</div>
          <div class="role-card-desc">${r.desc}</div>
        </div>
        <div class="role-card-arrow"><i class="fas fa-arrow-right"></i></div>
        <div class="role-card-shine"></div>
      </button>
    `;
  }

  /** Tampilkan modal akses dengan animasi halus. */
  function openAccessModal() {
    buildAccessModal();
    const modal = $('accessModal');
    if (!modal) return;

    // Tutup login dulu bila terbuka (jaga-jaga)
    if (typeof window.closeLogin === 'function') {
      try { window.closeLogin(); } catch (_) {}
    }

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');

    // Animasi stagger untuk card role
    const cards = modal.querySelectorAll('.role-card');
    cards.forEach((c, i) => {
      c.style.animation = 'none';
      // Reflow to restart animation
      void c.offsetWidth;
      c.style.animation = `accessCardIn .42s cubic-bezier(.2,.9,.3,1.2) ${0.08 + i * 0.08}s both`;
    });

    // Fokus ke card pertama untuk accessibility
    setTimeout(() => cards[0]?.focus(), 120);
  }

  /** Tutup modal akses. */
  function closeAccessModal() {
    const modal = $('accessModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  /** Handler ketika salah satu card role dipilih.
   *  Auto-login langsung dengan kredensial demo yang sesuai —
   *  TIDAK perlu buka #loginModal atau ketik username/password.
   *  Setelah login, user masuk ke dashboard ORI sesuai permission
   *  role-nya (admin → ROLES.admin, editor → ROLES.editor). */
  function pickRole(key) {
    const role = ACCESS_ROLES.find((r) => r.key === key);
    if (!role) return;

    try { localStorage.setItem(CONFIG.STORAGE_KEY, key); } catch (_) {}

    closeAccessModal();

    // Isi form login dengan kredensial demo, lalu panggil doLogin()
    // untuk reuse seluruh logika autentikasi yang sudah ada di app.js
    // (Supabase path + local fallback + redirect ke dashboard).
    const userInput = $('loginUser');
    const passInput = $('loginPass');
    if (userInput) userInput.value = role.demoUser;
    if (passInput) passInput.value = role.demoPass;

    if (typeof window.doLogin === 'function') {
      window.doLogin();
    } else {
      // Fallback: buka login modal bila doLogin tidak tersedia
      if (typeof window.toast === 'function') {
        window.toast('Modul login belum siap — coba lagi');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TOMBOL "MASUK SEBAGAI PENGUNJUNG" DI LOGIN MODAL
  // ═══════════════════════════════════════════════════════════════

  /** Sisipkan tombol "Masuk sebagai Pengunjung" di bawah tombol Masuk
   *  pada #loginModal. Aman dipanggil ulang. */
  function injectVisitorButton() {
    const loginBody = document.querySelector('#loginModal .login-body');
    if (!loginBody) return;
    if ($('loginVisitorBtn')) return; // sudah ada

    const doLoginBtn = $('doLoginBtn');
    if (!doLoginBtn) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'login-visitor-wrap';
    wrapper.innerHTML = `
      <div class="login-or-divider"><span>atau</span></div>
      <button class="btn btn-ghost login-visitor-btn" id="loginVisitorBtn" type="button">
        <i class="fas fa-eye"></i>
        <span>Masuk sebagai Pengunjung</span>
      </button>
    `;

    // Sisipkan tepat setelah tombol Masuk (doLoginBtn)
    if (doLoginBtn.nextSibling) {
      loginBody.insertBefore(wrapper, doLoginBtn.nextSibling);
    } else {
      loginBody.appendChild(wrapper);
    }

    $('loginVisitorBtn')?.addEventListener('click', () => {
      if (typeof window.closeLogin === 'function') window.closeLogin();
      if (typeof window.loginAsGuest === 'function') {
        window.loginAsGuest();
      } else if (typeof window.showView === 'function') {
        window.showView('visitor');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ESC KEY → tutup modal akses
  // ═══════════════════════════════════════════════════════════════
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = $('accessModal');
    if (modal && modal.classList.contains('show')) {
      closeAccessModal();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BINDING & INIT
  // ═══════════════════════════════════════════════════════════════

  /** Pasang listener klik logo. Aman dipanggil ulang. */
  function bindLogoTrigger() {
    const logo = $('pubLogoBtn');
    if (!logo || logo.__haBound) return;
    logo.__haBound = true;

    // Klik biasa → trigger detector. Perilaku "scroll to top / show
    // catalog" tetap dijalankan oleh listener lama di event-handlers.js.
    logo.addEventListener('click', handleLogoClick, { passive: true });
  }

  /** Inisialisasi modul. */
  function boot() {
    buildAccessModal();
    bindLogoTrigger();
    injectVisitorButton();
    console.log('[hidden-access] ready');
  }

  // Jalankan saat DOM siap
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Re-bind bila modal login dirender ulang secara dinamis
  const loginObs = new MutationObserver(() => {
    bindLogoTrigger();
    injectVisitorButton();
  });
  loginObs.observe(document.body, { childList: true, subtree: true });

  // Expose API minimal untuk debugging (opsional, tidak wajib)
  window.__hiddenAccess = {
    openAccessModal,
    closeAccessModal,
    resetClickTracker,
    CONFIG,
  };
})();
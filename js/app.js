setTimeout(() => {
  const ov = document.getElementById('loadingOverlay');
  if (ov && ov.style.display !== 'none') {
    console.warn('Force fallback — Supabase tidak merespon');
    state.session.dbOk = false;
    ov.style.display = 'none';
    if (!state.db.products.length) {
      state.db.products = fbProducts();
      state.db.users = fbUsers();
      state.db.reviews = fbReviews();
    }
    if (!state.db.branches.length) { state.db.branches = fbBranches(); initSelectedBranch(); }
    if (!state.db.promos.length) { state.db.promos = fbPromos(); }
    if (!state.db.settings) { state.db.settings = fbSettings(); }
    if (!state.db.categories || !state.db.categories.length) { state.db.categories = fbCategories(); }
    renderCatalog();
    renderReviews();
    renderBranchInfo();
    setupStarPick();
    setupRevDrop();
    setupZoom();
  }
}, 7000);
async function init() {
  if (LOGO_URL) { const ids = ['pubLogoImg', 'loginLogoImg']; ids.forEach((id) => { const el = document.getElementById(id); if (el) el.src = LOGO_URL; }); }
  const ov = document.getElementById('loadingOverlay');
  const race = (p, ms) =>
    Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), ms))]);
  try {
    if (!window.supabase) throw new Error('Supabase JS tidak dimuat');
    state.session.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await race(state.session.sb.from('products').select('id', { count: 'exact', head: true }), 4000);
    state.session.dbOk = true;
    await race(
      Promise.all([loadProducts(), loadUsers(), loadReviews(), loadBranches(), loadPromos(), loadSettings(), loadCategories()]),
      8000
    );
    initSelectedBranch();
    ov.style.display = 'none';
    renderCatalog();
    renderReviews();
    renderBranchInfo();
    setupStarPick();
    setupRevDrop();
    setupZoom();
    state.session.sb.channel('rc')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => { loadProducts().then(() => { renderCatalog(); if (state.session.currentUser) renderDash(); }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => { loadUsers().then(() => { if (state.session.currentUser) renderDash(); }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => { loadReviews().then(renderReviews); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, () => {
        loadBranches().then(() => {
          initSelectedBranch();
          renderBranchInfo();
          if (state.session.currentUser) renderDash();
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promos' }, () => { loadPromos().then(() => { renderCatalog(); if (state.session.currentUser) renderDash(); }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, () => { loadSettings().then(() => { if (state.session.currentUser) renderDash(); }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => { loadCategories().then(() => { renderCatalog(); if (state.session.currentUser) renderDash(); }); })
      .subscribe((status, err) => { if (status === 'CHANNEL_ERROR') console.error('Realtime error:', err); });
  } catch (e) {
    console.warn('Pakai data lokal:', e.message);
    state.session.dbOk = false;
    ov.style.display = 'none';
    state.db.products = fbProducts();
    state.db.users = fbUsers();
    state.db.reviews = fbReviews();
    state.db.branches = fbBranches();
    state.db.promos = fbPromos();
    state.db.settings = fbSettings();
    state.db.categories = fbCategories();
    initSelectedBranch();
    renderCatalog();
    renderReviews();
    renderBranchInfo();
    setupStarPick();
    setupZoom();
  }
  const urlParams = new URLSearchParams(window.location.search);
  const productId = parseInt(urlParams.get('id'));
  if (productId && !isNaN(productId)) { setTimeout(() => { openDetail(productId); }, 300); }
}
async function loadProducts() {
  if (!state.session.sb) return;
  const { data } = await state.session.sb.from('products').select('*').order('id');
  state.db.products = (data || []).map((p) => {
    const parseArr = (val) => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      }
      return [];
    };
    return {
      ...p,
      specs: parseArr(p.specs),
      images: parseArr(p.images),
      variants: parseArr(p.variants),
      variant_groups: Array.isArray(p.variant_groups) ? p.variant_groups : [],
    };
  });
}
async function loadUsers() {
  if (!state.session.sb) return;
  const { data } = await state.session.sb.from('users').select('*').order('id');
  state.db.users = data || [];
}
async function loadReviews() {
  if (!state.session.sb) return;
  const { data } = await state.session.sb.from('reviews').select('*').order('created_at', { ascending: false });
  state.db.reviews = data || [];
}
async function loadBranches() {
  if (!state.session.sb) return;
  const { data } = await state.session.sb.from('branches').select('*').order('id');
  state.db.branches = (data || []).map((b) => ({
    ...b,
    hours: b.hours || [],
    socials: b.socials || {},
    wa_numbers: Array.isArray(b.wa_numbers)
      ? b.wa_numbers
      : b.wa_number
        ? [{ number: b.wa_number, label: 'Utama', active: true }]
        : [],
  }));
}
async function loadPromos() {
  if (!state.session.sb) return;
  const { data } = await state.session.sb.from('promos').select('*').order('sort_order').order('id');
  state.db.promos = data || [];
}
async function loadSettings() {
  if (!state.session.sb) return;
  const { data } = await state.session.sb.from('store_settings').select('*').eq('id', 1).single();
  if (data) { state.db.settings = data; applySettings(); }
}
async function loadCategories() {
  if (!state.session.sb) return;
  const { data } = await state.session.sb.from('categories').select('*').order('sort_order').order('id');
  state.db.categories = (data && data.length) ? data : fbCategories();
}
function applySettings() {
  const s = state.db.settings;
  if (!s) return;
  if (s.accent_color) { document.documentElement.style.setProperty('--accent', s.accent_color); }
  if (s.meta_title) { document.title = s.meta_title; }
  let metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && s.meta_description) {
    metaDesc.setAttribute('content', s.meta_description);
  } else if (s.meta_description) {
    metaDesc = document.createElement('meta');
    metaDesc.name = 'description';
    metaDesc.content = s.meta_description;
    document.head.appendChild(metaDesc);
  }
  if (s.favicon_url) {
    let link = document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = s.favicon_url;
  }
  if (s.hero_headline) {
    const h = document.querySelector('.hero-headline');
    if (h) {
      const t = s.hero_headline.trim();
      const idx = t.indexOf(' ');
      if (idx > -1) {
        h.innerHTML = esc(t.slice(0, idx)) + ' <span>' + esc(t.slice(idx + 1)) + '</span>';
      } else {
        h.innerHTML = esc(t);
      }
    }
  }
  if (s.hero_subline) { const p = document.querySelector('.hero-subline'); if (p) p.textContent = s.hero_subline; }
  if (s.hero_badge) { const hb = document.querySelector('.hero-badge-text'); if (hb) hb.textContent = s.hero_badge; }
  // Footer bottom — fully dynamic, gak ada lagi tahun/footer_text numpuk
  var footerBottom = document.getElementById('footerBottom');
  if (footerBottom) {
    if (s.footer_text) {
      footerBottom.innerHTML = '&copy; ' + esc(s.footer_text);
    } else {
      var fYear = s.footer_year || new Date().getFullYear();
      var fStore = s.store_name || 'Gadget 5tore';
      footerBottom.innerHTML = '&copy; ' + esc(String(fYear)) + ' ' + esc(fStore) + '. Semua hak dilindungi.';
    }
  }
  if (s.tagline) { const tg = document.querySelector('.footer-tagline'); if (tg) tg.textContent = s.tagline; }

  // Helper: highlight angka di nama toko
  function highlightDigits(text, accentClass) {
    var m = text.match(/^(.*?)(\d+)(.*)$/);
    if (m) return esc(m[1]) + '<span class="' + accentClass + '">' + esc(m[2]) + '</span>' + esc(m[3]);
    return esc(text);
  }

  // Navbar logo — angka highlight otomatis
  if (s.store_name) {
    const logo = document.getElementById('pubLogoBtn');
    if (logo) {
      const name = s.store_name;
      const match = name.match(/^(.*?)(\d+)(.*)$/);
      if (match) {
        // Trim spasi dari group1 — jarak dihandle CSS margin-left pada .fv
        logo.innerHTML = '<span>' + esc(match[1].trimEnd()) + '</span><span class="fv">' + esc(match[2]) + '</span><span class="rest">' + esc(match[3].trimStart()) + '</span>';
      } else {
        logo.innerHTML = '<span>' + esc(name) + '</span>';
      }
    }
  }

  // Footer brand (white area) — juga ikut update + angka highlight
  if (s.store_name) {
    const fb = document.querySelector('.footer-brand-text');
    if (fb) fb.innerHTML = highlightDigits(s.store_name, 'footer-brand-accent');
  }
}
// Initial apply saat pertama load (tanpa perlu Supabase atau navigasi)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { applySettings(); }, { once: true });
} else {
  applySettings();
}
function initSelectedBranch() {
  if (!state.db.branches.length) { state.session.selectedBranch = null; return; }
  const def = state.db.branches.find((b) => b.is_default && b.active);
  state.session.selectedBranch = def || state.db.branches.find((b) => b.active) || null;
}
function getActiveWA() {
  if (!state.session.selectedBranch) return normalizeWA(SELLER_WA);
  const wn = state.session.selectedBranch.wa_numbers;
  if (Array.isArray(wn) && wn.length) { const a = wn.find((w) => w.active); if (a) return normalizeWA(a.number); }
  return normalizeWA(state.session.selectedBranch.wa_number) || normalizeWA(SELLER_WA);
}
function selectBranch(id) { state.session.selectedBranch = state.db.branches.find((b) => b.id === id) || null; renderBranchInfo(); }
function renderBranchInfo() {
  const el = document.getElementById('ftInfoSection');
  if (!el) return;
  const active = state.db.branches.filter((b) => b.active);
  if (!active.length || !state.session.selectedBranch) { el.innerHTML = `<h3><i data-lucide="store"></i> Gadget 5tore</h3><div style="color:var(--muted);font-size:13px;padding:8px 0">Belum ada cabang tersedia.</div>`; return; }
  const b = state.session.selectedBranch;
  const branchName = b.name || 'Gadget 5tore';
  const shortName = branchName.replace('Gadget 5tore', '').trim() || 'Cabang Utama';
  const chipHtml =
    active.length > 1
      ? `<div class="branch-selector">${active.map((ab) => `<button class="branch-chip${ab.id === b.id ? ' active' : ''}" onclick="selectBranch(${ab.id})">${esc(ab.name.replace('Gadget 5tore', '').trim() || ab.name)}</button>`).join('')}</div>`
      : '';
  const hoursHtml = (b.hours || []).length
    ? `<div class="ft-hours"><div class="ft-hours-title"><i data-lucide="clock"></i> Jam Operasional</div>${b.hours.map((h, i) => `<div class="ft-hours-row${i === b.hours.length - 1 ? ' ft-hours-closed' : ''}"><span>${esc(h.day)}</span><span>${esc(h.time)}</span></div>`).join('')}</div>`
    : '';
  let socialHtml = '<div class="ft-social-row">';
  const waNums = Array.isArray(b.wa_numbers)
    ? b.wa_numbers.filter((w) => w.number)
    : b.wa_number
      ? [{ number: b.wa_number, label: 'WhatsApp', active: true }]
      : [];
  waNums.forEach((w) => { socialHtml += `<a href="https://wa.me/${normalizeWA(w.number)}" target="_blank" class="ft-social-btn" aria-label="WhatsApp"><i class="fab fa-whatsapp" style="color:#25D366"></i></a>`; });
  const soc = b.socials || {};
  Object.entries(soc).forEach(([platform, url]) => { if (typeof url === 'string' && url.trim()) socialHtml += `<a href="${esc(url)}" target="_blank" class="ft-social-btn" aria-label="${esc(getSocialLabel(platform))}">${getSocialIcon(platform)}</a>`; });
  if (b.map_url)
    socialHtml += `<a href="${esc(b.map_url)}" target="_blank" class="ft-social-btn" aria-label="Google Maps"><i data-lucide="map-pin"></i></a>`;
  socialHtml += '</div>';
  const mapHtml = b.map_url
    ? `<button class="map-toggle" id="mapToggle" onclick="toggleMap()"><i data-lucide="map"></i> Lihat Lokasi di Google Maps</button><div class="map-wrap" id="mapWrap"><iframe src="${esc(b.map_url)}" allowfullscreen loading="lazy"></iframe></div>`
    : '';
  el.innerHTML = `${chipHtml}<h3><i data-lucide="store"></i> Gadget 5tore${shortName !== 'Cabang Utama' ? ' — ' + esc(shortName) : ''}</h3><div class="store-info-list">${b.address ? `<div class="store-info-item"><div class="si-icon"><i data-lucide="map-pin"></i></div><div><div class="si-label">Alamat</div><div class="si-value">${esc(b.address)}</div></div></div>` : ''}${b.phone ? `<div class="store-info-item"><div class="si-icon"><i data-lucide="phone"></i></div><div><div class="si-label">Telepon</div><div class="si-value"><a href="tel:${esc(b.phone.replace(/\D/g, ''))}">${esc(fmtPhone(b.phone))}</a></div></div></div>` : ''}${b.email ? `<div class="store-info-item"><div class="si-icon"><i data-lucide="mail"></i></div><div><div class="si-label">Email</div><div class="si-value"><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></div></div></div>` : ''}</div>${hoursHtml}${socialHtml}${mapHtml}`;
}
async function sbInsert(p) {
  if (!state.session.sb) return null;
  const { data, error } = await state.session.sb
    .from('products')
    .insert([
      {
        category: p.category,
        brand: p.brand,
        name: p.name,
        price: p.price,
        description: p.description || '',
        specs: p.specs || [],
        images: p.images || [],
        variants: p.variants || [],
        variant_groups: p.variant_groups || [],
        featured: p.featured || false,
        archived: p.archived || false,
        stock: p.stock || 0,
        sold: p.sold || 0,
      },
    ])
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return null; }
  return data;
}
async function sbUpdate(id, u) {
  if (!state.session.sb) return false;
  const c = { ...u };
  delete c.id;
  delete c.created_at;
  delete c.updated_at;
  const { error } = await state.session.sb.from('products').update(c).eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbDel(id) {
  if (!state.session.sb) return false;
  const { error } = await state.session.sb.from('products').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbInsertUser(u) {
  if (!state.session.sb) return null;
  const { data, error } = await state.session.sb
    .from('users')
    .insert([
      {
        username: u.username,
        password: u.password,
        display_name: u.display_name || u.username,
        role: u.role || 'viewer',
        active: u.active !== undefined ? u.active : true,
      },
    ])
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return null; }
  return data;
}
async function sbUpdateUser(id, u) {
  if (!state.session.sb) return false;
  const c = { ...u };
  delete c.id;
  delete c.created_at;
  delete c.updated_at;
  const { error } = await state.session.sb.from('users').update(c).eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbDelUser(id) {
  if (!state.session.sb) return false;
  const { error } = await state.session.sb.from('users').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbInsertReview(r) {
  if (!state.session.sb) return null;
  const { data, error } = await state.session.sb
    .from('reviews')
    .insert([{ name: r.name, rating: r.rating, comment: r.comment || '', photos: r.photos || [], hidden: r.hidden !== undefined ? r.hidden : false }])
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return null; }
  return data;
}
async function sbUpdateReview(id, u) {
  if (!state.session.sb) return false;
  const c = { ...u };
  delete c.id;
  delete c.created_at;
  const { error } = await state.session.sb.from('reviews').update(c).eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbDelReview(id) {
  if (!state.session.sb) return false;
  const { error } = await state.session.sb.from('reviews').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbInsertBranch(b) {
  if (!state.session.sb) return null;
  const { data, error } = await state.session.sb
    .from('branches')
    .insert([
      {
        name: b.name,
        address: b.address || '',
        phone: b.phone || '',
        email: b.email || '',
        hours: b.hours || [],
        map_url: b.map_url || '',
        wa_number: b.wa_number || '',
        wa_numbers: b.wa_numbers || [],
        socials: b.socials || {},
        is_default: b.is_default || false,
        active: b.active !== undefined ? b.active : true,
      },
    ])
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return null; }
  return data;
}
async function sbUpdateBranch(id, u) {
  if (!state.session.sb) return false;
  const c = { ...u };
  delete c.id;
  delete c.created_at;
  const { error } = await state.session.sb.from('branches').update(c).eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbDelBranch(id) {
  if (!state.session.sb) return false;
  const { error } = await state.session.sb.from('branches').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbInsertPromo(p) {
  if (!state.session.sb) return null;
  const { data, error } = await state.session.sb
    .from('promos')
    .insert([
      {
        title: p.title,
        description: p.description || '',
        image: p.image || '',
        active: p.active !== undefined ? p.active : true,
        sort_order: p.sort_order || 0,
      },
    ])
    .select()
    .single();
  if (error) { toast(error.message, 'error'); return null; }
  return data;
}
async function sbUpdatePromo(id, u) {
  if (!state.session.sb) return false;
  const c = { ...u };
  delete c.id;
  delete c.created_at;
  const { error } = await state.session.sb.from('promos').update(c).eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbDelPromo(id) {
  if (!state.session.sb) return false;
  const { error } = await state.session.sb.from('promos').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbUpdateSettings(u) {
  if (!state.session.sb) return false;
  const { error } = await state.session.sb.from('store_settings').update(u).eq('id', 1);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbInsertCategory(c) {
  if (!state.session.sb) return null;
  const { data, error } = await state.session.sb.from('categories').insert([c]).select().single();
  if (error) { toast(error.message, 'error'); return null; }
  return data;
}
async function sbUpdateCategory(id, u) {
  if (!state.session.sb) return false;
  const c = { ...u }; delete c.id; delete c.created_at;
  const { error } = await state.session.sb.from('categories').update(c).eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
async function sbDelCategory(id) {
  if (!state.session.sb) return false;
  const { error } = await state.session.sb.from('categories').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}
function updUploadUI() {
  const a = document.getElementById('upArea'),
    h = document.getElementById('upHint'),
    p = document.getElementById('upProg');
  if (!a) return;
  if (state.ui.uploading) {
    a.style.pointerEvents = 'none';
    a.style.opacity = '.6';
    if (h) h.textContent = 'Mengupload...';
    if (p) p.style.width = '60%';
  } else {
    a.style.pointerEvents = '';
    a.style.opacity = '';
    if (h)
      h.textContent = 'Klik atau seret gambar ke sini (maks 5MB per gambar, bisa pilih banyak)';
    if (p) p.style.width = '0%';
  }
}
async function handleFiles(files) {
  files = Array.from(files);
  if (!files || !files.length || state.ui.uploading) return;
  state.ui.uploading = true;
  updUploadUI();
  let count = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (f.size > 5 * 1024 * 1024) continue;
    if (!state.session.sb) { toast('Tidak terhubung Supabase', 'error'); break; }
    const ext = f.name.split('.').pop();
    const fn = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    try {
      const { error } = await state.session.sb.storage
        .from(BUCKET)
        .upload(fn, f, { cacheControl: '3600', upsert: false, contentType: f.type });
      if (error) throw error;
      const { data } = state.session.sb.storage.from(BUCKET).getPublicUrl(fn);
      if (!state.editor.product.images) state.editor.product.images = [];
      state.editor.product.images.push(data.publicUrl);
      count++;
    } catch (e) {
      console.error(e);
    }
  }
  document.getElementById('permFileIn').value = '';
  state.ui.uploading = false;
  updUploadUI();
  renderProdForm();
  if (count > 0) toast(count + ' gambar berhasil diupload');
  else if (files.length > 0) toast('Upload gagal', 'error');
}
function setupDrop() {
  const a = document.getElementById('upArea');
  if (!a) return;
  a.addEventListener('dragover', (e) => { e.preventDefault(); a.classList.add('drag-over'); });
  a.addEventListener('dragleave', (e) => { e.preventDefault(); a.classList.remove('drag-over'); });
  a.addEventListener('drop', (e) => {
    e.preventDefault();
    a.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}
function setupStarPick() {
  const sp = document.getElementById('starPick');
  if (!sp) return;
  const stars = sp.querySelectorAll('i');
  stars.forEach((s) => { s.addEventListener('mouseenter', () => { stars.forEach((x, i) => x.classList.toggle('active', i <= s.dataset.v - 1)); }); s.addEventListener('click', () => { state.ui.revRating = parseInt(s.dataset.v); stars.forEach((x, i) => x.classList.toggle('active', i < state.ui.revRating)); }); });
  sp.addEventListener('mouseleave', () => { stars.forEach((x, i) => x.classList.toggle('active', i < state.ui.revRating)); });
}
async function handleRevPhoto(files) {
  if (!files || !files.length) return;
  if (!state.session.sb) { toast('Tidak terhubung Supabase', 'error'); return; }
  const f = files[0];
  if (!f.type.startsWith('image/')) { toast('Hanya gambar', 'error'); return; }
  if (f.size > 5 * 1024 * 1024) { toast('Maks 5MB', 'error'); return; }
  const ext = f.name.split('.').pop(),
    fn = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  try {
    const { error } = await state.session.sb.storage
      .from(BUCKET)
      .upload(fn, f, { cacheControl: '3600', upsert: false, contentType: f.type });
    if (error) throw error;
    const { data } = state.session.sb.storage.from(BUCKET).getPublicUrl(fn);
    state.ui.revPhotos.push(data.publicUrl);
    renderRevPhotos();
    toast('Foto ditambahkan');
  } catch (e) {
    console.error(e);
    toast('Upload gagal', 'error');
  }
}
function renderRevPhotos() {
  const el = document.getElementById('revPhotosPreview');
  el.innerHTML = state.ui.revPhotos
    .map(
      (p, i) =>
        `<div style="position:relative;display:inline-block"><img src="${esc(p)}" style="width:60px;height:60px;border-radius:8px;object-fit:cover;border:1px solid var(--border)"><button class="rp-remove" onclick="state.ui.revPhotos.splice(${i},1);renderRevPhotos()"><i data-lucide="x"></i></button></div>`
    )
    .join('');
}
function setupRevDrop() {
  const a = document.getElementById('revUploadArea');
  if (!a) return;
  a.addEventListener('dragover', (e) => { e.preventDefault(); a.style.borderColor = 'var(--accent)'; });
  a.addEventListener('dragleave', (e) => { e.preventDefault(); a.style.borderColor = ''; });
  a.addEventListener('drop', (e) => {
    e.preventDefault();
    a.style.borderColor = '';
    if (e.dataTransfer.files.length) handleRevPhoto(e.dataTransfer.files);
  });
}
function toggleReviews() {
  const wrap = document.getElementById('reviewsWrap'),
    toggle = document.getElementById('reviewsToggle'),
    text = document.getElementById('reviewsToggleText');
  wrap.classList.toggle('expanded');
  toggle.classList.toggle('open');
  text.textContent = wrap.classList.contains('expanded') ? 'Tutup Ulasan' : 'Lihat Semua Ulasan';
}
function toggleReviewForm() {
  const wrap = document.getElementById('reviewFormWrap'),
    btn = document.getElementById('formToggleBtn');
  wrap.classList.toggle('show');
  if (wrap.classList.contains('show')) {
    btn.innerHTML = '<i data-lucide="x"></i> Tutup Form';
    btn.style.borderColor = 'var(--accent)';
    btn.style.borderStyle = 'solid';
  } else {
    btn.innerHTML = '<i data-lucide="pencil"></i> Tulis Ulasan';
    btn.style.borderColor = '';
    btn.style.borderStyle = '';
  }
}
async function submitReview() {
  if (state.ui.submittingReview) return;
  const name = document.getElementById('revName').value.trim(),
    comment = document.getElementById('revComment').value.trim();
  if (!name) { toast('Masukkan nama', 'error'); return; }
  if (!comment) { toast('Masukkan ulasan', 'error'); return; }
  state.ui.submittingReview = true;
  try {
    if (state.session.dbOk && state.session.sb) {
      const ok = await sbInsertReview({
        name,
        rating: state.ui.revRating,
        comment,
        photos: [...state.ui.revPhotos],
        hidden: true,
      });
      if (ok) {
        logAct('Ulasan Baru', name + ' memberi rating ' + state.ui.revRating, 'review');
        toast('Ulasan terkirim! Menunggu persetujuan admin.');
        document.getElementById('revName').value = '';
        document.getElementById('revComment').value = '';
        state.ui.revPhotos = [];
        renderRevPhotos();
        state.ui.revRating = 5;
        document
          .querySelectorAll('#starPick i')
          .forEach((x, i) => x.classList.toggle('active', i < 5));
        await loadReviews();
        renderReviews();
      }
    } else {
      state.db.reviews.unshift({
        id: Date.now(),
        name,
        rating: state.ui.revRating,
        comment,
        photos: [...state.ui.revPhotos],
        created_at: new Date().toISOString(),
        hidden: true,
      });
      logAct('Ulasan Baru', name + ' memberi rating ' + state.ui.revRating, 'review');
      toast('Ulasan terkirim, terima kasih!');
      document.getElementById('revName').value = '';
      document.getElementById('revComment').value = '';
      state.ui.revPhotos = [];
      renderRevPhotos();
      state.ui.revRating = 5;
      document
        .querySelectorAll('#starPick i')
        .forEach((x, i) => x.classList.toggle('active', i < 5));
      renderReviews();
    }
  } finally {
    state.ui.submittingReview = false;
  }
}
function renderReviews() {
  const publicReviews = state.db.reviews.filter((r) => !r.hidden);
  const list = document.getElementById('reviewList'),
    badge = document.getElementById('revCountBadge'),
    toggle = document.getElementById('reviewsToggle'),
    wrap = document.getElementById('reviewsWrap'),
    toggleText = document.getElementById('reviewsToggleText');
  badge.textContent = publicReviews.length;
  const avg = publicReviews.length
    ? (publicReviews.reduce((s, r) => s + r.rating, 0) / publicReviews.length).toFixed(1)
    : '0';
  const elBig = document.getElementById('ftRatingBig'),
    elStars = document.getElementById('ftStarsRow'),
    elFrom = document.getElementById('ftRatingFrom'),
    elBars = document.getElementById('ftBarsWrap'),
    elStatProd = document.getElementById('ftStatProd'),
    elStatRating = document.getElementById('ftStatRating');
  if (elBig) elBig.textContent = avg;
  if (elStatRating) elStatRating.textContent = avg;
  if (elFrom) elFrom.textContent = 'dari ' + publicReviews.length + ' ulasan';
  if (elStars) {
    let sh = '';
    for (let i = 1; i <= 5; i++) { sh += `<i data-lucide="star"${i <= Math.round(parseFloat(avg)) ? '' : ' class="empty"'}></i>`; }
    elStars.innerHTML = sh;
  }
  if (elBars) {
    const counts = [0, 0, 0, 0, 0];
    publicReviews.forEach((r) => { if (r.rating >= 1 && r.rating <= 5) counts[r.rating - 1]++; });
    elBars.innerHTML = [5, 4, 3, 2, 1]
      .map((s) => {
        const c = counts[s - 1];
        const pct = publicReviews.length ? Math.round((c / publicReviews.length) * 100) : 0;
        return `<div class="ft-bar-row"><span class="ft-bar-label">${s} <i data-lucide="star" style="font-size:7px;color:var(--gold)"></i></span><div class="ft-bar-track"><div class="ft-bar-fill" style="width:${pct}%"></div></div><span class="ft-bar-count">${c}</span></div>`;
      })
      .join('');
  }
  if (elStatProd) elStatProd.textContent = state.db.products.filter((p) => !p.archived).length;
  if (!publicReviews.length) {
    list.innerHTML =
      '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px"><i data-lucide="message-square-off" style="font-size:20px;display:block;margin-bottom:8px;opacity:.3"></i>Belum ada ulasan</div>';
    toggle.style.display = 'none';
    wrap.classList.remove('expanded');
    return;
  }
  toggle.style.display = 'flex';
  list.innerHTML = publicReviews
    .map((r) => {
      const stars = Array(5)
        .fill(0)
        .map(
          (_, i) =>
            `<i data-lucide="star" class="${i < r.rating ? '' : 'empty'}" style="color:${i < r.rating ? 'var(--gold)' : 'var(--border)'}"></i>`
        )
        .join('');
      const photos =
        r.photos && r.photos.length
          ? `<div class="testi-photos">${r.photos.map((ph) => `<img class="testi-photo" src="${esc(ph)}" alt="foto ulasan" data-zoom="${esc(ph)}">`).join('')}</div>`
          : '';
      const date = r.created_at
        ? new Date(r.created_at).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '';
      return `<div class="testi-card"><div class="testi-top"><img class="testi-avatar" src="https://ui-avatars.com/api/?name=${encodeURIComponent(r.name || 'U')}&background=D9503F&color=fff&size=64&bold=true" alt="${esc(r.name)}"><div><div class="testi-name">${esc(r.name || 'Anonim')}</div><div class="testi-date">${date}</div></div></div><div class="testi-stars">${stars}</div><div class="testi-text">"${esc(r.comment || '')}"</div>${photos}</div>`;
    })
    .join('');
  list.querySelectorAll('.testi-photo[data-zoom]').forEach((img) => { img.addEventListener('click', () => openZoom(img.dataset.zoom)); });
  wrap.classList.remove('expanded');
  toggle.classList.remove('open');
  toggleText.textContent = 'Lihat Semua Ulasan';
}
const REV_PP = 10;
async function deleteReview(id) {
  if (
    !(await showConfirm('Ulasan yang dihapus tidak bisa dikembalikan.', 'Hapus Ulasan?', 'delete'))
  )
    return;
  const ok = state.session.dbOk ? await sbDelReview(id) : true;
  if (ok) {
    state.db.reviews = state.db.reviews.filter((r) => r.id !== id);
    logAct('Hapus Ulasan', 'Menghapus ulasan ID ' + id, 'del');
    toast('Ulasan dihapus');
    renderReviewList(document.getElementById('dashContent'));
    renderReviews();
  }
}
async function toggleReviewStatus(id) {
  const rev = state.db.reviews.find((r) => r.id === id);
  if (!rev) return;
  const newStatus = rev.hidden ? false : true;
  const ok = state.session.dbOk ? await sbUpdateReview(id, { hidden: newStatus }) : true;
  if (ok) {
    rev.hidden = newStatus;
    toast(newStatus ? 'Ulasan disembunyikan' : 'Ulasan ditampilkan');
    renderReviewList(document.getElementById('dashContent'));
    renderReviews();
  }
}
function renderReviewList(el) {
  const allReviews = state.db.reviews;
  const total = allReviews.length;
  const pendingCount = allReviews.filter(r => r.hidden).length;
  const shownCount = total - pendingCount;
  const filtered = getFilteredReviews();
  const tp = Math.max(1, Math.ceil(filtered.length / REV_PP));
  if (state.admin.reviewPage > tp) state.admin.reviewPage = tp;
  const start = (state.admin.reviewPage - 1) * REV_PP;
  const pageItems = filtered.slice(start, start + REV_PP);

  // Rating counts for filter chips (respecting status filter)
  const baseList = state.admin.reviewFilterStatus === 'all' ? allReviews
    : state.admin.reviewFilterStatus === 'pending' ? allReviews.filter(r => r.hidden)
    : allReviews.filter(r => !r.hidden);
  const ratingCounts = [0, 0, 0, 0, 0];
  baseList.forEach(r => { if (r.rating >= 1 && r.rating <= 5) ratingCounts[r.rating - 1]++; });

  if (!total) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="message-square-off"></i></div><h3>Belum ada ulasan</h3><p>Belum ada ulasan masuk</p></div>';
    return;
  }

  const fs = state.admin.reviewFilterStatus;
  const fr = state.admin.reviewFilterRating;

  const filterHtml = '<div style="padding:14px 20px 0">'
    + '<div class="review-filter-bar">'
    + '<span class="review-filter-label">Status</span>'
    + '<div class="review-filter-chips">'
    + '<button class="review-filter-chip' + (fs==='all'?' active':'') + '" onclick="setReviewFilterStatus(\'all\')">Semua <span class="chip-count">(' + total + ')</span></button>'
    + '<button class="review-filter-chip' + (fs==='pending'?' active':'') + '" onclick="setReviewFilterStatus(\'pending\')"><i data-lucide="clock" style="font-size:10px;margin-right:2px"></i>Menunggu <span class="chip-count">(' + pendingCount + ')</span></button>'
    + '<button class="review-filter-chip' + (fs==='shown'?' active':'') + '" onclick="setReviewFilterStatus(\'shown\')"><i data-lucide="check" style="font-size:10px;margin-right:2px"></i>Ditampilkan <span class="chip-count">(' + shownCount + ')</span></button>'
    + '</div></div>'
    + '<div class="review-filter-bar" style="margin-top:8px">'
    + '<span class="review-filter-label">Rating</span>'
    + '<div class="review-filter-chips">'
    + '<button class="review-filter-chip review-star-chip' + (fr===0?' active':'') + '" onclick="setReviewFilterRating(0)">Semua</button>'
    + [5,4,3,2,1].map(s => '<button class="review-filter-chip review-star-chip' + (fr===s?' active':'') + '" onclick="setReviewFilterRating(' + s + ')"><i data-lucide="star"></i> ' + s + ' <span class="chip-count">(' + ratingCounts[s-1] + ')</span></button>').join('')
    + '</div></div></div>';

  const bulkHtml = '<div class="review-bulk-bar hidden" id="reviewBulkBar" style="margin:12px 20px 0">'
    + '<span class="review-bulk-info"><strong id="reviewBulkCount">0</strong> ulasan dipilih</span>'
    + '<div class="review-bulk-actions" id="reviewBulkActions">'
    + '<button class="btn btn-primary btn-sm" id="bulkToggleBtn" onclick="bulkToggleReviews()"><i data-lucide="eye"></i> Tampilkan</button>'
    + '<button class="btn btn-danger btn-sm" onclick="bulkDeleteReviews()"><i data-lucide="trash-2"></i> Hapus</button>'
    + '</div></div>';

  const tableRows = pageItems.map(r => {
    const stars = Array(5).fill(0).map((_, i) =>
      '<i data-lucide="star" class="' + (i < r.rating ? '' : 'empty') + '" style="color:' + (i < r.rating ? 'var(--gold)' : 'var(--border)') + ';font-size:10px"></i>'
    ).join('');
    const date = r.created_at
      ? new Date(r.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      : '-';
    const statusBadge = r.hidden
      ? '<span class="badge badge-yellow"><i data-lucide="clock" style="font-size:8px;margin-right:3px"></i>Menunggu</span>'
      : '<span class="badge badge-green">Ditampilkan</span>';
    const shortComment = (r.comment || '').length > 50
      ? (r.comment || '').substring(0, 50) + '...'
      : r.comment || '-';
    const isSelected = state.admin.reviewSelected.includes(r.id);
    return '<tr id="rrow-' + r.id + '" class="' + (isSelected ? 'review-selected' : '') + '" style="' + (r.hidden ? 'opacity:.6' : '') + '">'
      + '<td><input type="checkbox" class="review-cb" id="rcb-' + r.id + '" ' + (isSelected ? 'checked' : '') + ' onchange="toggleReviewSelect(' + r.id + ')"></td>'
      + '<td><div style="display:flex;align-items:center;gap:8px"><img src="https://ui-avatars.com/api/?name=' + encodeURIComponent(r.name || 'U') + '&background=D9503F&color=fff&size=64&bold=true" style="width:30px;height:30px;border-radius:50%;object-fit:cover"><div><div style="font-weight:600;font-size:12px;color:var(--navy)">' + esc(r.name || 'Anonim') + '</div>'
      + (r.photos && r.photos.length ? '<div style="font-size:9px;color:var(--accent);cursor:pointer" onclick="viewReviewPhotos(' + r.id + ')" title="Lihat ' + r.photos.length + ' foto"><i data-lucide="image"></i> ' + r.photos.length + ' foto</div>' : '')
      + '</div></div></td>'
      + '<td>' + stars + '</td>'
      + '<td style="white-space:normal;max-width:250px;color:var(--muted);font-size:11px" title="' + esc(r.comment || '') + '">' + esc(shortComment) + '</td>'
      + '<td style="font-size:11px;color:var(--muted)">' + date + '</td>'
      + '<td>' + statusBadge + '</td>'
      + '<td><div class="action-btns">'
      + '<button class="btn btn-ghost btn-sm" onclick="toggleReviewStatus(' + r.id + ')" title="' + (r.hidden ? 'Tampilkan' : 'Sembunyikan') + '"><i class="fas fa-' + (r.hidden ? 'eye' : 'eye-slash') + '"></i></button>'
      + '<button class="btn btn-danger btn-sm" onclick="deleteReview(' + r.id + ')" title="Hapus"><i data-lucide="trash-2"></i></button>'
      + '</div></td></tr>';
  }).join('');

  el.innerHTML = '<div class="card">'
    + '<div class="card-head"><h3><i data-lucide="messages-square"></i> Daftar Ulasan (' + total + ')</h3>'
    + '<div style="font-size:12px;color:var(--muted)">Ditampilkan: ' + shownCount + ' | Menunggu: ' + pendingCount + '</div></div>'
    + filterHtml
    + bulkHtml
    + '<div class="table-wrap"><table><thead><tr>'
    + '<th style="width:40px"><input type="checkbox" class="review-cb" id="reviewSelectAll" onchange="toggleReviewSelectAll()"></th>'
    + '<th>Pengguna</th><th>Rating</th><th>Ulasan</th><th>Tanggal</th><th>Status</th><th>Aksi</th>'
    + '</tr></thead><tbody>' + tableRows + '</tbody></table></div>'
    + '<div class="pagination">' + pag(state.admin.reviewPage, tp, 'state.admin.reviewPage') + '</div></div>';

  // Restore selection visuals
  updateReviewBulkBar();
  const selectAll = document.getElementById('reviewSelectAll');
  if (selectAll && pageItems.length) {
    const pageIds = pageItems.map(r => r.id);
    selectAll.checked = pageIds.length > 0 && pageIds.every(id => state.admin.reviewSelected.includes(id));
  }
}
function getFilteredReviews() {
  let list = [...state.db.reviews];
  if (state.admin.reviewFilterStatus === 'pending') list = list.filter(r => r.hidden);
  else if (state.admin.reviewFilterStatus === 'shown') list = list.filter(r => !r.hidden);
  if (state.admin.reviewFilterRating > 0) list = list.filter(r => r.rating === state.admin.reviewFilterRating);
  return list;
}
function setReviewFilterStatus(s) {
  state.admin.reviewFilterStatus = s;
  state.admin.reviewSelected = [];
  state.admin.reviewPage = 1;
  renderReviewList(document.getElementById('dashContent'));
}
function setReviewFilterRating(r) {
  state.admin.reviewFilterRating = r;
  state.admin.reviewSelected = [];
  state.admin.reviewPage = 1;
  renderReviewList(document.getElementById('dashContent'));
}
function toggleReviewSelect(id) {
  const idx = state.admin.reviewSelected.indexOf(id);
  if (idx > -1) state.admin.reviewSelected.splice(idx, 1);
  else state.admin.reviewSelected.push(id);
  updateReviewBulkBar();
  const cb = document.getElementById('rcb-' + id);
  if (cb) cb.checked = idx === -1;
  const row = document.getElementById('rrow-' + id);
  if (row) row.classList.toggle('review-selected', idx === -1);
  const selectAll = document.getElementById('reviewSelectAll');
  if (selectAll) {
    const visibleIds = getVisibleReviewIds();
    selectAll.checked = visibleIds.length > 0 && visibleIds.every(id => state.admin.reviewSelected.includes(id));
  }
}
function toggleReviewSelectAll() {
  const selectAll = document.getElementById('reviewSelectAll');
  const visibleIds = getVisibleReviewIds();
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => state.admin.reviewSelected.includes(id));
  if (allSelected) {
    state.admin.reviewSelected = state.admin.reviewSelected.filter(id => !visibleIds.includes(id));
  } else {
    visibleIds.forEach(id => { if (!state.admin.reviewSelected.includes(id)) state.admin.reviewSelected.push(id); });
  }
  visibleIds.forEach(id => {
    const cb = document.getElementById('rcb-' + id);
    if (cb) cb.checked = !allSelected;
    const row = document.getElementById('rrow-' + id);
    if (row) row.classList.toggle('review-selected', !allSelected);
  });
  if (selectAll) selectAll.checked = !allSelected && visibleIds.length > 0;
  updateReviewBulkBar();
}
function getVisibleReviewIds() {
  const filtered = getFilteredReviews();
  const start = (state.admin.reviewPage - 1) * REV_PP;
  return filtered.slice(start, start + REV_PP).map(r => r.id);
}
function updateReviewBulkBar() {
  const bar = document.getElementById('reviewBulkBar');
  const count = document.getElementById('reviewBulkCount');
  const toggleBtn = document.getElementById('bulkToggleBtn');
  if (!bar) return;
  const n = state.admin.reviewSelected.length;
  if (count) count.textContent = n;
  bar.classList.toggle('hidden', n === 0);
  if (toggleBtn && n > 0) {
    const selectedReviews = state.db.reviews.filter(r => state.admin.reviewSelected.includes(r.id));
    const allHidden = selectedReviews.every(r => r.hidden);
    const allShown = selectedReviews.every(r => !r.hidden);
    if (allHidden) {
      toggleBtn.innerHTML = '<i data-lucide="eye"></i> Tampilkan';
      toggleBtn.className = 'btn btn-primary btn-sm';
    } else if (allShown) {
      toggleBtn.innerHTML = '<i data-lucide="eye-off"></i> Sembunyikan';
      toggleBtn.className = 'btn btn-warning btn-sm';
    } else {
      toggleBtn.innerHTML = '<i data-lucide="repeat"></i> Toggle Status';
      toggleBtn.className = 'btn btn-warning btn-sm';
    }
  }
}
async function bulkToggleReviews() {
  if (!state.admin.reviewSelected.length) return;
  const selectedReviews = state.db.reviews.filter(r => state.admin.reviewSelected.includes(r.id));
  const allHidden = selectedReviews.every(r => r.hidden);
  const allShown = selectedReviews.every(r => !r.hidden);
  let newHidden;
  let confirmMsg, confirmTitle;
  if (allHidden) {
    newHidden = false;
    confirmMsg = 'Tampilkan ' + state.admin.reviewSelected.length + ' ulasan?';
    confirmTitle = 'Tampilkan Ulasan?';
  } else if (allShown) {
    newHidden = true;
    confirmMsg = 'Sembunyikan ' + state.admin.reviewSelected.length + ' ulasan?';
    confirmTitle = 'Sembunyikan Ulasan?';
  } else {
    newHidden = null;
    confirmMsg = 'Toggle status ' + state.admin.reviewSelected.length + ' ulasan (yang tersembunyi ditampilkan, yang ditampilkan disembunyikan)?';
    confirmTitle = 'Toggle Status Ulasan?';
  }
  if (!(await showConfirm(confirmMsg, confirmTitle, 'info'))) return;
  let ok = true;
  for (const id of state.admin.reviewSelected) {
    const rev = state.db.reviews.find(r => r.id === id);
    if (!rev) continue;
    const target = newHidden !== null ? newHidden : !rev.hidden;
    if (state.session.dbOk) ok = await sbUpdateReview(id, { hidden: target }) && ok;
    rev.hidden = target;
  }
  if (ok) {
    const count = state.admin.reviewSelected.length;
    state.admin.reviewSelected = [];
    logAct('Bulk Toggle', count + ' ulasan status diubah', 'review');
    toast(count + ' ulasan diperbarui');
    renderReviewList(document.getElementById('dashContent'));
    renderReviews();
    renderSide();
  }
}
async function bulkDeleteReviews() {
  if (!state.admin.reviewSelected.length) return;
  if (!(await showConfirm('Hapus ' + state.admin.reviewSelected.length + ' ulasan secara permanen?', 'Hapus Ulasan?', 'delete'))) return;
  let ok = true;
  for (const id of state.admin.reviewSelected) {
    if (state.session.dbOk) ok = await sbDelReview(id) && ok;
  }
  if (ok) {
    const count = state.admin.reviewSelected.length;
    state.db.reviews = state.db.reviews.filter(r => !state.admin.reviewSelected.includes(r.id));
    state.admin.reviewSelected = [];
    logAct('Bulk Hapus', count + ' ulasan dihapus', 'del');
    toast(count + ' ulasan dihapus');
    renderReviewList(document.getElementById('dashContent'));
    renderReviews();
    renderSide();
  }
}

function showConfirm(msg, title = 'Konfirmasi', type = 'danger') {
  return new Promise((resolve) => {
    state.ui.confirmRes = resolve;
    const modal = document.getElementById('confirmModal');
    const card = modal.querySelector('.confirm-card');
    const icon = document.getElementById('confirmIcon');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    card.className = 'confirm-card';
    if (type === 'delete') {
      card.classList.add('type-danger');
      icon.innerHTML = '<i data-lucide="trash-2"></i>';
      icon.className = 'confirm-icon confirm-icon-lg';
      icon.style.background = 'rgba(220,38,38,.08)';
      icon.style.color = 'var(--danger)';
      document.getElementById('confirmOk').className = 'btn btn-danger';
      document.getElementById('confirmOk').textContent = 'Ya, Hapus';
    } else if (type === 'warning') {
      card.classList.add('type-warning');
      icon.innerHTML = '<i data-lucide="triangle-alert"></i>';
      icon.className = 'confirm-icon confirm-icon-lg';
      icon.style.background = 'rgba(232,147,12,.08)';
      icon.style.color = 'var(--warning)';
      document.getElementById('confirmOk').className = 'btn btn-primary';
      document.getElementById('confirmOk').textContent = 'Ya, Lanjutkan';
    } else {
      card.classList.add('type-info');
      icon.innerHTML = '<i data-lucide="circle-help"></i>';
      icon.className = 'confirm-icon confirm-icon-lg';
      icon.style.background = 'var(--accent-soft)';
      icon.style.color = 'var(--accent)';
      document.getElementById('confirmOk').className = 'btn btn-primary';
      document.getElementById('confirmOk').textContent = 'Oke';
    }
    modal.classList.add('show');
  });
}
function closeConfirm(res) {
  document.getElementById('confirmModal').classList.remove('show');
  if (state.ui.confirmRes) state.ui.confirmRes(res);
  state.ui.confirmRes = null;
}
const fmt = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
function getDiscount(p) {
  if (p.discount_price && p.discount_price > 0) { const pct = Math.round((1 - p.discount_price / p.price) * 100); return { percent: pct, discountedPrice: p.discount_price, originalPrice: p.price }; }
  if (p.discount_percent && p.discount_percent > 0) { const dp = Math.round(p.price * (1 - p.discount_percent / 100)); return { percent: p.discount_percent, discountedPrice: dp, originalPrice: p.price }; }
  return null;
}
function discountPriceHtml(p) {
  const d = getDiscount(p);
  if (!d) return { html: '', discounted: false, price: p.price };
  const badgeHtml = `<div class="discount-badge">${d.percent}% OFF</div>`;
  const priceArea = `<div class="price-original">${fmt(d.originalPrice)}</div><div class="price-discounted">${fmt(d.discountedPrice)}</div>`;
  return { html: badgeHtml, priceArea, discounted: true, price: d.discountedPrice };
}
function discountFcardPriceHtml(p) {
  const d = getDiscount(p);
  if (!d) return { priceArea: `<div class="fcard-price-area"><div class="fcard-price">${fmt(p.price)}</div></div>`, badgeHtml: '' };
  return { priceArea: `<div class="fcard-price-area"><div class="price-original">${fmt(d.originalPrice)}</div><div class="fcard-price price-discounted">${fmt(d.discountedPrice)}</div></div>`, badgeHtml: `<div class="discount-badge">${d.percent}% OFF</div>`, };
}
const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};
function normalizeWA(raw) {
  if (!raw) return '';
  let n = String(raw).replace(/[\s\-\(\)\.]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('62')) return n;
  if (n.startsWith('0')) return '62' + n.slice(1);
  return n;
}
function fmtPhone(raw) {
  if (!raw) return '';
  let n = String(raw).replace(/[\s\-\(\)\.]/g, '');
  if (n.startsWith('+')) { const body = n.slice(1); return '+' + fmtDash(body); }
  return fmtDash(n);
}
function fmtDash(n) {
  if (n.length <= 4) return n;
  if (n.length <= 8) return n.slice(0, 4) + '-' + n.slice(4);
  if (n.length <= 12) {
    const d = n.length % 4 === 0 ? 4 : n.length % 4 === 2 ? 2 : 3;
    const r = Math.floor(n.length / d);
    let parts = [];
    for (let i = 0; i < r; i++) parts.push(n.slice(i * d, (i + 1) * d));
    if (n.length > r * d) parts.push(n.slice(r * d));
    return parts.join('-');
  }
  return (
    n.slice(0, Math.ceil((n.length - 4) / 2)) +
    '-' +
    n.slice(Math.ceil((n.length - 4) / 2), -4) +
    '-' +
    n.slice(-4)
  );
}
function escJs(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
function setEditField(field, val) {
  if (!state.editor.product) return;
  if (field === 'specs_idx') { state.editor.product._specIdx = val; return; }
  if (field === 'specs_val' && state.editor.product._specIdx !== undefined) { state.editor.product.specs[state.editor.product._specIdx] = val; return; }
  state.editor.product[field] = val;
}
function setEditNum(field, val) { if (state.editor.product) state.editor.product[field] = parseInt(val) || 0; }
function toast(m, t = 'success') {
  const b = document.getElementById('toastBox'),
    e = document.createElement('div');
  e.className = 'toast ' + t;
  e.innerHTML = `<i class="fas fa-${t === 'success' ? 'check-circle' : 'exclamation-circle'}"></i><div class="toast-msg">${esc(m)}</div><div class="toast-progress" style="width:100%"></div>`;
  b.appendChild(e);
  requestAnimationFrame(() => { requestAnimationFrame(() => { e.querySelector('.toast-progress').style.width = '0%'; }); });
  setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 300); }, 3000);
}
function hasPerm(p) { if (!state.session.currentUser) return false; return ROLES[state.session.currentUser.role]?.perms?.[p] || false; }
function getCatBadgeClass(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('iphone')) return 'badge-red';
  if (c.includes('samsung')) return 'badge-blue';
  if (c.includes('xiaomi') || c.includes('redmi') || c.includes('poco')) return 'badge-gold';
  if (c.includes('gaming')) return 'badge-yellow';
  if (c.includes('oppo')) return 'badge-green';
  if (c.includes('vivo')) return 'badge-blue';
  return 'badge-blue';
}
function toggleMap() { document.getElementById('mapToggle').classList.toggle('open'); document.getElementById('mapWrap').classList.toggle('open'); }
function showView(v) {
  document.querySelectorAll('.view').forEach((e) => e.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  document.getElementById('pubNav').style.display = v === 'catalog' ? 'flex' : 'none';
  if (v === 'catalog') { applySettings(); renderCatalog(); }
}
function goToCatalog() { showView('catalog'); updateNavAuth(); }
function updateNavAuth() {
  const right = document.getElementById('pubRight');
  if (!right) return;
  const isDark = document.body.classList.contains('dark');
  const ti = isDark ? 'fa-sun' : 'fa-moon';
  if (state.session.currentUser) {
    const ini =
      (state.session.currentUser.display_name || '')
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'U';
    right.innerHTML = `
      <div class="mob-dropdown">
        <button class="btn btn-ghost btn-sm mob-dropdown-trigger" onclick="toggleMobDropdown(event)"><i data-lucide="ellipsis-vertical"></i></button>
        <div class="mob-dropdown-menu">
          <div class="mob-dropdown-header">
            <div class="avatar" style="width:28px;height:28px;font-size:10px">${ini}</div>
            <div><div style="font-size:12px;font-weight:700;color:var(--fg)">${esc(state.session.currentUser.display_name)}</div><div style="font-size:10px;color:var(--muted)">${esc(ROLES[state.session.currentUser.role]?.label || '')}</div></div>
          </div>
          <button class="mob-dropdown-item" onclick="toggleTheme();closeMobDropdown()"><i class="fas ${ti}"></i> Ganti Mode</button>
          <button class="mob-dropdown-item" onclick="showView('dashboard');state.admin.panel='dashboard';renderSide();renderDash();closeMobDropdown()"><i data-lucide="gauge"></i> Dashboard</button>
          <button class="mob-dropdown-item danger" onclick="doLogout();closeMobDropdown()"><i data-lucide="log-out"></i> Logout</button>
        </div>
      </div>`;
  } else {
    right.innerHTML = `
      <div class="mob-dropdown">
        <button class="btn btn-ghost btn-sm mob-dropdown-trigger" onclick="toggleMobDropdown(event)"><i data-lucide="ellipsis-vertical"></i></button>
        <div class="mob-dropdown-menu">
          <button class="mob-dropdown-item" onclick="toggleTheme();closeMobDropdown()"><i class="fas ${ti}"></i> Ganti Mode</button>
          <button class="mob-dropdown-item" onclick="openLogin();closeMobDropdown()"><i data-lucide="lock"></i> Login</button>
        </div>
      </div>`;
  }
}
function dismissHero() { document.getElementById('heroBanner').classList.add('hidden'); }
function debounceCatSearch() {
  clearTimeout(state.catalog.searchTimer);
  state.catalog.searchTimer = setTimeout(() => {
    state.catalog.page = 1;
    state.catalog.exploreExpanded = false;
    renderCatalog();
  }, 250);
}
function getFilteredProducts() {
  let list = [...state.db.products].filter((p) => !p.archived);
  const q = (document.getElementById('catSearch').value || '').toLowerCase().trim();
  const brand = document.getElementById('filterBrand').value;
  const minP = parseInt(document.getElementById('filterPriceMin').value) || 0;
  const maxP = parseInt(document.getElementById('filterPriceMax').value) || Infinity;
  if (state.catalog.activeFilter !== 'Semua')
    list = list.filter(
      (p) => (p.category || '').toLowerCase().trim() === state.catalog.activeFilter.toLowerCase().trim()
    );
  if (q) {
    list = list.filter((p) => {
      const searchText = [
        p.name,
        p.brand,
        p.category,
        p.description,
        ...(Array.isArray(p.specs) ? p.specs : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchText.includes(q);
    });
  }
  if (brand) list = list.filter((p) => p.brand === brand);
  list = list.filter((p) => p.price >= minP && p.price <= maxP);
  const sortVal = (document.getElementById('catSort') || {}).value || 'newest';
  switch (sortVal) {
    case 'price-asc':
      list.sort((a, b) => getPriceRange(a).min - getPriceRange(b).min);
      break;
    case 'price-desc':
      list.sort((a, b) => getPriceRange(b).min - getPriceRange(a).min);
      break;
    case 'name-asc':
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      list.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'stock-desc':
      list.sort((a, b) => b.stock - a.stock);
      break;
    default:
      list.sort((a, b) => b.id - a.id);
  }
  return list;
}
function isWishlisted(id) { return state.session.wishlist.includes(id); }
function toggleWishlist(id, btn) {
  const idx = state.session.wishlist.indexOf(id);
  if (idx > -1) {
    state.session.wishlist.splice(idx, 1);
    toast('Dihapus dari wishlist', 'info');
  } else {
    state.session.wishlist.push(id);
    toast('Ditambahkan ke wishlist', 'success');
  }
  localStorage.setItem('wl', JSON.stringify(state.session.wishlist));
  if (btn) {
    btn.classList.toggle('wishlisted');
    const ico = btn.querySelector('i');
    if (ico) { ico.setAttribute('data-lucide', 'heart'); }
  }
}
function shareProduct(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  const text = `${p.name} — ${fmt(p.price)}`;
  if (navigator.share) {
    navigator.share({ title: p.name, text: text, url: window.location.href }).catch(() => {});
  } else {
    navigator.clipboard
      .writeText(text + ' ' + window.location.href)
      .then(() => toast('Link disalin ke clipboard', 'success'))
      .catch(() => toast('Gagal menyalin', 'error'));
  }
}
function onCatSort(val) {
  state.catalog.page = 1;
  state.catalog.showAll = false;
  renderCatPage();
}
function setCatView(mode) {
  state.catalog.viewMode = mode;
  const grid = document.getElementById('catGrid');
  grid.classList.toggle('list-view', mode === 'list');
  document.getElementById('viewGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('viewList').classList.toggle('active', mode === 'list');
}
function hasGroupedVar(p) { return p.variant_groups && p.variant_groups.length > 0; }
function genCombos(groups) {
  if (!groups || !groups.length) return [];
  const counts = groups.map((g) => g.options.length);
  const total = counts.reduce((a, b) => a * b, 1);
  const combos = [];
  for (let i = 0; i < total; i++) {
    let idx = i;
    const g = [];
    for (let j = 0; j < counts.length; j++) { g.push(idx % counts[j]); idx = Math.floor(idx / counts[j]); }
    combos.push({ g, diff: 0, stock: 0, image: '' });
  }
  return combos;
}
function comboLabel(combo, groups) { if (!groups || !groups.length) return ''; return combo.g.map((gi, groupIdx) => groups[groupIdx].options[gi] || '').join(' / '); }
function resolveCombo(p, selections) { const vs = p.variants || []; return vs.find((v) => v.g && v.g.every((gi, i) => gi === selections[i])); }
function getComboPrice(p, combo) { return (p.price || 0) + (parseInt(combo.diff) || 0); }
function getComboStock(combo) { return parseInt(combo.stock) || 0; }
const SPEC_ICONS = [
  { keys: ['hz', 'refresh', 'refresh rate'], icon: 'fa-sync-alt', label: 'Refresh' },
  { keys: ['mah', 'battery', 'baterai', 'kapasitas'], icon: 'fa-bolt', label: 'Baterai' },
  { keys: ['ram', 'memory ram'], icon: 'fa-microchip', label: 'RAM' },
  { keys: ['ssd', 'storage', 'penyimpanan', 'rom'], icon: 'fa-hdd', label: 'Storage' },
  { keys: ['mp', 'kamera', 'camera', 'megapixel'], icon: 'fa-camera', label: 'Kamera' },
  { keys: ['warranty', 'garansi'], icon: 'fa-shield-alt', label: 'Garansi' },
  {
    keys: ['inch', 'inci', 'layar', 'screen', 'display', 'monitor'],
    icon: 'fa-mobile-alt',
    label: 'Layar',
  },
  {
    keys: [
      'bluetooth',
      'wifi',
      'wi-fi',
      '5g',
      '4g',
      'lte',
      'nfc',
      'gps',
      'connectivity',
      'konektivitas',
    ],
    icon: 'fa-wifi',
    label: 'Konektivitas',
  },
  {
    keys: [
      'processor',
      'cpu',
      'chipset',
      'mediatek',
      'snapdragon',
      'intel',
      'amd',
      'apple silicon',
    ],
    icon: 'fa-microchip',
    label: 'Prosesor',
  },
  {
    keys: ['gpu', 'graphic', 'vga', 'rtx', 'gtx', 'radeon', 'm-series'],
    icon: 'fa-tv',
    label: 'GPU',
  },
  {
    keys: ['os', 'operating system', 'windows', 'android', 'ios', 'macos'],
    icon: 'fa-desktop',
    label: 'OS',
  },
  { keys: ['weight', 'berat', 'gram'], icon: 'fa-weight-hanging', label: 'Berat' },
  {
    keys: ['material', 'bahan', 'aluminum', 'plastik', 'glass', 'kaca'],
    icon: 'fa-cube',
    label: 'Material',
  },
  {
    keys: ['waterproof', 'water resist', 'ip68', 'ip67', 'splash'],
    icon: 'fa-tint',
    label: 'Water',
  },
  {
    keys: ['fast charging', 'fast charge', 'pengisian cepat', 'charging'],
    icon: 'fa-plug',
    label: 'Charging',
  },
];
function specToIcon(specText) {
  if (!specText) return { icon: '', label: '' };
  const s = specText.toLowerCase();
  for (const rule of SPEC_ICONS) { if (rule.keys.some((k) => s.includes(k))) return { icon: rule.icon, label: rule.label }; }
  return { icon: '', label: '' };
}
function specTagHtml(specText) {
  const { icon } = specToIcon(specText);
  if (icon)
    return `<span class="spec-tag spec-icon"><i class="fas ${icon}" style="font-size:8px;margin-right:3px;opacity:.7"></i>${esc(specText)}</span>`;
  return `<span class="spec-tag">${esc(specText)}</span>`;
}
function getGroupedPriceRange(p) {
  const vs = p.variants || [];
  if (!vs.length) return { min: p.price, max: p.price };
  let min = Infinity,
    max = -Infinity;
  vs.forEach((v) => {
    const pr = (p.price || 0) + (parseInt(v.diff) || 0);
    if (pr < min) min = pr;
    if (pr > max) max = pr;
  });
  return { min: min === Infinity ? p.price : min, max: max === -Infinity ? p.price : max };
}
function getPriceRange(p) {
  if (hasGroupedVar(p)) return getGroupedPriceRange(p);
  if (!p.variants || !p.variants.length) return { min: p.price, max: p.price };
  let min = p.price,
    max = p.price;
  p.variants.forEach((v) => {
    const vp = p.price + (parseInt(v.diff) || 0);
    if (vp < min) min = vp;
    if (vp > max) max = vp;
  });
  return { min, max };
}
function getImgSrc(p) { if (p.images && p.images.length > 0) return p.images[0]; return 'https://placehold.co/400x300/E2DED8/8B8A88?text=No+Image'; }
function pcardHtml(p, idx = 0) {
  const disc = discountPriceHtml(p);
  const effectivePrice = disc.discounted ? disc.price : p.price;
  const range = getPriceRange({ ...p, price: effectivePrice }),
    hasMulti = range.min !== range.max,
    hasVar = p.variants && p.variants.length > 0,
    outStock = p.stock <= 0,
    imgCount = p.images ? p.images.length : 0;
  let priceHtml = '';
  if (disc.discounted) {
    priceHtml = disc.priceArea;
  } else if (hasMulti) {
    priceHtml = `<div class="price-from">Mulai dari</div><div class="price-range">${fmt(range.min)}<span class="price-sep">–</span>${fmt(range.max)}</div>`;
  } else {
    priceHtml = `<div class="price-range">${fmt(range.min)}</div>`;
  }
  let specHtml = '';
  const allSpecs = p.specs || [];
  const specsWithIcon = allSpecs.filter((s) => specToIcon(s).icon);
  const specsWithoutIcon = allSpecs.filter((s) => !specToIcon(s).icon);
  const prioritizedSpecs = [
    ...specsWithIcon.slice(0, 2),
    ...specsWithoutIcon.slice(0, 2 - specsWithIcon.length),
  ].slice(0, 2);
  if (allSpecs.length) {
    let tags = prioritizedSpecs.map((s) => specTagHtml(s)).join('');
    const remaining = allSpecs.length - prioritizedSpecs.length;
    if (remaining > 0)
      tags += `<span class="spec-tag spec-more"><i data-lucide="ellipsis" style="font-size:6px;margin-right:2px;opacity:.5"></i>+${remaining} specs</span>`;
    specHtml = `<div class="pcard-specs">${tags}</div>`;
  }
  let varHtml = '';
  if (hasVar) {
    if (hasGroupedVar(p)) {
      const totalOpts = p.variant_groups.reduce((s, g) => s + g.options.length, 0);
      const gCount = p.variant_groups.length;
      if (totalOpts > 4 || gCount > 2) {
        varHtml = `<div class="var-tags"><span class="var-tag var-summary"><i data-lucide="layers" style="font-size:7px;margin-right:3px;opacity:.6"></i>${totalOpts} pilihan</span></div>`;
      } else {
        const tags = p.variant_groups
          .map(
            (g) =>
              `<span class="var-tag"><strong>${esc(g.name)}:</strong> ${g.options
                .slice(0, 3)
                .map((o) => esc(o))
                .join(', ')}${g.options.length > 3 ? ' +' + (g.options.length - 3) : ''}</span>`
          )
          .join('');
        varHtml = `<div class="var-tags">${tags}</div>`;
      }
    } else {
      const vCount = p.variants.length;
      if (vCount > 2) {
        varHtml = `<div class="var-tags"><span class="var-tag var-summary"><i data-lucide="layers" style="font-size:7px;margin-right:3px;opacity:.6"></i>${vCount} varian</span></div>`;
      } else {
        const tags = p.variants
          .slice(0, 4)
          .map((v) => {
            const diff = parseInt(v.diff) || 0;
            const diffTxt =
              diff > 0
                ? `<span class="var-price">+${fmt(diff)}</span>`
                : diff < 0
                  ? `<span class="var-price">${fmt(diff)}</span>`
                  : '';
            return `<span class="var-tag">${esc(v.name)}${diffTxt}</span>`;
          })
          .join('');
        varHtml = `<div class="var-tags">${tags}</div>`;
      }
    }
  }
  let stockClass = outStock ? 'stock-out' : p.stock > 5 ? 'stock-ok' : 'stock-low';
  let stockLabel = outStock ? 'Habis' : p.stock > 5 ? 'Tersedia' : 'Terbatas';
  let stockHtml = `<div class="pcard-stock-row"><span class="stock-dot ${stockClass}"></span><span class="stock-text">${stockLabel}</span></div>`;
  const oosBadge = outStock ? '<div class="oos-badge">HABIS</div>' : '';
  const featBadge = p.featured
    ? '<div class="featured-badge"><i data-lucide="star"></i> UNGGULAN</div>'
    : '';
  const imgBadge =
    imgCount > 1
      ? `<div class="img-indicator"><i data-lucide="images" style="font-size:7px"></i> ${imgCount}</div>`
      : '';
  const delay = Math.min(Math.floor(idx / 4) * 80, 800);
  var askBtn = `<button class="pcard-ask-btn" onclick="event.stopPropagation();askProduct(${p.id})" title="Tanya tentang produk ini"><i data-lucide="message-circle"></i> Tanya Produk</button>`;
  return `<div class="pcard" onclick="openDetail(${p.id})" style="animation-delay:${delay}ms"><div class="pcard-img-wrap"><img class="pcard-img" src="${getImgSrc(p)}" alt="${esc(p.name)}" loading="lazy"> ${oosBadge}${featBadge}${disc.html || ''}${imgBadge}<div class="pcard-actions"><button class="pcard-action-btn${isWishlisted(p.id) ? ' wishlisted' : ''}" onclick="event.stopPropagation();toggleWishlist(${p.id},this)" title="Wishlist"><i class="fa${isWishlisted(p.id) ? 's' : 'r'} fa-heart"></i></button><button class="pcard-qv" onclick="event.stopPropagation();openQV(${p.id})" title="Quick View"><i data-lucide="eye"></i></button><button class="pcard-action-btn" onclick="event.stopPropagation();shareProduct(${p.id})" title="Share"><i data-lucide="share-2"></i></button></div></div><div class="pcard-body"><div class="pcard-brand">${getBrandHtml(p.brand, '14px')}</div><div class="pcard-title">${esc(p.name)}</div><div class="pcard-price-area">${priceHtml}</div>${specHtml}${varHtml}${stockHtml}${askBtn}</div></div>`;
}
function askProduct(id) {
  var p = (state.db.products || []).find(function (x) { return x.id === id; });
  if (!p) return;
  var price = (p.discount_price > 0) ? p.discount_price : p.price;
  var msg = 'Halo, saya tertarik dengan ' + p.name + ' (' + fmt(price) + '). Apakah stoknya tersedia?';
  if (window.__lcOpenWithMessage) window.__lcOpenWithMessage(msg);
}
function renderCatalog() {
  renderBrandBar();
  renderHeroTicker();
  renderCatChips();
  renderBrandOptions();
  const ps = document.getElementById('promoSection');
  const activePromos = (state.db.promos || []).filter((p) => p.active);
  if (activePromos.length && ps) {
    ps.style.display = '';
    const badgeIcons = ['zap', 'flame', 'gift', 'sparkles', 'percent', 'tag'];
    ps.innerHTML = `<div class="promo-slider"><button class="promo-slider-btn prev" id="promoPrev"><i data-lucide="chevron-left"></i></button><button class="promo-slider-btn next" id="promoNext"><i data-lucide="chevron-right"></i></button><div class="promo-slider-track" id="promoSliderTrack">${activePromos.map((p, i) => {
      const hasBg = !!p.image;
      const grad = hasBg ? '' : ` promo-grad-${i % 4}`;
      const bgStyle = hasBg ? `background-image:url('${esc(p.image)}')` : '';
      const badgeIcon = badgeIcons[i % badgeIcons.length];
      return `<div class="promo-slide${grad}" style="${bgStyle}" data-idx="${i}"><div class="promo-slide-body"><div class="promo-slide-badge"><i data-lucide="${badgeIcon}"></i> Promo</div><h3>${esc(p.title)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}<button class="promo-slide-cta" data-promo-idx="${i}">Lihat Detail <i data-lucide="arrow-right"></i></button></div></div>`;
    }).join('')}</div><div class="promo-slider-counter"><span class="cur" id="promoCounterCur">01</span> / <span id="promoCounterTotal">${String(activePromos.length).padStart(2, '0')}</span></div><div class="promo-slider-progress"><div class="promo-slider-progress-bar" id="promoProgressBar"></div></div></div><div class="promo-slider-dots">${activePromos.map((_, i) => `<button class="promo-slider-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`).join('')}</div>`;
    setTimeout(initPromoSlider, 100);
  } else if (ps) { ps.style.display = 'none'; }
  const exploreEl = document.getElementById('exploreSection');
  const tabsEl = document.getElementById('exploreTabs');
  const contentEl = document.getElementById('exploreContent');
  const active = state.db.products.filter((p) => !p.archived);
  const feat = active.filter((p) => p.featured);
  const newestDays = (state.db.settings || {}).newest_days || 7;
  const newestCutoff = new Date(); newestCutoff.setDate(newestCutoff.getDate() - newestDays); newestCutoff.setHours(0,0,0,0);
  const newest = active.filter((p) => p.created_at && new Date(p.created_at) >= newestCutoff).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const bestSelling = [...active].filter((p) => (p.sold || 0) > 40).sort((a, b) => (b.sold || 0) - (a.sold || 0));
  const discounted = active.filter((p) => getDiscount(p));
  const TABS = [
    { key: 'featured', icon: 'star', label: 'Unggulan', items: feat },
    { key: 'newest', icon: 'clock', label: 'Terbaru', items: newest },
    { key: 'bestselling', icon: 'flame', label: 'Terlaris', items: bestSelling },
    { key: 'discounted', icon: 'tags', label: 'Diskon', items: discounted },
  ];
  const catQ = (document.getElementById('catSearch').value || '').trim();
  const brandVal = (document.getElementById('filterBrand').value || '').trim();
  const minPVal = (document.getElementById('filterPriceMin').value || '').trim();
  const maxPVal = (document.getElementById('filterPriceMax').value || '').trim();
  const hasFilter = state.catalog.activeFilter !== 'Semua' || catQ || brandVal || minPVal || maxPVal;
  const hasAnyTab = TABS.some((t) => t.items.length > 0);
  if (hasAnyTab && !hasFilter) {
    exploreEl.style.display = '';
    tabsEl.innerHTML = TABS.filter((t) => t.items.length > 0)
      .map((t) => `<button class="explore-tab${state.catalog.exploreTab === t.key ? ' active' : ''}" onclick="switchExploreTab('${t.key}')"><span class="explore-tab-icon"><i data-lucide="${t.icon}"></i></span><span class="explore-tab-label">${t.label}</span><span class="explore-tab-count">${t.items.length}</span></button>`)
      .join('');
    renderExploreContent(TABS);
  } else {
    exploreEl.style.display = 'none';
  }
  const mainArea = document.querySelector('.cat-bar');
  const mainGrid = document.getElementById('catGrid');
  const mainPag = document.getElementById('catPagination');
  if (state.catalog.exploreExpanded) {
    if (mainArea) mainArea.style.display = 'none';
    mainGrid.style.display = 'none';
    mainPag.style.display = 'none';
  } else {
    if (mainArea) mainArea.style.display = '';
    mainGrid.style.display = '';
    mainPag.style.display = '';
    renderCatPage();
  }
}
const EXPLORE_MAX = 8;
function switchExploreTab(key) {
  state.catalog.exploreTab = key;
  state.catalog.exploreExpanded = false;
  renderCatalog();
}
function renderExploreContent(TABS) {
  const contentEl = document.getElementById('exploreContent');
  const tab = TABS.find((t) => t.key === state.catalog.exploreTab);
  if (!tab || !tab.items.length) {
    const fallback = TABS.find((t) => t.items.length);
    if (fallback) { state.catalog.exploreTab = fallback.key; return renderExploreContent(TABS); }
    contentEl.innerHTML = '';
    return;
  }
  const items = tab.items;
  const seeAllBtn = (fn, label) =>
    `<button class="see-all-btn" onclick="${fn}">${label || 'Lihat Semua'} <i class="fas fa-${label ? 'arrow-left' : 'arrow-right'}" style="font-size:10px;margin-left:4px"></i></button>`;
  if (state.catalog.exploreExpanded) {
    contentEl.innerHTML = `<div class="explore-fade"><div class="explore-head"><div class="explore-head-left"><i class="${tab.icon}"></i> ${tab.label}</div>${seeAllBtn('state.catalog.exploreExpanded=false;renderCatalog()', 'Tutup')}</div><div class="products-grid">${items.map((p, i) => pcardHtml(p, i)).join('')}</div></div>`;
  } else {
    const renderFcards = (list, max) =>
      list.slice(0, max).map((p) => { const d = discountFcardPriceHtml(p); return `<div class="fcard" onclick="openDetail(${p.id})">${d.badgeHtml}<div class="fcard-img-wrap"><img class="fcard-img" src="${getImgSrc(p)}" alt="${esc(p.name)}" loading="lazy"></div><div class="fcard-body"><div class="fcard-title">${esc(p.name)}</div>${d.priceArea}</div></div>`; }).join('');
    contentEl.innerHTML = `<div class="explore-fade"><div class="explore-head"><div class="explore-head-left"><i class="${tab.icon}"></i> ${tab.label}</div>${items.length > EXPLORE_MAX ? seeAllBtn('state.catalog.exploreExpanded=true;renderCatalog()') : ''}</div><div class="section-cards">${renderFcards(items, EXPLORE_MAX)}</div></div>`;
  }
}
function renderCatPage() {
  const filtered = getFilteredProducts(),
    totalPages = Math.max(1, Math.ceil(filtered.length / CAT_PP));
  if (state.catalog.page > totalPages) state.catalog.page = totalPages;
  const catQ = (document.getElementById('catSearch').value || '').trim();
  const brandVal = (document.getElementById('filterBrand').value || '').trim();
  const minPVal = (document.getElementById('filterPriceMin').value || '').trim();
  const maxPVal = (document.getElementById('filterPriceMax').value || '').trim();
  const hasFilter = state.catalog.activeFilter !== 'Semua' || catQ || brandVal || minPVal || maxPVal;
  if (!state.catalog.showAll && filtered.length > 4 && hasFilter) {
    const start = 0,
      pageItems = filtered.slice(0, 4);
    document.getElementById('catCount').textContent = filtered.length;
    const grid = document.getElementById('catGrid');
    grid.innerHTML = pageItems.map((p, i) => pcardHtml(p, i)).join('');
    grid.innerHTML += `<div style="grid-column:1/-1;text-align:center;padding:20px"><button class="see-all-btn" onclick="state.catalog.showAll=true;renderCatalog()" style="margin:0 auto"><i data-lucide="grid-3x3"></i> Lihat Semua Produk (${filtered.length})</button></div>`;
    const c = document.getElementById('catPagination');
    c.innerHTML = '';
    c.style.display = 'none';
    return;
  }
  const start = (state.catalog.page - 1) * CAT_PP,
    pageItems = filtered.slice(start, start + CAT_PP);
  document.getElementById('catCount').textContent = filtered.length;
  const grid = document.getElementById('catGrid');
  if (!pageItems.length) {
    const filterDesc = hasFilter
      ? (state.catalog.activeFilter !== 'Semua' ? `kategori "${state.catalog.activeFilter}"` : '') +
        (catQ ? `${state.catalog.activeFilter !== 'Semua' ? ' & search ' : ''}search "${catQ}"` : '') +
        (brandVal ? ` brand "${brandVal}"` : '') +
        (minPVal || maxPVal
          ? ` range harga ${minPVal ? fmt(parseInt(minPVal)) : '0'} – ${maxPVal ? fmt(parseInt(maxPVal)) : '∞'}`
          : '')
      : '';
    const resetBtn = hasFilter
      ? `<button class="empty-state-cta" onclick="resetFilters()"><i data-lucide="rotate-ccw"></i> Reset Semua Filter</button>`
      : '';
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon"><i data-lucide="package-open"></i></div><h3>Produk tidak ditemukan</h3><p>${hasFilter ? 'Tidak ada produk untuk ' + filterDesc : 'Belum ada produk yang tersedia'}</p>${resetBtn}</div>`;
  } else {
    grid.innerHTML = pageItems.map((p, i) => pcardHtml(p, i)).join('');
  }
  renderCatPagination(filtered.length, totalPages);
}
function renderCatPagination(total, totalPages) {
  const c = document.getElementById('catPagination');
  if (totalPages <= 1) {
    c.innerHTML = '';
    c.style.display = 'none';
    return;
  }
  c.style.display = 'flex';
  let h = `<button class="pg-btn" onclick="goCatPage(${state.catalog.page - 1})" ${state.catalog.page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button>`;
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (state.catalog.page > 3) pages.push('...');
    for (let i = Math.max(2, state.catalog.page - 1); i <= Math.min(totalPages - 1, state.catalog.page + 1); i++)
      pages.push(i);
    if (state.catalog.page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }
  pages.forEach((pg) => {
    if (pg === '...') {
      h += `<span class="pg-dots">...</span>`;
    } else {
      h += `<button class="pg-btn${pg === state.catalog.page ? ' active' : ''}" onclick="goCatPage(${pg})">${pg}</button>`;
    }
  });
  h += `<button class="pg-btn" onclick="goCatPage(${state.catalog.page + 1})" ${state.catalog.page >= totalPages ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>`;
  const start = (state.catalog.page - 1) * CAT_PP + 1,
    end = Math.min(state.catalog.page * CAT_PP, total);
  h += `<span style="color:var(--muted);font-size:10px;margin-left:8px;white-space:nowrap">${start}-${end} dari ${total}</span>`;
  c.innerHTML = h;
}
function goCatPage(pg) {
  state.catalog.showAll = true;
  const filtered = getFilteredProducts(),
    totalPages = Math.max(1, Math.ceil(filtered.length / CAT_PP));
  if (pg < 1 || pg > totalPages) return;
  state.catalog.page = pg;
  renderCatPage();
  document.getElementById('catGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderCatChips() {
  const c = document.getElementById('catChips');
  const cats = state.db.categories || [];
  const activeCats = cats.filter((cat) => cat.active).sort((a, b) => a.sort_order - b.sort_order);
  const all = ['Semua', ...activeCats.map((cat) => cat.name)];
  c.innerHTML = all
    .map((cat) => {
      const catObj = activeCats.find((ac) => ac.name === cat);
      const icon = cat === 'Semua' ? '<i data-lucide="grid-3x3" style="font-size:13px;margin-right:5px"></i>' : (catObj ? getCatIconHtmlManaged(catObj, '13px') + '<span style="margin-right:5px"></span>' : '');
      return `<button class="cat-chip${state.catalog.activeFilter === cat ? ' active' : ''}" onclick="setCatFilter('${cat.replace(/'/g, "\\'")}')">${icon}${cat}</button>`;
    })
    .join('');
}
function renderBrandOptions() {
  const sel = document.getElementById('filterBrand'),
    current = sel.value;
  const brands = [
    ...new Set(
      state.db.products
        .filter((p) => !p.archived)
        .map((p) => (p.brand || '').trim())
        .filter(Boolean)
    ),
  ].sort();
  sel.innerHTML =
    '<option value="">Semua</option>' +
    brands
      .map((b) => `<option value="${esc(b)}"${b === current ? ' selected' : ''}>${esc(b)}</option>`)
      .join('');
}
function setCatFilter(cat) {
  state.catalog.activeFilter = cat;
  state.catalog.page = 1;
  state.catalog.showAll = false;
  state.catalog.exploreExpanded = false;
  renderCatalog();
  renderCatChips();
}
function resetFilters() {
  document.getElementById('catSearch').value = '';
  document.getElementById('filterBrand').value = '';
  document.getElementById('filterPriceMin').value = '';
  document.getElementById('filterPriceMax').value = '';
  state.catalog.activeFilter = 'Semua';
  state.catalog.page = 1;
  state.catalog.showAll = false;
  state.catalog.exploreExpanded = false;
  renderCatalog();
  toast('Filter direset', 'success');
}
function openQV(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  const img = getImgSrc(p);
  const d = getDiscount(p);
  const effectivePrice = d ? d.discountedPrice : p.price;
  const range = getPriceRange({ ...p, price: effectivePrice });
  let priceHtml;
  if (d) {
    priceHtml = `<div class="price-original">${fmt(d.originalPrice)}</div><div class="qv-price price-discounted">${fmt(d.discountedPrice)}</div>`;
  } else {
    priceHtml = `<div class="qv-price">${range.min !== range.max ? `${fmt(range.min)} – ${fmt(range.max)}` : fmt(range.min)}</div>`;
  }
  const priceText = d ? fmt(d.discountedPrice) : (range.min !== range.max ? `${fmt(range.min)} – ${fmt(range.max)}` : fmt(range.min));
  const specs = (p.specs || []).slice(0, 4);
  const storeUrl = window.location.href.split('?')[0].split('#')[0] + '?id=' + p.id;
  const wm = encodeURIComponent(
    `Halo, saya tertarik dengan *${p.name}* (${p.brand}) seharga ${priceText}.\n\nLihat produk: ${storeUrl}`
  );
  document.getElementById('qvCard').innerHTML = `
    <div style="position:relative">
      <img class="qv-img" src="${img}" alt="${esc(p.name)}">
      ${d ? `<div class="discount-badge">${d.percent}% OFF</div>` : ''}
      <button class="qv-close" onclick="closeQV()" aria-label="Tutup"><i data-lucide="x"></i></button>
    </div>
    <div class="qv-body">
      <div class="qv-brand" style="margin-bottom:4px">${getBrandHtml(p.brand, '16px')}</div>
      <div class="qv-name">${esc(p.name)}</div>
      ${priceHtml}
      <div class="qv-stock">${p.stock > 5 ? '<i data-lucide="circle-check" style="color:#16a34a;margin-right:4px"></i>Stok tersedia (' + p.stock + ')' : p.stock > 0 ? '<i data-lucide="circle-alert" style="color:var(--warning);margin-right:4px"></i>Stok terbatas (' + p.stock + ')' : '<i data-lucide="circle-x" style="color:var(--danger);margin-right:4px"></i>Stok habis'}</div>
      ${specs.length ? `<div class="qv-specs">${specs.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="qv-actions" style="flex-direction:column;gap:8px;margin-top:12px">
        <a class="btn btn-wa btn-sm${p.stock <= 0 ? ' disabled' : ''}" style="width:100%;justify-content:center" href="${p.stock <= 0 ? 'javascript:void(0)' : 'https://wa.me/' + getActiveWA() + '?text=' + wm}" target="${p.stock <= 0 ? '_self' : '_blank'}"><i class="fab fa-whatsapp"></i> ${p.stock <= 0 ? 'Stok Habis' : 'Tanya via WhatsApp'}</a>
        <button class="btn btn-ghost btn-sm" onclick="closeQV();openDetail(${p.id})" style="width:100%;justify-content:center"><i data-lucide="maximize"></i> Lihat Detail Lengkap</button>
      </div>
    </div>`;
  document.getElementById('qvOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeQV() { document.getElementById('qvOverlay').classList.remove('show'); document.body.style.overflow = ''; }
function selectDetailVariant(btn, price, outOfStock) {
  btn
    .closest('.variant-options')
    .querySelectorAll('.variant-opt')
    .forEach((o) => o.classList.remove('active'));
  btn.classList.add('active');
  const dPrice = document.getElementById('dPrice');
  const discRatio = dPrice ? parseFloat(dPrice.dataset.discRatio) : 0;
  if (discRatio > 0) {
    const origForVariant = Math.round(price / discRatio);
    const wrap = document.getElementById('dPriceWrap');
    const origEl = wrap ? wrap.querySelector('.price-original') : null;
    if (origEl) origEl.textContent = fmt(origForVariant);
  }
  if (dPrice) dPrice.textContent = fmt(price);
  const waBtn = document.querySelector('#detailBox .btn-wa');
  if (waBtn) {
    if (outOfStock) {
      waBtn.classList.add('disabled');
      waBtn.href = 'javascript:void(0)';
      waBtn.innerHTML = '<i class="fab fa-whatsapp"></i> Stok Habis';
      waBtn.target = '_self';
    } else {
      waBtn.classList.remove('disabled');
    }
  }
  const stockBadge = document.getElementById('dStockBadge');
  if (stockBadge) { stockBadge.textContent = 'Stok: ' + (outOfStock ? 0 : 'Tersedia'); stockBadge.className = 'badge ' + (outOfStock ? 'badge-red' : 'badge-green'); }
}
function updateGroupedWA(p, combo) {
  const waBtn = document.querySelector('#detailBox .btn-wa');
  if (!waBtn) return;
  const stock = getComboStock(combo);
  const rawPrice = getComboPrice(p, combo);
  const dPrice = document.getElementById('dPrice');
  const discRatio = dPrice ? parseFloat(dPrice.dataset.discRatio) : 0;
  const price = discRatio > 0 ? Math.round(rawPrice * discRatio) : rawPrice;
  const label = comboLabel(combo, p.variant_groups);
  const outOfStock = stock <= 0;
  const storeUrl = window.location.href.split('?')[0].split('#')[0] + '?id=' + p.id;
  const wm = encodeURIComponent(
    `Halo, saya tertarik dengan *${p.name}* (${p.brand})${label ? ' — ' + label : ''} seharga ${fmt(price)}.\n\nLihat produk: ${storeUrl}`
  );
  if (outOfStock) {
    waBtn.classList.add('disabled');
    waBtn.href = 'javascript:void(0)';
    waBtn.innerHTML = '<i class="fab fa-whatsapp"></i> Stok Habis';
    waBtn.target = '_self';
  } else {
    waBtn.classList.remove('disabled');
    waBtn.href = 'https://wa.me/' + getActiveWA() + '?text=' + wm;
    waBtn.innerHTML = '<i class="fab fa-whatsapp"></i> Tanya via WhatsApp';
    waBtn.target = '_blank';
  }
}
function openDetail(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  const imgs = p.images && p.images.length ? p.images : ['https://picsum.photos/seed/def/600/400'];
  const th = imgs
    .map(
      (im, i) =>
        `<img class="detail-thumb ${i === 0 ? 'active' : ''}" src="${esc(im)}" alt="" data-main-img="${esc(im)}">`
    )
    .join('');
  const imgCounter =
    imgs.length > 1
      ? `<div class="detail-img-counter"><i data-lucide="images" style="margin-right:4px;font-size:10px"></i>1 / ${imgs.length}</div>`
      : '';
  const dots =
    imgs.length > 1
      ? `<div class="detail-dots">${imgs.map((_, i) => `<button class="detail-dot ${i === 0 ? 'active' : ''}" data-idx="${i}" aria-label="Foto ${i + 1}"></button>`).join('')}</div>`
      : '';
  const sr = (p.specs || [])
    .map((s) => {
      const pt = s.split(/[\:\u2013\-]/);
      return pt.length > 1
        ? `<tr><td>${esc(pt[0].trim())}</td><td>${esc(pt.slice(1).join(':').trim())}</td></tr>`
        : `<tr><td colspan="2" style="text-align:left">${esc(s)}</td></tr>`;
    })
    .join('');
  const disc = getDiscount(p);
  const discBase = disc ? disc.discountedPrice : p.price;
  const initSel = new Array((p.variant_groups || []).length).fill(0);
  const initCombo = hasGroupedVar(p) ? resolveCombo(p, initSel) : null;
  const rawInitPrice = initCombo ? getComboPrice(p, initCombo) : p.price;
  const initPrice = disc ? Math.round(rawInitPrice * (disc.discountedPrice / p.price)) : rawInitPrice;
  const initStock = initCombo ? getComboStock(initCombo) : p.stock;
  const initLabel = initCombo ? comboLabel(initCombo, p.variant_groups) : '';
  const catLabel = p.category || '';
  const vh = hasGroupedVar(p)
    ? `<div class="variant-section">${p.variant_groups
        .map(
          (g, gi) =>
            `<div class="variant-label">${esc(g.name)}</div><div class="variant-options">${g.options
              .map((opt, oi) => {
                const sel = [...initSel];
                sel[gi] = oi;
                const c = resolveCombo(p, sel);
                const oos = c && getComboStock(c) <= 0;
                const hasCombo = !!c;
                const disabledAttr =
                  hasCombo && oos ? 'disabled style="opacity:.4;cursor:not-allowed"' : '';
                return `<button class="variant-opt ${oi === 0 ? 'active' : ''}" onclick="pickGroupOpt(${p.id},${gi},${oi})" ${disabledAttr}>${esc(opt)}${c && c.diff ? `<span class="var-price">${c.diff > 0 ? '+' : ''}${fmt(c.diff)}</span>` : ''}</button>`;
              })
              .join('')}</div>`
        )
        .join('')}</div>`
    : p.variants && p.variants.length
      ? `<div class="variant-section"><div class="variant-label">Pilihan Varian</div><div class="variant-options">${p.variants
          .map((v, i) => { const safePrice = (disc ? discBase : parseInt(p.price) || 0) + (parseInt(v.diff) || 0); return `<button class="variant-opt ${i === 0 ? 'active' : ''}" onclick="selectDetailVariant(this, ${safePrice})">${esc(v.name)}</button>`; })
          .join('')}</div></div>`
      : '';
  const storeUrl = window.location.href.split('?')[0].split('#')[0] + '?id=' + p.id;
  const wm = encodeURIComponent(
    `Halo, saya tertarik dengan *${p.name}* (${p.brand})${initLabel ? ' — ' + initLabel : ''} seharga ${fmt(initPrice)}.\n\nLihat produk: ${storeUrl}`
  );
  const stockIcon =
    initStock > 5 ? 'fa-check-circle' : initStock > 0 ? 'fa-exclamation-circle' : 'fa-times-circle';
  const stockLabel = initStock > 5 ? 'Tersedia' : initStock > 0 ? 'Stok Terbatas' : 'Habis';
  document.getElementById('detailBox').innerHTML =
    `<div class="detail-grid"><div class="detail-left"><img class="detail-img-bg" id="dBg" src="${esc(imgs[0])}" alt=""><div class="detail-img-wrap"><img class="detail-img-main" id="dMain" src="${esc(imgs[0])}" alt="${esc(p.name)}" onclick="openZoom(this.src)" style="cursor:zoom-in">${imgCounter}<div class="zoom-hint" onclick="openZoom(document.getElementById('dMain').src)" title="Zoom"><i data-lucide="zoom-in"></i></div>${dots}</div><div class="detail-thumbs">${th}</div></div><div class="detail-info">${catLabel ? `<div class="detail-cat"><i data-lucide="tag"></i> ${esc(catLabel)}</div>` : ''}<div class="detail-brand">${getBrandHtml(p.brand, '18px')}</div><div class="detail-name">${esc(p.name)}</div>${disc ? `<div class="discount-badge" style="position:static;display:inline-block;margin-bottom:6px">${disc.percent}% OFF</div>` : ''}<div id="dPriceWrap">${disc ? `<div class="price-original" style="font-size:14px">${fmt(p.price)}</div><div class="detail-price" id="dPrice" data-disc-pct="${disc.percent}" data-disc-ratio="${(disc.discountedPrice / p.price).toFixed(6)}">${fmt(initPrice)}</div>` : `<div class="detail-price" id="dPrice">${fmt(initPrice)}</div>`}</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${p.featured ? '<span class="badge badge-gold"><i data-lucide="star" style="margin-right:4px"></i>Unggulan</span>' : ''}<span class="badge ${initStock > 5 ? 'badge-green' : initStock > 0 ? 'badge-yellow' : 'badge-red'}" id="dStockBadge"><i class="fas ${stockIcon}" style="margin-right:4px"></i>${stockLabel}${initStock > 0 ? ' (' + initStock + ')' : ''}</span></div><div class="detail-desc">${esc(p.description || 'Tidak ada deskripsi.')}</div>${sr ? `<table class="spec-table">${sr}</table>` : ''}${vh}<div class="wa-section"><a class="btn btn-wa${initStock <= 0 ? ' disabled' : ''}" style="width:100%;justify-content:center" href="${initStock <= 0 ? 'javascript:void(0)' : 'https://wa.me/' + getActiveWA() + '?text=' + wm}" target="${initStock <= 0 ? '_self' : '_blank'}"><i class="fab fa-whatsapp" style="margin-right:6px"></i> ${initStock <= 0 ? 'Stok Habis' : 'Tanya via WhatsApp'}</a><div class="wa-trust-row"><span><i data-lucide="shield-check"></i> Original</span><span><i data-lucide="award"></i> Garansi Resmi</span><span><i data-lucide="truck"></i> Pengiriman Cepat</span></div></div></div></div>`;
  document
    .getElementById('detailBox')
    .querySelectorAll('.detail-thumb[data-main-img]')
    .forEach((thumb, i) => { thumb.addEventListener('click', function () { gotoDetailSlide(i); }); });
  document
    .getElementById('detailBox')
    .querySelectorAll('.detail-dot')
    .forEach((dot) => { dot.addEventListener('click', function () { gotoDetailSlide(parseInt(this.dataset.idx)); }); });
  state.ui.detailSlide.imgs = [...imgs];
  state.ui.detailSlide.idx = 0;
  setupDetailSlideEvents();
  startDetailSlide();
  document.getElementById('detailOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function stopDetailSlide() { if (state.ui.detailSlide.timer) { clearInterval(state.ui.detailSlide.timer); state.ui.detailSlide.timer = null; } }
function startDetailSlide() {
  stopDetailSlide();
  if (state.ui.detailSlide.imgs.length < 2) return;
  state.ui.detailSlide.paused = false;
  state.ui.detailSlide.timer = setInterval(() => {
    if (state.ui.detailSlide.paused) return;
    state.ui.detailSlide.idx = (state.ui.detailSlide.idx + 1) % state.ui.detailSlide.imgs.length;
    gotoDetailSlide(state.ui.detailSlide.idx);
  }, 4000);
}
function gotoDetailSlide(idx) {
  if (idx < 0 || idx >= state.ui.detailSlide.imgs.length) return;
  state.ui.detailSlide.idx = idx;
  const src = state.ui.detailSlide.imgs[idx];
  const mainImg = document.getElementById('dMain');
  const bgImg = document.getElementById('dBg');
  if (mainImg) { mainImg.style.opacity = '0'; setTimeout(() => { mainImg.src = src; mainImg.style.opacity = '1'; }, 150); }
  if (bgImg) { bgImg.style.opacity = '0'; setTimeout(() => { bgImg.src = src; bgImg.style.opacity = '1'; }, 100); }
  const thumbs = document.querySelectorAll('#detailBox .detail-thumb');
  thumbs.forEach((t, i) => t.classList.toggle('active', i === idx));
  const dots = document.querySelectorAll('#detailBox .detail-dot');
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  const counter = document.querySelector('.detail-img-counter');
  if (counter)
    counter.innerHTML = `<i data-lucide="images" style="margin-right:4px;font-size:10px"></i>${idx + 1} / ${state.ui.detailSlide.imgs.length}`;
}
function setupDetailSlideEvents() {
  const wrap = document.querySelector('#detailBox .detail-img-wrap');
  if (!wrap) return;
  wrap.addEventListener('mouseenter', () => { state.ui.detailSlide.paused = true; });
  wrap.addEventListener('mouseleave', () => { state.ui.detailSlide.paused = false; });
  let touchX = 0,
    touchY = 0,
    swiping = false;
  wrap.addEventListener(
    'touchstart',
    (e) => {
      state.ui.detailSlide.paused = true;
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
      swiping = false;
    },
    { passive: true }
  );
  wrap.addEventListener(
    'touchmove',
    (e) => {
      if (state.ui.detailSlide.imgs.length < 2) return;
      const dx = e.touches[0].clientX - touchX;
      const dy = e.touches[0].clientY - touchY;
      if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) { swiping = true; e.preventDefault(); }
    },
    { passive: false }
  );
  wrap.addEventListener('touchend', (e) => {
    if (swiping && state.ui.detailSlide.imgs.length >= 2) {
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40) {
        if (dx < 0) gotoDetailSlide((state.ui.detailSlide.idx + 1) % state.ui.detailSlide.imgs.length);
        else
          gotoDetailSlide((state.ui.detailSlide.idx - 1 + state.ui.detailSlide.imgs.length) % state.ui.detailSlide.imgs.length);
      }
    }
    swiping = false;
    setTimeout(() => { state.ui.detailSlide.paused = false; }, 3000);
  });
}
function closeDetail() {
  stopDetailSlide();
  document.getElementById('detailOverlay').classList.remove('show');
  document.body.style.overflow = '';
}
function pickGroupOpt(pid, groupIdx, optionIdx) {
  const p = state.db.products.find((x) => x.id === pid);
  if (!p) return;
  const allGroups = document.querySelectorAll('#detailBox .variant-section');
  const groupEl = allGroups[groupIdx];
  if (!groupEl) return;
  groupEl.querySelectorAll('.variant-opt').forEach((o, i) => { o.classList.toggle('active', i === optionIdx); });
  const selections = [];
  allGroups.forEach((gEl, gi) => {
    const activeBtn = gEl.querySelector('.variant-opt.active');
    selections.push(
      activeBtn ? Array.from(gEl.querySelectorAll('.variant-opt')).indexOf(activeBtn) : 0
    );
  });
  const combo = resolveCombo(p, selections);
  if (combo) {
    const rawPrice = getComboPrice(p, combo);
    const dPrice = document.getElementById('dPrice');
    const discRatio = dPrice ? parseFloat(dPrice.dataset.discRatio) : 0;
    const finalPrice = discRatio > 0 ? Math.round(rawPrice * discRatio) : rawPrice;
    dPrice.textContent = fmt(finalPrice);
    const wrap = document.getElementById('dPriceWrap');
    const origEl = wrap ? wrap.querySelector('.price-original') : null;
    if (origEl && discRatio > 0) origEl.textContent = fmt(rawPrice);
    const stock = getComboStock(combo);
    const stockBadge = document.getElementById('dStockBadge');
    if (stockBadge) {
      const si =
        stock > 5 ? 'fa-check-circle' : stock > 0 ? 'fa-exclamation-circle' : 'fa-times-circle';
      const sl = stock > 5 ? 'Tersedia' : stock > 0 ? 'Stok Terbatas' : 'Habis';
      stockBadge.innerHTML = `<i class="fas ${si}" style="margin-right:4px"></i>${sl}${stock > 0 ? ' (' + stock + ')' : ''}`;
      stockBadge.className =
        'badge ' + (stock > 5 ? 'badge-green' : stock > 0 ? 'badge-yellow' : 'badge-red');
    }
    updateGroupedWA(p, combo);
    if (combo.image) {
      const mainImg = document.getElementById('dMain');
      const bgImg = document.getElementById('dBg');
      if (mainImg) { mainImg.style.opacity = '0'; setTimeout(() => { mainImg.src = combo.image; mainImg.style.opacity = '1'; }, 150); }
      if (bgImg) { bgImg.style.opacity = '0'; setTimeout(() => { bgImg.src = combo.image; bgImg.style.opacity = '1'; }, 100); }
      document
        .querySelectorAll('#detailBox .detail-thumb')
        .forEach((t) => t.classList.remove('active'));
      const matchThumb = document.querySelector(
        `#detailBox .detail-thumb[data-main-img="${CSS.escape(combo.image)}"]`
      );
      if (matchThumb) matchThumb.classList.add('active');
    }
  }
}
function closeAdminDetail() { document.getElementById('adminDetailOverlay').classList.remove('show'); document.body.style.overflow = ''; }
function renderBranchList(el) {
  const pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  const ca = pm.branches_add,
    ce = pm.branches_edit,
    cd = pm.branches_delete;
  el.innerHTML = `<div class="card"><div class="card-head"><h3><i data-lucide="store"></i> Daftar Cabang (${state.db.branches.length})</h3>${ca ? `<button class="btn btn-primary btn-sm" onclick="openBranchForm()"><i data-lucide="plus"></i> Tambah</button>` : ''}</div><div style="padding:16px">${
    state.db.branches.length
      ? `<div class="branch-card-inner">${state.db.branches
          .map((b) => { const wa = b.wa_number || ''; return `<div class="branch-card"><div class="branch-card-icon"><i data-lucide="store"></i></div><div class="branch-card-body"><div class="branch-card-name">${esc(b.name)}${b.is_default ? '<span class="badge badge-gold" style="font-size:8px">Default</span>' : ''}<span class="badge ${b.active ? 'badge-green' : 'badge-red'}" style="font-size:8px">${b.active ? 'Aktif' : 'Nonaktif'}</span></div><div class="branch-card-addr">${esc(b.address || 'Belum ada alamat')}</div><div class="branch-card-meta">${wa ? `<div class="branch-card-meta-item"><i class="fab fa-whatsapp"></i>${esc(fmtPhone(wa))}</div>` : ''}${b.phone ? `<div class="branch-card-meta-item"><i data-lucide="phone"></i>${esc(fmtPhone(b.phone))}</div>` : ''}${b.email ? `<div class="branch-card-meta-item"><i data-lucide="mail"></i>${esc(b.email)}</div>` : ''}</div></div><div class="branch-card-actions">${ce ? `<button class="btn btn-info btn-sm" onclick="openBranchForm(${b.id})"><i data-lucide="pencil"></i></button>` : ''}${cd ? `<button class="btn btn-danger btn-sm" onclick="delBranch(${b.id})"><i data-lucide="trash-2"></i></button>` : ''}</div></div>`; })
          .join('')}</div>`
      : '<div class="empty-state" style="padding:30px"><i data-lucide="store"></i><p>Belum ada cabang</p></div>'
  }</div></div>`;
}
function renderSocialMedia(el) {
  if (state.editor.socialBranch !== null) { renderSocialEdit(el); return; }
  const pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  const ce = pm.social_edit;
  el.innerHTML = `<div class="card"><div class="card-head"><h3>Sosial Media per Cabang</h3><div style="font-size:12px;color:var(--muted)">Kelola link sosial media untuk setiap cabang</div></div><div style="display:flex;flex-direction:column;gap:12px">${
    state.db.branches
      .filter((b) => b.active)
      .map((b) => {
        const soc = b.socials || {};
        const entries = Object.entries(soc).filter(([, v]) => typeof v === 'string' && v.trim());
        const waNums = Array.isArray(b.wa_numbers) ? b.wa_numbers.filter((w) => w.number) : [];
        return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;transition:border-color .2s" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><strong>${esc(b.name)}</strong>${b.is_default ? ' <span class="badge badge-gold" style="font-size:10px">Default</span>' : ''}</div>${ce ? `<button class="btn btn-info btn-sm" onclick="state.editor.socialBranch=${b.id};renderDash()"><i data-lucide="pencil"></i> Edit</button>` : ''}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${waNums.map((w) => `<a href="https://wa.me/${normalizeWA(w.number)}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 6px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--fg);transition:all .2s;font-size:11px" onmouseenter="this.style.borderColor='#25D366';this.style.background='rgba(37,211,102,0.06)'" onmouseleave="this.style.borderColor='var(--border)';this.style.background='transparent'"><div style="width:24px;height:24px;border-radius:6px;background:rgba(37,211,102,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fab fa-whatsapp" style="color:#25D366;font-size:13px"></i></div><span style="color:var(--muted)">${waNums.length > 1 ? (w.active ? 'WA ' + esc(w.label || 'Aktif') : esc(w.label || 'WA')) : 'WhatsApp'}</span></a>`).join('')}${entries
          .map(([k, v]) => {
            const sp = SOCIAL_PLATFORMS[k] || {};
            const ic = sp.icon || 'link',
              cl = sp.color || '#555';
            const isFa = ic.startsWith('fab') || ic.startsWith('fas');
            const iconHtml = isFa
              ? `<i class="${ic}" style="font-size:13px;color:${cl}"></i>`
              : `<i data-lucide="${ic}" style="width:13px;height:13px;color:${cl}"></i>`;
            return `<a href="${esc(v)}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 6px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--fg);transition:all .2s;font-size:11px" onmouseenter="this.style.borderColor='${cl}';this.style.background='${cl}0F'" onmouseleave="this.style.borderColor='var(--border)';this.style.background='transparent'"><div style="width:24px;height:24px;border-radius:6px;background:${cl}1A;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconHtml}</div><span style="color:var(--muted)">${esc(sp.label || k)}</span></a>`;
          })
          .join(
            ''
          )}</div>${!waNums.length && !entries.length ? '<div style="color:var(--muted);font-size:12px">Belum ada sosial media</div>' : ''}</div>`;
      })
      .join('') ||
    '<div class="empty-state"><i data-lucide="share-2"></i><p>Belum ada cabang aktif</p></div>'
  }</div></div>`;
}
function renderSocialEdit(el) {
  const b = state.db.branches.find((x) => x.id === state.editor.socialBranch);
  if (!b) {
    state.editor.socialBranch = null;
    renderDash();
    return;
  }
  const isN = false;
  if (!state.editor.branch || state.editor.branch.id !== b.id) {
    state.editor.branch = {
      ...b,
      socials: { ...(b.socials || {}) },
      wa_numbers: Array.isArray(b.wa_numbers)
        ? b.wa_numbers.map((w) => ({ ...w }))
        : b.wa_number
          ? [{ number: b.wa_number, label: 'Utama', active: true }]
          : [],
    };
  }
  const bk = state.editor.branch;
  const soc = bk.socials || {};
  const socialRows =
    Object.entries(soc)
      .filter(([, v]) => typeof v === 'string')
      .map(
        ([k, v], i) =>
          `<div class="soc-row" style="margin-bottom:8px"><select class="form-input" style="min-width:130px;flex:1" onchange="changeSocialPlat(${i},this.value)">${Object.entries(
            SOCIAL_PLATFORMS
          )
            .map(
              ([pk, pv]) =>
                `<option value="${pk}"${k === pk ? ' selected' : ''}>${pv.label}</option>`
            )
            .join(
              ''
            )}</select><input class="form-input" style="flex:2;min-width:0" value="${esc(v)}" placeholder="https://..." onchange="changeSocialUrl(${i},this.value)"><button class="btn btn-danger btn-sm" onclick="removeSocial(${i})" style="min-width:36px;flex-shrink:0"><i data-lucide="x"></i></button></div>`
      )
      .join('') ||
    '<div style="color:var(--muted);font-size:13px;margin-bottom:12px">Belum ada sosial media</div>';
  const waRows = (bk.wa_numbers || [])
    .map(
      (w, i) =>
        `<div class="wa-row" style="margin-bottom:8px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0"><input type="radio" name="socWaActive" ${w.active ? 'checked' : ''} onchange="setWaActive(${i})" style="accent-color:var(--accent)"> <span style="font-size:12px;font-weight:600;${w.active ? 'color:var(--accent)' : ''}">${w.active ? 'Aktif' : ''}</span></label><input class="form-input" style="flex:1;min-width:60px" value="${esc(w.label || '')}" placeholder="Label" onchange="updateWaField(${i},'label',this.value)"><input class="form-input" style="flex:2;min-width:0" value="${esc(w.number || '')}" placeholder="628xxx" onchange="updateWaField(${i},'number',this.value)"><button class="btn btn-danger btn-sm" onclick="removeWaNum(${i})" style="min-width:36px;flex-shrink:0"${(bk.wa_numbers || []).length <= 1 ? ' disabled' : ''}><i data-lucide="x"></i></button></div>`
    )
    .join('');
  el.innerHTML = `<div style="margin-bottom:16px"><button class="btn btn-ghost btn-sm" onclick="state.editor.socialBranch=null;state.editor.branch=null;renderDash()"><i data-lucide="arrow-left"></i> Kembali</button></div><div class="card"><div style="padding:20px"><h3 style="margin-bottom:16px"><i data-lucide="store" style="color:var(--accent);margin-right:8px"></i>${esc(b.name)}</h3><div class="form-group"><label class="form-label" style="margin-bottom:8px;display:block">Nomor WhatsApp</label>${waRows || '<div style="color:var(--muted);font-size:13px;margin-bottom:12px">Belum ada nomor</div>'}<button class="btn btn-ghost btn-sm" onclick="addWaNum()"><i data-lucide="plus"></i> Tambah Nomor</button></div><div class="form-group" style="margin-top:16px"><label class="form-label" style="margin-bottom:8px;display:block">Sosial Media & Link</label>${socialRows}<button class="btn btn-ghost btn-sm" onclick="addSocial()"><i data-lucide="plus"></i> Tambah Platform</button></div><div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" onclick="state.editor.socialBranch=null;state.editor.branch=null;renderDash()">Batal</button><button class="btn btn-primary" onclick="saveSocialBranch()"><i data-lucide="floppy-disk"></i> Simpan</button></div></div></div>`;
}
async function saveSocialBranch() {
  const bk = state.editor.branch;
  if (!bk || !bk.id) return;
  const cleanSocials = {};
  Object.entries(bk.socials || {}).forEach(([k, v]) => { if (typeof v === 'string' && v.trim()) cleanSocials[k] = v.trim(); });
  bk.socials = cleanSocials;
  const cleanWa = bk.wa_numbers
    .filter((w) => w.number && w.number.trim())
    .map((w) => ({ number: w.number.trim(), label: w.label || '', active: !!w.active }));
  if (!cleanWa.some((w) => w.active) && cleanWa.length) cleanWa[0].active = true;
  bk.wa_numbers = cleanWa;
  const activeWa = cleanWa.find((w) => w.active);
  bk.wa_number = activeWa ? activeWa.number : '';
  const ok = await sbUpdateBranch(bk.id, {
    wa_number: bk.wa_number,
    wa_numbers: bk.wa_numbers,
    socials: bk.socials,
  });
  if (!ok) return;
  toast('Sosial media diperbarui');
  logAct('Edit Sosmed', 'Mengedit sosmed ' + bk.name, 'edit');
  await loadBranches();
  initSelectedBranch();
  renderBranchInfo();
  state.editor.socialBranch = null;
  state.editor.branch = null;
  state.admin.panel = 'social';
  renderDash();
}
function openBranchForm(id) {
  const isN = !id;
  if (isN) {
    state.editor.branch = {
      name: 'Gadget 5tore ',
      address: '',
      phone: '',
      email: '',
      hours: [
        { day: 'Senin - Jumat', time: '09:00 - 21:00' },
        { day: 'Sabtu', time: '09:00 - 21:00' },
        { day: 'Minggu', time: '10:00 - 18:00' },
      ],
      map_url: '',
      wa_number: '',
      is_default: false,
      active: true,
    };
    state.editor.tab = 'info';
  } else {
    const b = state.db.branches.find((x) => x.id === id);
    if (!b) return;
    state.editor.branch = { ...b, hours: [...(b.hours || [])] };
    state.editor.tab = 'info';
  }
  renderBranchForm();
}
function renderBranchForm() {
  const b = state.editor.branch;
  if (!b) return;
  const isN = !b.id;
  const el = document.getElementById('dashContent');
  document.getElementById('dashTitle').textContent = isN ? 'Tambah Cabang' : 'Edit Cabang';
  const hoursRows = (b.hours || [])
    .map(
      (h, i) =>
        `<div class="hours-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input class="form-input" style="flex:1" value="${esc(h.day)}" placeholder="Hari" onchange="state.editor.branch.hours[${i}].day=this.value"><input class="form-input" style="width:160px" value="${esc(h.time)}" placeholder="Jam" onchange="state.editor.branch.hours[${i}].time=this.value"><button class="btn btn-danger btn-sm" onclick="state.editor.branch.hours.splice(${i},1);renderBranchForm()" style="min-width:36px"><i data-lucide="x"></i></button></div>`
    )
    .join('');
  el.innerHTML = `<div style="margin-bottom:16px"><button class="btn btn-ghost btn-sm" onclick="state.admin.panel='branches';renderSide();renderDash()"><i data-lucide="arrow-left"></i> Kembali</button></div><div class="card"><div style="padding:20px"><div class="edit-tabs"><button class="edit-tab ${state.editor.tab === 'info' ? 'active' : ''}" onclick="state.editor.tab='info';renderBranchForm()"><i data-lucide="circle-info"></i> Info</button><button class="edit-tab ${state.editor.tab === 'hours' ? 'active' : ''}" onclick="state.editor.tab='hours';renderBranchForm()"><i data-lucide="clock"></i> Jam Operasional</button><button class="edit-tab ${state.editor.tab === 'location' ? 'active' : ''}" onclick="state.editor.tab='location';renderBranchForm()"><i data-lucide="map-pin"></i> Lokasi & Kontak</button><button class="edit-tab ${state.editor.tab === 'bstatus' ? 'active' : ''}" onclick="state.editor.tab='bstatus';renderBranchForm()"><i data-lucide="toggle-right"></i> Status</button></div>
  <div class="etab ${state.editor.tab === 'info' ? 'active' : ''}"><div class="form-grid-2"><div class="form-group" style="grid-column:1/-1"><label class="form-label">Nama Cabang</label><input class="form-input" value="${esc(b.name)}" onchange="state.editor.branch.name=this.value" placeholder="Gadget 5tore Jakarta Pusat"></div><div class="form-group" style="grid-column:1/-1"><label class="form-label">Alamat</label><textarea class="form-input" rows="2" onchange="state.editor.branch.address=this.value" placeholder="Alamat lengkap toko">${esc(b.address || '')}</textarea></div><div class="form-group"><label class="form-label">Telepon</label><input class="form-input" value="${esc(b.phone || '')}" onchange="state.editor.branch.phone=this.value" placeholder="021-555-1234"></div><div class="form-group"><label class="form-label">Email</label><input class="form-input" value="${esc(b.email || '')}" onchange="state.editor.branch.email=this.value" placeholder="email@toko.com"></div></div></div>
  <div class="etab ${state.editor.tab === 'hours' ? 'active' : ''}"><label class="form-label" style="margin-bottom:8px;display:block">Jam Operasional</label>${hoursRows || '<div style="color:var(--muted);font-size:13px;margin-bottom:12px">Belum ada jam operasional</div>'}<button class="btn btn-ghost btn-sm" onclick="state.editor.branch.hours.push({day:'',time:''});renderBranchForm()"><i data-lucide="plus"></i> Tambah Baris</button></div>
  <div class="etab ${state.editor.tab === 'location' ? 'active' : ''}"><div class="form-group"><label class="form-label">Nomor WhatsApp Utama</label><div style="font-size:11px;color:var(--muted);margin-bottom:8px">Nomor ini dipakai saat pembeli klik "Tanya via WhatsApp". Untuk mengelola beberapa nomor, gunakan panel <strong>Sosial Media</strong>.</div><input class="form-input" value="${esc(b.wa_number || '')}" onchange="state.editor.branch.wa_number=this.value" placeholder="628xxxxxxxxxx"></div><div class="form-group" style="margin-top:16px"><label class="form-label">Link Google Maps (embed URL)</label><input class="form-input" value="${esc(b.map_url || '')}" onchange="state.editor.branch.map_url=this.value" placeholder="https://maps.google.com/maps?q=...&output=embed"></div>${b.map_url ? `<div style="margin-top:8px"><iframe src="${esc(b.map_url)}" style="width:100%;height:180px;border:none;border-radius:var(--radius-sm);border:1px solid var(--border)" allowfullscreen loading="lazy"></iframe></div>` : ''}</div>
  <div class="etab ${state.editor.tab === 'bstatus' ? 'active' : ''}"><div class="status-checks"><label class="status-check"><input type="checkbox" ${b.active ? 'checked' : ''} onchange="state.editor.branch.active=this.checked"><span class="sc-box"><i data-lucide="check"></i></span><span class="sc-text"><div class="sc-title">Aktif</div><div class="sc-desc">Cabang tampil di halaman publik dan selector footer</div></span></label><label class="status-check"><input type="checkbox" ${b.is_default ? 'checked' : ''} onchange="state.editor.branch.is_default=this.checked"><span class="sc-box"><i data-lucide="check"></i></span><span class="sc-text"><div class="sc-title">Cabang Default</div><div class="sc-desc">Cabang yang otomatis dipilih saat pengguna membuka website (hanya satu)</div></span></label></div></div>
  <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" onclick="state.admin.panel='branches';renderSide();renderDash()">Batal</button><button class="btn btn-primary" onclick="saveBranch()"><i data-lucide="floppy-disk"></i> ${isN ? 'Tambah' : 'Simpan'}</button></div></div></div>`;
}
async function saveBranch() {
  const b = state.editor.branch;
  if (!b) return;
  if (!b.name.trim()) { toast('Nama cabang wajib diisi', 'error'); return; }
  if (b.wa_number) b.wa_number = b.wa_number.trim();
  if (b.is_default && state.session.dbOk && state.session.sb) {
    const { data: others } = await state.session.sb
      .from('branches')
      .update({ is_default: false })
      .neq('id', b.id || 0);
  } else if (b.is_default && !state.session.dbOk) {
    state.db.branches.forEach((x) => { if (x.id !== b.id) x.is_default = false; });
  }
  if (b.id) {
    const ok = await sbUpdateBranch(b.id, {
      name: b.name,
      address: b.address,
      phone: b.phone,
      email: b.email,
      hours: b.hours,
      map_url: b.map_url,
      wa_number: b.wa_number,
      active: b.active,
      is_default: b.is_default,
    });
    if (!ok) return;
    toast('Cabang diperbarui');
    logAct('Edit Cabang', 'Mengedit ' + b.name, 'edit');
  } else {
    b.active = b.active !== false;
    b.is_default = !!b.is_default;
    const np = await sbInsertBranch(b);
    if (!np) return;
    b.id = np.id;
    toast('Cabang ditambahkan');
    logAct('Tambah Cabang', 'Menambahkan ' + b.name, 'add');
  }
  await loadBranches();
  initSelectedBranch();
  renderBranchInfo();
  state.admin.panel = 'branches';
  renderSide();
  renderDash();
}
async function delBranch(id) {
  const b = state.db.branches.find((x) => x.id === id);
  if (!b) return;
  if (
    !(await showConfirm('Cabang yang dihapus tidak bisa dikembalikan.', 'Hapus Cabang?', 'delete'))
  )
    return;
  if (state.session.dbOk && state.session.sb) {
    const ok = await sbDelBranch(id);
    if (!ok) return;
    toast('Cabang dihapus');
    logAct('Hapus Cabang', 'Menghapus ' + b.name, 'del');
  } else {
    state.db.branches = state.db.branches.filter((x) => x.id !== id);
    toast('Cabang dihapus');
    logAct('Hapus Cabang', 'Menghapus ' + b.name, 'del');
  }
  await loadBranches();
  initSelectedBranch();
  renderBranchInfo();
  state.admin.panel = 'branches';
  renderSide();
  renderDash();
}
function _reRenderEditForm() {
  if (state.editor.socialBranch !== null) {
    renderSocialEdit(document.getElementById('dashContent'));
  } else {
    renderBranchForm();
  }
}
function changeSocialPlat(idx, newKey) {
  const keys = Object.keys(state.editor.branch.socials);
  const oldKey = keys[idx];
  if (!oldKey) return;
  const val = state.editor.branch.socials[oldKey];
  delete state.editor.branch.socials[oldKey];
  state.editor.branch.socials[newKey] = val;
  _reRenderEditForm();
}
function changeSocialUrl(idx, url) {
  const keys = Object.keys(state.editor.branch.socials);
  const key = keys[idx];
  if (key) state.editor.branch.socials[key] = url;
}
function removeSocial(idx) {
  const keys = Object.keys(state.editor.branch.socials);
  const key = keys[idx];
  if (key) delete state.editor.branch.socials[key];
  _reRenderEditForm();
}
function addSocial() {
  const used = Object.keys(state.editor.branch.socials);
  const avail = Object.keys(SOCIAL_PLATFORMS).find((k) => !used.includes(k));
  if (avail) {
    state.editor.branch.socials[avail] = '';
    _reRenderEditForm();
  } else {
    toast('Semua platform sudah ditambahkan', 'error');
  }
}
function addWaNum() {
  state.editor.branch.wa_numbers.push({
    number: '',
    label: 'Nomor ' + (state.editor.branch.wa_numbers.length + 1),
    active: false,
  });
  _reRenderEditForm();
}
function removeWaNum(idx) {
  state.editor.branch.wa_numbers.splice(idx, 1);
  if (!state.editor.branch.wa_numbers.some((w) => w.active) && state.editor.branch.wa_numbers.length) { state.editor.branch.wa_numbers[0].active = true; }
  _reRenderEditForm();
}
function setWaActive(idx) { state.editor.branch.wa_numbers.forEach((w, i) => (w.active = i === idx)); _reRenderEditForm(); }
function updateWaField(idx, field, val) { if (state.editor.branch.wa_numbers[idx]) state.editor.branch.wa_numbers[idx][field] = val; }
function renderPromoList(el) {
  const pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  const ca = pm.promos_manage;
  el.innerHTML = `<div class="card"><div class="card-head"><h3><i data-lucide="megaphone"></i> Daftar Promo (${state.db.promos.length})</h3>${ca ? `<button class="btn btn-primary btn-sm" onclick="openPromoForm()"><i data-lucide="plus"></i> Tambah</button>` : ''}</div><div style="padding:16px">${state.db.promos.length ? `<div class="branch-card-inner">${state.db.promos.map((p) => `<div style="display:flex;gap:14px;align-items:center;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:12px;transition:all .25s var(--ease)" onmouseenter="this.style.borderColor='rgba(var(--accent-rgb),.2)';this.style.transform='translateY(-1px)';this.style.boxShadow='var(--sh-sm)'" onmouseleave="this.style.borderColor='var(--border)';this.style.transform='';this.style.boxShadow=''"><div style="width:80px;height:52px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--bg3);display:flex;align-items:center;justify-content:center;border:1px solid var(--border)">${p.image ? `<img src="${esc(p.image)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '<i data-lucide="image" style="font-size:18px;color:var(--muted)"></i>'}</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div><div style="font-size:11px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.description || 'Tanpa deskripsi')}</div></div><div style="display:flex;gap:6px;align-items:center;flex-shrink:0"><span class="badge ${p.active ? 'badge-green' : 'badge-red'}" style="font-size:10px">${p.active ? 'Aktif' : 'Nonaktif'}</span>${ca ? `<button class="btn btn-info btn-sm" onclick="openPromoForm(${p.id})"><i data-lucide="pencil"></i></button><button class="btn btn-danger btn-sm" onclick="delPromo(${p.id})"><i data-lucide="trash-2"></i></button>` : ''}</div></div>`).join('')}</div>` : '<div class="empty-state" style="padding:30px"><i data-lucide="megaphone"></i><p>Belum ada promo</p></div>'}</div></div>`;
}
function handlePromoFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Pilih file gambar', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Ukuran maks 5MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function (e) {
    document.getElementById('cropImg').src = e.target.result;
    document.getElementById('cropModal').classList.add('show');
    setTimeout(() => {
      if (state.editor.promoCropper) { state.editor.promoCropper.destroy(); state.editor.promoCropper = null; }
      state.editor.promoCropper = new Cropper(document.getElementById('cropImg'), {
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        restore: false,
        aspectRatio: 16 / 9,
        background: true,
        modal: false,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
      });
    }, 100);
  };
  reader.readAsDataURL(file);
  document.getElementById('promoFileIn').value = '';
}
function applyPromoCrop() {
  if (!state.editor.promoCropper) { toast('Belum ada gambar', 'error'); return; }
  const canvas = state.editor.promoCropper.getCroppedCanvas({
    maxWidth: 1920,
    maxHeight: 1080,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });
  if (!canvas) { toast('Gagal memotong gambar', 'error'); return; }
  canvas.toBlob(
    function (blob) {
      state.editor.promoCropBlob = blob;
      const url = URL.createObjectURL(blob);
      const prev = document.getElementById('promoImgPreview');
      if (prev) { prev.src = url; prev.style.display = 'block'; }
      const hint = document.getElementById('promoImgHint');
      if (hint) hint.textContent = 'Gambar sudah dipotong. Klik ganti untuk mengubah.';
      state.editor.promo._pendingBlob = blob;
      closeCropModal();
      toast('Gambar siap dipotong', 'success');
    },
    'image/jpeg',
    0.92
  );
}
function closeCropModal() {
  if (state.editor.promoCropper) { state.editor.promoCropper.destroy(); state.editor.promoCropper = null; }
  document.getElementById('cropModal').classList.remove('show');
  document.getElementById('cropImg').src = '';
}
function removePromoImage() {
  state.editor.promo.image = '';
  state.editor.promo._pendingBlob = null;
  state.editor.promoCropBlob = null;
  const prev = document.getElementById('promoImgPreview');
  if (prev) { prev.src = ''; prev.style.display = 'none'; }
  const hint = document.getElementById('promoImgHint');
  if (hint) hint.textContent = 'Klik untuk pilih gambar dari device';
}
async function uploadPromoImage() {
  if (!state.editor.promo._pendingBlob) return null;
  if (!state.session.sb) { toast('Tidak terhubung Supabase', 'error'); return null; }
  const blob = state.editor.promo._pendingBlob;
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const fn = 'promo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  try {
    toast('Mengupload gambar...', 'info');
    const { error } = await state.session.sb.storage
      .from(BUCKET)
      .upload(fn, blob, { cacheControl: '3600', upsert: false, contentType: blob.type });
    if (error) throw error;
    const { data } = state.session.sb.storage.from(BUCKET).getPublicUrl(fn);
    state.editor.promo._pendingBlob = null;
    state.editor.promoCropBlob = null;
    return data.publicUrl;
  } catch (e) {
    console.error(e);
    toast('Gagal upload gambar', 'error');
    return null;
  }
}
function openPromoForm(id) {
  state.editor.promo = id
    ? { ...state.db.promos.find((p) => p.id === id) }
    : { title: '', description: '', image: '', active: true, sort_order: 0 };
  state.editor.promo._pendingBlob = null;
  state.editor.promoCropBlob = null;
  renderPromoForm();
}
function renderPromoForm() {
  const p = state.editor.promo,
    isN = !p.id,
    el = document.getElementById('dashContent');
  document.getElementById('dashTitle').textContent = isN ? 'Tambah Promo' : 'Edit Promo';
  const hasImg = p.image || p._pendingBlob;
  const previewSrc = p._pendingBlob ? URL.createObjectURL(p._pendingBlob) : p.image || '';
  el.innerHTML = `<div style="margin-bottom:16px"><button class="btn btn-ghost btn-sm" onclick="state.admin.panel='promos';renderSide();renderDash()"><i data-lucide="arrow-left"></i> Kembali</button></div><div class="card"><div style="padding:20px"><div class="form-group"><label class="form-label">Judul Promo</label><input class="form-input" value="${esc(p.title)}" onchange="state.editor.promo.title=this.value" placeholder="Flash Sale, Diskon Akhir Tahun..."></div><div class="form-group"><label class="form-label">Deskripsi</label><textarea class="form-input" rows="2" onchange="state.editor.promo.description=this.value" placeholder="Deskripsi singkat promo...">${esc(p.description || '')}</textarea></div><div class="form-group"><label class="form-label">Gambar Banner</label><div onclick="document.getElementById('promoFileIn').click()" style="border:2px dashed var(--border);border-radius:var(--radius-sm);padding:20px;text-align:center;cursor:pointer;transition:border-color .2s;background:var(--bg);position:relative;min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'"><img id="promoImgPreview" src="${esc(previewSrc)}" style="${hasImg ? 'display:block' : 'display:none'};max-width:100%;max-height:200px;border-radius:8px;object-fit:contain"><div id="promoImgHint" style="font-size:13px;color:var(--muted)">${hasImg ? 'Gambar sudah dipotong. Klik ganti untuk mengubah.' : '<i data-lucide="cloud-upload" style="font-size:24px;display:block;margin-bottom:6px"></i>Klik untuk pilih gambar dari device'}</div></div>${hasImg ? `<button class="btn btn-ghost btn-sm" onclick="removePromoImage()" style="margin-top:8px;color:var(--danger)"><i data-lucide="trash-2"></i> Hapus Gambar</button>` : ''}</div><div class="form-group"><label class="form-label">Urutan Tampil</label><input class="form-input" type="number" value="${p.sort_order || 0}" onchange="state.editor.promo.sort_order=parseInt(this.value)||0" style="max-width:120px"></div><div class="status-checks"><label class="status-check"><input type="checkbox" ${p.active ? 'checked' : ''} onchange="state.editor.promo.active=this.checked"><span class="sc-box"><i data-lucide="check"></i></span><span class="sc-text"><div class="sc-title">Tampilkan di Katalog</div><div class="sc-desc">Promo aktif akan muncul sebagai banner di halaman katalog</div></span></label></div><div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" onclick="state.admin.panel='promos';renderSide();renderDash()">Batal</button><button class="btn btn-primary" onclick="savePromo()"><i data-lucide="floppy-disk"></i> ${isN ? 'Tambah' : 'Simpan'}</button></div></div></div>`;
}
async function savePromo() {
  const p = state.editor.promo;
  if (!p.title || !p.title.trim()) { toast('Judul promo wajib', 'error'); return; }
  let imgUrl = p.image || '';
  if (p._pendingBlob) {
    const uploaded = await uploadPromoImage();
    if (!uploaded) {
      toast('Gagal upload gambar, promo tetap disimpan tanpa gambar', 'info');
    } else {
      imgUrl = uploaded;
    }
  }
  const saveData = {
    title: p.title.trim(),
    description: p.description || '',
    image: imgUrl,
    active: p.active !== undefined ? p.active : true,
    sort_order: p.sort_order || 0,
  };
  if (state.session.dbOk && state.session.sb) {
    if (p.id) {
      const ok = await sbUpdatePromo(p.id, saveData);
      if (!ok) return;
      toast('Diperbarui');
      logAct('Edit Promo', 'Mengedit ' + p.title, 'edit');
      await loadPromos();
    } else {
      const np = await sbInsertPromo(saveData);
      if (!np) return;
      toast('Ditambahkan');
      logAct('Tambah Promo', 'Menambahkan ' + p.title, 'add');
      await loadPromos();
    }
  } else {
    if (p.id) {
      const i = state.db.promos.findIndex((x) => x.id === p.id);
      if (i >= 0) state.db.promos[i] = { ...p, image: imgUrl };
      toast('Diperbarui');
    } else {
      p.id = Math.max(0, ...state.db.promos.map((x) => x.id)) + 1;
      state.db.promos.push({ ...p, image: imgUrl });
      toast('Ditambahkan');
    }
  }
  state.editor.promo._pendingBlob = null;
  state.editor.promoCropBlob = null;
  state.admin.panel = 'promos';
  renderSide();
  renderDash();
}
async function delPromo(id) {
  const p = state.db.promos.find((x) => x.id === id);
  if (!p) return;
  if (!(await showConfirm('Promo yang dihapus tidak bisa dikembalikan.', 'Hapus Promo?', 'delete')))
    return;
  if (state.session.dbOk && state.session.sb) {
    const ok = await sbDelPromo(id);
    if (ok) {
      toast('Dihapus');
      logAct('Hapus Promo', 'Menghapus ' + p.title, 'del');
      await loadPromos();
    }
  } else {
    state.db.promos = state.db.promos.filter((x) => x.id !== id);
    toast('Dihapus');
    logAct('Hapus Promo', 'Menghapus ' + p.title, 'del');
  }
  renderDash();
}
function openLogin() {
  document.getElementById('loginModal').classList.add('show');
  document.getElementById('loginErr').classList.remove('show');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  setTimeout(() => document.getElementById('loginUser').focus(), 100);
}
function closeLogin() { document.getElementById('loginModal').classList.remove('show'); }
async function doLogin() {
  const u = document.getElementById('loginUser').value.trim(),
    p = document.getElementById('loginPass').value;
  if (!u || !p) {
    document.getElementById('loginErr').textContent = 'Isi username dan password';
    document.getElementById('loginErr').classList.add('show');
    return;
  }
  if (state.session.dbOk && state.session.sb) {
    const { data, error } = await state.session.sb
      .from('users')
      .select('*')
      .eq('username', u)
      .eq('password', p)
      .eq('active', true)
      .single();
    if (error || !data) { document.getElementById('loginErr').classList.add('show'); return; }
    data._isDBLogin = true;
    state.session.currentUser = data;
  } else {
    const f = state.db.users.find((x) => x.username === u && x.password === p && x.active);
    if (!f) { document.getElementById('loginErr').classList.add('show'); return; }
    f._isDBLogin = true;
    state.session.currentUser = f;
  }
  closeLogin();
  toast('Selamat datang, ' + state.session.currentUser.display_name);
  logAct('Login', 'Masuk sebagai ' + state.session.currentUser.display_name, 'login');
  showView('dashboard');
  state.admin.panel = 'dashboard';
  renderSide();
  renderDash();
  updateNavAuth();
  updateDashTop();
}
function doVisitorLogin() {
  const f = state.db.users.find((x) => x.role === 'viewer' && x.active);
  if (f) {
    state.session.currentUser = f;
  } else {
    state.session.currentUser = {
      username: 'pengunjung',
      password: '',
      display_name: 'Pengunjung',
      role: 'viewer',
      active: true,
    };
  }
  closeLogin();
  toast('Selamat datang, Pengunjung!');
  logAct('Login', 'Masuk sebagai Pengunjung', 'login');
  showView('dashboard');
  state.admin.panel = 'dashboard';
  renderSide();
  renderDash();
  updateNavAuth();
  updateDashTop();
}
let _logoClicks = 0, _logoClickTimer = null;
function onLogoTripleClick() {
  _logoClicks++;
  clearTimeout(_logoClickTimer);
  if (_logoClicks >= 3) {
    _logoClicks = 0;
    openAccessModal();
    return;
  }
  _logoClickTimer = setTimeout(() => { _logoClicks = 0; }, 600);
}
function openAccessModal() { document.getElementById('accessModal').classList.add('show'); }
function closeAccessModal() { document.getElementById('accessModal').classList.remove('show'); }
function doAccessLogin(role) {
  let user = state.db.users.find((x) => x.role === role && x.active);
  if (!user) { const labels = { admin: 'Administrator', editor: 'Editor', viewer: 'Pengunjung' }; user = { username: role, password: '', display_name: labels[role] || role, role: role, active: true }; }
  state.session.currentUser = user;
  closeAccessModal();
  toast('Selamat datang, ' + user.display_name + '!');
  logAct('Login', 'Masuk sebagai ' + (ROLES[role]?.label || role), 'login');
  showView('dashboard');
  state.admin.panel = 'dashboard';
  renderSide();
  renderDash();
  updateNavAuth();
  updateDashTop();
}
function doLogout() {
  logAct('Logout', state.session.currentUser ? state.session.currentUser.display_name : '', 'login');
  state.session.currentUser = null;
  showView('catalog');
  toast('Berhasil logout');
  updateNavAuth();
}
function logAct(action, detail, type) {
  state.admin.activityLog.unshift({
    time: new Date(),
    user: state.session.currentUser ? state.session.currentUser.display_name : 'Publik',
    action,
    detail,
    type: type || 'product',
  });
  if (state.admin.activityLog.length > 50) state.admin.activityLog.length = 50;
}
function renderSettingsPanel(el) {
  const pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  if (!pm.settings_edit) { el.innerHTML = '<div class="empty-state"><i data-lucide="lock"></i><p>Akses ditolak</p></div>'; return; }
  const s = state.db.settings || fbSettings();
  const sectionCard = (icon, title, content) => `
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-head"><h3><i class="fas fa-${icon}"></i> ${title}</h3></div>
      <div style="padding: 20px;">${content}</div>
    </div>
  `;
  const identitasContent = `
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label">Nama Toko</label><input class="form-input" id="setStoreName" value="${esc(s.store_name)}" placeholder="Gadget 5tore"></div>
      <div class="form-group"><label class="form-label">Tagline</label><input class="form-input" id="setTagline" value="${esc(s.tagline || '')}" placeholder="Tagline singkat toko"></div>
      <div class="form-group"><label class="form-label">Logo URL</label><input class="form-input" id="setLogoUrl" value="${esc(s.logo_url || '')}" placeholder="https://..."></div>
      <div class="form-group"><label class="form-label">Favicon URL</label><input class="form-input" id="setFaviconUrl" value="${esc(s.favicon_url || '')}" placeholder="https://... (32x32px)"></div>
    </div>
  `;
  const tampilanContent = `
    <div class="form-group"><label class="form-label">Warna Aksen</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="color" id="setAccentColor" value="${s.accent_color || '#C8A44E'}" style="width:48px;height:38px;border:1px solid var(--border);border-radius:8px;cursor:pointer;padding:2px">
        <span style="font-size:12px;color:var(--muted)" id="accentPreview">${s.accent_color || '#C8A44E'}</span>
      </div>
    </div>
  `;
  const heroContent = `
    <div class="form-group"><label class="form-label">Hero Badge</label><input class="form-input" id="setHeroBadge" value="${esc(s.hero_badge || '')}" placeholder="Gadget Terpercaya Sejak 2025"></div>
    <div class="form-group"><label class="form-label">Hero Headline</label><input class="form-input" id="setHeroHeadline" value="${esc(s.hero_headline || '')}" placeholder="Temukan Gadget Impianmu"></div>
    <div class="form-group"><label class="form-label">Hero Subline</label><textarea class="form-input" id="setHeroSubline" rows="2" placeholder="Deskripsi singkat di bawah headline">${esc(s.hero_subline || '')}</textarea></div>
  `;
  const kontenContent = `
    <div class="form-group"><label class="form-label">Jangka Waktu Terbaru (hari)</label><input type="number" class="form-input" id="setNewestDays" value="${s.newest_days || 7}" min="1" max="365" placeholder="7"><span style="font-size:10px;color:var(--muted);margin-top:3px;display:block">Produk yang ditambahkan dalam X hari terakhir muncul di tab Terbaru</span></div>
    <div class="form-group"><label class="form-label">Footer Text</label><input class="form-input" id="setFooterText" value="${esc(s.footer_text || '')}" placeholder="© 2025 Gadget 5tore"></div>
  `;
  const seoContent = `
    <div class="form-group"><label class="form-label">Meta Title (SEO)</label><input class="form-input" id="setMetaTitle" value="${esc(s.meta_title || '')}" placeholder="Judul untuk Google"></div>
    <div class="form-group"><label class="form-label">Meta Description (SEO)</label><textarea class="form-input" id="setMetaDesc" rows="2" placeholder="Deskripsi untuk Google">${esc(s.meta_description || '')}</textarea></div>
  `;
  el.innerHTML = `
    ${sectionCard('store', 'Identitas Toko', identitasContent)}
    ${sectionCard('palette', 'Tampilan', tampilanContent)}
    ${sectionCard('home', 'Halaman Depan', heroContent)}
    ${sectionCard('cog', 'Konten', kontenContent)}
    ${sectionCard('search', 'SEO & Analytics', seoContent)}
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-primary" onclick="saveSettings()"><i data-lucide="floppy-disk"></i> Simpan Pengaturan</button>
    </div>
  `;
  const colorInput = document.getElementById('setAccentColor');
  const preview = document.getElementById('accentPreview');
  if (colorInput && preview) { colorInput.addEventListener('input', () => { preview.textContent = colorInput.value; }); }
}
async function saveSettings() {
  const s = {
    store_name: document.getElementById('setStoreName').value.trim(),
    tagline: document.getElementById('setTagline').value.trim(),
    logo_url: document.getElementById('setLogoUrl').value.trim(),
    favicon_url: document.getElementById('setFaviconUrl').value.trim(),
    accent_color: document.getElementById('setAccentColor').value,
    hero_badge: document.getElementById('setHeroBadge').value.trim(),
    hero_headline: document.getElementById('setHeroHeadline').value.trim(),
    hero_subline: document.getElementById('setHeroSubline').value.trim(),
    newest_days: parseInt(document.getElementById('setNewestDays').value) || 7,
    footer_text: document.getElementById('setFooterText').value.trim(),
    meta_title: document.getElementById('setMetaTitle').value.trim(),
    meta_description: document.getElementById('setMetaDesc').value.trim(),
  };
  if (!s.store_name) { toast('Nama toko wajib diisi', 'error'); return; }
    if (state.session.dbOk && state.session.sb) {
    const ok = await sbUpdateSettings(s);
    if (!ok) return;
  }
  Object.assign(state.db.settings, s);
  applySettings();
  renderBranchInfo();
  renderCatalog();
  toast('Pengaturan tersimpan');
  logAct('Edit Pengaturan', 'Mengubah pengaturan toko', 'edit');
  renderDash();
}
function renderCategoryList(el) {
  const pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  const ca = pm.categories_add, ce = pm.categories_edit, cd = pm.categories_delete;
  el.innerHTML = `<div class="card"><div class="card-head"><h3><i data-lucide="tags"></i> Daftar Kategori (${state.db.categories.length})</h3>${ca ? `<button class="btn btn-primary btn-sm" onclick="openCategoryForm()"><i data-lucide="plus"></i> Tambah</button>` : ''}</div><div style="padding:16px">${
    state.db.categories.length
      ? `<div class="branch-card-inner">${state.db.categories.sort((a, b) => a.sort_order - b.sort_order).map((c) => {
          return `<div class="branch-card"><div class="branch-card-icon">${getCatIconHtmlManaged(c, '20px')}</div><div class="branch-card-body"><div class="branch-card-name">${esc(c.name)}<span class="badge ${c.active ? 'badge-green' : 'badge-red'}" style="font-size:8px">${c.active ? 'Aktif' : 'Nonaktif'}</span></div><div class="branch-card-addr">Urutan: ${c.sort_order} &middot; Icon: ${c.icon_type || 'Default'}</div></div><div class="branch-card-actions">${ce ? `<button class="btn btn-info btn-sm" onclick="openCategoryForm(${c.id})"><i data-lucide="pencil"></i></button>` : ''}${cd ? `<button class="btn btn-danger btn-sm" onclick="delCategory(${c.id})"><i data-lucide="trash-2"></i></button>` : ''}</div></div>`;
        }).join('')}</div>`
      : '<div class="empty-state" style="padding:30px"><i data-lucide="tags"></i><p>Belum ada kategori</p></div>'
  }</div></div>`;
}
function getCatIconHtmlManaged(c, s) {
  if (c.icon_type === 'lucide' && c.icon_value) return `<i data-lucide="${c.icon_value}" style="font-size:${s}"></i>`;
  if (c.icon_type === 'fontawesome' && c.icon_value) return `<i class="${c.icon_value}" style="font-size:${s}"></i>`;
  if (c.icon_type === 'simpleicons' && c.icon_value) return `<img src="https://cdn.simpleicons.org/${c.icon_value}" alt="" style="height:${s};width:auto;object-fit:contain">`;
  return `<i data-lucide="tag" style="font-size:${s}"></i>`;
}
function openCategoryForm(id) {
  state.admin.panel = '_catForm';
  if (id) {
    const c = state.db.categories.find((x) => x.id === id);
    if (c) state.editor.category = { ...c };
  } else {
    state.editor.category = { name: '', slug: '', icon_type: '', icon_value: '', sort_order: state.db.categories.length, active: true };
  }
  renderDash();
}
function renderCategoryForm(el) {
  const c = state.editor.category;
  if (!c) return;
  const isN = !c.id;
  el.innerHTML = `<div style="margin-bottom:16px"><button class="btn btn-ghost btn-sm" onclick="state.admin.panel='categories';renderSide();renderDash()"><i data-lucide="arrow-left"></i> Kembali</button></div><div class="card"><div style="padding:20px">
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label">Nama Kategori</label><input class="form-input" id="catName" value="${esc(c.name)}" placeholder="Samsung" oninput="autoSlug()"></div>
      <div class="form-group"><label class="form-label">Slug (URL)</label><input class="form-input" id="catSlug" value="${esc(c.slug)}" placeholder="samsung"></div>
      <div class="form-group"><label class="form-label">Urutan</label><input type="number" class="form-input" id="catSort" value="${c.sort_order}" min="0"></div>
      <div class="form-group"><label class="form-label">Status</label><label class="status-check"><input type="checkbox" id="catActive" ${c.active ? 'checked' : ''}><span class="sc-box"><i data-lucide="check"></i></span><span class="sc-text"><div class="sc-title">Aktif</div><div class="sc-desc">Tampil di filter katalog</div></span></label></div>
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Tipe Icon</label><select class="form-input" id="catIconType" onchange="document.getElementById('catIconValue').value=''"><option value="" ${!c.icon_type ? 'selected' : ''}>Tanpa Icon (Default)</option><option value="fontawesome" ${c.icon_type === 'fontawesome' ? 'selected' : ''}>Font Awesome</option><option value="simpleicons" ${c.icon_type === 'simpleicons' ? 'selected' : ''}>Simple Icons (Brand Logo)</option></select></div>
      <div class="form-group" style="grid-column:1/-1" id="catIconValueWrap"><label class="form-label">Value Icon</label><input class="form-input" id="catIconValue" value="${esc(c.icon_value)}" placeholder="${c.icon_type === 'lucide' ? 'smartphone' : c.icon_type === 'fontawesome' ? 'fas fa-mobile-alt' : c.icon_type === 'simpleicons' ? 'samsung' : 'Kosongkan jika tanpa icon'}"></div>
    </div>
    <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" onclick="state.admin.panel='categories';renderSide();renderDash()">Batal</button><button class="btn btn-primary" onclick="saveCategory()"><i data-lucide="floppy-disk"></i> ${isN ? 'Tambah' : 'Simpan'}</button></div>
  </div></div>`;
}
function autoSlug() {
  const name = document.getElementById('catName').value.trim();
  const slugEl = document.getElementById('catSlug');
  if (slugEl && !state.editor.category?.id) { slugEl.value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
}
async function saveCategory() {
  const c = state.editor.category;
  if (!c) return;
  c.name = document.getElementById('catName').value.trim();
  c.slug = document.getElementById('catSlug').value.trim();
  c.sort_order = parseInt(document.getElementById('catSort').value) || 0;
  c.active = document.getElementById('catActive').checked;
  c.icon_type = document.getElementById('catIconType').value;
  c.icon_value = document.getElementById('catIconValue').value.trim();
  if (!c.name) { toast('Nama kategori wajib diisi', 'error'); return; }
  if (!c.slug) { toast('Slug wajib diisi', 'error'); return; }
  if (c.id) {
    if (state.session.dbOk) { const ok = await sbUpdateCategory(c.id, c); if (!ok) return; }
    else { const idx = state.db.categories.findIndex((x) => x.id === c.id); if (idx >= 0) state.db.categories[idx] = c; }
    toast('Kategori diperbarui');
    logAct('Edit Kategori', 'Mengedit ' + c.name, 'edit');
  } else {
    if (state.session.dbOk) {
      const np = await sbInsertCategory(c);
      if (!np) return;
      c.id = np.id;
    } else {
      c.id = Math.max(0, ...state.db.categories.map((x) => x.id)) + 1;
      state.db.categories.push(c);
    }
    toast('Kategori ditambahkan');
    logAct('Tambah Kategori', 'Menambahkan ' + c.name, 'add');
  }
  state.admin.panel = 'categories';
  renderSide();
  renderDash();
  renderCatalog();
}
async function delCategory(id) {
  const c = state.db.categories.find((x) => x.id === id);
  if (!c) return;
  if (!(await showConfirm('Kategori yang dihapus tidak bisa dikembalikan.', 'Hapus Kategori?', 'delete'))) return;
  if (state.session.dbOk) { const ok = await sbDelCategory(id); if (!ok) return; }
  else { state.db.categories = state.db.categories.filter((x) => x.id !== id); }
  toast('Kategori dihapus');
  logAct('Hapus Kategori', 'Menghapus ' + c.name, 'delete');
  renderDash();
  renderCatalog();
}
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('show');
  state.admin.sideLock = true;
  setTimeout(() => { state.admin.sideLock = false; }, 350);
}
function closeSidebar() {
  if (state.admin.sideLock) return;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}
function renderSide() {
  const n = document.getElementById('sideNav'),
    f = document.getElementById('sideFoot'),
    pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  const low = state.db.products.filter((p) => !p.archived && p.stock <= 5).length;
  let h = '<div class="nav-label">Menu Utama</div>';
  if (pm.dashboard)
    h += `<div class="nav-item ${state.admin.panel === 'dashboard' ? 'active' : ''}" onclick="state.admin.panel='dashboard';renderSide();renderDash();closeSidebar()"><i data-lucide="pie-chart"></i> Dashboard</div>`;
  if (pm.products_view)
    h += `<div class="nav-item ${state.admin.panel === 'products' ? 'active' : ''}" onclick="state.admin.panel='products';renderSide();renderDash();closeSidebar()"><i data-lucide="box"></i> Produk${low ? `<span class="nav-badge">${low}</span>` : ''}</div>`;
  if (pm.users_view)
    h += `<div class="nav-item ${state.admin.panel === 'users' ? 'active' : ''}" onclick="state.admin.panel='users';renderSide();renderDash();closeSidebar()"><i data-lucide="users"></i> Pengguna</div>`;
  if (pm.branches_view)
    h += `<div class="nav-item ${state.admin.panel === 'branches' ? 'active' : ''}" onclick="state.admin.panel='branches';renderSide();renderDash();closeSidebar()"><i data-lucide="store"></i> Cabang</div>`;
  if (pm.categories_view)
    h += `<div class="nav-item ${state.admin.panel === 'categories' ? 'active' : ''}" onclick="state.admin.panel='categories';renderSide();renderDash();closeSidebar()"><i data-lucide="tags"></i> Kategori</div>`;
  h += '<div class="nav-label">Konten</div>';
  if (pm.social_edit)
    h += `<div class="nav-item ${state.admin.panel === 'social' ? 'active' : ''}" onclick="state.admin.panel='social';renderSide();renderDash();closeSidebar()"><i data-lucide="share-2"></i> Sosial Media</div>`;
  if (pm.promos_manage)
    h += `<div class="nav-item ${state.admin.panel === 'promos' ? 'active' : ''}" onclick="state.admin.panel='promos';renderSide();renderDash();closeSidebar()"><i data-lucide="megaphone"></i> Promo</div>`;
  if (pm.reviews_manage) {
    const pendingRev = state.db.reviews.filter(r => r.hidden).length;
    h += `<div class="nav-item ${state.admin.panel === 'reviews' ? 'active' : ''}" onclick="state.admin.panel='reviews';state.admin.reviewFilterStatus='all';state.admin.reviewFilterRating=0;state.admin.reviewSelected=[];state.admin.reviewPage=1;renderSide();renderDash();closeSidebar()"><i data-lucide="messages-square"></i> Ulasan${pendingRev ? `<span class="nav-badge">${pendingRev}</span>` : ''}</div>`;
  }
  h += '<div class="nav-label">Sistem</div>';
  if (pm.settings_edit)
    h += `<div class="nav-item ${state.admin.panel === 'settings' ? 'active' : ''}" onclick="state.admin.panel='settings';renderSide();renderDash();closeSidebar()"><i data-lucide="settings"></i> Pengaturan</div>`;
  if (pm.roles_edit)
    h += `<div class="nav-item ${state.admin.panel === 'roles' ? 'active' : ''}" onclick="state.admin.panel='roles';renderSide();renderDash();closeSidebar()"><i data-lucide="shield-check"></i> Peran</div>`;
  h += `<div class="nav-item ${state.admin.panel === 'activity' ? 'active' : ''}" onclick="state.admin.panel='activity';renderSide();renderDash();closeSidebar()"><i data-lucide="history"></i> Aktivitas</div>`;
  n.innerHTML = h;
  f.innerHTML = '';
  renderMobBottomNav();
}
function renderMobBottomNav() {
  const el = document.getElementById('mobBottomNav');
  if (!el) return;
  const inner = el.querySelector('.mob-bottom-nav-inner');
  if (!inner) return;
  const pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  const items = [];
  if (pm.dashboard) items.push({ icon: 'fa-chart-pie', label: 'Home', panel: 'dashboard' });
  if (pm.products_view) items.push({ icon: 'fa-box', label: 'Produk', panel: 'products' });
  if (pm.branches_view) items.push({ icon: 'fa-store-alt', label: 'Cabang', panel: 'branches' });
  if (pm.promos_manage) items.push({ icon: 'fa-bullhorn', label: 'Promo', panel: 'promos' });
  items.push({ icon: 'fa-ellipsis-h', label: 'Lainnya', panel: '_more' });
  inner.innerHTML = items
    .map(
      (it) =>
        `<div class="mob-nav-item ${state.admin.panel === it.panel ? 'active' : ''}" onclick="${it.panel === '_more' ? 'openSidebar()' : `state.admin.panel='${it.panel}';renderSide();renderDash();closeSidebar();window.scrollTo(0,0)`}"><i class="fas ${it.icon}"></i><span>${it.label}</span></div>`
    )
    .join('');
}
function renderDash() {
  updateDashTop();
  const el = document.getElementById('dashContent'),
    ti = document.getElementById('dashTitle');
  if (state.admin.panel === 'dashboard') {
    ti.textContent = 'Dashboard';
    renderHome(el);
  } else if (state.admin.panel === 'products') {
    ti.textContent = 'Kelola Produk';
    renderProdList(el);
  } else if (state.admin.panel === 'users') {
    ti.textContent = 'Kelola Pengguna';
    renderUserList(el);
  } else if (state.admin.panel === 'branches') {
    ti.textContent = 'Kelola Cabang';
    renderBranchList(el);
  } else if (state.admin.panel === 'social') {
    ti.textContent = 'Sosial Media';
    renderSocialMedia(el);
  } else if (state.admin.panel === 'promos') {
    ti.textContent = 'Kelola Promo';
    renderPromoList(el);
  } else if (state.admin.panel === 'roles') {
    ti.textContent = 'Kelola Peran';
    renderRoles(el);
  } else if (state.admin.panel === 'reviews') {
    ti.textContent = 'Kelola Ulasan';
    renderReviewList(el);
  } else if (state.admin.panel === 'activity') {
    ti.textContent = 'Aktivitas Terakhir';
    renderActivityLog(el);
  } else if (state.admin.panel === 'settings') {
    ti.textContent = 'Pengaturan Toko';
    renderSettingsPanel(el);
  } else if (state.admin.panel === 'categories') {
    ti.textContent = 'Kelola Kategori';
    renderCategoryList(el);
  } else if (state.admin.panel === '_catForm') {
    ti.textContent = state.editor.category?.id ? 'Edit Kategori' : 'Tambah Kategori';
    renderCategoryForm(el);
  }
}
function renderHome(el) {
  const ac = state.db.products.filter((p) => !p.archived),
    rev = state.db.products.reduce((s, p) => s + p.price * p.sold, 0),
    stk = ac.reduce((s, p) => s + p.stock, 0),
    low = ac.filter((p) => p.stock <= 5);
  const lowCount = low.length;
  const reviewsCount = state.db.reviews.filter((r) => !r.hidden).length;
  const branchCount = state.db.branches.filter((b) => b.active).length;
  const hour = new Date().getHours();
  const greet =
    hour < 11
      ? 'Selamat Pagi'
      : hour < 15
        ? 'Selamat Siang'
        : hour < 18
          ? 'Selamat Sore'
          : 'Selamat Malam';
  const uName = state.session.currentUser ? state.session.currentUser.display_name.split(' ')[0] : 'Admin';
  const pm = state.session.currentUser ? ROLES[state.session.currentUser.role]?.perms || {} : {};
  let lowHtml = '';
  if (lowCount) {
    lowHtml = `<div class="low-stock-list">${low.map((p) => `<div class="low-stock-item"><img class="low-stock-img" src="${(p.images || [])[0] || 'https://picsum.photos/seed/def/80/80'}" alt="" loading="lazy"><div class="low-stock-info"><div class="low-stock-name">${esc(p.name)}</div><div class="low-stock-brand">${esc(p.brand)}</div></div><span class="low-stock-badge ${p.stock === 0 ? 'habis' : 'rendah'}">${p.stock === 0 ? 'Habis' : 'Stok ' + p.stock}</span></div>`).join('')}</div>`;
  } else {
    lowHtml =
      '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px"><i data-lucide="circle-check" style="color:#22c55e;margin-right:6px"></i>Semua stok aman</div>';
  }
  let recentHtml = '';
  const recent = state.admin.activityLog.slice(0, 6);
  if (recent.length) {
    recentHtml = recent
      .map((a) => {
        const ic =
          a.type === 'add'
            ? 'act-add'
            : a.type === 'del'
              ? 'act-del'
              : a.type === 'login'
                ? 'act-login'
                : a.type === 'review'
                  ? 'act-review'
                  : 'act-edit';
        const icon =
          a.type === 'add'
            ? 'fa-plus'
            : a.type === 'del'
              ? 'fa-trash'
              : a.type === 'login'
                ? 'fa-sign-in-alt'
                : a.type === 'review'
                  ? 'fa-star'
                  : 'fa-pen';
        const t = a.time;
        const ts =
          t.getHours().toString().padStart(2, '0') +
          ':' +
          t.getMinutes().toString().padStart(2, '0');
        const ds = t.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        return `<div class="dash-recent-item"><div class="dash-recent-icon ${ic}"><i class="fas ${icon}"></i></div><div class="dash-recent-text"><strong>${esc(a.action)}</strong><span>${esc(a.detail)}</span></div><div class="dash-recent-time">${ds} ${ts}</div></div>`;
      })
      .join('');
  } else {
    recentHtml =
      '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Belum ada aktivitas</div>';
  }
  let quickHtml = '';
  const qa = [];
  if (pm.products_add)
    qa.push({ icon: 'fa-plus-circle', label: 'Tambah Produk', fn: 'openProdForm()' });
  if (pm.branches_view)
    qa.push({
      icon: 'fa-store-alt',
      label: 'Kelola Cabang',
      fn: "state.admin.panel='branches';renderSide();renderDash()",
    });
  if (pm.social_edit)
    qa.push({
      icon: 'fa-share-alt',
      label: 'Sosial Media',
      fn: "state.admin.panel='social';renderSide();renderDash()",
    });
  if (pm.promos_manage)
    qa.push({ icon: 'fa-bullhorn', label: 'Buat Promo', fn: 'openPromoForm()' });
  if (pm.reviews_manage)
    qa.push({
      icon: 'fa-comments',
      label: 'Lihat Ulasan',
      fn: "state.admin.panel='reviews';renderSide();renderDash()",
    });
  qa.push({ icon: 'fa-external-link-alt', label: 'Buka Toko', fn: 'goToCatalog()' });
  const qaColors = ['gold', 'teal', 'amber', 'rose', 'indigo', 'sky'];
  quickHtml = qa
    .map(
      (q, i) =>
        `<div class="quick-action quick-action--${qaColors[i % qaColors.length]}" onclick="${q.fn}"><i class="fas ${q.icon}"></i><span>${q.label}</span></div>`
    )
    .join('');
  el.innerHTML = `
    <div class="dash-greeting">
      ${greet}, <strong>${esc(uName)}</strong>! Selamat mengelola tokomu.
      <span class="greeting-time">${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    <div class="stats-grid">
      <div class="stat-card stat-card--gold"><div class="stat-icon"><i data-lucide="box"></i></div><div class="stat-label">Total Produk</div><div class="stat-value">${ac.length}</div></div>
      <div class="stat-card stat-card--teal"><div class="stat-icon"><i data-lucide="store"></i></div><div class="stat-label">Cabang Aktif</div><div class="stat-value">${branchCount}</div></div>
      <div class="stat-card stat-card--amber"><div class="stat-icon"><i data-lucide="messages-square"></i></div><div class="stat-label">Ulasan</div><div class="stat-value">${reviewsCount}</div></div>
      <div class="stat-card stat-card--rose"><div class="stat-icon"><i data-lucide="triangle-alert"></i></div><div class="stat-label">Stok Rendah</div><div class="stat-value" style="${lowCount ? 'color:#D25050' : ''}">${lowCount}</div></div>
    </div>
    ${qa.length ? `<div class="quick-actions">${quickHtml}</div>` : ''}
    <div class="dash-grid-2col" style="margin-top:20px">
      <div class="card card--rose"><div class="card-head"><h3><i data-lucide="circle-alert"></i> Stok Rendah (${lowCount})</h3></div><div style="padding:14px 16px">${lowHtml}</div></div>
      <div class="card card--indigo"><div class="card-head"><h3><i data-lucide="history"></i> Aktivitas Terakhir</h3></div><div class="dash-recent" style="padding:4px 16px 8px">${recentHtml}</div></div>
    </div>
    <div style="margin-top:20px"><div class="card card--gold"><div class="card-head"><h3><i data-lucide="pie-chart"></i> Distribusi Kategori</h3></div><div style="padding:20px;display:flex;align-items:center;justify-content:center">${renderCatChartContents()}</div></div></div>
  `;
  updateGreetingTime();
}
function renderCatChart(el) {
  el.innerHTML = `<div class="card">
    <div class="card-head"><h3>Distribusi Kategori</h3></div>
    <div style="padding:20px">
      ${renderCatChartContents()}
    </div>
  </div>`;
}
function renderCatChartContents() {
  const ac = state.db.products.filter((p) => !p.archived);
  if (!ac.length) { return '<div class="empty-state" style="padding:20px"><p>Belum ada produk</p></div>'; }
  const counts = {};
  ac.forEach((p) => { const cat = p.category || 'Lainnya'; counts[cat] = (counts[cat] || 0) + 1; });
  const total = ac.length;
  const categories = Object.keys(counts).sort();
  const palette = [
    '#C8A44E',
    '#2D9B83',
    '#D9772A',
    '#6366F1',
    '#D25050',
    '#0EA5E9',
    '#A78BFA',
    '#14B8A6',
    '#E8615D',
    '#84CC16',
    '#F59E0B',
    '#EC4899',
    '#4F46E5',
  ];
  const colors = {};
  categories.forEach((cat, i) => { colors[cat] = palette[i % palette.length]; });
  let cumPct = 0;
  const stops = categories
    .map((cat) => {
      const pct = (counts[cat] / total) * 100;
      const start = cumPct;
      cumPct += pct;
      return `${colors[cat]} ${start.toFixed(1)}% ${(start + pct).toFixed(1)}%`;
    })
    .join(',');
  const grad = `conic-gradient(${stops})`;
  const legendHtml = categories
    .map(
      (cat) => `
    <div class="cat-legend-item">
      <div class="cat-legend-dot" style="background:${colors[cat]};box-shadow:0 0 8px ${colors[cat]}40"></div>
      <div class="cat-legend-name">${cat}</div>
      <div class="cat-legend-val">${counts[cat]}</div>
    </div>
  `
    )
    .join('');
  return `
    <div class="cat-chart-wrap">
      <div class="cat-donut" style="background:${grad}; box-shadow: 0 0 40px rgba(0,0,0,0.1);">
        <div class="cat-donut-hole">
          <div class="cat-donut-total">${total}</div>
          <div class="cat-donut-label">Produk</div>
        </div>
      </div>
      <div class="cat-legend">${legendHtml}</div>
    </div>
  `;
}
function renderProdList(el) {
  const oldInput = document.getElementById('dashSearch'),
    searchCursor = oldInput ? oldInput.selectionStart : null;
  const ca = hasPerm('products_add'),
    ce = hasPerm('products_edit'),
    cd = hasPerm('products_delete');
  const q = (document.getElementById('dashSearch')?.value || '').toLowerCase().trim();
  let list = [...state.db.products];
  if (state.catalog.dashCatFilter !== 'Semua') list = list.filter((p) => p.category === state.catalog.dashCatFilter);
  if (q) {
    list = list.filter((p) =>
      (
        (p.name || '') +
        ' ' +
        (p.brand || '') +
        ' ' +
        (p.category || '') +
        ' ' +
        (p.description || '') +
        ' ' +
        (p.specs || []).join(' ')
      )
        .toLowerCase()
        .includes(q)
    );
  }
  list = list.sort((a, b) => {
    let va = a[state.admin.sortField],
      vb = b[state.admin.sortField];
    if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
    return va < vb ? (state.admin.sortDir === 'asc' ? -1 : 1) : va > vb ? (state.admin.sortDir === 'asc' ? 1 : -1) : 0;
  });
  const tp = Math.max(1, Math.ceil(list.length / PP));
  if (state.admin.productPage > tp) state.admin.productPage = tp;
  const pi = list.slice((state.admin.productPage - 1) * PP, state.admin.productPage * PP);
  const si = (f) =>
    state.admin.sortField === f
      ? `<i data-lucide="chevron-${state.admin.sortDir === 'asc' ? 'up' : 'down'}" style="margin-left:3px;color:var(--accent);width:12px;height:12px"></i>`
      : `<i data-lucide="arrow-up-down" style="margin-left:3px;opacity:.3"></i>`;
  const catOpts = ['Semua', ...CATS]
    .map((c) => `<option value="${c}"${state.catalog.dashCatFilter === c ? ' selected' : ''}>${c}</option>`)
    .join('');
  el.innerHTML = `<div class="card"><div class="card-head"><h3><i data-lucide="box"></i> Daftar Produk (${state.db.products.length})</h3><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${ca ? `<button class="btn btn-primary btn-sm" onclick="openProdForm()"><i data-lucide="plus"></i> Tambah</button>` : ''}<div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:2px solid var(--border);border-radius:10px;padding:6px 12px;max-width:280px;min-width:200px"><i data-lucide="search" style="color:var(--accent)"></i><input type="text" placeholder="Cari nama, kategori, spesifikasi..." id="dashSearch" oninput="renderDash()" value="${esc(document.getElementById('dashSearch')?.value || '')}" style="background:none;border:none;outline:none;width:100%;font-size:13px;color:var(--fg);font-weight:600;"></div><select class="filter-select" style="min-width:130px" onchange="state.catalog.dashCatFilter=this.value;state.admin.productPage=1;renderDash()">${catOpts}</select></div></div>${!state.db.products.length ? '<div class="empty-state"><i data-lucide="package-open"></i><p>Belum ada produk</p><div class="empty-state-cta" onclick="openProdForm()"><i data-lucide="plus"></i> Tambah Produk Pertama</div></div>' : `<div class="table-wrap"><table><thead><tr><th style="cursor:pointer" onclick="state.admin.sortField='name';state.admin.sortDir=state.admin.sortDir==='asc'?'desc':'asc';renderDash()">Produk ${si('name')}</th><th>Kategori</th><th style="cursor:pointer" onclick="state.admin.sortField='price';state.admin.sortDir=state.admin.sortDir==='asc'?'desc':'asc';renderDash()">Harga ${si('price')}</th><th style="cursor:pointer" onclick="state.admin.sortField='stock';state.admin.sortDir=state.admin.sortDir==='asc'?'desc':'asc';renderDash()">Stok ${si('stock')}</th><th>Terjual</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${pi.map((p) => `<tr><td><div class="prod-cell"><img class="prod-thumb" src="${(p.images || [])[0] || 'https://picsum.photos/seed/def/80/80'}" alt="" loading="lazy"><div><div class="prod-name">${esc(p.name)}</div><div class="prod-brand">${esc(p.brand)}</div></div></div></td><td><span class="badge ${getCatBadgeClass(p.category)}">${esc(p.category)}</span></td><td>${(() => { const d = getDiscount(p); return d ? `<span class="tbl-disc"><span class="tbl-disc-badge"><i data-lucide="tag"></i> ${d.percent}%</span><span class="tbl-disc-orig">${fmt(d.originalPrice)}</span><br><strong style="color:var(--danger)">${fmt(d.discountedPrice)}</strong></span>` : `<strong>${fmt(p.price)}</strong>`; })()}</td><td>${p.stock <= 5 ? `<span style="color:${p.stock === 0 ? 'var(--danger)' : 'var(--warning)'};font-weight:600">${p.stock}</span>` : p.stock}</td><td>${p.sold || 0}</td><td>${p.archived ? '<span class="badge badge-red">Arsip</span>' : p.featured ? '<span class="badge badge-gold">Unggulan</span>' : '<span class="badge badge-green">Aktif</span>'}</td><td><div class="action-btns"><button class="btn btn-ghost btn-sm" onclick="viewProd(${p.id})"><i data-lucide="eye"></i></button>${ce ? `<button class="btn btn-info btn-sm" onclick="openProdForm(${p.id})"><i data-lucide="pencil"></i></button>` : ''}${cd ? `<button class="btn btn-danger btn-sm" onclick="delProd(${p.id})"><i data-lucide="trash-2"></i></button>` : ''}</div></td></tr>`).join('')}</tbody></table></div><div class="pagination">${pag(state.admin.productPage, tp, 'state.admin.productPage')}</div>`}</div>`;
  const newInput = document.getElementById('dashSearch');
  if (newInput && window.innerWidth > 768) { newInput.focus(); if (searchCursor !== null) newInput.setSelectionRange(searchCursor, searchCursor); }
}
function renderActivityLog(el) {
  const recent = state.admin.activityLog.slice(0, 10);
  if (!recent.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:30px"><i data-lucide="history"></i><p>Belum ada aktivitas tercatat</p><p style="font-size:11px;margin-top:4px">Aktivitas akan muncul saat ada perubahan data</p></div>';
    return;
  }
  el.innerHTML = `<div class="act-log">${recent
    .map((a) => {
      const ic =
        a.type === 'add'
          ? 'act-add'
          : a.type === 'del'
            ? 'act-del'
            : a.type === 'login'
              ? 'act-login'
              : a.type === 'review'
                ? 'act-review'
                : 'act-edit';
      const icon =
        a.type === 'add'
          ? 'fa-plus'
          : a.type === 'del'
            ? 'fa-trash'
            : a.type === 'login'
              ? 'fa-sign-in-alt'
              : a.type === 'review'
                ? 'fa-star'
                : 'fa-pen';
      const t = a.time;
      const ts =
        t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
      const ds = t.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      return `<div class="act-item"><div class="act-icon ${ic}"><i class="fas ${icon}"></i></div><div class="act-text"><strong>${esc(a.action)}</strong><br><span style="color:var(--muted);font-size:11px">${esc(a.detail)}</span></div><div class="act-time">${ds}<br>${ts}</div></div>`;
    })
    .join('')}</div>`;
}
function renderUserList(el) {
  const cu = hasPerm('users_add'),
    ce = hasPerm('users_edit'),
    cd = hasPerm('users_delete');
  const tp = Math.max(1, Math.ceil(state.db.users.length / UP));
  if (state.admin.userPage > tp) state.admin.userPage = tp;
  const pi = state.db.users.slice((state.admin.userPage - 1) * UP, state.admin.userPage * UP);
  el.innerHTML = `<div class="card"><div class="card-head"><h3><i data-lucide="users"></i> Daftar Pengguna (${state.db.users.length})</h3><div>${cu ? `<button class="btn btn-primary btn-sm" onclick="openUserForm()"><i data-lucide="plus"></i> Tambah</button>` : ''}</div></div><div class="table-wrap"><table><thead><tr><th>Username</th><th>Nama Tampilan</th><th>Peran</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${pi
    .map(
      (u) =>
        `<tr><td><div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:30px;height:30px;font-size:10px;border-radius:8px">${(
          u.display_name || u.username
        )
          .split(' ')
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(
            0,
            2
          )}</div><strong>${esc(u.username)}</strong></div></td><td>${esc(u.display_name || u.username)}</td><td><span class="badge ${u.role === 'admin' ? 'badge-red' : u.role === 'editor' ? 'badge-blue' : 'badge-green'}">${esc(ROLES[u.role]?.label || u.role)}</span></td><td>${u.active ? '<span class="badge badge-green">Aktif</span>' : '<span class="badge badge-red">Nonaktif</span>'}</td><td><div class="action-btns">${ce ? `<button class="btn btn-info btn-sm" onclick="openUserForm(${u.id})"><i data-lucide="pencil"></i></button>` : ''}${cd ? `<button class="btn btn-danger btn-sm" onclick="delUser(${u.id})"><i data-lucide="trash-2"></i></button>` : ''}</div></td></tr>`
    )
    .join(
      ''
    )}</tbody></table></div><div class="pagination">${pag(state.admin.userPage, tp, 'state.admin.userPage')}</div></div>`;
}
function renderRoles(el) {
  const PERM_GROUPS = [
    { label: 'Dashboard', perms: ['dashboard'] },
    { label: 'Produk', perms: ['products_view', 'products_add', 'products_edit', 'products_delete'] },
    { label: 'Pengguna', perms: ['users_view', 'users_add', 'users_edit', 'users_delete'] },
    { label: 'Cabang', perms: ['branches_view', 'branches_add', 'branches_edit', 'branches_delete'] },
    { label: 'Kategori', perms: ['categories_view', 'categories_add', 'categories_edit', 'categories_delete'] },
    { label: 'Lainnya', perms: ['social_edit', 'roles_edit', 'reviews_manage', 'promos_manage', 'settings_edit'] },
  ];
  const shortLabel = (pk) => { const map = { dashboard:'Lihat', products_view:'Lihat', products_add:'Tambah', products_edit:'Edit', products_delete:'Hapus', users_view:'Lihat', users_add:'Tambah', users_edit:'Edit', users_delete:'Hapus', branches_view:'Lihat', branches_add:'Tambah', branches_edit:'Edit', branches_delete:'Hapus', categories_view:'Lihat', categories_add:'Tambah', categories_edit:'Edit', categories_delete:'Hapus', social_edit:'Sosmed', roles_edit:'Peran', reviews_manage:'Ulasan', promos_manage:'Promo', settings_edit:'Setting' }; return map[pk] || pk; };
  const roleBadge = { admin: 'badge-red', editor: 'badge-blue', viewer: 'badge-green' };
  const editing = state.admin.editRole;
  el.innerHTML = `<div class="card"><div class="card-head"><h3><i data-lucide="shield-check"></i> Kelola Peran</h3></div><div style="padding:16px">${Object.entries(ROLES).map(([k, r]) => {
    const isEditing = editing === k;
    return `<div class="role-card${isEditing ? ' editing' : ''}">
      <div class="role-card-head">
        <div class="role-card-left"><span class="badge ${roleBadge[k]}" style="margin-right:8px">${r.label}</span><span style="font-size:12px;color:var(--muted)">${r.desc}</span></div>
        <button class="role-edit-btn" onclick="state.admin.editRole=state.admin.editRole==='${k}'?null:'${k}';renderDash()" title="${isEditing ? 'Tutup' : 'Edit'}"><i class="fas fa-${isEditing ? 'times' : 'pen'}"></i></button>
      </div>
      ${isEditing ? `<div class="role-card-body">${PERM_GROUPS.map(g => `<div class="role-perm-group"><span class="role-perm-group-label">${g.label}</span><div class="role-perm-toggles">${g.perms.map(pk => `<span class="rp-toggle${r.perms[pk] ? ' on' : ''}" onclick="togglePerm('${k}','${pk}')" title="${PERMS[pk].label}">${shortLabel(pk)}</span>`).join('')}</div></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div></div>`;
}
function togglePerm(role, perm) { ROLES[role].perms[perm] = !ROLES[role].perms[perm]; renderDash(); }
function pag(cur, tot, vn) {
  if (tot <= 1) return '';
  let h = `<button class="page-btn" onclick="${vn}=Math.max(1,${vn}-1);renderDash()" ${cur === 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button>`;
  for (let i = 1; i <= tot; i++) {
    if (tot > 7 && i > 2 && i < tot - 1 && Math.abs(i - cur) > 1) {
      if (i === 3 || i === tot - 2)
        h += '<span style="color:var(--muted);padding:0 4px">...</span>';
      continue;
    }
    h += `<button class="page-btn ${i === cur ? 'active' : ''}" onclick="${vn}=${i};renderDash()">${i}</button>`;
  }
  h += `<button class="page-btn" onclick="${vn}=Math.min(${tot},${vn}+1);renderDash()" ${cur === tot ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>`;
  return h;
}
function switchToGrouped() {
  if (!state.editor.product.variant_groups || !state.editor.product.variant_groups.length) {
    state.editor.product.variant_groups = [{ name: 'Warna', options: ['Hitam', 'Putih', 'Biru'] }];
    state.editor.product.variants = [];
    regenVariants();
  }
  renderProdForm();
}
function openProdForm(id) {
  state.editor.product = id
    ? { ...state.db.products.find((p) => p.id === id) }
    : {
        category: CATS[0],
        brand: '',
        name: '',
        price: 0,
        description: '',
        specs: [],
        images: [],
        variants: [],
        variant_groups: [],
        featured: false,
        archived: false,
        stock: 0,
        sold: 0,
        discount_price: null,
        discount_percent: null,
      };
  if (!state.editor.product.images) state.editor.product.images = [];
  if (!state.editor.product.specs) state.editor.product.specs = [];
  if (!state.editor.product.variants) state.editor.product.variants = [];
  if (!state.editor.product.variant_groups) state.editor.product.variant_groups = [];
  state.editor.tab = 'info';
  renderProdForm();
}
function renderProdForm() {
  const p = state.editor.product,
    isN = !p.id,
    el = document.getElementById('dashContent');
  document.getElementById('dashTitle').textContent = isN ? 'Tambah Produk' : 'Edit Produk';
  const sp = (p.specs || [])
    .map(
      (s, i) =>
        `<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center"><input class="form-input" value="${esc(s)}" oninput="setEditField('specs_idx',${i});setEditField('specs_val',this.value)" style="flex:1"><button class="btn btn-danger btn-sm" onclick="state.editor.product.specs.splice(${i},1);renderProdForm()"><i data-lucide="x"></i></button></div>`
    )
    .join('');
  const isGrouped = hasGroupedVar(p);
  const flatVl = (p.variants || [])
    .filter((v) => v.name)
    .map(
      (v, i) =>
        `<div class="var-item"><span class="var-name">${esc(v.name)}</span><span class="var-diff">${v.diff ? (v.diff > 0 ? '+' : '') + fmt(v.diff) : ''}</span><button class="var-remove" onclick="state.editor.product.variants.splice(${i},1);renderProdForm()"><i data-lucide="x"></i></button></div>`
    )
    .join('');
  const groupsHtml = (p.variant_groups || [])
    .map(
      (g, gi) =>
        `<div class="vg-group-card"><div class="vg-group-head"><div style="display:flex;align-items:center;gap:8px;flex:1"><i data-lucide="layers" style="color:var(--accent);font-size:13px"></i><input class="form-input vg-group-name" value="${esc(g.name)}" onchange="state.editor.product.variant_groups[${gi}].name=this.value;renderProdForm()" placeholder="Nama grup (mis: Warna)"></div><button class="btn btn-danger btn-sm" onclick="state.editor.product.variant_groups.splice(${gi},1);regenVariants();renderProdForm()" style="min-width:30px" title="Hapus grup"><i data-lucide="trash-2"></i></button></div>${g.options.map((o, oi) => `<div class="vg-option-row"><input class="form-input vg-option-input" value="${esc(o)}" onchange="state.editor.product.variant_groups[${gi}].options[${oi}]=this.value" placeholder="Nama opsi"><button class="btn btn-danger btn-sm vg-option-del" onclick="state.editor.product.variant_groups[${gi}].options.splice(${oi},1);regenVariants();renderProdForm()" title="Hapus opsi"${g.options.length <= 1 ? ' disabled' : ''}><i data-lucide="x"></i></button></div>`).join('')}<button class="btn btn-ghost btn-sm vg-add-opt" onclick="state.editor.product.variant_groups[${gi}].options.push('Opsi baru');regenVariants();renderProdForm()"><i data-lucide="plus"></i> Tambah Opsi</button></div>`
    )
    .join('');
  const combosHtml = isGrouped
    ? (p.variants || [])
        .map((v, i) => {
          const lbl = comboLabel(v, p.variant_groups);
          const fullPrice = (p.price || 0) + (parseInt(v.diff) || 0);
          return `<div class="vg-combo-item"><div class="vg-combo-left"><div class="vg-combo-label">${esc(lbl)}</div>${v.image ? `<div class="vg-combo-thumb"><img src="${esc(v.image)}" alt="" onerror="this.style.display='none'"></div>` : ''}</div><div class="vg-combo-fields"><div class="vg-combo-field"><span class="vg-field-label">Selisih Harga</span><div class="vg-field-row"><span style="font-size:11px;color:var(--muted)">Rp</span><input class="form-input vg-field-input" type="number" value="${v.diff || 0}" onchange="state.editor.product.variants[${i}].diff=parseInt(this.value)||0"></div></div><div class="vg-combo-field"><span class="vg-field-label">Stok</span><input class="form-input vg-field-input vg-stock-input" type="number" value="${v.stock || 0}" onchange="state.editor.product.variants[${i}].stock=parseInt(this.value)||0"></div><div class="vg-combo-field"><span class="vg-field-label">Gambar</span><input class="form-input vg-field-input vg-img-input" value="${esc(v.image || '')}" onchange="state.editor.product.variants[${i}].image=this.value" placeholder="URL gambar (opsional)"></div><div class="vg-combo-price">${fmt(fullPrice)}</div></div></div>`;
        })
        .join('')
    : '';
  const gi = (p.images || [])
    .map(
      (im, i) =>
        `<div class="gallery-item ${i === 0 ? 'main' : ''}"><img src="${esc(im)}" alt=""><div class="gi-badge">${i === 0 ? 'Utama' : ''}</div><div class="gi-actions">${i !== 0 ? `<button class="gi-btn" onclick="const t=state.editor.product.images[0];state.editor.product.images[0]=state.editor.product.images[${i}];state.editor.product.images[${i}]=t;renderProdForm()" title="Jadikan utama"><i data-lucide="star"></i></button>` : ''}<button class="gi-btn" onclick="state.editor.product.images.splice(${i},1);renderProdForm()" title="Hapus"><i data-lucide="trash-2"></i></button></div></div>`
    )
    .join('');
  el.innerHTML = `<div style="margin-bottom:16px"><button class="btn btn-ghost btn-sm" onclick="state.admin.panel='products';renderSide();renderDash()"><i data-lucide="arrow-left"></i> Kembali</button></div><div class="card"><div style="padding:20px"><div class="edit-tabs"><button class="edit-tab ${state.editor.tab === 'info' ? 'active' : ''}" onclick="state.editor.tab='info';renderProdForm()"><i data-lucide="circle-info"></i> Info</button><button class="edit-tab ${state.editor.tab === 'gallery' ? 'active' : ''}" onclick="state.editor.tab='gallery';renderProdForm()"><i data-lucide="images"></i> Gallery</button><button class="edit-tab ${state.editor.tab === 'variants' ? 'active' : ''}" onclick="state.editor.tab='variants';renderProdForm()"><i data-lucide="sliders-horizontal"></i> Varian</button><button class="edit-tab ${state.editor.tab === 'status' ? 'active' : ''}" onclick="state.editor.tab='status';renderProdForm()"><i data-lucide="toggle-right"></i> Status</button></div><div class="etab ${state.editor.tab === 'info' ? 'active' : ''}"><div class="form-grid-2"><div class="form-group"><label class="form-label">Kategori</label><select class="form-input" onchange="setEditField('category',this.value)">${CATS.map((c) => `<option value="${c}"${p.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Merek</label><input class="form-input" value="${esc(p.brand)}" onchange="setEditField('brand',this.value)" placeholder="Contoh: ASUS"></div><div class="form-group" style="grid-column:1/-1"><label class="form-label">Nama Produk</label><input class="form-input" value="${esc(p.name)}" onchange="setEditField('name',this.value)" placeholder="Contoh: ROG Strix G16"></div><div class="form-group"><label class="form-label">Harga Dasar (Rp)</label><input class="form-input" type="number" value="${p.price || 0}" onchange="setEditNum('price',this.value)"></div><div class="form-group"><label class="form-label">Stok</label><input class="form-input" type="number" value="${p.stock || 0}" onchange="setEditNum('stock',this.value)"></div><div class="form-group" style="grid-column:1/-1"><label class="form-label" style="display:flex;align-items:center;gap:6px"><i data-lucide="tag" style="color:var(--danger);font-size:11px"></i> Diskon <span style="font-size:9px;color:var(--muted);font-weight:400">(opsional, isi salah satu)</span></label><div style="display:flex;gap:12px;align-items:center"><div style="flex:1"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Harga Diskon (Rp)</div><input class="form-input" type="number" value="${p.discount_price || ''}" placeholder="Kosongkan jika tidak diskon" onchange="state.editor.product.discount_price=parseInt(this.value)||null;if(this.value)state.editor.product.discount_percent=null;renderProdForm()"></div><div style="font-size:18px;color:var(--muted);padding-top:14px">atau</div><div style="flex:1"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Persentase Diskon (%)</div><input class="form-input" type="number" value="${p.discount_percent || ''}" placeholder="Contoh: 20" min="1" max="99" onchange="state.editor.product.discount_percent=parseInt(this.value)||null;if(this.value)state.editor.product.discount_price=null;renderProdForm()"></div></div></div><div class="form-group" style="grid-column:1/-1"><label class="form-label">Deskripsi</label><textarea class="form-input" rows="3" onchange="setEditField('description',this.value)" placeholder="Deskripsi singkat produk...">${esc(p.description || '')}</textarea></div></div><div style="margin-top:12px"><label class="form-label">Spesifikasi</label>${sp || '<div style="color:var(--muted);font-size:12px;margin-bottom:8px">Belum ada spesifikasi</div>'}<button class="btn btn-ghost btn-sm" onclick="state.editor.product.specs.push('');renderProdForm()"><i data-lucide="plus"></i> Tambah Spesifikasi</button></div></div><div class="etab ${state.editor.tab === 'gallery' ? 'active' : ''}"><div class="gallery-grid">${gi || ''}</div><div class="upload-area" id="upArea" onclick="document.getElementById('permFileIn').click()"><i data-lucide="cloud-upload"></i><p>Klik atau seret gambar ke sini</p><div class="upload-hint" id="upHint">Klik atau seret gambar ke sini (maks 5MB per gambar, bisa pilih banyak)</div><div class="upload-progress" id="upProg"></div></div></div><div class="etab ${state.editor.tab === 'variants' ? 'active' : ''}"><div style="display:flex;gap:8px;margin-bottom:16px"><button class="btn btn-ghost btn-sm ${!isGrouped ? 'active' : ''}" style="${!isGrouped ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}" onclick="state.editor.product.variant_groups=[];if(state.editor.product.variants.length&&!state.editor.product.variants[0].g)state.editor.product.variants=state.editor.product.variants.map(v=>({name:v.name,diff:v.diff||0,stock:0}));renderProdForm()"><i data-lucide="list"></i> Varian Biasa</button><button class="btn btn-ghost btn-sm ${isGrouped ? 'active' : ''}" style="${isGrouped ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}" onclick="switchToGrouped()"><i data-lucide="layers"></i> Varian Group</button></div>${isGrouped ? `<div class="form-group"><label class="form-label">Grup Varian</label>${groupsHtml || '<div style="color:var(--muted);font-size:12px;margin-bottom:8px">Belum ada grup</div>'}<button class="btn btn-ghost btn-sm" onclick="state.editor.product.variant_groups.push({name:'Grup '+(state.editor.product.variant_groups.length+1),options:['Opsi 1','Opsi 2']});regenVariants();renderProdForm()"><i data-lucide="plus"></i> Tambah Grup</button></div>${state.editor.product.variant_groups.length ? `<div class="form-group"><label class="form-label">Kombinasi & Harga</label><div style="font-size:11px;color:var(--muted);margin-bottom:8px">Atur selisih harga (dari harga dasar) dan stok untuk setiap kombinasi.</div><div class="var-list">${combosHtml || '<div class="empty-state" style="padding:16px"><i data-lucide="sliders-horizontal"></i><p>Tambahkan grup dan opsi di atas</p></div>'}</div></div>` : ''}` : `<div class="form-group"><label class="form-label">Tambah Varian</label><div style="display:flex;gap:8px;align-items:flex-end"><div style="flex:1"><input class="form-input" id="varNameIn" placeholder="Nama (mis: RAM 16GB)"></div><div style="width:140px"><input class="form-input" type="number" id="varDiffIn" placeholder="Selisih harga"></div><button class="btn btn-primary btn-sm" onclick="const n=document.getElementById('varNameIn'),d=document.getElementById('varDiffIn');if(n.value.trim()){if(!state.editor.product.variants)state.editor.product.variants=[];state.editor.product.variants.push({name:n.value.trim(),diff:parseInt(d.value)||0});n.value='';d.value='';renderProdForm();}"><i data-lucide="plus"></i></button></div></div><div class="var-list">${flatVl || '<div class="empty-state" style="padding:20px"><i data-lucide="sliders-horizontal"></i><p>Belum ada varian</p></div>'}</div>`}</div><div class="etab ${state.editor.tab === 'status' ? 'active' : ''}"><div class="status-checks"><label class="status-check"><input type="checkbox" ${p.featured ? 'checked' : ''} onchange="state.editor.product.featured=this.checked"><span class="sc-box"><i data-lucide="check"></i></span><span class="sc-text"><div class="sc-title">Produk Unggulan</div><div class="sc-desc">Tampil di section unggulan halaman depan</div></span></label><label class="status-check"><input type="checkbox" ${p.archived ? 'checked' : ''} onchange="state.editor.product.archived=this.checked"><span class="sc-box"><i data-lucide="check"></i></span><span class="sc-text"><div class="sc-title">Diarsipkan</div><div class="sc-desc">Tidak tampil di katalog publik</div></span></label></div></div><div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" onclick="state.admin.panel='products';renderSide();renderDash()">Batal</button><button class="btn btn-primary" onclick="saveProd()"><i data-lucide="floppy-disk"></i> ${isN ? 'Tambah' : 'Simpan'}</button></div></div></div>`;
  setTimeout(() => setupDrop(), 50);
}
function regenVariants() {
  const groups = state.editor.product.variant_groups || [];
  if (!groups.length) { state.editor.product.variants = []; return; }
  const oldCombos = (state.editor.product.variants || []).filter((v) => v.g);
  const newCombos = genCombos(groups);
  newCombos.forEach((nc) => {
    const existing = oldCombos.find((oc) => oc.g.every((gi, i) => gi === nc.g[i]));
    if (existing) {
      nc.diff = existing.diff;
      nc.stock = existing.stock;
      nc.image = existing.image || '';
    }
  });
  state.editor.product.variants = newCombos;
}
async function saveProd() {
  const p = state.editor.product;
  if (!p.name || !p.brand) { toast('Nama dan merek wajib', 'error'); return; }
  if (state.ui.uploading) { toast('Tunggu upload selesai', 'error'); return; }
  const saveData = {
    category: p.category,
    brand: p.brand,
    name: p.name,
    price: p.price,
    description: p.description,
    specs: p.specs,
    images: p.images,
    variants: p.variants,
    variant_groups: p.variant_groups || [],
    featured: p.featured,
    archived: p.archived,
    stock: p.stock,
    sold: p.sold,
    discount_price: p.discount_price || null,
    discount_percent: p.discount_percent || null,
  };
  if (state.session.dbOk && state.session.sb) {
    if (p.id) {
      const ok = await sbUpdate(p.id, saveData);
      if (!ok) return;
      toast('Diperbarui');
      logAct('Edit Produk', 'Mengedit ' + p.name, 'edit');
      await loadProducts();
    } else {
      const np = await sbInsert(saveData);
      if (!np) return;
      toast('Ditambahkan');
      logAct('Tambah Produk', 'Menambahkan ' + p.name, 'add');
      await loadProducts();
    }
  } else {
    if (p.id) {
      const i = state.db.products.findIndex((x) => x.id === p.id);
      if (i >= 0) state.db.products[i] = { ...p };
      toast('Diperbarui');
    } else {
      p.id = Math.max(0, ...state.db.products.map((x) => x.id)) + 1;
      state.db.products.push({ ...p });
      toast('Ditambahkan');
    }
  }
  state.admin.panel = 'products';
  renderSide();
  renderDash();
}
async function delProd(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  if (
    !(await showConfirm('Produk yang dihapus tidak bisa dikembalikan.', 'Hapus Produk?', 'delete'))
  )
    return;
  if (state.session.dbOk && state.session.sb) {
    const ok = await sbDel(id);
    if (ok) {
      toast('Dihapus');
      logAct('Hapus Produk', 'Menghapus ' + p.name, 'del');
      await loadProducts();
    }
  } else {
    state.db.products = state.db.products.filter((x) => x.id !== id);
    toast('Dihapus');
  }
  renderDash();
}
function viewProd(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  const imgs = p.images && p.images.length ? p.images : ['https://picsum.photos/seed/def/600/400'];
  const th = imgs
    .map(
      (im, i) =>
        `<img class="detail-thumb ${i === 0 ? 'active' : ''}" src="${esc(im)}" alt="" data-main-img="${esc(im)}">`
    )
    .join('');
  const imgCounter =
    imgs.length > 1
      ? `<div class="detail-img-counter"><i data-lucide="images" style="margin-right:4px;font-size:10px"></i>1 / ${imgs.length}</div>`
      : '';
  const dots =
    imgs.length > 1
      ? `<div class="detail-dots">${imgs.map((_, i) => `<button class="detail-dot ${i === 0 ? 'active' : ''}" data-idx="${i}" aria-label="Foto ${i + 1}"></button>`).join('')}</div>`
      : '';
  const sr = (p.specs || [])
    .map((s) => {
      const pt = s.split(/[\:\u2013\-]/);
      return pt.length > 1
        ? `<tr><td>${esc(pt[0].trim())}</td><td>${esc(pt.slice(1).join(':').trim())}</td></tr>`
        : `<tr><td colspan="2" style="text-align:left">${esc(s)}</td></tr>`;
    })
    .join('');
  const vc = hasGroupedVar(p)
    ? (p.variant_groups || [])
        .map(
          (g) =>
            `<span class="ad-var-chip" style="margin-right:4px"><strong>${esc(g.name)}:</strong> ${g.options.map((o) => esc(o)).join(', ')}</span>`
        )
        .join('')
    : (p.variants || [])
        .map(
          (v) =>
            `<span class="ad-var-chip">${esc(v.name)}<span>${v.diff ? (v.diff > 0 ? '+' : '') + fmt(v.diff) : ''}</span></span>`
        )
        .join('');
  const catLabel = p.category || '';
  const stockIcon =
    p.stock > 5 ? 'fa-check-circle' : p.stock > 0 ? 'fa-exclamation-circle' : 'fa-times-circle';
  const stockLabel = p.stock > 5 ? 'Tersedia' : p.stock > 0 ? 'Stok Terbatas' : 'Habis';
  document.getElementById('detailBox').innerHTML =
    `<div class="detail-grid"><div class="detail-left"><img class="detail-img-bg" id="dBg" src="${esc(imgs[0])}" alt=""><div class="detail-img-wrap"><img class="detail-img-main" id="dMain" src="${esc(imgs[0])}" alt="${esc(p.name)}" onclick="openZoom(this.src)" style="cursor:zoom-in">${imgCounter}<div class="zoom-hint" onclick="openZoom(document.getElementById('dMain').src)" title="Zoom"><i data-lucide="zoom-in"></i></div>${dots}</div><div class="detail-thumbs">${th}</div></div><div class="detail-info">${catLabel ? `<div class="detail-cat"><i data-lucide="tag"></i> ${esc(catLabel)}</div>` : ''}<div class="detail-brand">${getBrandHtml(p.brand, '18px')}</div><div class="detail-name">${esc(p.name)}</div><div class="detail-price">${fmt(p.price)}</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${p.featured ? '<span class="badge badge-gold"><i data-lucide="star" style="margin-right:4px"></i>Unggulan</span>' : ''}<span class="badge ${p.stock > 5 ? 'badge-green' : p.stock > 0 ? 'badge-yellow' : 'badge-red'}"><i class="fas ${stockIcon}" style="margin-right:4px"></i>${stockLabel}${p.stock > 0 ? ' (' + p.stock + ')' : ''}</span><span class="badge badge-blue"><i data-lucide="shopping-cart" style="margin-right:4px"></i>Terjual: ${p.sold}</span>${p.archived ? '<span class="badge badge-red"><i data-lucide="archive" style="margin-right:4px"></i>Arsip</span>' : ''}</div><div class="detail-desc">${esc(p.description || 'Tidak ada deskripsi.')}</div>${sr ? `<table class="spec-table">${sr}</table>` : ''}${vc ? `<div class="variant-section"><div class="variant-label">Varian</div><div class="ad-var-list">${vc}</div></div>` : ''}<div class="wa-section"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="closeDetail()"><i data-lucide="x"></i> Tutup</button>${hasPerm('products_edit') ? `<button class="btn btn-info btn-sm" onclick="closeDetail();openProdForm(${p.id})"><i data-lucide="pencil"></i> Edit</button>` : ''}</div></div></div></div>`;
  document
    .getElementById('detailBox')
    .querySelectorAll('.detail-thumb[data-main-img]')
    .forEach((thumb, i) => { thumb.addEventListener('click', function () { gotoDetailSlide(i); }); });
  document
    .getElementById('detailBox')
    .querySelectorAll('.detail-dot')
    .forEach((dot) => { dot.addEventListener('click', function () { gotoDetailSlide(parseInt(this.dataset.idx)); }); });
  state.ui.detailSlide.imgs = [...imgs];
  state.ui.detailSlide.idx = 0;
  setupDetailSlideEvents();
  startDetailSlide();
  document.getElementById('detailOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function openUserForm(id) {
  state.editor.user = id
    ? { ...state.db.users.find((u) => u.id === id) }
    : { username: '', password: '', display_name: '', role: 'viewer', active: true };
  renderUserForm();
}
function renderUserForm() {
  const u = state.editor.user,
    isN = !u.id,
    el = document.getElementById('dashContent');
  document.getElementById('dashTitle').textContent = isN ? 'Tambah Pengguna' : 'Edit Pengguna';
  el.innerHTML = `<div style="margin-bottom:16px"><button class="btn btn-ghost btn-sm" onclick="state.admin.panel='users';renderSide();renderDash()"><i data-lucide="arrow-left"></i> Kembali</button></div><div class="card"><div style="padding:20px"><div class="form-grid-2"><div class="form-group"><label class="form-label">Username</label><input class="form-input" value="${esc(u.username)}" onchange="state.editor.user.username=this.value" ${!isN ? 'readonly style="opacity:.6"' : ''}></div><div class="form-group"><label class="form-label">${isN ? 'Password' : 'Password Baru (kosongkan jika tidak diubah)'}</label><input class="form-input" type="password" value="${isN ? esc(u.password) : ''}" onchange="state.editor.user.password=this.value" placeholder="${isN ? 'Masukkan password' : 'Kosongkan jika tidak diubah'}"></div><div class="form-group"><label class="form-label">Nama Tampilan</label><input class="form-input" value="${esc(u.display_name || '')}" onchange="state.editor.user.display_name=this.value"></div><div class="form-group"><label class="form-label">Peran</label><select class="form-input" onchange="state.editor.user.role=this.value">${Object.entries(
    ROLES
  )
    .map(
      ([k, r]) =>
        `<option value="${k}"${u.role === k ? ' selected' : ''}>${r.label} - ${r.desc}</option>`
    )
    .join(
      ''
    )}</select></div></div><div class="form-group" style="margin-top:4px"><label class="status-check"><input type="checkbox" ${u.active ? 'checked' : ''} onchange="state.editor.user.active=this.checked"><span class="sc-box"><i data-lucide="check"></i></span><span class="sc-text"><div class="sc-title">Aktif</div><div class="sc-desc">Nonaktif jika tidak boleh login</div></span></label></div><div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" onclick="state.admin.panel='users';renderSide();renderDash()">Batal</button><button class="btn btn-primary" onclick="saveUser()"><i data-lucide="floppy-disk"></i> ${isN ? 'Tambah' : 'Simpan'}</button></div></div></div>`;
}
async function saveUser() {
  const u = state.editor.user;
  if (!u.username) { toast('Username wajib', 'error'); return; }
  if (!u.id && !u.password) { toast('Password wajib', 'error'); return; }
  if (state.session.dbOk && state.session.sb) {
    if (u.id) {
      const upd = { display_name: u.display_name || u.username, role: u.role, active: u.active };
      if (u.password) upd.password = u.password;
      const ok = await sbUpdateUser(u.id, upd);
      if (ok) { toast('Diperbarui'); await loadUsers(); }
    } else {
      const np = await sbInsertUser(u);
      if (np) { toast('Ditambahkan'); await loadUsers(); }
    }
  } else {
    if (u.id) {
      const i = state.db.users.findIndex((x) => x.id === u.id);
      if (i >= 0) {
        state.db.users[i] = {
          ...state.db.users[i],
          display_name: u.display_name || u.username,
          role: u.role,
          active: u.active,
        };
        if (u.password) state.db.users[i].password = u.password;
      }
      toast('Diperbarui');
    } else {
      u.id = Math.max(0, ...state.db.users.map((x) => x.id)) + 1;
      state.db.users.push({ ...u, display_name: u.display_name || u.username });
      toast('Ditambahkan');
    }
  }
  state.admin.panel = 'users';
  renderSide();
  renderDash();
}
async function delUser(id) {
  const u = state.db.users.find((x) => x.id === id);
  if (!u) return;
  if (
    !(await showConfirm(
      'Pengguna yang dihapus tidak bisa dikembalikan.',
      'Hapus Pengguna?',
      'delete'
    ))
  )
    return;
  if (state.session.dbOk && state.session.sb) {
    const ok = await sbDelUser(id);
    if (ok) {
      toast('Dihapus');
      logAct('Hapus Pengguna', 'Menghapus ' + (u.display_name || u.username), 'del');
      await loadUsers();
    }
  } else {
    state.db.users = state.db.users.filter((x) => x.id !== id);
    toast('Dihapus');
    logAct('Hapus Pengguna', 'Menghapus ' + (u.display_name || u.username), 'del');
  }
  renderDash();
}
function setupZoom() {
  const ov = document.getElementById('zoomOverlay'),
    img = document.getElementById('zoomImg');
  ov.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      state.ui.zoom.scale += e.deltaY * -0.002;
      state.ui.zoom.scale = Math.max(0.5, Math.min(5, state.ui.zoom.scale));
      img.style.transform = `scale(${state.ui.zoom.scale})`;
    },
    { passive: false }
  );
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('zoom-hint')) closeZoom(); });
  img.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let sx = e.clientX,
      sy = e.clientY,
      lx = 0,
      ly = 0;
    const move = (e2) => {
      lx = e2.clientX - sx;
      ly = e2.clientY - sy;
      img.style.transform = `scale(${state.ui.zoom.scale}) translate(${lx}px,${ly}px)`;
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  let ts = null;
  ov.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        state.ui.zoom.zooming = true;
        state.ui.zoom.startDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        state.ui.zoom.startScale = state.ui.zoom.scale;
      } else if (e.touches.length === 1) {
        ts = { x: e.touches[0].clientX, y: e.touches[0].clientY, lx: 0, ly: 0 };
      }
    },
    { passive: false }
  );
  ov.addEventListener(
    'touchmove',
    (e) => {
      if (state.ui.zoom.zooming && e.touches.length === 2) {
        e.preventDefault();
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        state.ui.zoom.scale = Math.max(0.5, Math.min(5, state.ui.zoom.startScale * (d / state.ui.zoom.startDist)));
        img.style.transform = `scale(${state.ui.zoom.scale})`;
      } else if (ts && e.touches.length === 1) {
        e.preventDefault();
        ts.lx = e.touches[0].clientX - ts.x;
        ts.ly = e.touches[0].clientY - ts.y;
        img.style.transform = `scale(${state.ui.zoom.scale}) translate(${ts.lx}px,${ts.ly}px)`;
      }
    },
    { passive: false }
  );
  ov.addEventListener('touchend', () => { state.ui.zoom.zooming = false; ts = null; });
}
function openZoom(src) {
  state.ui.zoom.scale = 1;
  const img = document.getElementById('zoomImg');
  img.src = src;
  img.style.transform = 'scale(1)';
  document.getElementById('zoomOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeZoom() { document.getElementById('zoomOverlay').classList.remove('show'); document.body.style.overflow = ''; state.ui.revGalleryPhotos = null; state.ui.revGalleryIdx = -1; }
function viewReviewPhotos(id) {
  const rev = state.db.reviews.find(r => r.id === id);
  if (!rev || !rev.photos || !rev.photos.length) return;
  if (rev.photos.length === 1) { openZoomForGallery(rev.photos, 0); return; }
  state.ui.revGalleryPhotos = rev.photos;
  state.ui.revGalleryIdx = 0;
  let existing = document.getElementById('revGalleryModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'revGalleryModal';
  modal.className = 'modal-bg show';
  modal.style.zIndex = '340';
  modal.innerHTML = '<div style="background:var(--bg2);border-radius:var(--radius);max-width:560px;width:95%;max-height:85vh;overflow:auto;box-shadow:var(--sh-xl);padding:20px">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="margin:0;font-size:15px;font-weight:700"><i data-lucide="images" style="margin-right:8px;color:var(--accent)"></i>Foto Ulasan — ' + esc(rev.name) + '</h3><button class="btn btn-ghost btn-sm" onclick="closeRevGallery()"><i data-lucide="x"></i></button></div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">' + rev.photos.map((p, i) => '<div style="position:relative;border-radius:var(--radius);overflow:hidden;aspect-ratio:1;background:var(--bg3);border:1px solid var(--border);cursor:pointer;transition:all .2s" onclick="closeRevGallery();openZoomForGallery(state.ui.revGalleryPhotos,' + i + ')" onmouseenter="this.style.borderColor=\'var(--accent)\'" onmouseleave="this.style.borderColor=\'var(--border)\'"><img src="' + esc(p) + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'"></div>').join('') + '</div></div>';
  modal.addEventListener('click', function(e) { if (e.target === modal) closeRevGallery(); });
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
}
function closeRevGallery() {
  const m = document.getElementById('revGalleryModal');
  if (m) m.remove();
  document.body.style.overflow = '';
}
function openZoomForGallery(photos, idx) {
  state.ui.revGalleryPhotos = photos;
  state.ui.revGalleryIdx = idx;
  openZoom(photos[idx]);
  updateZoomNav();
}
function updateZoomNav() {
  let nav = document.getElementById('zoomNav');
  const photos = state.ui.revGalleryPhotos;
  if (!photos || photos.length <= 1) { if (nav) nav.remove(); return; }
  if (!nav) {
    nav = document.createElement('div');
    nav.id = 'zoomNav';
    nav.style.cssText = 'position:absolute;bottom:40px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:10';
    nav.innerHTML = '<button id="zoomPrev" style="width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.08);backdrop-filter:blur(8px);color:#fff;border:none;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s"><i data-lucide="chevron-left"></i></button><span id="zoomCounter" style="color:rgba(255,255,255,.5);font-size:12px;display:flex;align-items:center;min-width:50px;justify-content:center">1/3</span><button id="zoomNext" style="width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.08);backdrop-filter:blur(8px);color:#fff;border:none;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s"><i data-lucide="chevron-right"></i></button>';
    document.getElementById('zoomOverlay').appendChild(nav);
    document.getElementById('zoomPrev').addEventListener('click', function(e) { e.stopPropagation(); navZoom(-1); });
    document.getElementById('zoomNext').addEventListener('click', function(e) { e.stopPropagation(); navZoom(1); });
  }
  nav.style.display = 'flex';
  document.getElementById('zoomCounter').textContent = (state.ui.revGalleryIdx + 1) + '/' + photos.length;
}
function navZoom(dir) {
  const photos = state.ui.revGalleryPhotos;
  if (!photos || photos.length <= 1) return;
  let idx = state.ui.revGalleryIdx + dir;
  if (idx < 0) idx = photos.length - 1;
  if (idx >= photos.length) idx = 0;
  state.ui.revGalleryIdx = idx;
  const img = document.getElementById('zoomImg');
  img.src = photos[idx];
  img.style.transform = 'scale(1)';
  state.ui.zoom.scale = 1;
  document.getElementById('zoomCounter').textContent = (idx + 1) + '/' + photos.length;
}
function toggleFilterPanel() {
  const p = document.getElementById('filterPanel');
  const b = document.getElementById('filterToggle');
  if (!p) return;
  const isOpen = p.classList.contains('open');
  if (isOpen) {
    p.classList.remove('open');
    p.style.display = 'none';
    b.classList.remove('active');
  } else {
    p.style.display = '';
    requestAnimationFrame(() => { p.classList.add('open'); });
    b.classList.add('active');
  }
}
/* ── Promo Slider ── */
let _psTimer = null, _psIdx = 0, _psProgressRAF = null, _psProgressStart = 0;
const _psInterval = 5000;
function initPromoSlider() {
  const slides = document.querySelectorAll('.promo-slide'), track = document.getElementById('promoSliderTrack'), dots = document.querySelectorAll('.promo-slider-dot');
  const counterCur = document.getElementById('promoCounterCur');
  const progressBar = document.getElementById('promoProgressBar');
  if (!slides.length) return;

  const total = slides.length;

  const go = (i) => {
    _psIdx = (i + total) % total;
    track.style.transform = `translateX(-${_psIdx * 100}%)`;
    dots.forEach((d, j) => d.classList.toggle('active', j === _psIdx));
    if (counterCur) counterCur.textContent = String(_psIdx + 1).padStart(2, '0');
    // Animate slide content in
    const activeBody = slides[_psIdx].querySelector('.promo-slide-body');
    if (activeBody) {
      activeBody.style.opacity = '0';
      activeBody.style.transform = 'translateY(12px)';
      requestAnimationFrame(() => {
        activeBody.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
        activeBody.style.opacity = '1';
        activeBody.style.transform = 'translateY(0)';
      });
    }
  };

  // Progress bar
  function startProgress() {
    _psProgressStart = performance.now();
    if (progressBar) progressBar.style.width = '0%';
    cancelAnimationFrame(_psProgressRAF);
    function tick(now) {
      const elapsed = now - _psProgressStart;
      const pct = Math.min((elapsed / _psInterval) * 100, 100);
      if (progressBar) progressBar.style.width = pct + '%';
      if (elapsed < _psInterval) {
        _psProgressRAF = requestAnimationFrame(tick);
      }
    }
    _psProgressRAF = requestAnimationFrame(tick);
  }

  const reset = () => {
    clearInterval(_psTimer);
    cancelAnimationFrame(_psProgressRAF);
    go(_psIdx);
    startProgress();
    _psTimer = setInterval(() => { go(_psIdx + 1); startProgress(); }, _psInterval);
  };

  document.getElementById('promoPrev')?.addEventListener('click', () => { go(_psIdx - 1); reset(); });
  document.getElementById('promoNext')?.addEventListener('click', () => { go(_psIdx + 1); reset(); });
  dots.forEach(d => d.addEventListener('click', () => { go(parseInt(d.dataset.idx)); reset(); }));

  // Swipe support
  let swStartX = 0, swStartY = 0, swDragging = false;
  const sliderEl = document.querySelector('.promo-slider');
  if (sliderEl) {
    sliderEl.addEventListener('touchstart', (e) => {
      swStartX = e.touches[0].clientX;
      swStartY = e.touches[0].clientY;
      swDragging = true;
      track.style.transition = 'none';
    }, { passive: true });
    sliderEl.addEventListener('touchmove', (e) => {
      if (!swDragging) return;
      const dx = e.touches[0].clientX - swStartX;
      const dy = e.touches[0].clientY - swStartY;
      if (Math.abs(dy) > Math.abs(dx)) { swDragging = false; return; }
      const offset = -(_psIdx * 100) + (dx / sliderEl.offsetWidth) * 100;
      track.style.transform = `translateX(${offset}%)`;
    }, { passive: true });
    sliderEl.addEventListener('touchend', (e) => {
      if (!swDragging) return;
      swDragging = false;
      track.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.8, 0.25, 1)';
      const dx = e.changedTouches[0].clientX - swStartX;
      if (Math.abs(dx) > 50) {
        go(dx < 0 ? _psIdx + 1 : _psIdx - 1);
      } else {
        go(_psIdx);
      }
      reset();
    }, { passive: true });
  }

  // CTA buttons — scroll to promo section or show toast
  document.querySelectorAll('.promo-slide-cta').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.promoIdx);
      const promo = (state.db.promos || []).filter(p => p.active)[idx];
      if (promo) toast(promo.title, 'info');
    });
  });

  if (slides.length > 1) {
    reset();
  } else {
    go(0);
    // Hide nav buttons & counter if only 1 slide
    const prev = document.getElementById('promoPrev');
    const next = document.getElementById('promoNext');
    const counter = document.querySelector('.promo-slider-counter');
    const dotsEl = document.querySelector('.promo-slider-dots');
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
    if (counter) counter.style.display = 'none';
    if (dotsEl) dotsEl.style.display = 'none';
    if (progressBar) progressBar.parentElement.style.display = 'none';
  }
}
function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  updateNavAuth();
  updateDashTop();
}
(function () { if (localStorage.getItem('theme') === 'dark') { document.body.classList.add('dark'); } updateNavAuth(); })();
function toggleMobDropdown(e) {
  e.stopPropagation();
  const menu = e.currentTarget.nextElementSibling;
  if (menu) menu.classList.toggle('open');
}
function closeMobDropdown() { document.querySelectorAll('.mob-dropdown-menu.open').forEach((m) => m.classList.remove('open')); }
document.addEventListener('click', function (e) { if (!e.target.closest('.mob-dropdown')) closeMobDropdown(); });
function updateDashTop() {
  const el = document.getElementById('dashTopRight');
  if (!el) return;
  const isDark = document.body.classList.contains('dark');
  const ti = isDark ? 'fa-sun' : 'fa-moon';
  el.innerHTML = `
    <div class="mob-dropdown">
      <button class="btn btn-ghost btn-sm mob-dropdown-trigger" onclick="toggleMobDropdown(event)"><i data-lucide="ellipsis-vertical"></i></button>
      <div class="mob-dropdown-menu">
        <button class="mob-dropdown-item" onclick="goToCatalog();closeMobDropdown()"><i data-lucide="external-link"></i> Toko</button>
        <button class="mob-dropdown-item" onclick="toggleTheme();closeMobDropdown()"><i class="fas ${ti}"></i> Ganti Mode</button>
        <button class="mob-dropdown-item danger" onclick="doLogout();closeMobDropdown()"><i data-lucide="log-out"></i> Logout</button>
      </div>
    </div>`;
}
function renderHeroTicker() {
  const track = document.getElementById('heroTickerTrack');
  if (!track) return;
  const items = state.db.products.filter((p) => !p.archived);
  if (!items.length) {
    track.innerHTML = '';
    clearInterval(state.ui.ticker.timer);
    return;
  }
  track.innerHTML = items
    .map((p) => {
      const brand = (p.brand || '').trim();
      const brandPart = brand
        ? `<span class="ticker-brand">${esc(brand)}</span><span class="ticker-dot"></span>`
        : '';
      return `<div class="hero-ticker-item" onclick="openDetail(${p.id})">${brandPart}<span class="ticker-name">${esc(p.name)}</span></div>`;
    })
    .join('');
  state.ui.ticker.idx = 0;
  track.style.transform = 'translateY(0)';
  clearInterval(state.ui.ticker.timer);
  state.ui.ticker.timer = setInterval(() => { state.ui.ticker.idx = (state.ui.ticker.idx + 1) % items.length; track.style.transform = 'translateY(-' + state.ui.ticker.idx * 22 + 'px)'; }, 3000);
}
function renderBrandBar() {
  const brands = [
    { name: 'Apple', slug: 'apple', text: false },
    { name: 'Xiaomi', slug: 'xiaomi', text: false },
    { name: 'OnePlus', slug: 'oneplus', text: false },
    { name: 'Google', slug: 'google', text: false },
    { name: 'Motorola', slug: 'motorola', text: false },
    { name: 'Huawei', slug: 'huawei', text: false },
    { name: 'Samsung', slug: 'samsung', text: true },
    { name: 'OPPO', slug: 'oppo', text: true },
    { name: 'VIVO', slug: 'vivo', text: true },
    { name: 'ASUS', slug: 'asus', text: true },
    { name: 'Infinix', slug: 'infinix', text: true },
    { name: 'Tecno', slug: 'tecno', text: true },
    { name: 'Realme', slug: 'realme', text: true },
  ];
  const html = brands
    .map((b) => { const cls = b.text ? 'brand-text' : 'brand-bar-item'; return `<div class="${cls}" title="${esc(b.name)}"><img src="https://cdn.simpleicons.org/${b.slug}" alt="${esc(b.name)}" onerror="this.parentElement.remove()"></div>`; })
    .join('');
  document.getElementById('brandBarTrack').innerHTML = html + html;
}
function updateGreetingTime() { const el = document.querySelector('.dash-greeting .greeting-time'); if (el) { const now = new Date(); el.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); } }
setInterval(updateGreetingTime, 30000);
init();
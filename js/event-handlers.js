(function attachEventHandlers() {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const scrollToEl = (el) => { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('pubLogoBtn')?.addEventListener('click', () => { /* handled by hidden-access.js */ });
  function setActiveNav(id) {
    document.querySelectorAll('.pub-nav-link').forEach(b => b.classList.remove('active'));
    const btn = $(id);
    if (btn) btn.classList.add('active');
  }
  $('navProduk')?.addEventListener('click', () => { setActiveNav('navProduk'); const search = $('catSearch'); if (search) { search.focus(); scrollToEl(search); } });
  $('navPromo')?.addEventListener('click', () => { setActiveNav('navPromo'); scrollToEl($('promoSection')); });
  $('navTentang')?.addEventListener('click', () => { setActiveNav('navTentang'); const footer = document.querySelector('.cat-footer'); if (footer) footer.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('navSearchBtn')?.addEventListener('click', () => { const search = $('catSearch'); if (search) { search.focus(); scrollToEl(search); } });
  $('navWaBtn')?.addEventListener('click', () => { window.open('https://wa.me/' + (window.SELLER_WA || ''), '_blank'); });
  $('themeToggleBtn')?.addEventListener('click', toggleTheme);
  $('loginBtn')?.addEventListener('click', openLogin);
  $('catSearch')?.addEventListener('input', debounceCatSearch);
  $('filterToggle')?.addEventListener('click', toggleFilterPanel);
  $('filterBrand')?.addEventListener('change', () => {
    state.catalog.showAll = false;
    state.catalog.exploreExpanded = false;
    renderCatalog();
  });
  $('filterPriceMin')?.addEventListener('input', debounceCatSearch);
  $('filterPriceMax')?.addEventListener('input', debounceCatSearch);
  $('filterResetBtn')?.addEventListener('click', resetFilters);
  $('catSort')?.addEventListener('change', (e) => onCatSort(e.target.value));
  $('viewGrid')?.addEventListener('click', () => setCatView('grid'));
  $('viewList')?.addEventListener('click', () => setCatView('list'));
  $('reviewsToggle')?.addEventListener('click', toggleReviews);
  $('formToggleBtn')?.addEventListener('click', toggleReviewForm);
  $('submitReviewBtn')?.addEventListener('click', submitReview);
  $('revUploadArea')?.addEventListener('click', () => { const fileIn = $('revFileIn'); if (fileIn) fileIn.click(); });
  $('revFileIn')?.addEventListener('change', (e) => { handleRevPhoto(e.target.files); e.target.value = ''; });
  $('qvOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeQV(); });
  $('detailOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDetail(); });
  $('detailCloseBtn')?.addEventListener('click', closeDetail);
  $('adminDetailOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAdminDetail(); });
  $('adminDetailCloseBtn')?.addEventListener('click', closeAdminDetail);
  $('loginModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeLogin(); });
  $('loginCloseBtn')?.addEventListener('click', closeLogin);
  $('doLoginBtn')?.addEventListener('click', doLogin);
  $('loginVisitorBtn')?.addEventListener('click', doVisitorLogin);
  $('loginPass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('loginUser')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('mobileBurgerBtn')?.addEventListener('click', openSidebar);
  $('sidebarOverlay')?.addEventListener('click', closeSidebar);
  $('zoomCloseBtn')?.addEventListener('click', closeZoom);
  $('confirmCancel')?.addEventListener('click', () => closeConfirm(false));
  $('confirmOk')?.addEventListener('click', () => closeConfirm(true));
  $('accessModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAccessModal(); });
  $('accessCloseBtn')?.addEventListener('click', closeAccessModal);
  $('backToTop')?.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('permFileIn')?.addEventListener('change', (e) => { handleFiles(e.target.files); });
  $('promoFileIn')?.addEventListener('change', (e) => { handlePromoFile(e.target.files[0]); });
  $('cropCloseBtn')?.addEventListener('click', closeCropModal);
  $('cropCancelBtn')?.addEventListener('click', closeCropModal);
  $('cropApplyBtn')?.addEventListener('click', applyPromoCrop);
  document.querySelectorAll('[data-ratio]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.editor.promoCropper) return;
      const ratio = btn.dataset.ratio;
      const value = ratio === 'free' ? NaN : parseFloat(ratio);
      state.editor.promoCropper.setAspectRatio(value);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const zoom = $('zoomOverlay');
    if (zoom && zoom.classList.contains('show')) { closeZoom(); return; }
    const detail = $('detailOverlay');
    if (detail && detail.classList.contains('show')) { closeDetail(); return; }
    const qv = $('qvOverlay');
    if (qv && qv.classList.contains('show')) { closeQV(); return; }
    const crop = $('cropModal');
    if (crop && crop.style.display !== 'none') { closeCropModal(); return; }
    const access = $('accessModal');
    if (access && access.classList.contains('show')) { closeAccessModal(); return; }
    const confirm = $('confirmModal');
    if (confirm && confirm.style.display !== 'none' && state.ui.confirmRes) { closeConfirm(false); return; }
    const login = $('loginModal');
    if (login && login.style.display !== 'none') { closeLogin(); return; }
  });
  console.log('[event-handlers] All listeners attached.');
})();
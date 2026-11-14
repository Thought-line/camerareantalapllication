// LensLease single-page frontend. No framework, no build step.

// ------------------------------------------------------------ utilities
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n) => `$${Math.round(Number(n ?? 0)).toLocaleString('en-US')}`;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (days, base = new Date()) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return iso(d);
};
const prettyDate = (s) =>
  new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const prettyShort = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const initials = (name) =>
  name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const STATUS = {
  reserved: { label: 'Reserved', cls: 'pill-info' },
  picked_up: { label: 'Picked up', cls: 'pill-ok' },
  returned: { label: 'Returned', cls: 'pill-mute' },
  cancelled: { label: 'Cancelled', cls: 'pill-mute' },
  overdue: { label: 'Overdue', cls: 'pill-out' },
};

// ------------------------------------------------------------ icons
const ICONS = {
  camera: '<path d="M4 9h3l2-3h6l2 3h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="15" r="4.2"/>',
  cinema: '<rect x="2" y="7" width="13" height="11" rx="2"/><path d="m15 12 6-4v10l-6-4z"/><circle cx="6.5" cy="4.5" r="2.2"/><circle cx="11.5" cy="4.5" r="2.2"/>',
  lens: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M3.5 8.5h17M3.5 15.5h17"/>',
  action: '<rect x="2.5" y="7" width="15" height="10" rx="2.5"/><circle cx="10" cy="12" r="3.2"/><path d="M17.5 10.5 22 8v8l-4.5-2.5z"/>',
  light: '<path d="M12 3v2.5M5 7l1.8 1.8M19 7l-1.8 1.8"/><rect x="6.5" y="9" width="11" height="7" rx="2"/><path d="M9.5 16v4h5v-4"/>',
  audio: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7"/>',
  support: '<circle cx="12" cy="7" r="3"/><path d="M12 10v7M6 21l6-4 6 4M4 13h4M16 13h4"/>',
};
// Stroke defaults to currentColor so each artwork picks up its item's accent from CSS.
const iconSvg = (name, stroke = 'currentColor') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${
    ICONS[name] ?? ICONS.camera
  }</svg>`;

function stockPill(av) {
  if (!av) return '';
  if (av.available <= 0) return '<span class="pill pill-out">Booked out</span>';
  if (av.available === 1) return '<span class="pill pill-low">Last one</span>';
  return `<span class="pill pill-ok">${av.available} available</span>`;
}

// ------------------------------------------------------------ state
const store = {
  token: localStorage.getItem('ll_token'),
  user: null,
  cart: JSON.parse(localStorage.getItem('ll_cart') ?? '[]'),
  insurance: localStorage.getItem('ll_insurance') === 'true',
  dates: JSON.parse(localStorage.getItem('ll_dates') ?? 'null') ?? { from: addDays(1), to: addDays(3) },
  filters: { search: '', category: 'all', brand: 'all', sort: 'rating', availableOnly: false },
  catalog: null,
};

function saveCart() {
  localStorage.setItem('ll_cart', JSON.stringify(store.cart));
  renderCartCount();
}
function saveDates() {
  // Never let a stale saved range start in the past.
  if (store.dates.from < iso(new Date())) store.dates = { from: addDays(1), to: addDays(3) };
  if (store.dates.to < store.dates.from) store.dates.to = store.dates.from;
  localStorage.setItem('ll_dates', JSON.stringify(store.dates));
}

// ------------------------------------------------------------ api client
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && store.token) signOut(true);
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data;
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

// ------------------------------------------------------------ auth
async function refreshMe() {
  const { user, demoAccounts } = await api('/api/auth/me');
  store.user = user;
  store.demoAccounts = demoAccounts;
  renderAuth();
}

async function signIn(email) {
  const { token, user } = await api('/api/auth/login', { method: 'POST', body: { email } });
  store.token = token;
  store.user = user;
  localStorage.setItem('ll_token', token);
  renderAuth();
  toast(`Welcome back, ${user.name.split(' ')[0]}`);
}

function signOut(silent = false) {
  if (store.token) api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  store.token = null;
  store.user = null;
  localStorage.removeItem('ll_token');
  renderAuth();
  if (!silent) toast('Signed out');
  if (location.hash.startsWith('#/admin') || location.hash.startsWith('#/bookings')) location.hash = '#/';
  else render();
}

function renderAuth() {
  const slot = $('#auth-slot');
  if (store.user) {
    slot.innerHTML = `
      <div class="user-chip">
        <span class="avatar">${esc(initials(store.user.name))}</span>
        <span class="who">${esc(store.user.name.split(' ')[0])}<small>${esc(store.user.role)}</small></span>
        <button class="btn btn-quiet btn-sm" id="signout-btn" type="button">Sign out</button>
      </div>`;
    $('#signout-btn').onclick = () => signOut();
  } else {
    slot.innerHTML = '<button class="btn btn-primary btn-sm" id="signin-btn" type="button">Sign in</button>';
    $('#signin-btn').onclick = openLogin;
  }
  $('.nav-admin').hidden = store.user?.role !== 'admin';
}

function openLogin() {
  const dialog = $('#login-dialog');
  const list = $('#demo-accounts');
  list.innerHTML = (store.demoAccounts ?? [])
    .map(
      (u) => `<button class="demo-account" type="button" data-email="${esc(u.email)}">
        <span class="avatar">${esc(initials(u.name))}</span>
        <span><strong>${esc(u.name)}</strong><small>${esc(u.email)} · ${esc(u.role)}</small></span>
      </button>`,
    )
    .join('');
  list.querySelectorAll('.demo-account').forEach((btn) => {
    btn.onclick = () => {
      $('#login-email').value = btn.dataset.email;
      $('#login-submit').click();
    };
  });
  $('#login-error').hidden = true;
  dialog.showModal();
}

$('#login-cancel').onclick = () => $('#login-dialog').close();

$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  const email = $('#login-email').value.trim();
  if (!email) return;
  try {
    await signIn(email);
    $('#login-dialog').close();
    render();
  } catch (err) {
    const box = $('#login-error');
    box.textContent = err.message;
    box.hidden = false;
  }
};

// ------------------------------------------------------------ cart
function addToCart(cam, qty = 1) {
  const existing = store.cart.find((i) => i.cameraId === cam.id);
  if (existing) existing.qty = Math.min(10, existing.qty + qty);
  else
    store.cart.push({
      cameraId: cam.id,
      name: cam.name,
      dailyRate: cam.dailyRate,
      accent: cam.accent,
      icon: cam.icon,
      qty,
    });
  saveCart();
  toast(`${cam.name} added`);
  openDrawer();
}

function setQty(cameraId, qty) {
  const item = store.cart.find((i) => i.cameraId === cameraId);
  if (!item) return;
  item.qty = qty;
  if (item.qty <= 0) store.cart = store.cart.filter((i) => i.cameraId !== cameraId);
  saveCart();
  renderDrawer();
  if (currentRoute().name === 'catalog' || currentRoute().name === 'detail') render();
}

function renderCartCount() {
  const count = store.cart.reduce((n, i) => n + i.qty, 0);
  const el = $('#cart-count');
  el.textContent = count;
  el.dataset.empty = count === 0;
}

function openDrawer() {
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  renderDrawer();
}
function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
}
$('#cart-btn').onclick = openDrawer;
$('#drawer-close').onclick = closeDrawer;
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
});

async function renderDrawer() {
  const body = $('#drawer-body');
  if (store.cart.length === 0) {
    body.innerHTML = `<div class="empty"><h3>Nothing reserved yet</h3><p>Browse the catalogue and add gear for your shoot dates.</p></div>`;
    return;
  }

  body.innerHTML = `
    <div class="panel">
      <h3>Shoot dates</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Pickup</span><input type="date" id="d-from" value="${store.dates.from}" min="${iso(new Date())}" /></label>
        <label class="field"><span>Return</span><input type="date" id="d-to" value="${store.dates.to}" min="${store.dates.from}" /></label>
      </div>
      <label class="check" style="margin-top:12px;padding-bottom:0">
        <input type="checkbox" id="d-insurance" ${store.insurance ? 'checked' : ''} />
        Add damage waiver (9%)
      </label>
    </div>
    <div class="panel">
      <h3>Gear</h3>
      ${store.cart
        .map(
          (i) => `<div class="line-item">
            <span class="li-art" style="--art:${esc(i.accent ?? '#4f46e5')}">${iconSvg(i.icon)}</span>
            <span class="li-main"><strong>${esc(i.name)}</strong><span>${money0(i.dailyRate)}/day</span></span>
            <span class="qty">
              <button type="button" data-dec="${esc(i.cameraId)}" aria-label="Fewer">−</button>
              <span>${i.qty}</span>
              <button type="button" data-inc="${esc(i.cameraId)}" aria-label="More">+</button>
            </span>
          </div>`,
        )
        .join('')}
    </div>
    <div id="quote-slot"><div class="panel"><p class="muted">Pricing…</p></div></div>
    <label class="field"><span>Notes for the shop</span><textarea id="d-notes" placeholder="What are you shooting? Any pickup preferences?"></textarea></label>
    <button class="btn btn-primary btn-block" id="checkout-btn" type="button">Confirm reservation</button>
  `;

  body.querySelectorAll('[data-inc]').forEach((b) => {
    b.onclick = () => setQty(b.dataset.inc, store.cart.find((i) => i.cameraId === b.dataset.inc).qty + 1);
  });
  body.querySelectorAll('[data-dec]').forEach((b) => {
    b.onclick = () => setQty(b.dataset.dec, store.cart.find((i) => i.cameraId === b.dataset.dec).qty - 1);
  });
  $('#d-from').onchange = (e) => {
    store.dates.from = e.target.value;
    saveDates();
    renderDrawer();
    if (currentRoute().name !== 'bookings') render();
  };
  $('#d-to').onchange = (e) => {
    store.dates.to = e.target.value;
    saveDates();
    renderDrawer();
    if (currentRoute().name !== 'bookings') render();
  };
  $('#d-insurance').onchange = (e) => {
    store.insurance = e.target.checked;
    localStorage.setItem('ll_insurance', String(store.insurance));
    refreshQuote();
  };
  $('#checkout-btn').onclick = checkout;
  refreshQuote();
}

async function refreshQuote() {
  const slot = $('#quote-slot');
  if (!slot) return;
  try {
    const { pricing, unavailable } = await api('/api/quote', {
      method: 'POST',
      body: {
        items: store.cart.map((i) => ({ cameraId: i.cameraId, qty: i.qty })),
        startDate: store.dates.from,
        endDate: store.dates.to,
        insurance: store.insurance,
      },
    });
    slot.dataset.ok = unavailable.length === 0;
    slot.innerHTML = `
      ${
        unavailable.length
          ? `<div class="notice notice-warn" style="margin-bottom:12px">Not enough stock for these dates: ${unavailable
              .map((u) => `${esc(u.name)} (${u.available} free, ${u.wanted} wanted)`)
              .join(', ')}</div>`
          : ''
      }
      <div class="panel panel-rows">
        <div class="row"><span class="label">${pricing.days} day${pricing.days === 1 ? '' : 's'} rental</span><span class="value">${money(pricing.base)}</span></div>
        ${pricing.discount > 0 ? `<div class="row credit"><span class="label">${esc(pricing.discountLabel)}</span><span class="value">−${money(pricing.discount)}</span></div>` : ''}
        ${pricing.insuranceFee > 0 ? `<div class="row"><span class="label">Damage waiver</span><span class="value">${money(pricing.insuranceFee)}</span></div>` : ''}
        <div class="row"><span class="label">Tax (8.5%)</span><span class="value">${money(pricing.tax)}</span></div>
        <div class="row total"><span>Rental total</span><span>${money(pricing.total)}</span></div>
        <div class="row"><span class="label">Refundable deposit</span><span class="value">${money(pricing.deposit)}</span></div>
      </div>`;
    const btn = $('#checkout-btn');
    if (btn) btn.disabled = unavailable.length > 0;
  } catch (err) {
    slot.innerHTML = `<div class="notice notice-warn">${esc(err.message)}</div>`;
    const btn = $('#checkout-btn');
    if (btn) btn.disabled = true;
  }
}

async function checkout() {
  if (!store.user) {
    toast('Sign in to reserve gear', 'err');
    openLogin();
    return;
  }
  const btn = $('#checkout-btn');
  btn.disabled = true;
  btn.textContent = 'Reserving…';
  try {
    const { booking } = await api('/api/bookings', {
      method: 'POST',
      body: {
        items: store.cart.map((i) => ({ cameraId: i.cameraId, qty: i.qty })),
        startDate: store.dates.from,
        endDate: store.dates.to,
        insurance: store.insurance,
        notes: $('#d-notes')?.value ?? '',
      },
    });
    store.cart = [];
    saveCart();
    closeDrawer();
    toast(`Reserved — confirmation ${booking.code}`);
    location.hash = '#/bookings';
    render();
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false;
    btn.textContent = 'Confirm reservation';
  }
}

// ------------------------------------------------------------ router
function currentRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'gear' && parts[1]) return { name: 'detail', id: parts[1] };
  if (parts[0] === 'bookings') return { name: 'bookings' };
  if (parts[0] === 'admin') return { name: 'admin' };
  return { name: 'catalog' };
}

function setActiveNav(name) {
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name || (name === 'detail' && a.dataset.route === 'catalog'));
  });
}

async function render() {
  const route = currentRoute();
  setActiveNav(route.name);
  const view = $('#view');
  view.innerHTML = '<div class="grid">' + '<div class="skeleton"></div>'.repeat(6) + '</div>';
  try {
    if (route.name === 'catalog') await renderCatalog(view);
    else if (route.name === 'detail') await renderDetail(view, route.id);
    else if (route.name === 'bookings') await renderBookings(view);
    else if (route.name === 'admin') await renderAdmin(view);
  } catch (err) {
    view.innerHTML = `<div class="empty"><h3>Could not load this page</h3><p>${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', render);

// ------------------------------------------------------------ view: catalog
async function renderCatalog(view) {
  const f = store.filters;
  const params = new URLSearchParams({
    from: store.dates.from,
    to: store.dates.to,
    search: f.search,
    category: f.category,
    brand: f.brand,
    sort: f.sort,
    availableOnly: String(f.availableOnly),
  });
  const data = await api(`/api/catalog?${params}`);
  store.catalog = data;

  const available = data.cameras.filter((c) => c.availability.available > 0).length;

  view.innerHTML = `
    <section class="hero">
      <h1>Pro camera gear, booked by the day.</h1>
      <p>Cinema bodies, fast glass, lighting and sound — checked, cleaned and ready for pickup. Pick your shoot dates and we will hold the kit.</p>
      <div class="hero-stats">
        <div><span>${data.cameras.length}</span><small>items listed</small></div>
        <div><span>${available}</span><small>free on your dates</small></div>
        <div><span>${data.window.days}</span><small>day booking</small></div>
        <div><span>20%</span><small>off weekly hire</small></div>
      </div>
    </section>

    <div class="filters">
      <label class="field"><span>Search</span><input type="text" id="f-search" placeholder="Camera, lens, brand…" value="${esc(f.search)}" /></label>
      <label class="field"><span>Pickup</span><input type="date" id="f-from" value="${store.dates.from}" min="${iso(new Date())}" /></label>
      <label class="field"><span>Return</span><input type="date" id="f-to" value="${store.dates.to}" min="${store.dates.from}" /></label>
      <label class="field"><span>Category</span>
        <select id="f-category">
          <option value="all">All categories</option>
          ${data.categories.map((c) => `<option value="${esc(c)}" ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Sort</span>
        <select id="f-sort">
          <option value="rating" ${f.sort === 'rating' ? 'selected' : ''}>Top rated</option>
          <option value="price-asc" ${f.sort === 'price-asc' ? 'selected' : ''}>Price: low to high</option>
          <option value="price-desc" ${f.sort === 'price-desc' ? 'selected' : ''}>Price: high to low</option>
          <option value="name" ${f.sort === 'name' ? 'selected' : ''}>Name</option>
        </select>
      </label>
      <label class="check"><input type="checkbox" id="f-avail" ${f.availableOnly ? 'checked' : ''} /> Available only</label>
    </div>

    <div class="page-head">
      <div>
        <h1>${data.count} item${data.count === 1 ? '' : 's'}</h1>
        <p>Availability shown for ${prettyDate(data.window.from)} → ${prettyDate(data.window.to)} · ${data.window.days} day${data.window.days === 1 ? '' : 's'}</p>
      </div>
    </div>

    ${
      data.cameras.length === 0
        ? `<div class="empty"><h3>No gear matches those filters</h3><p>Try widening the search or clearing the availability filter.</p></div>`
        : `<div class="grid">${data.cameras.map(cardHtml).join('')}</div>`
    }
  `;

  // filters
  const search = $('#f-search');
  let debounce;
  search.oninput = (e) => {
    clearTimeout(debounce);
    const value = e.target.value;
    debounce = setTimeout(() => {
      store.filters.search = value;
      render().then(() => {
        const el = $('#f-search');
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }, 260);
  };
  $('#f-category').onchange = (e) => { store.filters.category = e.target.value; render(); };
  $('#f-sort').onchange = (e) => { store.filters.sort = e.target.value; render(); };
  $('#f-avail').onchange = (e) => { store.filters.availableOnly = e.target.checked; render(); };
  $('#f-from').onchange = (e) => { store.dates.from = e.target.value; saveDates(); render(); };
  $('#f-to').onchange = (e) => { store.dates.to = e.target.value; saveDates(); render(); };

  wireCardButtons(view, data.cameras);
}

function cardHtml(cam) {
  const inCart = store.cart.find((i) => i.cameraId === cam.id);
  const out = cam.availability.available <= 0;
  return `
    <article class="card">
      <a class="card-art" style="--art:${esc(cam.accent)}" href="#/gear/${esc(cam.id)}" aria-label="${esc(cam.name)}">
        ${iconSvg(cam.icon)}
      </a>
      <div class="card-body">
        <div class="card-kicker"><span>${esc(cam.brand)}</span>·<span>${esc(cam.category)}</span>
          <span class="rating" style="margin-left:auto">★ ${cam.rating.toFixed(1)}</span>
        </div>
        <h3><a href="#/gear/${esc(cam.id)}">${esc(cam.name)}</a></h3>
        <p class="tagline">${esc(cam.tagline)}</p>
        <div>${stockPill(cam.availability)}</div>
        <div class="card-foot">
          <span class="price">${money0(cam.dailyRate)}<small>/day</small></span>
          <button class="btn ${out ? 'btn-ghost' : 'btn-primary'} btn-sm" data-add="${esc(cam.id)}" ${out ? 'disabled' : ''}>
            ${out ? 'Booked out' : inCart ? `In cart (${inCart.qty})` : 'Add'}
          </button>
        </div>
      </div>
    </article>`;
}

function wireCardButtons(root, cameras) {
  root.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = () => {
      const cam = cameras.find((c) => c.id === btn.dataset.add);
      if (cam) addToCart(cam);
      render();
    };
  });
}

// ------------------------------------------------------------ view: detail
async function renderDetail(view, cameraId) {
  const { camera: cam, related } = await api(
    `/api/cameras/${encodeURIComponent(cameraId)}?from=${store.dates.from}&to=${store.dates.to}`,
  );
  const days = Math.max(1, Math.floor((Date.parse(store.dates.to) - Date.parse(store.dates.from)) / 864e5) + 1);
  const inCart = store.cart.find((i) => i.cameraId === cam.id);
  const out = cam.availability.available <= 0;

  view.innerHTML = `
    <a class="breadcrumb" href="#/">← Back to catalogue</a>
    <div class="detail">
      <div>
        <div class="detail-art" style="--art:${esc(cam.accent)}">${iconSvg(cam.icon)}</div>
        <div class="card-kicker" style="margin-top:16px">
          <span>${esc(cam.brand)}</span>·<span>${esc(cam.category)}</span>
          <span class="rating">★ ${cam.rating.toFixed(1)}</span>
        </div>
        <h1>${esc(cam.name)}</h1>
        <p class="muted" style="margin-top:10px;max-width:62ch">${esc(cam.description)}</p>
        <div class="spec-grid">${cam.specs.map((s) => `<div class="spec">${esc(s)}</div>`).join('')}</div>

        ${
          related.length
            ? `<h3 style="margin:30px 0 14px">Often rented with</h3>
               <div class="grid">${related.map(cardHtml).join('')}</div>`
            : ''
        }
      </div>

      <aside>
        <div class="panel">
          <div class="row" style="margin-bottom:14px">
            <span class="price" style="font-size:25px">${money0(cam.dailyRate)}<small>/day</small></span>
            ${stockPill(cam.availability)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field"><span>Pickup</span><input type="date" id="x-from" value="${store.dates.from}" min="${iso(new Date())}" /></label>
            <label class="field"><span>Return</span><input type="date" id="x-to" value="${store.dates.to}" min="${store.dates.from}" /></label>
          </div>
          <div class="panel-rows" style="margin-top:15px">
            <div class="row"><span class="label">In stock</span><span class="value">${cam.availability.stock} unit${cam.availability.stock === 1 ? '' : 's'}</span></div>
            <div class="row"><span class="label">Committed on these dates</span><span class="value">${cam.availability.booked}</span></div>
            <div class="row"><span class="label">Refundable deposit</span><span class="value">${money0(cam.deposit)}</span></div>
            ${days ? `<div class="row total"><span>${days} day estimate</span><span>${money0(cam.dailyRate * days)}</span></div>` : ''}
          </div>
          <button class="btn ${out ? 'btn-ghost' : 'btn-primary'} btn-block" style="margin-top:16px" data-add="${esc(cam.id)}" ${out ? 'disabled' : ''}>
            ${out ? 'Booked out on these dates' : inCart ? `In cart (${inCart.qty}) — add another` : 'Add to rental'}
          </button>
        </div>
        <div class="panel">
          <h3>Rental terms</h3>
          <div class="panel-rows">
            <div class="row"><span class="label">3+ days</span><span class="value">10% off</span></div>
            <div class="row"><span class="label">7+ days</span><span class="value">20% off</span></div>
            <div class="row"><span class="label">14+ days</span><span class="value">25% off</span></div>
            <div class="row"><span class="label">Damage waiver</span><span class="value">9% optional</span></div>
          </div>
          <p class="faint" style="font-size:12.5px;margin-top:12px">Pickup from 9am on the first day, return by 6pm on the last. Deposit is released after the gear is checked in.</p>
        </div>
      </aside>
    </div>`;

  $('#x-from').onchange = (e) => { store.dates.from = e.target.value; saveDates(); render(); };
  $('#x-to').onchange = (e) => { store.dates.to = e.target.value; saveDates(); render(); };
  wireCardButtons(view, [cam, ...related]);
}

// ------------------------------------------------------------ view: bookings
async function renderBookings(view) {
  if (!store.user) {
    view.innerHTML = `<div class="empty"><h3>Sign in to see your rentals</h3><p>Demo accounts need no password.</p>
      <button class="btn btn-primary" id="empty-signin" style="margin-top:14px">Sign in</button></div>`;
    $('#empty-signin').onclick = openLogin;
    return;
  }

  const { bookings, scope } = await api('/api/bookings');
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${scope === 'all' ? 'All rentals' : 'My rentals'}</h1>
        <p>${bookings.length} booking${bookings.length === 1 ? '' : 's'} · reserved under ${esc(store.user.email)}</p>
      </div>
      <a class="btn btn-ghost" href="#/">Browse catalogue</a>
    </div>
    ${
      bookings.length === 0
        ? `<div class="empty"><h3>No rentals yet</h3><p>Add gear to your cart and confirm a reservation to see it here.</p></div>`
        : `<div style="display:flex;flex-direction:column;gap:14px">${bookings.map(bookingCard).join('')}</div>`
    }`;

  view.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api(`/api/bookings/${btn.dataset.cancel}/status`, { method: 'POST', body: { status: 'cancelled' } });
        toast('Booking cancelled');
        render();
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    };
  });
}

function bookingCard(b) {
  const st = STATUS[b.status] ?? STATUS.reserved;
  return `
    <article class="panel">
      <div class="row" style="align-items:flex-start">
        <div>
          <div class="card-kicker" style="margin-bottom:6px">
            <strong style="color:var(--text);font-size:14px;letter-spacing:0">${esc(b.code)}</strong>
            <span class="pill ${st.cls}">${st.label}</span>
          </div>
          <h3 style="font-size:17px">${prettyDate(b.startDate)} → ${prettyDate(b.endDate)}</h3>
          <p class="faint" style="font-size:13px;margin-top:4px">${b.pricing.days} day${b.pricing.days === 1 ? '' : 's'} · ${b.items.length} item${b.items.length === 1 ? '' : 's'}${b.notes ? ` · ${esc(b.notes)}` : ''}</p>
        </div>
        <div style="text-align:right">
          <div class="price">${money(b.pricing.total)}</div>
          <div class="faint" style="font-size:12.5px">+ ${money0(b.pricing.deposit)} deposit</div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
        ${b.items.map((i) => `<span class="pill pill-mute">${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ''}</span>`).join('')}
      </div>
      ${
        b.status === 'reserved'
          ? `<div style="margin-top:14px;display:flex;justify-content:flex-end">
               <button class="btn btn-danger btn-sm" data-cancel="${esc(b.id)}">Cancel booking</button>
             </div>`
          : ''
      }
    </article>`;
}

// ------------------------------------------------------------ view: admin
async function renderAdmin(view) {
  if (store.user?.role !== 'admin') {
    view.innerHTML = `<div class="empty"><h3>Staff only</h3><p>Sign in as admin@lenslease.io to open the shop dashboard.</p>
      <button class="btn btn-primary" id="empty-signin" style="margin-top:14px">Sign in</button></div>`;
    $('#empty-signin').onclick = openLogin;
    return;
  }

  const [stats, { bookings }, catalog] = await Promise.all([
    api('/api/stats'),
    api('/api/bookings'),
    api(`/api/catalog?from=${store.dates.from}&to=${store.dates.to}`),
  ]);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Shop dashboard</h1><p>Counter operations, inventory and revenue for the demo shop.</p></div>
      <button class="btn btn-ghost" id="reset-btn">Reset demo data</button>
    </div>

    <div class="stat-row">
      <div class="stat"><small>Booked revenue</small><b>${money0(stats.revenue)}</b><div class="trend">${stats.bookings} bookings all time</div></div>
      <div class="stat"><small>Gear out now</small><b>${stats.unitsOut}/${stats.totalUnits}</b>
        <div class="bar"><i style="width:${stats.utilisation}%"></i></div>
        <div class="trend">${stats.utilisation}% of the shelf</div></div>
      <div class="stat"><small>Pickups today</small><b>${stats.pickupsToday}</b><div class="trend">waiting at the counter</div></div>
      <div class="stat"><small>Due back today</small><b>${stats.dueToday}</b><div class="trend">${stats.byStatus.overdue ?? 0} overdue</div></div>
    </div>

    <div class="split">
      <section>
        <div class="page-head"><div><h1 style="font-size:19px">Bookings</h1></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ref</th><th>Customer</th><th>Dates</th><th>Items</th><th>Status</th><th class="num">Total</th><th></th></tr></thead>
            <tbody>
              ${
                bookings.length === 0
                  ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:26px">No bookings yet.</td></tr>'
                  : bookings.map(bookingRow).join('')
              }
            </tbody>
          </table>
        </div>
      </section>

      <aside>
        <div class="panel">
          <h3>Most rented</h3>
          <div class="panel-rows">
            ${
              stats.topItems.length
                ? stats.topItems
                    .map(
                      (t) =>
                        `<div class="row"><span class="label">${esc(t.name)}</span><span class="value">${t.count}×</span></div>`,
                    )
                    .join('')
                : '<p class="muted">No rentals recorded yet.</p>'
            }
          </div>
        </div>
        <div class="panel">
          <h3>Add gear</h3>
          <form id="add-form" style="display:flex;flex-direction:column;gap:10px">
            <label class="field"><span>Name</span><input type="text" name="name" required placeholder="Canon EOS R6 II" /></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label class="field"><span>Brand</span><input type="text" name="brand" required placeholder="Canon" /></label>
              <label class="field"><span>Category</span>
                <select name="category">
                  ${catalog.categories.map((c) => `<option>${esc(c)}</option>`).join('')}
                </select>
              </label>
            </div>
            <label class="field"><span>Tagline</span><input type="text" name="tagline" placeholder="Short pitch for the card" /></label>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
              <label class="field"><span>Day rate</span><input type="number" name="dailyRate" min="1" value="60" required /></label>
              <label class="field"><span>Deposit</span><input type="number" name="deposit" min="0" value="500" /></label>
              <label class="field"><span>Stock</span><input type="number" name="stock" min="0" max="99" value="2" /></label>
            </div>
            <button class="btn btn-primary btn-block" type="submit">Add to catalogue</button>
          </form>
        </div>
      </aside>
    </div>

    <div class="page-head" style="margin-top:30px"><div><h1 style="font-size:19px">Inventory</h1><p>Availability for ${prettyShort(store.dates.from)} → ${prettyShort(store.dates.to)}</p></div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Item</th><th>Category</th><th class="num">Day rate</th><th class="num">Stock</th><th class="num">Committed</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${catalog.cameras
            .map(
              (c) => `<tr>
                <td><strong>${esc(c.name)}</strong><div class="faint" style="font-size:12.5px">${esc(c.brand)}</div></td>
                <td class="muted">${esc(c.category)}</td>
                <td class="num">${money0(c.dailyRate)}</td>
                <td class="num">
                  <span class="qty"><button type="button" data-stock-dec="${esc(c.id)}" ${c.stock === 0 ? 'disabled' : ''}>−</button><span>${c.stock}</span><button type="button" data-stock-inc="${esc(c.id)}">+</button></span>
                </td>
                <td class="num">${c.availability.booked}</td>
                <td>${stockPill(c.availability)}</td>
                <td><div class="cell-actions"><button class="btn btn-danger btn-sm" data-del="${esc(c.id)}">Remove</button></div></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  // booking actions
  view.querySelectorAll('[data-status]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api(`/api/bookings/${btn.dataset.id}/status`, { method: 'POST', body: { status: btn.dataset.status } });
        toast('Booking updated');
        render();
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    };
  });

  // inventory actions
  const patchStock = async (id, stock) => {
    try {
      await api(`/api/cameras/${id}`, { method: 'PATCH', body: { stock } });
      render();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  view.querySelectorAll('[data-stock-inc]').forEach((b) => {
    b.onclick = () => {
      const cam = catalog.cameras.find((c) => c.id === b.dataset.stockInc);
      patchStock(cam.id, cam.stock + 1);
    };
  });
  view.querySelectorAll('[data-stock-dec]').forEach((b) => {
    b.onclick = () => {
      const cam = catalog.cameras.find((c) => c.id === b.dataset.stockDec);
      patchStock(cam.id, Math.max(0, cam.stock - 1));
    };
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Remove this item from the catalogue?')) return;
      try {
        await api(`/api/cameras/${b.dataset.del}`, { method: 'DELETE' });
        toast('Item removed');
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  });

  $('#add-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const { camera } = await api('/api/cameras', {
        method: 'POST',
        body: { ...fd, accent: randomAccent(), icon: iconForCategory(fd.category) },
      });
      toast(`${camera.name} added to the catalogue`);
      render();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $('#reset-btn').onclick = async () => {
    if (!confirm('Restore the demo catalogue and bookings? Current data will be replaced.')) return;
    try {
      await api('/api/admin/reset', { method: 'POST' });
      store.cart = [];
      saveCart();
      toast('Demo data restored');
      render();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

function bookingRow(b) {
  const st = STATUS[b.status] ?? STATUS.reserved;
  const next = {
    reserved: [
      { status: 'picked_up', label: 'Check out', cls: 'btn-primary' },
      { status: 'cancelled', label: 'Cancel', cls: 'btn-danger' },
    ],
    picked_up: [{ status: 'returned', label: 'Check in', cls: 'btn-primary' }],
    overdue: [{ status: 'returned', label: 'Check in', cls: 'btn-primary' }],
  }[b.status] ?? [];

  return `<tr>
    <td><strong>${esc(b.code)}</strong></td>
    <td>${esc(b.customerName)}<div class="faint" style="font-size:12px">${esc(b.customerEmail ?? '')}</div></td>
    <td>${prettyShort(b.startDate)} → ${prettyShort(b.endDate)}<div class="faint" style="font-size:12px">${b.pricing.days} days</div></td>
    <td class="muted">${b.items.map((i) => esc(i.name)).join(', ')}</td>
    <td><span class="pill ${st.cls}">${st.label}</span></td>
    <td class="num">${money(b.pricing.total)}</td>
    <td><div class="cell-actions">${next
      .map((n) => `<button class="btn ${n.cls} btn-sm" data-status="${n.status}" data-id="${esc(b.id)}">${n.label}</button>`)
      .join('')}</div></td>
  </tr>`;
}

const ACCENTS = ['#e05c4b', '#3f7fd6', '#5b4bd6', '#2f855a', '#d69e2e', '#805ad5', '#319795', '#dd6b20'];
const randomAccent = () => ACCENTS[Math.floor(Math.random() * ACCENTS.length)];
const iconForCategory = (category) =>
  ({ Lens: 'lens', Cinema: 'cinema', Action: 'action', Lighting: 'light', Audio: 'audio', Support: 'support' }[category] ??
  'camera');

// ------------------------------------------------------------ boot
saveDates();
renderCartCount();
refreshMe()
  .catch(() => {})
  .finally(render);

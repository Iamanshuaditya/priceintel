export function operatorUiHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PriceIntel</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <main class="shell">
    <section id="auth-view" class="auth-card">
      <div class="brand">PriceIntel</div>
      <p class="muted">Reliable competitor price monitoring.</p>
      <form id="auth-form" autocomplete="on">
        <label>Email<input id="email" name="email" type="email" autocomplete="email" required></label>
        <label>Password<input id="password" name="password" type="password" autocomplete="current-password" minlength="8" required></label>
        <div class="button-row">
          <button type="submit">Sign in</button>
          <button id="register-button" type="button" class="secondary">Create account</button>
        </div>
        <p id="auth-error" class="error" role="alert"></p>
      </form>
    </section>

    <section id="app-view" hidden>
      <header class="topbar">
        <div><strong>PriceIntel</strong><span class="muted small"> operator console</span></div>
        <div class="top-actions">
          <select id="workspace-select" aria-label="Workspace"></select>
          <button id="logout-button" class="secondary">Log out</button>
        </div>
      </header>

      <section id="empty-workspace" class="panel" hidden>
        <h2>Create your first workspace</h2>
        <form id="workspace-form" class="inline-form">
          <input id="workspace-name" placeholder="Acme Audio" maxlength="200" required>
          <button>Create workspace</button>
        </form>
      </section>

      <div id="workspace-content" class="layout" hidden>
        <section class="panel span-2">
          <div class="panel-head">
            <div><h2>Products</h2><p class="muted small">Internal catalog and monitored listing counts.</p></div>
          </div>
          <form id="product-form" class="grid-form">
            <input id="product-title" placeholder="Product name" required>
            <input id="product-sku" placeholder="SKU" required>
            <input id="product-price" type="number" min="0" step="0.01" placeholder="Our price">
            <input id="product-currency" value="USD" maxlength="3" required>
            <button>Add product</button>
          </form>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>SKU</th><th>Our price</th><th>Listings</th></tr></thead>
              <tbody id="products-body"></tbody>
            </table>
          </div>
        </section>

        <section class="panel span-2">
          <div class="panel-head">
            <div><h2>Competitor listings</h2><p id="selected-product-label" class="muted small">Select a product.</p></div>
          </div>
          <form id="listing-form" class="grid-form" hidden>
            <input id="listing-retailer" placeholder="Retailer (e.g. Walmart)" required>
            <input id="listing-url" type="url" placeholder="https://example.com/product" required class="wide">
            <button>Add listing</button>
          </form>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Retailer</th><th>Price</th><th>Stock</th><th>Health</th><th>Verified</th></tr></thead>
              <tbody id="listings-body"></tbody>
            </table>
          </div>
        </section>

        <aside class="panel detail-panel">
          <div id="listing-empty" class="muted">Select a competitor listing to inspect it.</div>
          <div id="listing-detail" hidden>
            <div class="panel-head">
              <div><h2 id="detail-retailer"></h2><p id="detail-url" class="muted small break"></p></div>
              <span id="detail-health" class="badge"></span>
            </div>
            <div class="price-line"><span id="detail-price">—</span><span id="detail-stock" class="muted"></span></div>
            <dl class="facts">
              <div><dt>Last attempted</dt><dd id="detail-attempt">—</dd></div>
              <div><dt>Last successfully verified</dt><dd id="detail-success">—</dd></div>
              <div><dt>Failure count</dt><dd id="detail-failures">0</dd></div>
              <div><dt>Source</dt><dd id="detail-source">—</dd></div>
              <div><dt>Confidence</dt><dd id="detail-confidence">—</dd></div>
            </dl>
            <div id="honesty-message" class="honesty" hidden></div>
            <div class="button-row">
              <button id="check-now-button">Check now</button>
              <span id="crawl-status" class="muted small"></span>
            </div>
            <hr>
            <h3>Price history</h3>
            <div id="history-list" class="history"></div>
            <h3>Changes</h3>
            <div id="changes-list" class="history"></div>
          </div>
        </aside>
      </div>
    </section>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

export function operatorUiCss() {
  return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f6f7f8}*{box-sizing:border-box}body{margin:0}.shell{max-width:1180px;margin:0 auto;padding:28px}.auth-card{width:min(420px,100%);margin:12vh auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.05)}.brand{font-size:26px;font-weight:750;letter-spacing:-.03em}.muted{color:#6b7280}.small{font-size:13px}.error{color:#b91c1c;min-height:20px}.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.top-actions{display:flex;gap:10px;align-items:center}.layout{display:grid;grid-template-columns:1fr 1fr;gap:16px}.span-2{grid-column:1 / -1}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px}.detail-panel{grid-column:1 / -1}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.panel h2,.panel h3{margin:0 0 6px}.panel h3{font-size:15px;margin-top:18px}.grid-form{display:grid;grid-template-columns:2fr 1fr 1fr .6fr auto;gap:8px;margin:14px 0}.grid-form .wide{grid-column:span 3}.inline-form{display:flex;gap:8px}.inline-form input{flex:1}input,select,button{font:inherit;border-radius:8px;border:1px solid #d1d5db;padding:9px 11px;background:#fff}label{display:grid;gap:5px;margin:14px 0;font-size:14px}button{cursor:pointer;background:#111827;color:#fff;border-color:#111827;font-weight:650}button.secondary{background:#fff;color:#111827;border-color:#d1d5db}button:disabled{opacity:.5;cursor:wait}.button-row{display:flex;gap:10px;align-items:center}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px 9px;border-top:1px solid #eef0f2;font-size:14px}th{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}tbody tr{cursor:pointer}tbody tr:hover,tbody tr.selected{background:#f8fafc}.badge{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:700;background:#eef2ff}.badge.healthy{background:#ecfdf3;color:#067647}.badge.failed,.badge.degraded{background:#fff1f2;color:#b42318}.badge.stale{background:#fffaeb;color:#b54708}.price-line{display:flex;gap:12px;align-items:baseline;margin:18px 0}.price-line>span:first-child{font-size:36px;font-weight:750;letter-spacing:-.04em}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}.facts div{border:1px solid #eef0f2;border-radius:9px;padding:11px}.facts dt{font-size:12px;color:#6b7280}.facts dd{margin:5px 0 0;font-weight:600}.honesty{margin:14px 0;padding:12px;border-left:3px solid #b54708;background:#fffaeb;font-size:14px}.history{display:grid;gap:7px}.history-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #eef0f2;font-size:14px}.break{overflow-wrap:anywhere}@media(max-width:760px){.shell{padding:14px}.topbar{align-items:flex-start;gap:12px;flex-direction:column}.layout{grid-template-columns:1fr}.grid-form{grid-template-columns:1fr}.grid-form .wide{grid-column:auto}.facts{grid-template-columns:1fr}}`;
}

export function operatorUiJs() {
  return `(() => {
  const state = { workspaceId:null, productId:null, listingId:null, products:[], listings:[] };
  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (value, currency) => value == null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:currency || 'USD'}).format(Number(value));
  const when = (value) => value ? new Date(value).toLocaleString() : 'Never';
  const healthClass = (health) => health === 'HEALTHY' ? 'healthy' : health === 'STALE' ? 'stale' : 'failed';

  async function request(path, options) {
    options = options || {};
    const response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? {} : {'content-type':'application/json'},
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) { showAuth(); throw new Error('Authentication required'); }
    if (!response.ok) throw new Error(body && body.error ? body.error.message : 'Request failed (' + response.status + ')');
    return body;
  }

  function showAuth() {
    el('auth-view').hidden = false;
    el('app-view').hidden = true;
  }

  function showApp() {
    el('auth-view').hidden = true;
    el('app-view').hidden = false;
  }

  async function authenticate(action) {
    el('auth-error').textContent = '';
    try {
      await request('/v1/auth/' + action, {method:'POST', body:{
        email:el('email').value,
        password:el('password').value,
        sessionTransport:'cookie',
      }});
      showApp();
      await loadWorkspaces();
    } catch (error) {
      el('auth-error').textContent = error.message;
    }
  }

  async function loadWorkspaces() {
    const body = await request('/v1/workspaces');
    const select = el('workspace-select');
    select.innerHTML = '';
    body.workspaces.forEach((workspace) => {
      const option = document.createElement('option');
      option.value = workspace.id;
      option.textContent = workspace.name + ' · ' + workspace.role;
      select.appendChild(option);
    });
    if (!body.workspaces.length) {
      state.workspaceId = null;
      el('empty-workspace').hidden = false;
      el('workspace-content').hidden = true;
      return;
    }
    el('empty-workspace').hidden = true;
    el('workspace-content').hidden = false;
    state.workspaceId = select.value || body.workspaces[0].id;
    select.value = state.workspaceId;
    state.productId = null;
    state.listingId = null;
    await loadProducts();
  }

  async function loadProducts() {
    const body = await request('/v1/workspaces/' + encodeURIComponent(state.workspaceId) + '/products');
    state.products = body.products;
    const tbody = el('products-body');
    tbody.innerHTML = body.products.map((product) => '<tr data-product="' + esc(product.id) + '" class="' + (product.id === state.productId ? 'selected' : '') + '"><td><strong>' + esc(product.title) + '</strong></td><td>' + esc(product.sku) + '</td><td>' + esc(money(product.currentPrice, product.currency)) + '</td><td>' + esc(product.listingCount || 0) + '</td></tr>').join('');
    tbody.querySelectorAll('tr').forEach((row) => row.addEventListener('click', () => selectProduct(row.dataset.product)));
    if (state.productId && !body.products.some((product) => product.id === state.productId)) state.productId = null;
    if (!state.productId && body.products.length) await selectProduct(body.products[0].id);
    if (!body.products.length) {
      el('listing-form').hidden = true;
      el('selected-product-label').textContent = 'Add a product to begin monitoring.';
      el('listings-body').innerHTML = '';
    }
  }

  async function selectProduct(productId) {
    state.productId = productId;
    state.listingId = null;
    const product = state.products.find((item) => item.id === productId);
    el('selected-product-label').textContent = product ? product.title + ' · ' + product.sku : 'Selected product';
    el('listing-form').hidden = false;
    el('listing-empty').hidden = false;
    el('listing-detail').hidden = true;
    await loadListings();
    document.querySelectorAll('#products-body tr').forEach((row) => row.classList.toggle('selected', row.dataset.product === productId));
  }

  async function loadListings() {
    if (!state.workspaceId || !state.productId) return;
    const body = await request('/v1/workspaces/' + encodeURIComponent(state.workspaceId) + '/listings?productId=' + encodeURIComponent(state.productId));
    state.listings = body.listings;
    const tbody = el('listings-body');
    tbody.innerHTML = body.listings.map((listing) => '<tr data-listing="' + esc(listing.id) + '" class="' + (listing.id === state.listingId ? 'selected' : '') + '"><td><strong>' + esc(listing.retailer) + '</strong></td><td>' + esc(money(listing.currentPrice, listing.currentCurrency || 'USD')) + '</td><td>' + esc(listing.currentStockStatus || 'UNKNOWN') + '</td><td><span class="badge ' + healthClass(listing.health) + '">' + esc(listing.health) + '</span></td><td>' + esc(when(listing.lastSuccessfulCrawlAt)) + '</td></tr>').join('');
    tbody.querySelectorAll('tr').forEach((row) => row.addEventListener('click', () => selectListing(row.dataset.listing)));
    if (!body.listings.length) {
      el('listing-empty').hidden = false;
      el('listing-detail').hidden = true;
    }
  }

  async function selectListing(listingId) {
    state.listingId = listingId;
    document.querySelectorAll('#listings-body tr').forEach((row) => row.classList.toggle('selected', row.dataset.listing === listingId));
    await refreshListingDetail();
  }

  async function refreshListingDetail() {
    if (!state.listingId) return;
    const prefix = '/v1/workspaces/' + encodeURIComponent(state.workspaceId) + '/listings/' + encodeURIComponent(state.listingId);
    const pair = await Promise.all([request(prefix), request(prefix + '/history')]);
    const listing = pair[0].listing;
    const history = pair[1];
    el('listing-empty').hidden = true;
    el('listing-detail').hidden = false;
    el('detail-retailer').textContent = listing.retailer;
    el('detail-url').textContent = listing.url;
    el('detail-health').textContent = listing.health;
    el('detail-health').className = 'badge ' + healthClass(listing.health);
    el('detail-price').textContent = money(listing.currentPrice, listing.currentCurrency || 'USD');
    el('detail-stock').textContent = listing.currentStockStatus || 'UNKNOWN';
    el('detail-attempt').textContent = when(listing.lastCrawlAt);
    el('detail-success').textContent = when(listing.lastSuccessfulCrawlAt);
    el('detail-failures').textContent = String(listing.failureCount || 0);
    el('detail-source').textContent = listing.sourceMethod || '—';
    el('detail-confidence').textContent = listing.confidence == null ? '—' : Math.round(Number(listing.confidence) * 100) + '%';

    const honesty = el('honesty-message');
    if (listing.health !== 'HEALTHY' && listing.lastSuccessfulCrawlAt) {
      honesty.hidden = false;
      honesty.textContent = 'We could not verify a new price. The displayed value is the last successfully verified value and has NOT been treated as fresh.';
    } else honesty.hidden = true;

    el('history-list').innerHTML = history.observations.length ? history.observations.map((item) => '<div class="history-row"><span>' + esc(when(item.verifiedAt)) + '</span><strong>' + esc(money(item.price,item.currency)) + ' · ' + esc(item.stockStatus) + '</strong></div>').join('') : '<div class="muted small">No verified observations yet.</div>';
    el('changes-list').innerHTML = history.changes.length ? history.changes.map((item) => '<div class="history-row"><span>' + esc(when(item.createdAt)) + ' · ' + esc(item.type) + '</span><strong>' + esc(String(item.previousValue)) + ' → ' + esc(String(item.currentValue)) + '</strong></div>').join('') : '<div class="muted small">No semantic changes yet.</div>';
  }

  async function pollCrawl(crawlRunId) {
    const status = el('crawl-status');
    const button = el('check-now-button');
    button.disabled = true;
    try {
      for (let i = 0; i < 60; i += 1) {
        const body = await request('/v1/workspaces/' + encodeURIComponent(state.workspaceId) + '/crawls/' + encodeURIComponent(crawlRunId));
        status.textContent = body.crawl.status + (body.crawl.failureCode ? ' · ' + body.crawl.failureCode : '');
        if (body.crawl.status === 'SUCCEEDED' || body.crawl.status === 'FAILED') break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await Promise.all([loadProducts(), loadListings(), refreshListingDetail()]);
    } finally { button.disabled = false; }
  }

  el('auth-form').addEventListener('submit', (event) => { event.preventDefault(); void authenticate('login'); });
  el('register-button').addEventListener('click', () => void authenticate('register'));
  el('logout-button').addEventListener('click', async () => { try { await request('/v1/auth/logout',{method:'POST'}); } finally { showAuth(); } });
  el('workspace-select').addEventListener('change', async (event) => { state.workspaceId = event.target.value; state.productId = null; state.listingId = null; await loadProducts(); });
  el('workspace-form').addEventListener('submit', async (event) => { event.preventDefault(); await request('/v1/workspaces',{method:'POST',body:{name:el('workspace-name').value}}); el('workspace-name').value=''; await loadWorkspaces(); });
  el('product-form').addEventListener('submit', async (event) => { event.preventDefault(); await request('/v1/workspaces/' + encodeURIComponent(state.workspaceId) + '/products',{method:'POST',body:{title:el('product-title').value,sku:el('product-sku').value,currentPrice:el('product-price').value ? Number(el('product-price').value) : null,currency:el('product-currency').value}}); el('product-title').value=''; el('product-sku').value=''; el('product-price').value=''; await loadProducts(); });
  el('listing-form').addEventListener('submit', async (event) => { event.preventDefault(); await request('/v1/workspaces/' + encodeURIComponent(state.workspaceId) + '/products/' + encodeURIComponent(state.productId) + '/listings',{method:'POST',body:{retailer:el('listing-retailer').value,url:el('listing-url').value}}); el('listing-retailer').value=''; el('listing-url').value=''; await Promise.all([loadProducts(),loadListings()]); });
  el('check-now-button').addEventListener('click', async () => { const body = await request('/v1/workspaces/' + encodeURIComponent(state.workspaceId) + '/listings/' + encodeURIComponent(state.listingId) + '/crawl',{method:'POST'}); await pollCrawl(body.crawl.crawlRunId); });

  request('/v1/me').then(() => { showApp(); return loadWorkspaces(); }).catch(() => showAuth());
})();`;
}

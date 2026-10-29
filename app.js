/* MELTMARE storefront: single page app, no build step.
   Products, accounts, orders and payments live on the server (see server.js and README.md).
   Only the shopping cart is kept in the browser (localStorage). */
(function () {
  'use strict';

  // ---------- config ----------
  var FREE_SHIP = 999; // overwritten from the server at start up
  var SHIP_FEE = 79;
  var INFO = { email: 'hello@meltmare.com', phone: '', address: '', hours: '', policiesReviewed: false }; // overwritten from the server
  var SCENTS = ['Woody', 'Floral', 'Fresh', 'Sweet', 'Spiced'];
  var STATUSES = ['Pending payment', 'Paid', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
  var CUSTOMER_STATUS = { 'Pending payment': 'Waiting for payment', Paid: 'Order confirmed', Packed: 'Being packed', Shipped: 'On its way', Delivered: 'Delivered', Cancelled: 'Cancelled' };

  var FAQ = [
    ['How do I choose a scent?', 'Start with the scent family: Woody for warmth, Floral for softness, Fresh for calm, Sweet for comfort and Spiced for cosy evenings.'],
    ['How long does delivery take?', 'Orders are packed within 2 working days and usually arrive in 3 to 7 working days, depending on your city.'],
    ['Can I track my order?', 'Yes. Sign in and open My account to see the status of every order.'],
    ['Which payment methods do you accept?', 'UPI, debit and credit cards, netbanking and popular wallets, all processed securely by Cashfree.'],
    ['Can I send a candle as a gift?', "Yes. Enter your recipient's address at checkout and we will pack it gift ready."],
    ['What if my candle arrives damaged?', 'Write to us within 7 days with a photo and we will replace it. Used candles cannot be returned.']
  ];

  var POLICIES = {
    shipping: ['Shipping policy', ['We ship across India. Orders are packed within 2 working days and delivered in 3 to 7 working days, depending on your city.', 'Delivery is free on orders above ₹999. Below that, a flat delivery charge of ₹79 applies.', 'As soon as your order ships, its status updates in My account so you can follow it to your door.']],
    refund: ['Refund policy', ['Damaged or wrong items are replaced or refunded if reported within 7 days with photos. Used candles cannot be returned.', 'Refunds go back to the original payment method in 5 to 7 working days.', 'Write to us at hello@meltmare.com with your order number and a photo, and we will take care of the rest.']],
    privacy: ['Privacy policy', ['We collect your name, email, phone number and address only to process orders and support you.', 'Payments are handled by Cashfree and we never store card details.', 'We do not sell your data. Ever.']],
    terms: ['Terms of service', ['Prices are in Indian rupees and include applicable taxes.', 'We may cancel an order for a stock or pricing error and will refund it in full.', 'By using this site you agree to these terms and to our other policies.']]
  };

  var REVIEWS = [
    ['Cedar Dusk has become part of my evening routine. The whole room feels calmer within minutes of lighting it.', 'Ananya R.'],
    ['Bought Vanilla Linen as a gift and ended up keeping one for myself. Beautiful jar, and the scent is soft, never overpowering.', 'Rohan M.'],
    ['Sea Salt Breeze is exactly what my study needed. Clean, coastal, and it burns evenly right to the edge.', 'Priya S.']
  ];

  // ---------- helpers ----------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (n) { return '₹' + Number(n).toLocaleString('en-IN'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var load = function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  var save = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  var I = {
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 3c2 3 5 5 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z"/></svg>',
    gift: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="11" rx="1"/><path d="M3 9h18v3H3zM12 9v11M12 9c-2-4-6-3-5 0M12 9c2-4 6-3 5 0"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>'
  };

  // ---------- api and state ----------
  var S = { products: [], user: null, config: { payments: 'off' } };

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }
  function loadCatalogue() {
    return api('GET', '/api/products').then(function (j) {
      S.products = j.products; S.config = j.config || S.config;
      if (S.config.freeShip) FREE_SHIP = S.config.freeShip;
      if (S.config.shipFee !== undefined) SHIP_FEE = S.config.shipFee;
      if (S.config.store) INFO = S.config.store;
    });
  }
  function loadMe() { return api('GET', '/api/auth/me').then(function (j) { S.user = j.user; }).catch(function () { S.user = null; }); }
  function safeNext(n) { return n && n.charAt(0) === '/' && n.charAt(1) !== '/' && n.charAt(1) !== '\\' ? n : '/'; }

  var store = {
    products: function () { return S.products; },
    cart: function () { return load('mm_cart', []); },
    saveCart: function (c) { save('mm_cart', c); updateBadge(); },
    user: function () { return S.user; }
  };
  var find = function (slug) { return S.products.filter(function (p) { return p.slug === slug; })[0]; };
  var imgSrc = function (p) { return p.image || '/assets/img/' + p.slug + '.jpg'; };
  var cartLines = function () {
    return store.cart().map(function (l) { var p = find(l.slug); return p ? { p: p, qty: l.qty } : null; }).filter(Boolean);
  };
  var subtotal = function () { return cartLines().reduce(function (a, l) { return a + l.p.price * l.qty; }, 0); };
  var delivery = function (sub) { return sub === 0 || sub >= FREE_SHIP ? 0 : SHIP_FEE; };

  function addToCart(slug, qty) {
    var p = find(slug); if (!p) return;
    if (p.stock <= 0) { toast('Sold out for now'); return; }
    var cart = store.cart(), hit = cart.filter(function (l) { return l.slug === slug; })[0];
    var next = (hit ? hit.qty : 0) + (qty || 1);
    if (next > p.stock) { toast('Only ' + p.stock + ' available'); next = p.stock; }
    if (hit) hit.qty = next; else cart.push({ slug: slug, qty: next });
    store.saveCart(cart);
    toast('Added to your cart');
    renderCartDrawer(); openDrawer('cart');
  }
  function setQty(slug, qty) {
    var p = find(slug), cart = store.cart();
    if (qty <= 0) cart = cart.filter(function (l) { return l.slug !== slug; });
    else cart.forEach(function (l) { if (l.slug === slug) l.qty = Math.min(qty, p ? p.stock : qty); });
    store.saveCart(cart); renderCartDrawer(); if (location.pathname === '/cart' || location.pathname === '/checkout') route();
  }

  // ---------- ui bits ----------
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function imgTag(p) {
    return '<img src="' + esc(imgSrc(p)) + '" alt="' + esc(p.name) + '" loading="lazy" data-ph="' + esc(p.name.charAt(0)) + '">';
  }
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.dataset.ph) {
      var d = document.createElement('div'); d.className = 'ph'; d.style.cssText = 'width:100%;height:100%;'; d.textContent = t.dataset.ph;
      t.replaceWith(d);
    }
  }, true);

  function card(p) {
    var tag = p.stock <= 0 ? '<span class="tag red">Sold out</span>' : p.tag ? '<span class="tag">' + esc(p.tag) + '</span>' : '';
    var fab = p.stock > 0 ? '<button class="add-fab" data-add="' + p.slug + '" aria-label="Add ' + esc(p.name) + ' to cart">' + I.plus + '</button>' : '';
    var low = p.stock > 0 && p.stock <= 5 ? '<div class="low">Only ' + p.stock + ' left</div>' : '';
    return '<article class="card"><div class="imgbox">' + tag + '<a href="/product/' + p.slug + '" data-link style="display:block;width:100%;height:100%">' + imgTag(p) + '</a>' + fab + '</div>' +
      '<div class="meta"><div class="scent">' + esc(p.scent) + '</div><h3><a href="/product/' + p.slug + '" data-link>' + esc(p.name) + '</a></h3>' +
      '<div class="notes">' + p.notes.map(esc).join(' · ') + '</div><div class="price">' + money(p.price) + '</div>' + low + '</div></article>';
  }

  // ---------- shell ----------
  function shell(inner, opts) {
    opts = opts || {};
    var cnt = store.cart().reduce(function (a, l) { return a + l.qty; }, 0);
    var path = location.pathname;
    var nav = [['/shop', 'Shop'], ['/story', 'Our Story'], ['/contact', 'Contact']];
    var navHtml = nav.map(function (n) { return '<a href="' + n[0] + '" data-link class="' + (path.indexOf(n[0]) === 0 ? 'on' : '') + '">' + n[1] + '</a>'; }).join('');
    var user = store.user();
    return '<div class="announce">Free delivery on orders above ₹' + FREE_SHIP + '</div>' +
      '<header class="header"><div class="wrap row">' +
      '<div class="left"><button class="icon-btn menu-btn" data-open="menu" aria-label="Open menu">' + I.menu + '</button><nav>' + navHtml + '</nav></div>' +
      '<a href="/" data-link class="logo" aria-label="MELTMARE home"><img src="/assets/logo-green.png" alt=""><span>MELTMARE</span></a>' +
      '<div class="right"><button class="icon-btn" id="searchBtn" aria-label="Search">' + I.search + '</button>' +
      '<a class="icon-btn" href="' + (user ? '/account' : '/login') + '" data-link aria-label="Account">' + I.user + '</a>' +
      '<button class="icon-btn" data-open="cart" aria-label="Cart">' + I.bag + '<span class="badge-count" id="cartCount" style="' + (cnt ? '' : 'display:none') + '">' + cnt + '</span></button></div>' +
      '</div><div class="searchbar" id="searchbar"><div class="wrap"><input id="searchInput" placeholder="Search candles by name or scent" aria-label="Search"><div class="search-results" id="searchResults"></div></div></div></header>' +
      '<main>' + inner + '</main>' + footer() +
      '<div class="overlay" id="overlay"></div>' +
      '<aside class="drawer left" id="menuDrawer" aria-label="Menu"><div class="drawer-head"><h3>MELTMARE</h3><button class="close-btn" data-close aria-label="Close">×</button></div>' +
      '<div class="drawer-nav">' + [['/', 'Home'], ['/shop', 'Shop'], ['/story', 'Our Story'], ['/contact', 'Contact'], ['/faq', 'FAQ'], ['/candle-care', 'Candle care'], [user ? '/account' : '/login', user ? 'My account' : 'Sign in']].map(function (n) { return '<a href="' + n[0] + '" data-link>' + n[1] + '</a>'; }).join('') + '</div></aside>' +
      '<aside class="drawer right" id="cartDrawer" aria-label="Cart"></aside>';
  }

  function footer() {
    var list = function (arr) { return '<ul>' + arr.map(function (a) { return '<li><a href="' + a[0] + '" data-link>' + a[1] + '</a></li>'; }).join('') + '</ul>'; };
    return '<footer class="footer"><div class="wrap"><div class="cols">' +
      '<div class="brand"><img src="/assets/logo-green.png" alt="MELTMARE"><p class="tagline">Find your scent. Light your mood.</p><p>Candles and décor made to make your space feel calm, personal and complete.</p></div>' +
      '<div><h5>SHOP</h5>' + list([['/shop', 'Shop all']].concat(SCENTS.map(function (s) { return ['/shop?scent=' + s, s]; }))) + '</div>' +
      '<div><h5>HELP</h5>' + list([['/faq', 'FAQ'], ['/candle-care', 'Candle care'], ['/contact', 'Contact us'], ['/policies/shipping', 'Shipping policy'], ['/policies/refund', 'Refund policy']]) + '</div>' +
      '<div><h5>JOIN THE CIRCLE</h5><p style="color:rgba(255,253,248,.75);font-size:14px;margin:0">New arrivals and offers, straight to your inbox.</p><form class="join" data-news><input type="email" required placeholder="Your email" aria-label="Email"><button>JOIN</button></form></div>' +
      '</div><div class="bottom"><span>' + esc(INFO.email) + (INFO.phone ? ' · ' + esc(INFO.phone) : '') + '</span><span>© 2026 MELTMARE. All rights reserved.</span></div>' +
      '<div class="bottom" style="border:0;margin-top:0;padding-top:10px"><div class="pay"><span>UPI</span><span>Visa</span><span>Mastercard</span><span>RuPay</span><span>Netbanking</span></div><div class="legal"><a href="/policies/privacy" data-link>Privacy</a><a href="/policies/terms" data-link>Terms</a></div></div>' +
      '</div></footer>';
  }

  function renderCartDrawer() {
    var d = $('#cartDrawer'); if (!d) return;
    var lines = cartLines(), sub = subtotal();
    var left = Math.max(0, FREE_SHIP - sub);
    var body;
    if (!lines.length) body = '<div class="empty" style="padding:40px 0"><p>Your cart is empty</p><a class="btn green" href="/shop" data-link data-close>Start shopping</a></div>';
    else body = '<div class="progress">' + (left > 0 ? 'You are ' + money(left) + ' away from free delivery' : 'You have unlocked free delivery') + '<div class="bar"><i style="width:' + Math.min(100, sub / FREE_SHIP * 100) + '%"></i></div></div>' + lines.map(lineHtml).join('');
    d.innerHTML = '<div class="drawer-head"><h3>Your cart</h3><button class="close-btn" data-close aria-label="Close">×</button></div><div class="drawer-body">' + body + '</div>' +
      (lines.length ? '<div class="drawer-foot"><div class="totals"><div><span>Subtotal</span><b>' + money(sub) + '</b></div></div><div class="note">Delivery charges are calculated at checkout</div><a class="btn green block" href="/checkout" data-link data-close>Checkout</a><a class="btn outline-dark block" href="/shop" data-link data-close>Continue shopping</a></div>' : '');
  }
  function lineHtml(l) {
    return '<div class="line"><div class="thumb">' + imgTag(l.p) + '</div><div><h4>' + esc(l.p.name) + '</h4><small>' + esc(l.p.scent) + '</small><br>' +
      '<div class="qty"><button data-qty="' + l.p.slug + '" data-d="-1" aria-label="Decrease">−</button><span>' + l.qty + '</span><button data-qty="' + l.p.slug + '" data-d="1" aria-label="Increase">+</button></div>' +
      '<button class="link-btn" data-remove="' + l.p.slug + '">Remove</button></div><b>' + money(l.p.price * l.qty) + '</b></div>';
  }
  function updateBadge() {
    var c = $('#cartCount'); if (!c) return;
    var n = store.cart().reduce(function (a, l) { return a + l.qty; }, 0);
    c.textContent = n; c.style.display = n ? '' : 'none';
  }
  function openDrawer(which) {
    if (which === 'cart') renderCartDrawer();
    $('#overlay').classList.add('open');
    $(which === 'cart' ? '#cartDrawer' : '#menuDrawer').classList.add('open');
  }
  function closeDrawers() { $$('.drawer').forEach(function (d) { d.classList.remove('open'); }); $('#overlay') && $('#overlay').classList.remove('open'); }

  // ---------- pages ----------
  function pageHome() {
    var prods = store.products().filter(function (p) { return p.active; });
    var fav = prods.filter(function (p) { return p.featured; }).slice(0, 8);
    var strip = ['Find your scent. Light your mood.', 'Hand-poured in small batches', 'Clean-burning wax', 'Botanical fragrance oils', 'Every room has a fragrance. Find yours.'];
    var track = strip.map(function (s) { return '<span>' + s + '</span><b>✦</b>'; }).join('');
    return '<section class="hero"><div class="bgimg"><img src="/assets/img/hero.jpg" alt="" data-ph=""></div><div class="wrap inner">' +
      '<p class="eyebrow gold">MELTMARE · SCENTED CANDLES &amp; DÉCOR</p><h1>Warm light<br><em>for every room.</em></h1>' +
      '<p class="lead">Candles and décor from MELTMARE, made to make your space feel calm, personal and complete.</p>' +
      '<div class="cta"><a class="btn gold" href="/shop" data-link>Shop the collection →</a><a class="btn outline" href="/story" data-link>Our story</a></div></div><div class="mouse"></div></section>' +
      '<div class="marquee"><div class="track">' + track + track + '</div></div>' +
      '<section class="section"><div class="wrap"><div class="section-head reveal"><p class="eyebrow">THE EDIT</p><h2>Our favourites</h2></div><div class="grid reveal">' + fav.map(card).join('') + '</div>' +
      '<div class="center mt"><a class="text-link" href="/shop" data-link>View all products →</a></div></div></section>' +
      '<section class="section bg-beige"><div class="wrap"><div class="section-head reveal"><p class="eyebrow">SHOP BY SCENT</p><h2>Find your scent</h2><p>Every MELTMARE candle begins with a fragrance. Choose the mood first — the room follows.</p></div><div class="tiles reveal">' +
      SCENTS.map(function (s) { return '<a class="tile" href="/shop?scent=' + s + '" data-link><img src="/assets/img/scent-' + s.toLowerCase() + '.jpg" alt="" data-ph=""><div><h3>' + s + '</h3><span>EXPLORE</span></div></a>'; }).join('') + '</div></div></section>' +
      '<section class="promise"><div class="wrap cols">' + [[I.flame, 'Thoughtfully made', 'Designed with care, finished by hand'], [I.gift, 'Gift ready', 'Beautiful enough to give as it is'], [I.shield, 'Secure payment', 'Pay safely with UPI, cards or netbanking'], [I.box, 'Delivered with care', 'Packed to arrive in perfect condition']].map(function (x) { return '<div>' + x[0] + '<h4>' + x[1] + '</h4><p>' + x[2] + '</p></div>'; }).join('') + '</div></section>' +
      '<section class="section"><div class="wrap split"><div class="pic reveal"><img src="/assets/img/story.jpg" alt="" data-ph=""></div><div class="reveal"><p class="eyebrow">OUR STORY</p><h2>Made to be lit, kept and gifted</h2>' +
      '<p>Every candle starts with one question: what does this moment smell like? From cedar evenings to sea salt mornings, we choose the fragrance first and design everything else around it.</p><p>We keep our range small and our scents honest, so every candle is one you will want to light again.</p><a class="btn green" href="/story" data-link>Read our story</a></div></div></section>' +
      '<section class="section bg-beige"><div class="wrap"><div class="section-head reveal"><p class="eyebrow">SAMPLE REVIEWS</p><h2>Loved by our customers</h2></div><div class="reviews reveal">' +
      REVIEWS.map(function (r) { return '<div class="review"><div class="stars">★★★★★</div><p>“' + r[0] + '”</p><b>' + r[1].toUpperCase() + '</b></div>'; }).join('') + '</div></div></section>' +
      '<section class="section bg-deep news"><div class="wrap reveal"><p class="eyebrow gold">NEWSLETTER</p><h2>Join the MELTMARE circle</h2><p>New arrivals and offers, straight to your inbox.</p><form data-news><input type="email" required placeholder="Your email" aria-label="Email"><button class="btn gold">SUBSCRIBE</button></form></div></section>';
  }

  function pageShop() {
    var qs = new URLSearchParams(location.search), scent = qs.get('scent') || 'All', sort = qs.get('sort') || 'new';
    var items = store.products().filter(function (p) { return p.active && (scent === 'All' || p.scent === scent); });
    if (sort === 'asc') items.sort(function (a, b) { return a.price - b.price; });
    if (sort === 'desc') items.sort(function (a, b) { return b.price - a.price; });
    var chips = ['All'].concat(SCENTS).map(function (s) { return '<a class="chip ' + (s === scent ? 'on' : '') + '" href="/shop' + (s === 'All' ? '' : '?scent=' + s) + (sort !== 'new' ? (s === 'All' ? '?' : '&') + 'sort=' + sort : '') + '" data-link>' + s + '</a>'; }).join('');
    return '<div class="page-head"><p class="eyebrow">THE COLLECTION</p><h1>Shop all</h1><p>Everything MELTMARE, in one place.</p></div><div class="wrap"><div class="toolbar"><div class="chips" style="margin:0;justify-content:flex-start">' + chips + '</div>' +
      '<select id="sort" aria-label="Sort"><option value="new"' + (sort === 'new' ? ' selected' : '') + '>Newest</option><option value="asc"' + (sort === 'asc' ? ' selected' : '') + '>Price: low to high</option><option value="desc"' + (sort === 'desc' ? ' selected' : '') + '>Price: high to low</option></select></div>' +
      '<div class="grid">' + items.map(card).join('') + '</div><p class="center muted" style="margin:40px 0 80px">Showing ' + items.length + ' of ' + store.products().filter(function (p) { return p.active; }).length + '</p></div>';
  }

  function pageProduct(slug) {
    var p = find(slug);
    if (!p || !p.active) return page404();
    var more = store.products().filter(function (x) { return x.active && x.scent === p.scent && x.slug !== p.slug; }).slice(0, 4);
    var stock = p.stock <= 0 ? '<div class="stock out"><i></i>Sold out for now</div>' : p.stock <= 5 ? '<div class="stock low"><i></i>Only ' + p.stock + ' left</div>' : '<div class="stock"><i></i>In stock, ready to ship</div>';
    var tag = p.stock <= 0 ? 'SOLD OUT' : p.tag ? p.tag.toUpperCase() : '';
    var acc = [['Description', p.desc], ['Details', 'Scent family: ' + p.scent + '. Scent notes: ' + p.notes.join(', ') + '. Hand-poured in small batches.'], ['Delivery and returns', 'Orders are packed within 2 working days and delivered in 3 to 7 working days. Delivery is free above ₹' + FREE_SHIP + '. Damaged or wrong items are replaced or refunded if reported within 7 days with photos. Used candles cannot be returned.']];
    return '<div class="wrap"><div class="crumbs"><a href="/" data-link>Home</a> / <a href="/shop" data-link>Shop</a> / <a href="/shop?scent=' + p.scent + '" data-link>' + p.scent + '</a> / ' + esc(p.name) + '</div>' +
      '<div class="pdp"><div class="gallery">' + (tag ? '<span class="tag' + (p.stock <= 0 ? ' red' : '') + '">' + tag + '</span>' : '') + imgTag(p) + '</div><div>' +
      '<p class="eyebrow">' + p.scent.toUpperCase() + '</p><h1>' + esc(p.name) + '</h1><div class="notes-row">' + p.notes.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') + '</div>' +
      '<div class="price">' + money(p.price) + '</div><p class="muted" style="font-size:17px;margin:0">' + esc(p.desc) + '</p>' + stock +
      '<div class="buy"><div class="qty"><button id="qm" aria-label="Decrease">−</button><span id="qv">1</span><button id="qp" aria-label="Increase">+</button></div><button class="btn green" style="flex:1" id="addBtn" data-slug="' + p.slug + '"' + (p.stock <= 0 ? ' disabled' : '') + '>' + (p.stock <= 0 ? 'Sold out' : 'Add to cart') + '</button></div>' +
      '<div class="assure"><span>✓ Free delivery above ₹' + FREE_SHIP + '</span><span>✓ Easy replacement for transit damage</span></div>' +
      '<div class="acc">' + acc.map(function (a, i) { return '<button class="' + (i === 0 ? 'open' : '') + '" data-acc>' + a[0] + '</button><div class="panel">' + esc(a[1]) + '</div>'; }).join('') + '</div></div></div>' +
      (more.length ? '<div style="padding-bottom:80px"><div class="section-head"><p class="eyebrow">MORE ' + p.scent.toUpperCase() + ' SCENTS</p><h2>You may also like</h2></div><div class="grid">' + more.map(card).join('') + '</div></div>' : '') + '</div>';
  }

  function pageStory() {
    return '<div class="page-head"><p class="eyebrow">SINCE THE FIRST POUR</p><h1>Our story</h1></div><div class="prose"><p style="font-size:21px;font-family:var(--serif)">MELTMARE began with a simple idea: a candle should do more than light a room. It should change how the room feels.</p>' +
      '<p>Every candle starts with one question: what does this moment smell like? From cedar evenings to sea salt mornings, we choose the fragrance first and design everything else around it. The wax, the wick, the jar — each one exists to carry the scent, never to shout over it.</p>' +
      '<p>We keep our range small and our scents honest, so every candle is one you will want to light again. Light one, breathe in, and let the room do the rest.</p><div class="quote">“Scent first, everything else follows.”</div>' +
      '<div class="center"><p class="eyebrow">Shop by scent</p><div class="chips">' + SCENTS.map(function (s) { return '<a class="chip" href="/shop?scent=' + s + '" data-link>' + s + '</a>'; }).join('') + '</div></div></div>';
  }

  function pageContact() {
    var row = function (k, v) { return '<div style="margin-bottom:20px"><p class="eyebrow" style="margin-bottom:4px">' + k + '</p><div>' + v + '</div></div>'; };
    return '<div class="page-head"><p class="eyebrow">CONTACT</p><h1>Say hello</h1><p>Questions about a scent, an order or a gift? Write to us and we will reply within 1 working day.</p></div><div class="wrap"><div class="two-col" style="grid-template-columns:1fr">' +
      '<div class="split" style="align-items:start"><div>' + row('EMAIL', esc(INFO.email)) + (INFO.phone ? row('PHONE', esc(INFO.phone)) : '') + (INFO.address ? row('ADDRESS', esc(INFO.address)) : '') + (INFO.hours ? row('HOURS', esc(INFO.hours)) : '') + '</div>' +
      '<form class="panel-box" id="contactForm"><div class="field"><label>Name</label><input type="text" name="name" required></div><div class="form-grid two"><div class="field"><label>Email</label><input type="email" name="email" required></div><div class="field"><label>Phone</label><input type="tel" name="phone"></div></div><div class="field"><label>Message</label><textarea name="message" required></textarea></div><button class="btn green">Send message</button></form></div></div></div>';
  }

  function pageFaq() {
    return '<div class="page-head"><p class="eyebrow">HELP</p><h1>Frequently asked questions</h1><p>Scents, delivery, payments, gifting and returns — answered simply.</p></div><div class="faq"><div class="acc wrap" style="width:100%">' +
      FAQ.map(function (f) { return '<button data-acc data-single>' + esc(f[0]) + '</button><div class="panel">' + esc(f[1]) + '</div>'; }).join('') + '</div></div>';
  }

  function pageCare() {
    var steps = ['Trim the wick to about 5 mm before every burn', 'On the first burn, let the wax melt right to the edge of the jar, usually 2 to 3 hours', 'Burn for no more than 4 hours at a time', 'Keep the candle away from drafts, children, pets and anything that can catch fire', 'Stop using it when about 1 cm of wax is left'];
    return '<div class="page-head"><p class="eyebrow">CANDLE CARE</p><h1>Burn it right</h1><p>A few simple habits help every MELTMARE candle burn cleaner, longer and safer.</p></div><div class="steps wrap">' +
      steps.map(function (s, i) { return '<div class="step"><i>' + (i + 1) + '</i><p>' + s + '</p></div>'; }).join('') + '</div>';
  }

  function pagePolicy(key) {
    var pol = POLICIES[key]; if (!pol) return page404();
    return '<div class="page-head"><p class="eyebrow">MELTMARE POLICIES</p><h1>' + pol[0] + '</h1></div><div class="prose">' + (INFO.policiesReviewed ? '' : '<span class="draft">Draft policy — to be reviewed before launch.</span>') + pol[1].map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</div>';
  }

  function page404() {
    return '<div class="empty" style="padding:120px 16px"><p class="eyebrow">404</p><p>This page has gone missing</p><a class="btn green" href="/" data-link>Back to home</a></div>';
  }

  function pageCart() {
    var lines = cartLines(), sub = subtotal(), ship = delivery(sub);
    if (!lines.length) return '<div class="page-head"><p class="eyebrow">YOUR SELECTION</p><h1>Cart</h1></div><div class="empty"><p>Your cart is empty</p><p style="font-size:18px" class="muted">Light one. Breathe in. Stay a while.</p><a class="btn green" href="/shop" data-link>Start shopping</a></div>';
    return '<div class="page-head"><p class="eyebrow">YOUR SELECTION</p><h1>Cart</h1></div><div class="wrap two-col"><div>' + lines.map(lineHtml).join('') + '</div>' + summary(sub, ship, '<a class="btn green block" href="/checkout" data-link>Checkout</a><a class="btn outline-dark block" href="/shop" data-link>Continue shopping</a>') + '</div>';
  }
  function summary(sub, ship, extra) {
    return '<div class="panel-box" style="align-self:start"><h3>Order summary</h3><div class="totals"><div><span>Subtotal</span><span>' + money(sub) + '</span></div><div><span>Delivery</span><span>' + (ship ? money(ship) : 'Free') + '</span></div><div class="grand"><span>Total</span><span>' + money(sub + ship) + '</span></div></div><div style="display:grid;gap:12px;margin-top:20px">' + (extra || '') + '</div></div>';
  }

  function pageLogin() {
    if (store.user()) { go(safeNext(new URLSearchParams(location.search).get('next') || '/account'), true); return ''; }
    return '<div class="auth"><h1>Welcome to MELTMARE</h1><p class="muted">Sign in with your email or phone number</p><div class="tabs"><button class="on" data-mode="email">EMAIL</button><button data-mode="phone">PHONE</button></div>' +
      '<form id="loginForm"><div class="field" id="idField"><label id="idLabel">Email</label><input type="email" id="idInput" required autocomplete="email"></div>' +
      '<div id="otpBox" style="display:none"><label>Enter the 6 digit code</label><div class="otp">' + [0, 1, 2, 3, 4, 5].map(function () { return '<input type="text" inputmode="numeric" maxlength="1" aria-label="Digit">'; }).join('') + '</div><p class="note" id="otpNote"></p><button type="button" class="link-btn" id="resendBtn" style="display:none">Resend code</button></div>' +
      '<div id="nameField" class="field" style="display:none"><label>Your name</label><input type="text" id="nameInput" autocomplete="name" maxlength="80"></div><div class="err" id="loginErr"></div>' +
      '<button class="btn green block" id="loginBtn">Send OTP</button></form><p class="note" style="margin-top:20px">New here? Just enter your email or phone. We will create your account when you verify the code.</p></div>';
  }

  function accountShell(u, tab, body) {
    return '<div class="page-head"><p class="eyebrow">MY ACCOUNT</p><h1>Hello, ' + esc(u.name || 'there') + '</h1></div><div class="wrap" style="padding-bottom:80px"><div class="chips"><a class="chip ' + (tab === 'orders' ? 'on' : '') + '" href="/account" data-link>Orders</a><a class="chip ' + (tab === 'profile' ? 'on' : '') + '" href="/account?tab=profile" data-link>Profile</a></div><div style="max-width:760px;margin:0 auto">' + body + '</div></div>';
  }
  function pageAccount() {
    var u = store.user();
    if (!u) { go('/login?next=/account', true); return ''; }
    var tab = new URLSearchParams(location.search).get('tab') || 'orders';
    if (tab === 'profile') {
      return loadMe().then(function () {
        u = store.user(); if (!u) { go('/login?next=/account', true); return ''; }
        return accountShell(u, tab, profileHtml(u));
      });
    }
    return api('GET', '/api/orders').then(function (j) {
      return accountShell(u, tab, j.orders.length ? j.orders.map(orderRow).join('') : '<div class="empty" style="padding:32px 0"><p>No orders yet</p><a class="btn green" href="/shop" data-link>Start shopping</a></div>');
    });
  }
  function profileHtml(u) {
    return '<form class="panel-box" id="profileForm" style="max-width:520px"><div class="field"><label>Name</label><input type="text" name="name" required maxlength="80" value="' + esc(u.name) + '"></div><div class="field"><label>Email</label><input type="email" name="email" value="' + esc(u.email || '') + '"></div><div class="field"><label>Phone</label><input type="tel" name="phone" pattern="[0-9]{10}" title="Enter a valid 10 digit phone number" value="' + esc(u.phone || '') + '"></div><div class="field"><label>Saved address</label><textarea name="address" maxlength="300">' + esc(u.address || '') + '</textarea></div><div class="err" id="profileErr"></div><div style="display:flex;gap:10px"><button class="btn green">Save</button><button type="button" class="btn outline-dark" id="logout">Log out</button></div></form>';
  }
  function orderRow(o) {
    var steps = ['Paid', 'Packed', 'Shipped', 'Delivered'], idx = steps.indexOf(o.status);
    var tl = idx < 0 ? '' : '<div class="timeline">' + steps.map(function (s, i) { return '<i class="' + (i <= idx ? 'on' : '') + '" title="' + s + '"></i>'; }).join('') + '</div>';
    var pay = o.status === 'Pending payment' ? '<div style="margin-top:12px"><button class="btn green" data-pay="' + esc(o.id) + '" style="padding:10px 18px">Complete payment</button></div>' : '';
    return '<div class="order" style="display:block"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><b>' + esc(o.number) + '</b><div class="note">' + new Date(o.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '</div></div><div style="text-align:right"><span class="status ' + o.status.split(' ')[0] + '">' + CUSTOMER_STATUS[o.status] + '</span><div style="margin-top:6px;font-weight:600">' + money(o.total) + '</div></div></div>' + tl +
      '<div class="note">' + o.items.map(function (i) { return esc(i.name) + ' × ' + i.qty; }).join(', ') + '</div><div class="note" style="margin-top:6px">Deliver to: ' + esc(o.address.name) + ', ' + esc(o.address.line) + ', ' + esc(o.address.city) + ' ' + esc(o.address.pin) + '</div>' +
      (o.tracking ? '<div class="note" style="margin-top:6px">Tracking: <b>' + esc(o.tracking) + '</b></div>' : '') + pay + '</div>';
  }

  function pageCheckout() {
    var u = store.user();
    if (!u) { go('/login?next=/checkout', true); return ''; }
    var lines = cartLines(); if (!lines.length) return pageCart();
    var sub = subtotal(), ship = delivery(sub);
    var states = ['Andhra Pradesh', 'Delhi', 'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Maharashtra', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal', 'Other'];
    return '<div class="page-head"><p class="eyebrow">ALMOST THERE</p><h1>Checkout</h1></div><div class="wrap two-col"><form class="panel-box" id="checkoutForm"><h3>Delivery details</h3>' +
      '<div class="field"><label>Full name</label><input type="text" name="name" required value="' + esc(u.name || '') + '"></div><div class="field"><label>Phone</label><input type="tel" name="phone" required pattern="[0-9]{10}" title="Enter a valid 10 digit phone number" value="' + esc(u.phone || '') + '"></div>' +
      '<div class="field"><label>Address</label><input type="text" name="line" required value="' + esc(u.address || '') + '"></div><div class="form-grid two"><div class="field"><label>City</label><input type="text" name="city" required></div><div class="field"><label>State</label><select name="state" style="width:100%">' + states.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label>Pincode</label><input type="text" name="pin" required pattern="[0-9]{6}" title="Please enter a valid 6 digit pincode" inputmode="numeric"></div>' +
      '<div class="err" id="payErr"></div><button class="btn green block" id="payBtn">Pay ' + money(sub + ship) + ' securely</button><p class="note center" style="margin-top:12px">Payments are processed securely by Cashfree</p></form>' + summary(sub, ship, lines.map(function (l) { return '<div style="display:flex;justify-content:space-between;font-size:14px"><span>' + esc(l.p.name) + ' × ' + l.qty + '</span><span>' + money(l.p.price * l.qty) + '</span></div>'; }).join('')) + '</div>';
  }

  var pollTimer = null, pollCount = 0;
  function pageConfirm(id) {
    if (!store.user()) { go('/login?next=/order/' + id, true); return ''; }
    return api('GET', '/api/orders/' + encodeURIComponent(id)).then(function (j) {
      var o = j.order, u = store.user() || {}, first = esc((u.name || 'friend').split(' ')[0]);
      var links = '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a class="btn green" href="/account" data-link>View my orders</a><a class="btn outline-dark" href="/shop" data-link>Continue shopping</a></div>';
      if (['Paid', 'Packed', 'Shipped', 'Delivered'].indexOf(o.status) > -1) {
        store.saveCart([]);
        return '<div class="empty" style="padding:96px 16px"><p class="eyebrow">ORDER CONFIRMED</p><h1 style="font-size:52px">Thank you, ' + first + '</h1><p style="font-size:20px" class="muted">Your order <b>' + esc(o.number) + '</b> is confirmed. We will let you know when it ships.</p>' + links + '</div>';
      }
      if (o.status === 'Pending payment') {
        if (pollCount < 6) { pollCount += 1; pollTimer = setTimeout(function () { if (location.pathname === '/order/' + id) route(); }, 5000); }
        return '<div class="empty" style="padding:96px 16px"><p class="eyebrow">WAITING FOR PAYMENT</p><h1 style="font-size:46px">Almost there, ' + first + '</h1><p style="font-size:20px" class="muted">We have not received the payment for order <b>' + esc(o.number) + '</b> yet. If you have just paid, this page updates by itself in a few seconds.</p>' +
          '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><button class="btn green" data-pay="' + esc(o.id) + '">Complete payment</button><a class="btn outline-dark" href="/account" data-link>My orders</a></div><p class="note" style="margin-top:20px">Unpaid orders are released automatically after 30 minutes.</p></div>';
      }
      return '<div class="empty" style="padding:96px 16px"><p class="eyebrow">ORDER CANCELLED</p><h1 style="font-size:46px">This order was cancelled</h1><p style="font-size:20px" class="muted">Order <b>' + esc(o.number) + '</b> was not completed, so you have not been charged. If money was deducted, it is returned by your bank within a few working days.</p>' + links + '</div>';
    }, function (e) { if (e.status === 404) return page404(); throw e; });
  }

  // ---------- admin ----------
  function adminLoginHtml() {
    return '<div class="admin" style="display:grid;place-items:center;padding:24px"><form id="adminLogin" class="panel-box" style="width:min(420px,100%)"><p class="eyebrow">MELTMARE ADMIN</p><h3 style="font-size:30px">Sign in to manage the store</h3><div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username"></div><div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password"></div><div class="err" id="adminErr"></div><button class="btn green block">Sign in</button></form></div>';
  }
  function adminFrame(tab, body) {
    var tabs = ['dashboard', 'products', 'orders', 'messages'].map(function (t) { return '<a class="chip ' + (t === tab ? 'on' : '') + '" href="/admin?tab=' + t + '" data-link style="text-transform:capitalize">' + t + '</a>'; }).join('');
    return '<div class="admin"><div class="admin-top"><div class="wrap row"><b>MELTMARE Admin</b><div><a class="btn outline" href="/" data-link style="padding:8px 16px">View store</a> <button class="btn outline" id="adminOut" style="padding:8px 16px">Sign out</button></div></div></div><div class="wrap"><div class="admin-nav">' + tabs + '</div>' + body + '<div style="height:60px"></div></div></div>';
  }
  function pageAdmin() {
    return api('GET', '/api/admin/me').then(function (j) {
      if (!j.admin) return adminLoginHtml();
      var tab = new URLSearchParams(location.search).get('tab') || 'dashboard';
      return adminBody(tab).then(function (body) { return adminFrame(tab, body); });
    });
  }
  function adminBody(tab) {
    if (tab === 'dashboard') {
      return api('GET', '/api/admin/summary').then(function (s) {
        var st = function (v, l) { return '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>'; };
        return '<div class="stats">' + st(s.ordersToday, 'Orders today') + st(money(s.revenueToday), 'Revenue today') + st(s.toPack, 'To pack') + st(s.lowStock, 'Low stock') + '</div><div class="stats">' + st(money(s.revenueTotal), 'Total revenue') + st(s.customers, 'Customers') + '</div><p class="muted">Use the tabs above to manage products, orders and messages.</p>';
      });
    }
    if (tab === 'products') {
      return api('GET', '/api/admin/products').then(function (j) {
        var rows = j.products.map(function (p) {
          return '<tr><td><div style="display:flex;gap:10px;align-items:center"><div style="width:48px;height:48px;border-radius:6px;overflow:hidden;background:#eee;flex:none">' + imgTag(p) + '</div><div><b>' + esc(p.name) + '</b><br><label class="note" style="cursor:pointer;text-decoration:underline">Change photo<input type="file" accept="image/jpeg,image/png,image/webp" data-img="' + p.slug + '" style="display:none"></label></div></div></td><td>' + esc(p.scent) + '</td>' +
            '<td><input type="number" min="1" data-pf="price" data-slug="' + p.slug + '" value="' + p.price + '"></td><td><input type="number" min="0" data-pf="stock" data-slug="' + p.slug + '" value="' + p.stock + '"></td>' +
            '<td><input type="checkbox" data-pf="featured" data-slug="' + p.slug + '"' + (p.featured ? ' checked' : '') + '></td><td><input type="checkbox" data-pf="active" data-slug="' + p.slug + '"' + (p.active ? ' checked' : '') + '></td></tr>';
        }).join('');
        var add = '<form class="panel-box" id="addProduct" style="margin-top:32px"><h3>Add a product</h3><div class="form-grid two"><div class="field"><label>Name</label><input type="text" name="name" required maxlength="80"></div><div class="field"><label>Scent family</label><select name="scent" style="width:100%">' + SCENTS.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div></div>' +
          '<div class="form-grid two"><div class="field"><label>Price (₹)</label><input type="number" name="price" min="1" required></div><div class="field"><label>Stock</label><input type="number" name="stock" min="0" required value="10"></div></div>' +
          '<div class="form-grid two"><div class="field"><label>Scent notes (comma separated)</label><input type="text" name="notes" placeholder="Cedarwood, Amber"></div><div class="field"><label>Tag (optional)</label><input type="text" name="tag" maxlength="24" placeholder="New"></div></div>' +
          '<div class="field"><label>Description</label><textarea name="desc" maxlength="600"></textarea></div><div class="field"><label>Photo (JPG, PNG or WebP, up to 5 MB)</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></div><div class="err" id="addErr"></div><button class="btn green">Add product</button></form>';
        return '<div class="table-wrap"><table><tr><th>Product</th><th>Scent</th><th>Price</th><th>Stock</th><th>Featured</th><th>Active</th></tr>' + rows + '</table></div>' + add;
      });
    }
    if (tab === 'orders') {
      return api('GET', '/api/admin/orders').then(function (j) {
        if (!j.orders.length) return '<p class="muted">No orders yet.</p>';
        return '<div class="table-wrap"><table><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Tracking</th></tr>' + j.orders.map(function (o) {
          var opts = o.status === 'Pending payment' ? ['Pending payment', 'Cancelled'] : o.status === 'Cancelled' ? ['Cancelled'] : ['Paid', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
          return '<tr><td><b>' + esc(o.number) + '</b><br><span class="note">' + new Date(o.created).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</span></td>' +
            '<td>' + esc(o.address.name) + '<br><span class="note">' + esc(o.address.phone) + (o.customer.email ? '<br>' + esc(o.customer.email) : '') + '<br>' + esc(o.address.line) + ', ' + esc(o.address.city) + ' ' + esc(o.address.pin) + '</span></td>' +
            '<td>' + o.items.map(function (i) { return esc(i.name) + ' × ' + i.qty; }).join('<br>') + (o.note ? '<br><span class="note" style="color:#B3402F">' + esc(o.note) + '</span>' : '') + '</td><td>' + money(o.total) + '</td>' +
            '<td><select data-status="' + esc(o.id) + '"' + (o.status === 'Cancelled' ? ' disabled' : '') + '>' + opts.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td>' +
            '<td><input type="text" data-track="' + esc(o.id) + '" value="' + esc(o.tracking || '') + '" placeholder="Courier + AWB" maxlength="200"></td></tr>';
        }).join('') + '</table></div>';
      });
    }
    return api('GET', '/api/admin/messages').then(function (j) {
      return j.messages.length ? '<div class="table-wrap"><table><tr><th>From</th><th>Message</th><th>Date</th></tr>' + j.messages.map(function (m) { return '<tr><td>' + esc(m.name) + '<br><span class="note">' + esc(m.email) + (m.phone ? '<br>' + esc(m.phone) : '') + '</span></td><td>' + esc(m.message) + '</td><td>' + new Date(m.created).toLocaleDateString('en-IN') + '</td></tr>'; }).join('') + '</table></div>' : '<p class="muted">No messages yet.</p>';
    });
  }

  // ---------- payment ----------
  function loadCashfree() {
    if (window.Cashfree) return Promise.resolve(window.Cashfree);
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      s.onload = function () { window.Cashfree ? res(window.Cashfree) : rej(new Error('We could not load the payment page. Please try again.')); };
      s.onerror = function () { rej(new Error('We could not load the payment page. Please check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  function startPayment(order, payment) {
    if (payment.mode === 'mock') { window.__mm.navigate('/mock-pay/' + order.id); return Promise.resolve(); }
    return loadCashfree().then(function (CF) {
      return CF({ mode: payment.mode === 'production' ? 'production' : 'sandbox' }).checkout({ paymentSessionId: payment.paymentSessionId, redirectTarget: '_self' });
    });
  }
  function payAgain(btn) {
    btn.disabled = true;
    api('POST', '/api/orders/' + encodeURIComponent(btn.dataset.pay) + '/pay').then(function (j) { return startPayment(j.order, j.payment); })
      .catch(function (x) { btn.disabled = false; toast(x.message); route(); });
  }
  function placeOrder(form) {
    var d = Object.fromEntries(new FormData(form)), lines = cartLines();
    if (!lines.length) return;
    var btn = $('#payBtn'), err = $('#payErr'), label = btn.textContent;
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Starting secure payment…';
    api('POST', '/api/orders', { items: lines.map(function (l) { return { slug: l.p.slug, qty: l.qty }; }), address: { name: d.name, phone: d.phone, line: d.line, city: d.city, state: d.state, pin: d.pin } })
      .then(function (j) { return startPayment(j.order, j.payment); })
      .catch(function (x) {
        btn.disabled = false; btn.textContent = label;
        if (x.status === 401) { S.user = null; go('/login?next=/checkout'); return; }
        if (x.status === 400 && /available|sold out|left/.test(x.message)) {
          // stock changed: refresh the catalogue and trim the cart, then show the message
          loadCatalogue().then(function () {
            store.saveCart(store.cart().map(function (l) { var p = find(l.slug); return p && p.stock > 0 ? { slug: l.slug, qty: Math.min(l.qty, p.stock) } : null; }).filter(Boolean));
            route(); toast(x.message);
          });
          return;
        }
        err.textContent = x.message;
      });
  }

  // ---------- router ----------
  var TITLES = { '/': 'MELTMARE: Scented Candles for Every Mood', '/shop': 'Shop Scented Candles, MELTMARE', '/story': 'Our Story, MELTMARE', '/contact': 'Contact, MELTMARE', '/faq': 'Help and FAQ, MELTMARE', '/candle-care': 'How to Burn a Candle, MELTMARE', '/cart': 'Your Cart, MELTMARE', '/login': 'Sign In, MELTMARE', '/account': 'My Account, MELTMARE', '/checkout': 'Checkout, MELTMARE', '/admin': 'Admin, MELTMARE' };
  var routeSeq = 0;

  function go(url, replace) { if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url); var p = route(); window.scrollTo(0, 0); return p; }

  function errorPage(e) {
    return '<div class="empty" style="padding:120px 16px"><p class="eyebrow">OOPS</p><p>' + esc(e && e.status ? e.message : 'We could not load this page. Please check your connection.') + '</p><button class="btn green" id="retry">Try again</button></div>';
  }

  function route() {
    var seq = ++routeSeq, path = location.pathname.replace(/\/+$/, '') || '/', out, m, isAdmin = false;
    clearTimeout(pollTimer); if (!/^\/order\//.test(path)) pollCount = 0;
    if (path === '/') out = pageHome();
    else if (path === '/shop') out = pageShop();
    else if ((m = path.match(/^\/product\/([\w-]+)$/))) out = pageProduct(m[1]);
    else if (path === '/story') out = pageStory();
    else if (path === '/contact') out = pageContact();
    else if (path === '/faq') out = pageFaq();
    else if (path === '/candle-care') out = pageCare();
    else if ((m = path.match(/^\/policies\/(\w+)$/))) out = pagePolicy(m[1]);
    else if (path === '/cart') out = pageCart();
    else if (path === '/login') out = pageLogin();
    else if (path === '/account') out = pageAccount();
    else if (path === '/checkout') out = pageCheckout();
    else if ((m = path.match(/^\/order\/([\w-]+)$/))) out = pageConfirm(m[1]);
    else if (path === '/admin') { out = pageAdmin(); isAdmin = true; }
    else out = page404();
    return Promise.resolve(out).catch(function (e) { return errorPage(e); }).then(function (html) {
      if (seq !== routeSeq || html === '') return;
      if (isAdmin) { $('#app').innerHTML = html; document.title = TITLES['/admin']; bind(); return; }
      $('#app').innerHTML = shell(html);
      renderCartDrawer();
      var pr = (m = path.match(/^\/product\/([\w-]+)$/)) && find(m[1]);
      document.title = pr ? pr.name + ', scented candle | MELTMARE' : TITLES[path] || (path.indexOf('/policies') === 0 ? 'Policies, MELTMARE' : 'MELTMARE');
      bind();
      var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.08 }) : null;
      $$('.reveal').forEach(function (el) { io ? io.observe(el) : el.classList.add('in'); });
    });
  }

  // ---------- events ----------
  function readImage(file) {
    return new Promise(function (res, rej) {
      if (!file) return res(null);
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return rej(new Error('Please choose a JPG, PNG or WebP image'));
      if (file.size > 5 * 1024 * 1024) return rej(new Error('That image is larger than 5 MB'));
      var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('Could not read that image')); }; r.readAsDataURL(file);
    });
  }
  function uploadImage(file) {
    return readImage(file).then(function (data) { return data ? api('POST', '/api/admin/upload', { data: data }).then(function (j) { return j.url; }) : ''; });
  }

  function bind() {
    var overlay = $('#overlay'); if (overlay) overlay.onclick = closeDrawers;
    var rt = $('#retry'); if (rt) rt.onclick = function () { Promise.all([loadCatalogue(), loadMe()]).then(route, route); };
    var sb = $('#searchBtn'); if (sb) sb.onclick = function () { var bar = $('#searchbar'); bar.classList.toggle('open'); if (bar.classList.contains('open')) $('#searchInput').focus(); };
    var si = $('#searchInput'); if (si) si.oninput = function () {
      var q = si.value.trim().toLowerCase(), out = $('#searchResults');
      out.innerHTML = q ? store.products().filter(function (p) { return p.active && (p.name + ' ' + p.scent + ' ' + p.notes.join(' ')).toLowerCase().indexOf(q) > -1; }).slice(0, 6).map(function (p) { return '<a href="/product/' + p.slug + '" data-link>' + esc(p.name) + ' · ' + p.scent + '</a>'; }).join('') || '<span class="note" style="color:#fffdf8;padding:8px 12px">No candles found</span>' : '';
    };
    var sort = $('#sort'); if (sort) sort.onchange = function () { var q = new URLSearchParams(location.search); q.set('sort', sort.value); go('/shop?' + q.toString()); };
    var ab = $('#addBtn'); if (ab) {
      var qv = 1, label = $('#qv');
      $('#qm').onclick = function () { qv = Math.max(1, qv - 1); label.textContent = qv; };
      $('#qp').onclick = function () { var p = find(ab.dataset.slug); qv = Math.min(p.stock, qv + 1); label.textContent = qv; };
      ab.onclick = function () { addToCart(ab.dataset.slug, qv); };
    }
    $$('[data-news]').forEach(function (f) {
      f.onsubmit = function (e) {
        e.preventDefault();
        api('POST', '/api/subscribe', { email: f.querySelector('input').value }).then(function () { f.reset(); toast('You are in. Welcome to the MELTMARE circle'); }, function (x) { toast(x.message); });
      };
    });
    var cf = $('#contactForm'); if (cf) cf.onsubmit = function (e) {
      e.preventDefault();
      api('POST', '/api/contact', Object.fromEntries(new FormData(cf))).then(function () { cf.reset(); toast('Thank you, we will get back to you soon'); }, function (x) { toast(x.message); });
    };
    var lf = $('#loginForm'); if (lf) bindLogin(lf);
    var pf = $('#profileForm'); if (pf) pf.onsubmit = function (e) {
      e.preventDefault(); $('#profileErr').textContent = '';
      api('PATCH', '/api/me', Object.fromEntries(new FormData(pf))).then(function (j) { S.user = j.user; toast('Your details are saved'); }, function (x) { $('#profileErr').textContent = x.message; });
    };
    var lo = $('#logout'); if (lo) lo.onclick = function () { api('POST', '/api/auth/logout', {}).then(function () { S.user = null; go('/'); }); };
    var ck = $('#checkoutForm'); if (ck) ck.onsubmit = function (e) { e.preventDefault(); placeOrder(ck); };

    // admin
    var al = $('#adminLogin'); if (al) al.onsubmit = function (e) {
      e.preventDefault();
      api('POST', '/api/admin/login', Object.fromEntries(new FormData(al))).then(function () { route(); }, function (x) { $('#adminErr').textContent = x.message; });
    };
    var ao = $('#adminOut'); if (ao) ao.onclick = function () { api('POST', '/api/admin/logout', {}).then(route); };
    $$('[data-pf]').forEach(function (inp) {
      inp.onchange = function () {
        var body = {}; body[inp.dataset.pf] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
        api('PATCH', '/api/admin/products/' + inp.dataset.slug, body).then(function () { toast('Product saved'); }, function (x) { toast(x.message); route(); });
      };
    });
    $$('[data-img]').forEach(function (inp) {
      inp.onchange = function () {
        uploadImage(inp.files[0]).then(function (url) { return url && api('PATCH', '/api/admin/products/' + inp.dataset.img, { image: url }); }).then(function () { toast('Photo updated'); route(); }, function (x) { toast(x.message); });
      };
    });
    var ap = $('#addProduct'); if (ap) ap.onsubmit = function (e) {
      e.preventDefault(); var err = $('#addErr'); err.textContent = '';
      var d = Object.fromEntries(new FormData(ap)); var file = ap.querySelector('[name=photo]').files[0];
      uploadImage(file).then(function (url) { delete d.photo; if (url) d.image = url; return api('POST', '/api/admin/products', d); })
        .then(function () { toast('Product added'); route(); }, function (x) { err.textContent = x.message; });
    };
    $$('[data-status]').forEach(function (s) {
      s.onchange = function () {
        if (s.value === 'Cancelled' && !window.confirm('Cancel this order? Reserved stock is returned. Any refund must be issued from your Cashfree dashboard.')) { route(); return; }
        api('PATCH', '/api/admin/orders/' + s.dataset.status, { status: s.value }).then(function () { toast('Order status updated to ' + s.value); if (s.value === 'Cancelled') route(); }, function (x) { toast(x.message); route(); });
      };
    });
    $$('[data-track]').forEach(function (inp) {
      inp.onchange = function () { api('PATCH', '/api/admin/orders/' + inp.dataset.track, { tracking: inp.value }).then(function () { toast('Tracking saved'); }, function (x) { toast(x.message); }); };
    });
  }

  function bindLogin(lf) {
    var st = { mode: 'email', step: 1, id: '' };
    var idInput = $('#idInput'), label = $('#idLabel'), btn = $('#loginBtn'), err = $('#loginErr'), note = $('#otpNote'), resend = $('#resendBtn'), otp = $$('.otp input'), resendTimer;
    var next = safeNext(new URLSearchParams(location.search).get('next'));
    $$('.tabs button').forEach(function (b) {
      b.onclick = function () {
        if (st.step !== 1) return;
        st.mode = b.dataset.mode; $$('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
        label.textContent = st.mode === 'email' ? 'Email' : 'Phone number';
        idInput.type = st.mode === 'email' ? 'email' : 'tel'; idInput.value = ''; idInput.pattern = st.mode === 'phone' ? '[0-9]{10}' : ''; idInput.title = 'Please enter a valid 10 digit phone number';
        idInput.autocomplete = st.mode === 'email' ? 'email' : 'tel'; err.textContent = '';
      };
    });
    otp.forEach(function (o, i) {
      o.oninput = function () { o.value = o.value.replace(/\D/g, ''); if (o.value && otp[i + 1]) otp[i + 1].focus(); };
      o.onkeydown = function (e) { if (e.key === 'Backspace' && !o.value && otp[i - 1]) otp[i - 1].focus(); };
      o.onpaste = function (e) {
        var t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6); if (!t) return;
        e.preventDefault(); otp.forEach(function (x, k) { x.value = t.charAt(k) || ''; }); (otp[Math.min(t.length, 5)]).focus();
      };
    });
    function armResend() { resend.style.display = 'none'; clearTimeout(resendTimer); resendTimer = setTimeout(function () { resend.style.display = ''; }, 30000); }
    function request() {
      return api('POST', '/api/auth/request', { mode: st.mode, id: st.id }).then(function (j) {
        note.textContent = 'We sent a 6 digit code to ' + st.id + (j.devOtp ? '. Test mode: your code is ' + j.devOtp : '');
        armResend();
      });
    }
    resend.onclick = function () { err.textContent = ''; request().then(function () { toast('A new code is on its way'); }, function (x) { err.textContent = x.message; }); };
    lf.onsubmit = function (e) {
      e.preventDefault(); err.textContent = '';
      if (st.step === 1) {
        st.id = idInput.value.trim(); btn.disabled = true; btn.textContent = 'Sending…';
        request().then(function () {
          st.step = 2; $('#otpBox').style.display = ''; idInput.readOnly = true; btn.disabled = false; btn.textContent = 'Verify and continue'; otp[0].focus();
        }, function (x) { btn.disabled = false; btn.textContent = 'Send OTP'; err.textContent = x.message; });
      } else {
        var code = otp.map(function (o) { return o.value; }).join('');
        if (code.length !== 6) { err.textContent = 'Please enter the 6 digit code'; return; }
        btn.disabled = true; btn.textContent = 'Checking…';
        api('POST', '/api/auth/verify', { mode: st.mode, id: st.id, code: code, name: $('#nameInput').value.trim() }).then(function (j) {
          S.user = j.user; go(next);
        }, function (x) {
          btn.disabled = false; btn.textContent = 'Verify and continue';
          if (x.data && x.data.needName) { $('#nameField').style.display = ''; $('#nameInput').focus(); err.textContent = 'Welcome! Tell us your name to finish.'; }
          else err.textContent = x.message;
        });
      }
    };
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t.closest('a[data-link]');
    if (a && !e.metaKey && !e.ctrlKey && a.target !== '_blank') {
      e.preventDefault(); closeDrawers(); go(a.getAttribute('href')); return;
    }
    var open = t.closest('[data-open]'); if (open) { openDrawer(open.dataset.open === 'cart' ? 'cart' : 'menu'); return; }
    if (t.closest('[data-close]')) { closeDrawers(); return; }
    var add = t.closest('[data-add]'); if (add) { e.preventDefault(); addToCart(add.dataset.add, 1); return; }
    var q = t.closest('[data-qty]'); if (q) { var l = store.cart().filter(function (x) { return x.slug === q.dataset.qty; })[0]; setQty(q.dataset.qty, (l ? l.qty : 0) + Number(q.dataset.d)); return; }
    var r = t.closest('[data-remove]'); if (r) { setQty(r.dataset.remove, 0); return; }
    var pay = t.closest('[data-pay]'); if (pay) { e.preventDefault(); payAgain(pay); return; }
    var acc = t.closest('[data-acc]');
    if (acc) {
      var wasOpen = acc.classList.contains('open');
      if (acc.hasAttribute('data-single')) $$('[data-acc]').forEach(function (b) { b.classList.remove('open'); });
      acc.classList.toggle('open', !wasOpen);
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawers(); });
  window.addEventListener('popstate', route);

  // ---------- start ----------
  window.__mm = { navigate: function (u) { window.location.href = u; } };
  window.__mm.ready = Promise.all([loadCatalogue(), loadMe()]).then(route, function () {
    $('#app').innerHTML = '<div class="empty" style="padding:120px 16px"><p class="eyebrow">OFFLINE</p><p>We could not reach the store. Please check your connection.</p><button class="btn green" id="retry">Try again</button></div>';
    bind();
  });
})();

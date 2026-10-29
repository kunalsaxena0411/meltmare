# MELTMARE store

Scented candle store for meltmare.com: storefront, cart, checkout with **Cashfree**, customer sign in by **email or phone OTP**, order history, and an **admin panel**. Plain Node.js, **no packages to install**.

## Run it on your computer (2 minutes)

1. Install Node.js 18 or newer from nodejs.org.
2. Open a terminal in this folder and run:

```
copy .env.example .env        (Mac/Linux: cp .env.example .env)
node server.js
```

3. Open http://localhost:3000.

In this local mode:
- **Payments** use a built in test page ("Simulate successful payment"), because no Cashfree keys are set.
- **Sign in codes** show on screen (`DEV_SHOW_OTP=1`), so no email or SMS is needed.
- **Admin** is at http://localhost:3000/admin. The email and a random password are printed in the terminal when the server starts. Set `DEV_ADMIN_PASSWORD` in `.env` to keep the same one.

## What is inside

| Part | Where |
| --- | --- |
| Storefront (home, shop, product, story, contact, FAQ, care, policies) | `app.js`, `styles.css`, `index.html` |
| API and static server | `server.js` |
| Cashfree create order, verify, webhook | `lib/cashfree.js` |
| OTP and order emails (Resend, MSG91) | `lib/notify.js` |
| Sessions, password hashing, rate limits | `lib/auth.js` |
| Data (JSON file in `data/`) and starter products | `lib/db.js`, `lib/seed.js` |
| Photos | `assets/img/` (stock photos), `data/uploads/` (photos added from admin) |
| Tests | `test/` |

### How an order works

1. Customer signs in with an OTP and fills the delivery form.
2. The **server** recomputes prices, checks stock, reserves the stock, creates order `MM000001` as *Pending payment* and creates a Cashfree order.
3. Cashfree checkout opens (UPI, cards, netbanking, wallets).
4. The order becomes **Paid** only when Cashfree confirms it, by webhook (signature checked, amount checked) or by the server asking Cashfree when the customer returns. The browser is never trusted.
5. Unpaid orders are cancelled after 30 minutes and the stock is released.
6. Admin moves the order to Packed, Shipped (with courier and tracking number) and Delivered. The customer sees every step in My account.

## Design preview on Vercel (not for real orders)

Vercel runs serverless functions with no permanent disk, so use it only to review the design. Orders and accounts reset whenever the function restarts.

1. Import the GitHub repo in Vercel (framework preset: Other, no build command).
2. Add these environment variables: `PREVIEW_MODE=1`, `SESSION_SECRET` (any long random text), `DEV_SHOW_OTP=1`, `DEV_ADMIN_PASSWORD` (a password you choose).
3. Deploy. Payments use the test page and sign in codes show on screen.

For the real store use a Node host with a persistent disk (Render, Railway or a VPS) as described below.

## Go live checklist

1. **Hosting.** Any Node host works (Render, Railway, a small VPS). It needs HTTPS and a **persistent disk** for the `data` folder (set `DATA_DIR`). Start command: `node server.js`. Set `NODE_ENV=production` and `TRUST_PROXY=1` behind a proxy.
2. **Secrets.** In the host's environment settings (or `.env`) set `SESSION_SECRET`, `SITE_URL=https://meltmare.com`, `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` (`npm run hash-password -- "a long password"`). In production the server refuses to start without `SESSION_SECRET`, and the admin stays disabled without a password hash.
3. **Cashfree.**
   - Test first: put the **sandbox** App ID and Secret Key in, `CASHFREE_ENV=sandbox`, and do a test order with Cashfree's test UPI or test card.
   - In the Cashfree dashboard add the webhook `https://meltmare.com/api/cashfree/webhook` (Payment Success and Payment Failed).
   - Live: after Cashfree KYC approval, switch to the live keys and `CASHFREE_ENV=production`.
4. **Sign in codes.**
   - Email: create a Resend account, verify the domain, set `RESEND_API_KEY` and `MAIL_FROM`.
   - Phone: India requires a DLT registered sender and OTP template. MSG91 is wired in (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`). Until this is approved, phone sign in will not send codes. Email sign in works on its own.
5. **Store details.** Set `STORE_PHONE`, `STORE_ADDRESS`, `STORE_HOURS`. Replace the stock photos with real product photos from admin (Products, Change photo). Edit prices and stock there too.
6. **Policies.** Read the four policy pages in `app.js` (`POLICIES`) with the client, edit if needed, then set `POLICIES_REVIEWED=1`.
7. **Backups.** Copy the `data` folder regularly. It holds orders, customers and uploaded photos.

## Things to know

- **Refunds** are issued from the Cashfree dashboard. Cancelling an order in admin returns the stock but does not move money.
- **Phone sign in** needs the DLT step above. **Email sign in** is the reliable path at launch.
- The data store is a JSON file, which is fine for a small store (hundreds of orders a month). If volume grows, move to SQLite or Postgres. Only `lib/db.js` and the `data` calls in `server.js` need to change.
- No GST invoice generation, courier booking or discount codes are included (outside the agreed scope).
- Product photos are stock images, replace before launch.
- The Emergent preview site has a public admin login. Do not reuse that password anywhere.

## Tests

```
npm test            API tests: login, orders, stock, admin, Cashfree create/verify/webhook/expiry (Cashfree is stubbed)
npm install --no-save jsdom
npm run test:ui     full site flows in a simulated browser
```

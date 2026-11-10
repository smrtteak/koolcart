# Koolcart

A small online shop where you can chat with the shopkeeper, make an offer, and pay in seconds with KoolUPI.

**Live demo: https://koolcart.vercel.app** (demo payments, no real money)

**Sellers describe a product in plain words (and a photo). An AI agent writes the listing, prices it and puts it on a shared storefront. Shoppers get their own AI assistant that answers questions, haggles within limits the seller set, and opens a checkout right in the chat.**

| Seller side (`/seller`) | Shopper side (`/`) |
|---|---|
| Chat + 📷 photo → listing, price, floor price, stock | Product grid + AI shop assistant |
| "How are sales?" → live numbers from orders | "Can you do $22?" → server-side haggling policy |
| "Refund the last order" → refund to the buyer | "Check me out" → order + pay button inline |
| One-click refunds, stock +/−, "✨ Improve with AI" | Search, category filters, "🤝 Make offer" price slider |
| New orders flash in live; animated revenue stats | "💬 Ask AI" on any product, receipt + confetti on payment |
| Returns tab: approve (refund) or decline | **Cart** with one order for every item |
| | **Returns & exchanges** form (`/returns`) with common reasons |

## Payments: KoolUPI

KoolUPI is Koolcart's built-in demo payment method, modelled on UPI apps. A shopper taps **Pay with KoolUPI**, a payment sheet slides up showing the amount, and they enter **any 4-digit PIN**. After a short "talking to the bank" pause the order is paid, with a UTR reference on the receipt. No account, card or real money is involved, and the PIN is never stored.

- `src/lib/koolupi.ts`: the gateway (PIN check, payment id, UTR, refunds)
- `src/components/KoolUpi.tsx`: the pay button and PIN sheet
- `POST /api/checkout/[orderId]/pay` with `{ "pin": "1234", "upiId": "you@koolupi" }` pays an order

Refunds from the seller studio and approved returns work the same way as before.

PayPal is still supported: set `PAYMENT_PROVIDER=paypal` plus `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` to switch checkout back to PayPal Smart Buttons (see below).

## How it works

```
Seller ──chat/photo──▶ Seller agent (LLM + tools) ──▶ listings, stock, refunds
                                   │
                                   ▼
                              Listings store (Postgres or JSON)
                                   ▲
Shopper ──chat──▶ Shopper agent (LLM + tools) ──▶ order (KC-…)
                                   │
                     KoolUPI sheet in chat ──▶ /api/checkout/[id]/pay ──▶ stock & sales update
```

### Optional: PayPal mode (`PAYMENT_PROVIDER=paypal`)

| PayPal capability | Where | What it does |
|---|---|---|
| OAuth 2.0 client credentials | `src/lib/paypal.ts` | Server-side access token, cached until expiry |
| **Catalog Products API** (`/v1/catalogs/products`) | seller agent `create_listing` / `update_listing` | Every AI-written listing is registered as a PayPal product |
| **Orders v2** create (`/v2/checkout/orders`) | cart and "Buy now" (haggled prices come from the shopper agent's `add_to_cart`) | Itemised order with SKU, unit prices, quantities and an `item_total` breakdown, at list or negotiated prices |
| **Orders v2** capture & get | `/api/checkout/[orderId]/capture`, `check_order_status` | Captures payment after buyer approval (idempotent via `PayPal-Request-Id`), records payer and capture id, decrements stock |
| **Payments v2** refunds (`/v2/payments/captures/{id}/refund`) | seller agent `refund_order`, order Refund button, approved returns | Full or partial refunds from a chat message, one click, or an approved return request |
| **PayPal JS SDK** Smart Buttons (`@paypal/react-paypal-js`) | `src/components/PayPalCheckout.tsx` | Renders checkout inside the assistant's chat bubble and on product pages |

### AI integration

Two tool-using agents run on whichever model you configure. The agent loop (`src/lib/agents/run.ts`) is provider-neutral, and tools are written once with Zod schemas:

| Provider | Setup | Cost |
|---|---|---|
| **Ollama** (default) | nothing set; uses `gemma4:31b-cloud` via local Ollama | free |
| **Google Gemini** | `GEMINI_API_KEY` from [AI Studio](https://aistudio.google.com/apikey) | free tier |
| **Claude** | `ANTHROPIC_API_KEY` (uses the Anthropic SDK tool runner, vision, refusal fallbacks) | paid |
| Any OpenAI-compatible API | `AI_BASE_URL` + `AI_API_KEY` (Groq, OpenRouter, ollama.com…) | varies |

The agents:

- **Seller agent** (`src/lib/agents/seller.ts`) reads the product photo (vision) and the seller's notes, writes the copy, suggests a price and a floor price when none is given, and runs the shop with tools: `create_listing`, `update_listing`, `delete_listing`, `get_shop_overview`, `list_orders`, `refund_order`, `set_shop_name`.
- **Shopper agent** (`src/lib/agents/buyer.ts`) answers only from catalog data and has `search_catalog`, `get_product`, `evaluate_offer`, `create_checkout` and `check_order_status`.

**The AI never controls money on its own:**
- The seller's floor price is never shown to the shopper agent. Offers go to a deterministic server-side policy (`evaluate_offer`) that returns accept / counter / decline.
- A haggled price reaches the cart only through `add_to_cart`, and checkout honours it only if the same chat agreed it in the last two hours. Prompt-injecting the assistant into "just charge me $1" fails.
- `src/lib/commerce.ts` checks stock, list price and floor price again before any PayPal order is created.
- Refunds are capped at the amount still refundable.
- Tool arguments are validated against their Zod schemas before running, on every provider.
- If checkout fails, the shopper sees the real error, even if the model glosses over it.

## Run it locally

Requirements: Node 20+ and one AI option (a PayPal sandbox account only if you use PayPal mode): a free [Gemini API key](https://aistudio.google.com/apikey), [Ollama](https://ollama.com) (`ollama signin` once), or a Claude API key.

1. **Create PayPal sandbox credentials.** Go to developer.paypal.com → *Apps & Credentials* → *Sandbox* → *Create App*, then copy the **Client ID** and **Secret**. Under *Testing Tools → Sandbox Accounts* you'll find a sandbox **personal** account; use it to pay at checkout.
2. **Install and configure**
   ```bash
   git clone <this repo> koolcart && cd koolcart
   npm install
   cp .env.example .env.local   # fill in PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and optionally an AI key
   npm run dev
   ```
3. Open http://localhost:3000. The shop opens with 18 starter products (hand-drawn illustrations in `public/products/`), so there's something to browse, haggle over and buy right away.

To reset the shop to the starter catalog, stop the server and delete `data/store.json`. It's recreated from `src/lib/starter-catalog.json` on the next request.

### PayPal demo mode (PayPal mode without keys)

If `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` are not set, the app runs in **PayPal demo mode**. The header shows an orange "PayPal demo mode · simulated" badge. `src/lib/paypal.ts` returns locally simulated responses with the same shape as the real Catalog, Orders and Refunds APIs, and checkout shows a simulated approval step in place of the PayPal popup, so the whole flow can be tried. Add sandbox keys and restart: real PayPal API calls and Smart Buttons take over, and the badge changes to "PayPal sandbox".

### Demo script (~2 minutes)

1. **Seller studio** → attach a product photo and type: *"5 of these candles, soy wax, 8oz, around $18, don't go under $15."* The listing appears on the right.
2. **Storefront** → ask the assistant *"What's good for a gift under $40?"*, then make an offer below the list price on any product. Watch it counter. Accept, then say *"check me out"*.
3. Tap **Pay with KoolUPI** and enter any 4-digit PIN. The chat confirms the payment and stock goes down.
4. **Seller studio** → *"How are sales?"* → *"Refund the last order, the buyer changed their mind."* The order flips to REFUNDED on the dashboard.

## A shared market

Koolcart is a network, not a single shop. Anyone can open **Sell** and is asked for their name once. Their listings show **"by <name>"** to everyone, shoppers can filter by maker, and the shopkeeper AI mentions who made what. One cart can mix several makers.

Each seller's back room (`/seller`) only shows **their** listings, their part of each order, and returns on those orders. The server enforces this: seller APIs and the seller AI's tools can only edit, delete or refund the caller's own items. In a mixed cart, a seller can refund only their share. Sellers are identified by name only (no accounts), which suits a demo; add real sign-in before using this for real money.

The 18 starter products belong to the house account **"Koolcart"**. Set `SELLER_PASSCODE` to keep visitors from editing them.

## Put it online (Render + Neon, free)

On a free host the server's disk is wiped on every restart, so a hosted Koolcart needs a database to keep everyone's listings. Set `DATABASE_URL` and the shop lives in Postgres; without it, it lives in `data/store.json`.

1. **Database (Neon, free).** Sign up at [neon.tech](https://neon.tech), create a project, and copy its **connection string** (`postgresql://…?sslmode=require`). Koolcart creates its table and seeds the starter shelf on first start.
2. **AI key (Gemini, free).** Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). A hosted server can't reach the Ollama on your laptop.
3. **Deploy (Render, free).** Sign in at [render.com](https://render.com) with GitHub → **New → Blueprint** → pick this repo. Render reads `render.yaml` and asks for:
   - `DATABASE_URL`: the Neon connection string
   - `GEMINI_API_KEY`
   - `SELLER_PASSCODE`: any phrase; it protects the house "Koolcart" account
4. Click **Apply**. The first build takes a few minutes, and you get a URL like `https://koolcart.onrender.com`.

**Check it works:** the header badge says **Demo payments · KoolUPI**; open **Sell**, enter a name and list something; open the site in another browser or on your phone and the listing shows **"by <your name>"**.

The free Render tier sleeps after about 15 idle minutes, so the first visit after that takes 30–60 seconds. Everything is saved in Neon, so nothing is lost.

Optional: `DEMO_RESET_HOURS=N` wipes the shop back to the starter catalog every N hours. That also erases sellers' listings, so leave it off for a shared market.

## Tech

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Gemini / Ollama (OpenAI-compatible API) or `@anthropic-ai/sdk` · Zod · PayPal REST APIs · `@paypal/react-paypal-js`.

## Tools & sponsor integrations

| Tool | Used for |
|---|---|
| **PayPal developer platform (sandbox)** | OAuth 2.0, Catalog Products API, Orders v2 (create, capture, get), Payments v2 refunds, JS SDK Smart Buttons. See [PayPal integration](#paypal-integration). |
| **Gemma 4 via Ollama** (`gemma4:31b-cloud`) | Default AI model for the seller helper and the shopkeeper agents (tool calling). Used in the demo video. |
| Google Gemini API / Anthropic Claude | Optional AI providers; the same agents and tools run on either when its key is set. |
| Next.js, React, TypeScript, Tailwind CSS, Zod | App framework, UI and tool schemas. |
| PostgreSQL (`pg`), e.g. Neon | Shared storage for hosted deployments. |
| Playwright, ffmpeg, macOS speech | Used only to record and narrate the demo video, not part of the app. |

**Sponsor tools:** none of the hackathon sponsor tools (AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, Zapier) are used. A `render.yaml` is included so the app can be deployed to Render (see [Put it online](#put-it-online-render--neon-free)); if you do deploy there, Render counts as a sponsor tool you used.

## Project layout

```
src/lib/paypal.ts          PayPal REST client (OAuth, Catalog, Orders, Refunds)
src/lib/commerce.ts        checkout / capture / refund rules (price floors, stock)
src/lib/store.ts           datastore: JSON file locally, Postgres when DATABASE_URL is set (seeds the starter catalog)
src/lib/starter-catalog.json  18 starter products
src/lib/agents/seller.ts   seller agent + tools
src/lib/agents/buyer.ts    shopper agent + haggling policy
src/app/api/**             route handlers
src/app/page.tsx           storefront + shopper chat
src/app/seller/page.tsx    seller studio
src/components/Chat.tsx    shared chat UI, agent activity trail, live polling
src/components/PayPalCheckout.tsx  PayPal Smart Buttons (or demo-mode stand-in)
src/components/Cart.tsx    cart drawer + multi-item PayPal checkout
src/app/returns/page.tsx   returns & exchanges form
src/app/api/returns/**     return requests (approving a return refunds via PayPal)
public/products/*.svg      hand-drawn product illustrations
```

## License

MIT, see [LICENSE](LICENSE).

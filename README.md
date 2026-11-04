# Koolcart

A small online shop where you can chat with the shopkeeper, make an offer, and pay with PayPal.

**Sellers describe a product in plain words (and a photo). An AI agent writes the listing, prices it, registers it in the PayPal catalog and puts it on a storefront with PayPal checkout. Shoppers get their own AI assistant that answers questions, haggles within limits the seller set, and opens a PayPal checkout right in the chat.**

Built for *Build What's Next with PayPal and AI*.

| Seller side (`/seller`) | Shopper side (`/`) |
|---|---|
| Chat + 📷 photo → listing, price, floor price, stock | Product grid + AI shop assistant |
| "How are sales?" → live numbers from orders | "Can you do $22?" → server-side haggling policy |
| "Refund the last order" → PayPal refund | "Check me out" → PayPal order + Smart Buttons inline |
| One-click refunds, stock +/−, "✨ Improve with AI" | Search, category filters, "🤝 Make offer" price slider |
| New orders flash in live; animated revenue stats | "💬 Ask AI" on any product, receipt + confetti on payment |
| Returns tab: approve (PayPal refund) or decline | **Cart** with one PayPal order for every item |
| | **Returns & exchanges** form (`/returns`) with common reasons |

Both chats show a live **activity trail** of what the agent did, e.g. *🤝 Checked the shop's pricing policy for $7.00 → accepted $7.00*, then *💳 Created PayPal order (Orders v2)*. Viewers can see exactly when AI reasoning hands off to PayPal.

## How it works

```
Seller ──chat/photo──▶ Seller agent (LLM + tools) ──▶    PayPal Catalog Products API
                                   │                   ──▶ PayPal Payments API (refunds)
                                   ▼
                              Listings store
                                   ▲
Shopper ──chat──▶ Shopper agent (LLM + tools) ──▶    PayPal Orders v2 (create)
                                   │
                     PayPal Smart Buttons in chat ──▶ PayPal Orders v2 (capture) ──▶ stock & sales update
```

### PayPal integration

| PayPal capability | Where | What it does |
|---|---|---|
| OAuth 2.0 client credentials | `src/lib/paypal.ts` | Server-side access token, cached until expiry |
| **Catalog Products API** (`/v1/catalogs/products`) | seller agent `create_listing` / `update_listing` | Every AI-written listing is registered as a PayPal product |
| **Orders v2** create (`/v2/checkout/orders`) | shopper agent `create_checkout`, cart, "Buy now" | Itemised order with SKU, unit prices, quantities and an `item_total` breakdown, at list or negotiated prices |
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
- `create_checkout` only accepts a discounted price that the policy agreed to within the last hour. Prompt-injecting the assistant into "just charge me $1" fails.
- `src/lib/commerce.ts` checks stock, list price and floor price again before any PayPal order is created.
- Refunds are capped at the amount still refundable.
- Tool arguments are validated against their Zod schemas before running, on every provider.
- If checkout fails, the shopper sees the real error, even if the model glosses over it.

## Run it locally

Requirements: Node 20+, a [PayPal Developer](https://developer.paypal.com/) account (free sandbox), and one AI option: a free [Gemini API key](https://aistudio.google.com/apikey), [Ollama](https://ollama.com) (`ollama signin` once), or a Claude API key.

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

### Demo mode (no PayPal keys yet)

If `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` are not set, the app runs in **PayPal demo mode**. The header shows an orange "PayPal demo mode · simulated" badge. `src/lib/paypal.ts` returns locally simulated responses with the same shape as the real Catalog, Orders and Refunds APIs, and checkout shows a simulated approval step in place of the PayPal popup, so the whole flow can be tried. Add sandbox keys and restart: real PayPal API calls and Smart Buttons take over, and the badge changes to "PayPal sandbox".

### Demo script (~2 minutes)

1. **Seller studio** → attach a product photo and type: *"5 of these candles, soy wax, 8oz, around $18, don't go under $15."* The listing appears on the right with its PayPal catalog id.
2. **Storefront** → ask the assistant *"What's good for a gift under $40?"*, then make an offer below the list price on any product. Watch it counter. Accept, then say *"check me out"*.
3. Pay with the sandbox personal account in the PayPal popup. The chat confirms the payment and stock goes down.
4. **Seller studio** → *"How are sales?"* → *"Refund the last order, the buyer changed their mind."* The order flips to REFUNDED in PayPal and on the dashboard.

## Deploy (Render)

`render.yaml` is included: *New → Blueprint* on Render, point it at this repo, and fill in the PayPal vars plus `GEMINI_API_KEY`. A hosted server can't reach your local Ollama, so use Gemini, or `AI_BASE_URL=https://ollama.com/v1` with an Ollama API key. Data is a JSON file (`data/store.json`). On Render's free tier it resets to the starter catalog on each deploy.

For a public demo, two optional settings keep the shop safe without hiding anything from judges:

| Setting | What it does |
|---|---|
| `DEMO_RESET_HOURS=1` | Rolls the shop back to the 18 starter products (and clears test orders) every hour, so anything a visitor deletes or changes fixes itself. The seller studio shows a note saying so. Set by default in `render.yaml`. |
| `SELLER_PASSCODE=…` | Puts the seller studio behind a passcode. Seller-only APIs (chat, dashboard, stock, delete, refunds, returns) reject requests without it. Share the passcode in your project description so judges can get in. Leave it unset to keep the studio open. |

Neither is set locally by default, so your own shop is never reset or locked.

## Tech

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Gemini / Ollama (OpenAI-compatible API) or `@anthropic-ai/sdk` · Zod · PayPal REST APIs · `@paypal/react-paypal-js`.

## Tools & sponsor integrations

| Tool | Used for |
|---|---|
| **PayPal developer platform (sandbox)** | OAuth 2.0, Catalog Products API, Orders v2 (create, capture, get), Payments v2 refunds, JS SDK Smart Buttons. See [PayPal integration](#paypal-integration). |
| **Gemma 4 via Ollama** (`gemma4:31b-cloud`) | Default AI model for the seller helper and the shopkeeper agents (tool calling). Used in the demo video. |
| Google Gemini API / Anthropic Claude | Optional AI providers; the same agents and tools run on either when its key is set. |
| Next.js, React, TypeScript, Tailwind CSS, Zod | App framework, UI and tool schemas. |
| Playwright, ffmpeg, macOS speech | Used only to record and narrate the demo video, not part of the app. |

**Sponsor tools:** none of the hackathon sponsor tools (AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, Zapier) are used. A `render.yaml` is included so the app *can* be deployed to Render, but the submission does not rely on it.

## Project layout

```
src/lib/paypal.ts          PayPal REST client (OAuth, Catalog, Orders, Refunds)
src/lib/commerce.ts        checkout / capture / refund rules (price floors, stock)
src/lib/store.ts           JSON-file datastore (seeds the starter catalog on first run)
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

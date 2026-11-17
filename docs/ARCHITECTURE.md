# Vastra Books: architecture

How the app is put together and why. Written for whoever maintains or extends it.

## 1. What it has to do

| Need | How it is met |
|---|---|
| 1 to 10 users, one office PC, shared over Wi-Fi | One Node.js program and one SQLite file. No cloud bill. |
| Several stores, each ₹2L+ a month | Every bill, payment, expense and stock movement carries a location. Dashboard and reports filter by store. Staff are tied to their store. |
| Retail, wholesale, marketplace, own online orders | Every sale has a channel. Items have a retail and a wholesale price. Marketplace fee and courier cost are stored on the bill. |
| Not GST registered today | Plain bills by default. One switch turns on tax invoices with CGST / SGST / IGST and the garment 5% / 18% slab. |
| Stock: Shirt (Premium, Offer, Jeans Shirt), Pant (Formal, Cotton, Track, Jeans), Hoodie, Blazer, Shoes | Category → sub-category → item → size × colour. The owner's list is loaded at first start. |
| Cost: purchased goods, raw material, labour, factory other costs | Two routes to cost per piece: purchase (price + share of freight) and production cost sheet. |
| AI with free models | One OpenAI-compatible connector. The model reads reports; it never touches the database. |
| Reports as Excel / Word / PDF | One report format feeds the screen, ExcelJS, docx and the print layout. |

## 2. Ideas taken from Tally and Vyapar

| From Tally | From Vyapar |
|---|---|
| One "voucher" record type for sale, purchase and returns | Fast bill screen with search and barcode scan |
| Godowns: stock by location, transfers | Dashboard with today's sale, dues and low stock |
| Manufacturing journal: materials + costs → cost per piece | "You'll get / you'll give" balances, Payment In / Out |
| Day Book, Profit & Loss, outstanding, stock valuation | Item profit, expenses by head, UPI QR, one-press backup |

Open-source projects reviewed: ERPNext (GPL-3), Frappe Books (AGPL-3), Bigcapital (AGPL-3), Akaunting, FloDesktop, Posnic. None covers size/colour variants + multi-store + manufacturing cost + AI in a simple package, and forking a GPL/AGPL ERP brings its weight and licence terms. So this is a custom build that borrows their ideas and uses only permissive (MIT / Apache) libraries: React, Vite, Tailwind CSS, Express, Recharts, lucide, ExcelJS, docx, qrcode, JsBarcode.

## 3. High-level design

```
 Store 1 PC   Store 2 phone   Godown tablet        (same Wi-Fi, any browser)
       └────────────┬───────────────┘
                    ▼  http://<office-pc>:4000
 ┌─────────────────── Office PC ────────────────────┐
 │ ONE Node.js program (Express 5)                  │
 │  ├─ React screens (static files from dist/)      │
 │  ├─ /api → session check → role + store check    │
 │  ├─ services: bills · stock · production         │
 │  │            reports · export · backup · AI     │
 │  └─ SQLite (node:sqlite, WAL mode)               │
 │ data/app.db        data/backups/ (daily, 14 kept)│
 └───────────────────────┬──────────────────────────┘
                         │ owner only, only when AI is used
                         ▼
        Groq / OpenRouter / DeepSeek / …  or  Ollama on the same PC
```

| Part | Choice | Reason |
|---|---|---|
| Server | Node 22 + Express 5, TypeScript run directly by Node | No build step for the server |
| Database | SQLite through Node's built-in `node:sqlite` | Nothing to compile on a Windows PC; one file to back up |
| Screens | React + Vite + Tailwind, fonts bundled | Works with no internet |
| Login | scrypt password hash, HttpOnly SameSite cookie, sessions in the database | Server keeps no state in memory |
| Money | Whole paise (integers) | No rounding drift |
| Stock | A ledger of movements; stock on hand = sum | One source of truth for every location |
| Totals | Recomputed on the server from `shared/calc.ts` | The browser's numbers are only a preview |

### Scale path

1. **Access from anywhere:** copy the folder to a small cloud server behind HTTPS (for example Caddy). No code change.
2. **50+ users, or stores writing at once from different cities:** move to Postgres. All SQL sits in the six server service files and is plain SQL; `server/db.ts` is the only file that knows the driver.
3. **Second company:** add a `company_id` column and filter on it.

SQLite itself is far from its limit here: the 40-day demo (400 bills, 970 stock movements) builds in about 0.1 second.

## 4. Low-level design

### Files

```
shared/calc.ts         money helpers, bill maths, dates, amount in words (used by screens AND server)
server/index.ts        Express app, Vite in dev, static files in prod, demo copy, start-up message
server/db.ts           open database, schema, tx(), settings, bill numbers, backup, first-run basics
server/schema.sql      tables, indexes and four views
server/util.ts         HttpError and input checks
server/auth.ts         first-run setup, login, sessions, users, guards
server/masters.ts      settings, locations, categories, parties, items + variants, expenses
server/vouchers.ts     sale / purchase / returns, cancel, payments
server/stock.ts        stock movement, average cost, transfer, adjust, production cost sheets
server/reports.ts      19 reports + party statement + GST summary + dashboard
server/export.ts       one report → .xlsx or .docx
server/ai.ts           AI connector, Ask AI, daily insights
server/seed.ts         demo data (built through the same functions the screens use)
src/ui.tsx             UI kit: Button, Field, Modal, DataTable, Combo, RangePicker …
src/App.tsx            layout, navigation, routes, app-wide data
src/pages/*.tsx        one file per screen
```

One bill form serves sale, purchase and both returns. One report page serves every report. One export function makes every Excel and Word file. One AI connector serves every provider.

### Tables

| Table | Holds |
|---|---|
| `users`, `sessions` | Up to 10 users, role (`owner` / `staff`), the staff member's store; hashed session tokens |
| `settings` | Key → JSON: brand, bill settings, AI provider, running numbers, cached insights |
| `locations` | Godown, store or factory |
| `categories` | Two levels (parent_id) |
| `parties` | Customer, supplier or job worker, with opening balance |
| `items`, `variants` | Item (finished or raw, unit, GST type) and its size × colour rows: SKU/barcode, retail price, wholesale price, average cost, low-stock level |
| `vouchers`, `voucher_lines` | Bill header (type, number, date, party, location, channel, totals, fee, courier cost, status) and lines (qty, rate, discount, tax, **unit_cost at that moment**) |
| `payments` | Money in or out, mode, optional link to a bill |
| `expenses` | Head, amount, mode, store |
| `productions`, `production_inputs`, `production_outputs` | Cost sheet: material used, labour, other cost, pieces made |
| `stock_moves` | Every stock change: date, variant, location, ±qty, unit cost, reason, source document |

Views: `v_variant` (variant + item + category names), `v_stock` (stock per variant and location), `v_sale_lines` (signed sale lines with each line's share of selling cost), `v_party_balance`.

### Rules

- **Bill maths:** line → line discount % → share of bill discount (by value, last line takes the leftover paise) → GST (0 while GST is off; garments 5% up to ₹2,500 per piece, 18% above) → round the bill to the rupee.
- **Bill numbers:** prefix + running number, taken inside the save transaction.
- **Stock out** is refused when the location is short, unless the owner allows negative stock.
- **Cost per piece** is a weighted average per variant, updated whenever stock comes in at a known cost.
  - Purchased: `(price + this line's share of freight) ÷ qty`
  - Manufactured: `(raw material at average cost + labour + factory other costs) ÷ pieces made`
- **Corrections:** bills and cost sheets are cancelled, never edited. Cancelling removes the document's stock movements and payments; the document and its number stay, marked cancelled. Average cost is not rolled back on cancel; the next receipt re-averages it.
- **Party balance:** opening + sales − sale returns − purchases + purchase returns − labour owed − payments in + payments out. Positive means the party owes the business.
- **Net profit:** sales − returns + charges billed − cost of goods sold − marketplace fees − courier cost − expenses − stock write-offs.
- **Unit economics:** per item: price, cost, gross margin, selling cost, contribution, overhead (expenses shared by revenue) and net profit per unit; plus break-even units.

### Roles

| | Owner | Staff |
|---|---|---|
| Bills, purchases, production, transfers, parties, expenses | All locations | Bills and expenses only for their own store |
| Dashboard | Everything | Own store; no profit or stock value |
| Reports | All 19 | Sales and stock reports, own store, no profit columns |
| Stock adjustment, cancelling others' bills, deleting | Yes | No (staff can cancel only their own bills of today) |
| Settings, users, AI, backup | Yes | No |

Every one of these is enforced on the server, not only hidden on screen.

### AI

1. **Plan.** The question, the list of reports and the list of stores go to the model. It replies with a small JSON naming up to three reports and their dates. The server checks every field; unknown report names are dropped.
2. **Fetch.** The server runs those reports through `runReport()`, the same function the Reports screen uses.
3. **Answer.** The rows (at most 40 per report, money in rupees, phone column removed) go back to the model with instructions to answer only from that data, in the language of the question.

Daily insights use the same connector with eight reports of the last 30 days and are cached once per day per store.

Tool-calling is not used because free models support it unevenly; a plain JSON reply works on all of them.

### Safety

- No default password; the first visit creates the owner. Passwords need 8+ characters and are stored as scrypt hashes.
- Session cookie is HttpOnly and SameSite=Lax; only a SHA-256 of the token is stored.
- Eight wrong passwords lock that username and address for 10 minutes.
- All changes must arrive as JSON, which blocks cross-site form posts.
- Every SQL statement is parameterised; every input is checked on the server.
- Daily backup with `VACUUM INTO` (a consistent copy even while the app is in use), 14 kept, plus a download button.
- The AI key is stored on the office PC and never sent back to the browser.

On a shared Wi-Fi the traffic is plain HTTP. That is acceptable inside the shop's own network; put the app behind HTTPS before exposing it to the internet.

## 5. Checks

- `shared/calc.test.ts`: discounts, round-off, GST off, GST slab at the ₹2,500 edge, inclusive and exclusive prices, CGST/SGST vs IGST.
- `server/flow.test.ts`: one end-to-end story with hand-worked numbers. Purchase with freight (fabric ₹102/m, shirt ₹714), production (₹8,600 ÷ 40 = ₹215 per piece), transfer, four sales on four channels, a return, an expense and a write-off; then stock per location, balances, net profit ₹1,181, exports, role limits, the AI pipeline against a stand-in model, and cancellation.

## 6. Deliberate simplifications

| Simplification | Ceiling | Upgrade when |
|---|---|---|
| PDF through the browser's print layout | Needs one extra click | A scheduled or emailed PDF is wanted |
| One receipt per cost sheet | A part-finished lot needs two sheets | Partial receipts become routine |
| Equal cost for every piece on a sheet | Mixed garments on one sheet share one cost | Separate sheets are not practical |
| Overheads shared by revenue in unit economics | Rough for very different price points | Per-store or per-category allocation is wanted |
| No schema migration runner | First column change needs one | The first schema change |
| English screens | AI already answers in the question's language | Staff need Hindi or Bengali screens |

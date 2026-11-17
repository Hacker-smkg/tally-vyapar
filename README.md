# Vastra Books

Billing, stock, costing and profit for a multi-store clothing business. It combines the useful parts of Tally (stock by location, manufacturing cost, profit and loss) and Vyapar (fast bills, party balances, simple reports), and adds an AI assistant that answers questions from your own data.

Built for 1 to 10 users. It runs on one office computer; everyone else opens it in a browser on the same Wi-Fi. All data stays in one file on that computer.

Design and data model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 🚀 Deploy to Cloud (Client + Server Fullstack)

Both the React frontend and Express backend are pre-configured to deploy together:

- **Vercel (Instant Serverless Demo):**
  [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FHacker-smkg%2Ftally-vyapar)
  *Uses `api/index.ts` serverless handler and `vercel.json` rewrites to serve both the frontend and API.*

- **Render (24/7 Persistent Node.js App):**
  [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Hacker-smkg/tally-vyapar)
  *Uses `render.yaml` to spin up a full Node 22 web service.*

## Try it first (demo copy)

The demo copy has its own data folder (`data-demo/`) with a sample business, so nothing you do there touches the real books.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run demo
```

Open http://localhost:4010 and press **Use demo login**.

## Run the real app

```bash
npm start
```

Open http://localhost:4000. The first visit asks you to create the owner account. There is no default password.

While changing code, `npm run dev` starts the same app with live reload.

## Put it on the office PC (Windows)

1. Install **Node.js 22 LTS** (version 22.18 or newer) from https://nodejs.org.
2. Copy this folder to the PC. Leave out `node_modules`, `data-demo` and `dist`.
3. Double-click **Start App.bat**. The first start installs and builds; later starts take a few seconds.
4. If Windows Firewall asks, allow access on **Private networks**.
5. The window prints two addresses. Use the "same Wi-Fi" one on every other computer, tablet or phone.

Two things keep it reliable:

- In the Wi-Fi router, reserve a fixed IP address for the office PC, so the address never changes.
- Set the PC to never sleep while the shop is open.

## First setup (5 minutes)

| Where | What to do |
|---|---|
| Settings › Brand | Business name, address, phone, logo, brand colour |
| Settings › Locations | Add every store, godown and factory |
| Settings › Categories | Shirt, Pant, Hoodie, Blazer and Shoes are already there; add your own |
| Settings › Bills | Bill number prefix, UPI ID for the scan-to-pay QR, terms, expense heads |
| Settings › Users | Add staff and tie each one to their store |
| Items | Add items with sizes and colours; enter opening stock and cost |
| Parties | Add suppliers, job workers and credit customers with any old balance |

## What each screen does

| Screen | Use it for |
|---|---|
| Dashboard | Today's and this month's sales, net profit, dues, low stock, best sellers, store and channel split |
| Sales | New bill (type or scan), print or save as PDF, sale return, receive payment |
| Purchases | Fabric, trims and ready garments bought, with freight shared into cost |
| Production | Cost sheet: raw material + labour + factory other costs ÷ pieces made = cost per piece |
| Stock | Stock per location, transfer with a printable slip, adjustment, history of any item |
| Items | Catalogue, prices, low-stock alert levels, price tags with barcode |
| Parties | Balances, statements, Payment In and Payment Out |
| Expenses | Rent, salary, electricity and other running costs, per store |
| Reports | 19 reports, each as Excel, Word or PDF |
| Ask AI | Questions in plain words; answers come only from your reports |

**PDF:** press **PDF / Print** and choose "Save as PDF" in the print window. The same layout prints on paper.

**Corrections:** a saved bill is not edited. Open it, press **Cancel bill** (stock and money go back, the number stays as cancelled), then **Duplicate** to make it again correctly.

**Costs:** labour and factory costs entered on a production cost sheet become part of stock value. Do not enter the same amount again under Expenses.

## Backup and restore

- Every day the app saves a full copy in `data/backups/` and keeps the last 14.
- Settings › Backup › **Download backup now** gives you a copy to keep on a pen drive or Google Drive. Do this weekly.
- To restore: stop the app, replace `data/app.db` with the backup file (delete `app.db-wal` and `app.db-shm` if present), start the app.

## AI assistant (optional, can be free)

1. Make a free API key at Groq (console.groq.com) or OpenRouter (openrouter.ai).
2. Settings › AI: pick the provider, paste the key, press **Load models**, pick a model, press **Test**, then **Save**.
3. Use **Ask AI**, and see the **AI insights** card on the Dashboard.

DeepSeek, xAI Grok, Moonshot Kimi, Zhipu GLM, Alibaba Qwen and a local Ollama model work the same way. The AI can only read reports. It receives item names, party names and amounts; never phone numbers, addresses or passwords. Free cloud tiers may keep what they receive; Ollama keeps everything on the PC.

## Updating to a newer version

Replace everything except the `data/` folder, then:

```bash
npm install
```

```bash
npm run build
```

## Checks

```bash
npm test
```

Runs the bill maths tests and one end-to-end flow with hand-worked numbers (buy, manufacture, transfer, sell on four channels, return, cancel, reports, exports, AI pipeline).

```bash
npm run qa
```

The full QA run: starts throwaway copies of the app on temporary data and checks them over HTTP (139 checks: functions, wrong inputs, limits, calculations, roles, security, many users at once, speed, backup and restore, AI). It never touches `data/` or `data-demo/`. Results go to `qa/results.json`; `python3 qa/report.py` (needs `openpyxl`) turns them into the Excel report.

```bash
npm run typecheck
```

## Not included yet

GST return files, government e-invoice (IRN) and e-way bill (only needed after GST registration; the GST switch in Settings already makes tax invoices), balance sheet and double-entry ledgers, payroll, thermal 80 mm receipt layout, customer-facing WhatsApp bot.

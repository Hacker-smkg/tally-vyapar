# Vastra Books: next-level improvements

Written 17 Nov 2026, after the build and three rounds of QA. Each item says what is missing today, what to build, and how big the job is. Sizes: **S** = under a day, **M** = 1 to 3 days, **L** = about a week.

The order inside each group is the order I would do them in.

## How to read the priority

| Priority | Meaning |
|---|---|
| P1 | Do before the shop depends on the app every day |
| P2 | Do in the first month of real use |
| P3 | Do when the need shows up |

## Summary

| # | Improvement | Priority | Size |
|---|---|---|---|
| 1 | Off-site backup | P1 | S |
| 2 | Thermal 80 mm receipt | P1 | M |
| 3 | Hide the blank "Sale return" button from staff | P1 | S |
| 4 | Run as a Windows service that starts with the PC | P1 | S |
| 5 | Day-end closing per store | P1 | M |
| 6 | Hide cost prices from staff | P2 | S |
| 7 | Change log for items, prices and parties | P2 | M |
| 8 | Partial receipts on cost sheets | P2 | M |
| 9 | Purchase orders and reorder list | P2 | M |
| 10 | Customer phone lookup and purchase history | P2 | S |
| 11 | Discount and offer rules | P2 | M |
| 12 | Hindi and Bengali screens | P2 | M |
| 13 | AI: faster answers, saved questions, weekly summary | P2 | M |
| 14 | Estimates and delivery challans | P3 | M |
| 15 | GST return files, e-invoice and e-way bill | P3 | L |
| 16 | Marketplace settlement import | P3 | L |
| 17 | Access from outside the shop (HTTPS) | P3 | M |
| 18 | WhatsApp bill sharing and payment reminders | P3 | M |
| 19 | Customer-facing WhatsApp sales bot | P3 | L |
| 20 | Move to Postgres | P3 | L |

---

## Group A: protect the data and the daily routine (P1)

### 1. Off-site backup — S
**Today:** the daily backup sits in `data/backups/` on the same PC as the data. A dead disk, theft or fire takes both.
**Build:** a setting for a second backup folder (a pen drive, or a Google Drive / OneDrive folder that syncs by itself). After each daily backup, copy the file there and show "last off-site backup: date" on the Backup screen, in red if older than 3 days.
**Done when:** unplugging the pen drive turns the status red, and a file from it restores into a fresh copy.

### 2. Thermal 80 mm receipt — M
**Today:** bills print on A4 or A5 only. Most shop counters use roll printers.
**Build:** a bill-paper setting (A4 / A5 / 80 mm). The 80 mm layout is one narrow column: brand, bill number, items as two lines each, totals, UPI QR, footer.
**Done when:** a 3-item bill prints on a roll printer with nothing cut off, and the QR scans.

### 3. Hide the blank "Sale return" button from staff — S
**Today:** staff can open a blank return but cannot save it (they must start from the bill). The button only leads to an error.
**Build:** show that button to the owner only; staff see "Return" inside each bill.

### 4. Start with the PC — S
**Today:** someone must double-click `Start App.bat` each morning. If the window is closed, billing stops in every store.
**Build:** a second script that registers the app with Windows Task Scheduler to start at boot and restart if it stops, plus a line on the login page showing the server's Wi-Fi address.
**Done when:** after a power cut and reboot, the stores can bill without anyone touching the office PC.

### 5. Day-end closing per store — M
**Today:** Daily Sales shows cash, UPI and card collected, but nobody confirms the cash in the drawer.
**Build:** a "Close the day" screen per store: opening cash, cash sales, cash refunds, cash expenses, expected cash, counted cash, difference, who closed. Stored once per store per day and shown in a Day Closing report.
**Done when:** a shortfall of ₹200 shows up against the store and the person who closed.

## Group B: tighten control and save time (P2)

### 6. Hide cost prices from staff — S
**Today:** staff cannot open profit reports, but they see cost per piece on purchase and production screens and in item lists, so margins can be worked out.
**Build:** a per-user switch "can see cost prices". Without it, cost columns and the cost panel are left out of the data sent to the browser, not just hidden.

### 7. Change log — M
**Today:** bills leave a trail (cancel and re-make), but a changed selling price, low-stock level or party balance leaves none.
**Build:** one `changes` table (who, when, what record, old value, new value) written by the item, party, settings and user screens, with a "History" button on each.
**Done when:** changing a shirt's price from ₹499 to ₹449 shows both values, the user and the time.

### 8. Partial receipts on cost sheets — M
**Today:** one cost sheet is one receipt. If the tailor returns 120 of 200 pieces, the lot has to be split into two sheets by hand.
**Build:** let an open sheet receive pieces more than once. Each receipt takes its share of material, labour and other cost; the sheet closes when the last piece arrives or is written off as rejected.

### 9. Purchase orders and reorder list — M
**Today:** Low Stock and Best Sellers say what is running out, but ordering happens outside the app.
**Build:** a "Reorder" screen that proposes a quantity per size from the last 30 days of sales and current stock, turns the chosen lines into a purchase order for a supplier, and later converts the order into a purchase bill.

### 10. Customer phone lookup and history — S
**Today:** walk-in bills carry an optional name only.
**Build:** a phone box on the bill. A known number fills the name and shows past bills and total spend; a new number creates the customer quietly. Adds a Top Customers report.

### 11. Discount and offer rules — M
**Today:** discounts are typed per line or per bill.
**Build:** named offers with dates: flat % on a category, "buy 2 get 10% off", end-of-season price list. The bill applies them and shows which offer was used; a report shows what each offer cost.

### 12. Hindi and Bengali screens — M
**Today:** screens are English; only the AI answers in other languages.
**Build:** move screen text into one language file per language and add a language choice per user. Bills stay in English unless the owner changes it.

### 13. AI: faster, and more useful day to day — M
**Today:** live-tested on a free keyless model. It answers correctly from the right report, but a free tier that spaces replies 45 seconds apart makes one question take about a minute.
**Build:**
- Use a keyed free tier (Groq) or a local Ollama model for answers in seconds.
- Save favourite questions as one-press buttons.
- A weekly summary every Monday: sales against last week, slow stock to discount, who to collect from.
- Let the AI explain one report row ("why is this item's margin low?").
- Keep the last 20 questions and answers.

## Group C: when the business needs it (P3)

### 14. Estimates and delivery challans — M
Quotation → bill, and challan → bill, for wholesale buyers who take goods first and are billed later.

### 15. GST return files, e-invoice and e-way bill — L
Only after GST registration. The GST switch already makes tax invoices with CGST / SGST / IGST. This adds GSTR-1 and GSTR-3B export files, and IRN and e-way bill generation through a GSP account (IRN is required above ₹5 crore turnover).

### 16. Marketplace settlement import — L
**Today:** marketplace fee and courier cost are typed on each bill.
**Build:** import the settlement file from Meesho, Amazon or Flipkart, match it to bills, fill fees and returns automatically, and show what the marketplace still owes.

### 17. Access from outside the shop — M
**Today:** the app works on the shop Wi-Fi over plain HTTP.
**Build:** either a small cloud server behind HTTPS, or a secure tunnel from the office PC. Add two-step login for the owner before opening it to the internet.

### 18. WhatsApp bill sharing and payment reminders — M
A "Send on WhatsApp" button that opens WhatsApp with the bill summary and a link or PDF, and a reminder list for dues older than a set number of days.

### 19. Customer-facing WhatsApp sales bot — L
A separate piece: needs a WhatsApp Business API account. Answers stock and price questions from the catalogue and takes orders into the app as own-online bills.

### 20. Move to Postgres — L
Only if several cities write at once or users pass about 50. One year of data (20,000 bills, 11 MB) answers every screen in under 125 ms on SQLite, so this is far away.

---

## Known limits carried from QA

| Item | State |
|---|---|
| `Start App.bat` on Windows | Written, never run. Test on the office PC first. |
| Physical barcode scanner and paper printer | Only simulated typing and PDF output were checked. |
| Safari, Firefox, Edge | Not opened. The app uses standard browser features only. |
| ExcelJS dependency notice | Two moderate `npm audit` notices in a library used for Excel export. Not reachable from this app; no fixed release yet. Re-check when updating. |
| Free keyless AI endpoint | Fine for a trial with sample data. It is a public service: use a keyed provider or Ollama before sending real business figures. |

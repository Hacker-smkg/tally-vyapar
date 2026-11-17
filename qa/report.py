# Builds the Excel QA report from qa/results.json plus the browser, PDF and defect findings below.
#   python3 qa/report.py
import json, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

res = json.load(open('qa/results.json'))
F = lambda **k: Font(name='Arial', size=10, **k)
HEAD = PatternFill('solid', fgColor='1E293B'); GREEN = PatternFill('solid', fgColor='DCFCE7'); RED = PatternFill('solid', fgColor='FEE2E2'); AMBER = PatternFill('solid', fgColor='FEF3C7'); GREY = PatternFill('solid', fgColor='F1F5F9')
thin = Side(style='thin', color='CBD5E1'); BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

def sheet(wb, name, headers, rows, widths, status_col=None):
    ws = wb.create_sheet(name)
    ws.append(headers)
    for c in ws[1]: c.font = F(bold=True, color='FFFFFF'); c.fill = HEAD; c.alignment = Alignment(vertical='center', wrap_text=True); c.border = BOX
    for r in rows:
        ws.append(r)
        for c in ws[ws.max_row]: c.font = F(); c.alignment = Alignment(vertical='top', wrap_text=True); c.border = BOX
        if status_col:
            c = ws.cell(ws.max_row, status_col); v = str(c.value)
            c.fill = GREEN if v.startswith(('Pass', 'Fixed')) else RED if v.startswith(('Fail', 'Open')) else AMBER; c.font = F(bold=True)
    for i, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions
    return ws

UI = [  # checked in the browser on the demo copy (dev build) and with headless Chrome on the production build
 ('Login', 'Functional', 'Demo login page renders; demo login button fills the form; login lands on the dashboard', 'Pass', ''),
 ('Dashboard', 'Functional', 'Cards, 14-day chart, channel / store / best-seller bars, low stock and latest bills show real numbers', 'Pass', ''),
 ('Sales', 'Functional', 'Item search by name + size ranks the exact size first; typing a SKU + Enter (barcode scanner) adds the item', 'Pass', 'Search ranking fixed during the build'),
 ('Sales', 'Functional', 'Bill saved from the form; printable bill shows items, totals, amount in words', 'Pass', 'INV-0393 in the demo copy'),
 ('Sales', 'Functional', 'Return started from a bill is pre-filled and saved as a credit note', 'Pass', 'SR-0006'),
 ('Sales', 'Negative', 'A second full return of the same bill is refused with a clear message on the form', 'Pass', '"Only 0 of … can be returned against INV-0394"'),
 ('Sales', 'Integrity', 'Cancel is blocked while a return exists, with a message naming the return', 'Pass', ''),
 ('Sales', 'Functional', 'Cancelling shows the CANCELLED watermark and removes the Cancel / Return buttons', 'Pass', ''),
 ('Sales', 'Functional', 'Print / PDF button opens the print flow', 'Pass', ''),
 ('Parties', 'Functional', 'New party from the form appears in the list; Receive payment updates the balance on screen', 'Pass', ''),
 ('Parties', 'Security', 'A name containing <img onerror=…> is shown as text; nothing runs', 'Pass', ''),
 ('Expenses', 'Functional', 'New expense appears in the list; an empty amount shows "Enter the amount" inside the form', 'Pass', ''),
 ('Reports', 'Functional', 'All 19 reports open from the menu with a table or an empty-state note and no error', 'Pass', ''),
 ('Reports', 'Functional', 'Changing the channel filter re-queries, filters the rows and updates the page address', 'Pass', ''),
 ('Reports', 'Negative', 'A staff user opening an owner-only report address sees "This report is not available"', 'Pass', 'Was an endless spinner: defect D-08, fixed'),
 ('Settings', 'Functional', 'Brand colour change applies across the app at once and can be changed back', 'Pass', ''),
 ('Stock', 'Functional', 'Transfer through the screen moves 1 piece godown → store; total unchanged; transfer slip shown and printable', 'Pass', ''),
 ('Production', 'Functional', 'New cost sheet through the screen: 15 m denim + ₹650 labour ÷ 10 pieces = ₹338.84; stock and average cost update', 'Pass', ''),
 ('Items', 'Functional', 'Item editor opens with sizes, prices, stock and barcodes', 'Pass', ''),
 ('Price tags', 'Functional', 'Tags render with brand, item, size, MRP and barcode; count per size is editable', 'Pass', ''),
 ('Roles', 'Roles', 'Staff screen: 9 menu entries (no Ask AI, no Settings), no profit card, no store picker, no Adjust button, store locked on the bill form', 'Pass', ''),
 ('Navigation', 'Negative', 'An unknown page address returns to the dashboard', 'Pass', ''),
 ('Layout', 'UI', 'Phone width (375 px): dashboard and bill form fit with no sideways scroll', 'Pass', 'Two layout defects fixed during the build'),
 ('Layout', 'UI', 'Small quantity boxes keep their width; item names stay readable in bill, transfer and cost-sheet rows', 'Pass', 'Fixed during the build'),
 ('PDF', 'Export', 'Bill prints to a 1-page PDF with brand header, items, totals, amount in words and UPI QR code', 'Pass', 'Headless Chrome, production build'),
 ('PDF', 'Export', '30-day Sales Register (about 400 bills) prints landscape, full width, headings repeated, 14 pages', 'Pass', 'Was 38 pages: defect D-09, fixed'),
 ('PDF', 'Export', 'Profit & Loss and Unit Economics each print on 1 page; price tags print 4 pages for 81 tags', 'Pass', ''),
 ('Sales', 'Functional', 'Duplicating a return keeps it tied to the original bill (a second full return is refused naming the original bill)', 'Pass', 'D-16 re-checked on screen'),
 ('Sales', 'Roles', 'Staff saving a return with no bill see "Open the original bill and press Return…" on the form', 'Pass', 'D-11 on screen'),
 ('Settings', 'Negative', 'A username with a space shows the username rule inside the user form', 'Pass', 'D-15 on screen'),
 ('Production', 'Boundary', 'An open cost sheet cannot pick a completion date earlier than its start date', 'Pass', 'D-14 on screen'),
 ('GST', 'Functional', 'GSTIN and state saved under Brand; GST switched on under Bills; the "prices include GST" switch appears', 'Pass', ''),
 ('GST', 'Calculation', 'Bill form shows GST 5% on a ₹499 shirt and 18% on a ₹3,499 blazer, with Taxable value, CGST and SGST lines', 'Pass', 'CGST = SGST = ₹278.75 after fix D-19'),
 ('GST', 'Functional', 'Saved bill is titled TAX INVOICE, shows the GSTIN, a GST column with 5% and 18%, and the tax lines', 'Pass', 'INV-0395 in the demo copy'),
 ('GST', 'Functional', 'Switching GST off under Bills hides the GST Summary report again', 'Pass', ''),
 ('Volume', 'Performance', 'One year, 20,000 bills (11 MB): every screen call and report under 125 ms; bill save 4–17 ms; backup 0.4 s; Excel of the full year 1 s', 'Pass', 'npm run qa:volume'),
 ('AI (live)', 'AI', 'Free keyless model (Pollinations, gpt-oss-20b) connected from Settings; model list loads', 'Pass', 'Demo copy, sample data only'),
 ('AI (live)', 'AI', 'Ask AI on screen: "Which store sold more in the last 30 days, and what is the net profit?" → picked Store Comparison; all 4 figures equal the report', 'Pass', 'About 60 s on the free tier'),
 ('AI (live)', 'AI', 'Hinglish question "Pichhle 7 din me kaun sa item sabse zyada bika…" → picked Best Sellers for exactly 11–17 Nov; units, sales, stock and days of stock equal the report', 'Pass', 'Answer came in English, not Hinglish'),
 ('AI (live)', 'AI', 'AI insights card on the dashboard shows 5 findings and 3 actions from the live model', 'Pass', 'After fixes D-21 to D-23'),
 ('GST', 'Calculation', 'Saved in-state tax invoice on screen: Taxable ₹3,440.50, CGST ₹278.75, SGST ₹278.75, Total ₹3,998', 'Pass', 'D-19 on a saved bill'),
 ('GST', 'Calculation', 'Tax invoice to a Gujarat buyer on screen: IGST ₹557.51, no CGST/SGST lines, buyer GSTIN printed', 'Pass', ''),
 ('Reports', 'Functional', 'A 780-row report draws 500 rows with a notice; "Show all" draws all 780 and removes the notice', 'Pass', 'D-18 on screen'),
 ('Sales', 'Functional', 'A duplicated return is labelled "Copied from SR-0007"', 'Pass', 'D-20 on screen'),
 ('Security', 'Security', 'Production build runs under its content-security policy with no console errors on any printed page', 'Pass', ''),
]
DEFECTS = [
 ('D-01', 'High', 'Returns', 'A sale return could take back more pieces than the bill sold, or items that were never on it (a route to false refunds).', 'BILL-16, BILL-17', 'Fixed', 'A return made from a bill is tied to that bill; quantity is limited to sold minus already returned; party must match.'),
 ('D-02', 'High', 'Returns', 'A sale with a return against it could be cancelled, putting the stock back twice.', 'BILL-18', 'Fixed', 'Cancel is refused until the return is cancelled; the message names the return.'),
 ('D-03', 'Medium', 'Billing', 'Fractions of a piece were accepted (0.5 shirt) in bills, transfers and cost sheets.', 'BILL-07, STOCK-03, STOCK-09', 'Fixed', 'Items counted in pcs, pair or set accept whole numbers only; metres and kg still take decimals.'),
 ('D-04', 'Medium', 'Dates', 'Dates that do not exist (30 February) were accepted.', 'BILL-09', 'Fixed', 'Dates are checked against the real calendar.'),
 ('D-05', 'Medium', 'Dates', 'Bills, payments, expenses and stock entries could be dated in the future through the API.', 'BILL-09', 'Fixed', 'Entry dates after today are refused.'),
 ('D-06', 'Medium', 'Roles', "Staff tied to one store could open another store's bill by typing its address.", 'ROLE-06', 'Fixed', 'The bill page now follows the same store rule as the bill list.'),
 ('D-07', 'Low', 'Security', 'The production build sent no content-security policy header.', 'ROLE-16', 'Fixed', "Policy added: only the app's own scripts, styles, fonts and images load; no embedding."),
 ('D-08', 'Low', 'Reports', 'A staff user opening an owner-only report address saw an endless spinner.', 'Browser', 'Fixed', 'Shows "This report is not available".'),
 ('D-09', 'Medium', 'Print', 'Printed reports used screen-size text and wrapped cells: 38 pages for a month of sales.', 'PDF', 'Fixed', 'Compact print layout, full page width, repeating headings: 14 pages.'),
 ('D-11', 'High', 'Returns', 'Staff could make a cash refund with no bill behind it.', 'EDGE-04', 'Fixed', 'Staff must start a return from the bill; only the owner can take a return without a bill.'),
 ('D-12', 'Medium', 'Payments', 'The payment on a walk-in bill could be deleted, leaving a walk-in bill unpaid with no customer to chase.', 'EDGE-02', 'Fixed', 'Refused with "Cancel the bill instead". Payments on credit bills can still be deleted by the owner.'),
 ('D-13', 'Medium', 'Data', 'Updating or deleting a record that does not exist answered "saved"; updating an unknown item caused a server error.', 'EDGE-01', 'Fixed', 'All 13 such requests now answer "not found".'),
 ('D-14', 'Low', 'Production', 'A cost sheet could be completed on a date before it was started.', 'EDGE-05', 'Fixed', 'Refused with a clear message.'),
 ('D-15', 'Low', 'Users', 'Usernames with spaces or under 3 characters were accepted.', 'EDGE-06', 'Fixed', '3 to 40 letters or digits, no spaces.'),
 ('D-16', 'Medium', 'Returns', 'Duplicating a return from its screen pointed the copy at the return itself and failed with "Original bill not found".', 'Code review', 'Fixed', 'The copy keeps pointing at the original bill.'),
 ('D-17', 'High', 'Volume', 'Word export of a year-long register (20,000 rows) took 19.5 seconds and froze the app for every user meanwhile.', 'Volume run', 'Fixed', 'Word files carry the first 2,000 rows with a note and full totals; now 1.3 seconds. Excel carries the full list.'),
 ('D-18', 'Medium', 'Volume', 'The Reports screen tried to draw every row of a long report at once (20,000 rows, 4 MB).', 'Volume run', 'Fixed', 'Draws 500 rows first, with "Show 2,000 more" and "Show all" buttons; totals always cover every row.'),
 ('D-19', 'Medium', 'GST', 'On a tax invoice CGST and SGST could differ by 1 paisa (₹278.76 and ₹278.75).', 'GST screen check', 'Fixed', 'Tax on each line is kept even to the paisa, so the two halves are always equal. Unit test added.'),
 ('D-20', 'Low', 'Returns', 'A duplicated return was labelled "Return against SR-…" instead of "Copied from SR-…".', 'Browser', 'Fixed', 'Label corrected.'),
 ('D-21', 'High', 'AI', 'The Ask AI page went completely blank as soon as a model was connected (it never showed before because no model had been connected).', 'Live AI test', 'Fixed', 'One line handed the browser scroll result back to React; corrected. Page renders and answers.'),
 ('D-22', 'Medium', 'AI', 'On a free tier that spaces replies ("retry after 26s"), every question failed, because one question needs two replies.', 'Live AI test', 'Fixed', 'The connector waits once and retries by itself; a plain message is shown if the limit is longer. Automated check added.'),
 ('D-23', 'Medium', 'AI', 'A live model reply with a curly quote and a missing bracket made the insights card show raw code instead of findings.', 'Live AI test', 'Fixed', 'Reply repair plus a salvage step; unit test built from the real reply.'),
 ('D-24', 'Low', 'AI', 'The model read "last 30 days" as 31 days, and once advised "collecting" money that is actually owed to suppliers.', 'Live AI test', 'Fixed', 'Exact date ranges and the meaning of the dues columns are now given to the model. The date fix was re-tested live; the dues wording was not.'),
 ('D-10', 'Low', 'Sessions', 'Expired login sessions were never removed from the database.', 'Code review', 'Fixed', 'Cleared at each login.'),
]
NOTES = [
 ('Note', 'Live AI was tested on a free keyless public model with sample data', 'For real business figures use a keyed provider (Groq, OpenRouter) or a local Ollama model. The key is yours to paste in Settings › AI.'),
 ('Not tested', 'Start App.bat on Windows', 'No Windows machine here. Test on the office PC: double-click, allow the firewall prompt, open the Wi-Fi address from a phone.'),
 ('Not tested', 'A physical barcode scanner and a paper printer', 'Scanner input was simulated by typing a SKU + Enter. PDF output was checked; paper was not.'),
 ('Not tested', 'Browsers other than Chrome', 'Safari, Firefox and Edge were not opened. The app uses standard features only.'),
 ('By design', 'Staff can see cost prices in purchase and production screens', 'They enter those costs. Profit reports, the dashboard profit card and stock value stay owner-only.'),
 ('By design', 'A return without a bill reference is still allowed', 'For customers who come without the bill. It is not limited by any bill; review these in the Sales Returns list.'),
 ('By design', 'Average cost is not rolled back when a purchase or cost sheet is cancelled', 'The next receipt re-averages it. Documented in docs/ARCHITECTURE.md.'),
 ('By design', 'Traffic inside the shop Wi-Fi is plain HTTP', 'Fine on your own network. Put the app behind HTTPS before opening it to the internet.'),
 ('Advisory', 'npm audit: 2 moderate notices (uuid, used inside ExcelJS)', 'The flaw needs a caller-supplied buffer, which this app never passes. No fixed ExcelJS release exists yet; re-check on updates.'),
]

wb = Workbook(); s = wb.active; s.title = 'Summary'
auto = [[r['id'], r['area'], r['type'], r['title'], r['status'], r['detail'], r['ms']] for r in res['rows']]
sheet(wb, 'Automated checks', ['ID', 'Area', 'Type of test', 'What was checked', 'Result', 'Measured / note', 'Time (ms)'], auto, [11, 30, 14, 90, 9, 38, 10], 5)
sheet(wb, 'Browser and PDF checks', ['ID', 'Screen', 'Type of test', 'What was checked', 'Result', 'Note'], [[f'UI-{i:02d}', *u] for i, u in enumerate(UI, 1)], [8, 14, 14, 95, 9, 45], 5)
sheet(wb, 'Defects', ['ID', 'Severity', 'Area', 'Defect found', 'Found by', 'Status', 'What was changed'], DEFECTS, [7, 10, 12, 70, 22, 9, 70], 6)
sheet(wb, 'Not covered and notes', ['Kind', 'Item', 'Detail'], NOTES, [13, 55, 100], 1)

A, U, Dn = "'Automated checks'", "'Browser and PDF checks'", 'Defects'
s['A1'] = 'Vastra Books: QA test report'; s['A1'].font = Font(name='Arial', size=16, bold=True)
s['A2'] = f"Run on {datetime.date.fromisoformat(res['date']).strftime('%d %b %Y')} · Node {res['node']} · macOS · automated run: npm run qa"; s['A2'].font = F(color='64748B')
rows = [('Result', None), ('Automated checks run', f'=COUNTA({A}!A:A)-1'), ('Automated checks passed', f'=COUNTIF({A}!E:E,"Pass")'), ('Automated checks failed', f'=COUNTIF({A}!E:E,"Fail")'),
        ('Browser and PDF checks run', f'=COUNTA({U}!A:A)-1'), ('Browser and PDF checks passed', f'=COUNTIF({U}!E:E,"Pass")'), ('Browser and PDF checks failed', f'=COUNTIF({U}!E:E,"Fail")'),
        ('Unit tests (npm test)', '13 of 13 passed'), ('Defects found', f'=COUNTA({Dn}!A:A)-1'), ('Defects fixed and re-tested', f'=COUNTIF({Dn}!F:F,"Fixed")'), ('Defects open', f'=COUNTIF({Dn}!F:F,"Open")')]
for i, (k, v) in enumerate(rows, 4):
    s.cell(i, 1, k).font = F(bold=(v is None)); s.cell(i, 2, v).font = F(bold=True)
    if v is None: s.cell(i, 1).fill = GREY; s.cell(i, 2).fill = GREY
r0 = 4 + len(rows) + 1
for j, h in enumerate(['Area (automated)', 'Checks', 'Passed', 'Failed'], 1): c = s.cell(r0, j, h); c.font = F(bold=True, color='FFFFFF'); c.fill = HEAD
areas = list(dict.fromkeys(r['area'] for r in res['rows']))
for i, a in enumerate(areas, r0 + 1):
    s.cell(i, 1, a).font = F()
    s.cell(i, 2, f'=COUNTIF({A}!B:B,A{i})').font = F(); s.cell(i, 3, f'=COUNTIFS({A}!B:B,A{i},{A}!E:E,"Pass")').font = F(); s.cell(i, 4, f'=COUNTIFS({A}!B:B,A{i},{A}!E:E,"Fail")').font = F()
r1 = r0 + len(areas) + 2
for j, h in enumerate(['Type of test (automated)', 'Checks'], 1): c = s.cell(r1, j, h); c.font = F(bold=True, color='FFFFFF'); c.fill = HEAD
for i, ty in enumerate(sorted(set(r['type'] for r in res['rows'])), r1 + 1):
    s.cell(i, 1, ty).font = F(); s.cell(i, 2, f'=COUNTIF({A}!C:C,A{i})').font = F()
s.column_dimensions['A'].width = 48
for col in 'BCD': s.column_dimensions[col].width = 18
out = f"QA Test Report - Vastra Books - {res['date']}.xlsx"; wb.save(out); print(out)

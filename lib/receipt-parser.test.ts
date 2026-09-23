import test from "node:test";
import assert from "node:assert/strict";
import {
  parseReceiptEmail,
  detectService,
  extractAmount,
  normalizeArabicDigits,
  stripHtml,
} from "./receipt-parser";

test("normalizeArabicDigits converts Arabic-Indic numerals to ASCII", () => {
  assert.equal(normalizeArabicDigits("٩٤.٥٠ ج.م"), "94.50 ج.م");
  assert.equal(normalizeArabicDigits("المجموع: ١٢٠"), "المجموع: 120");
});

test("stripHtml removes tags, styles, and extra whitespace", () => {
  const html = `<div><style>.test{color:red;}</style><h1>Uber Receipt</h1><p>Total: &nbsp;EGP 95.00</p></div>`;
  assert.equal(stripHtml(html), "Uber Receipt Total: EGP 95.00");
});

test("detectService detects Uber, DiDi, Careem, and inDrive", () => {
  assert.equal(detectService("Your trip with Uber"), "uber");
  assert.equal(detectService("رحلتك مع اوبر"), "uber");
  assert.equal(detectService("DiDi Trip Receipt #1234"), "didi");
  assert.equal(detectService("إيصال رحلة ديدي"), "didi");
  assert.equal(detectService("Careem booking details"), "careem");
  assert.equal(detectService("inDrive receipt"), "indrive");
  assert.equal(detectService("Random receipt from bakery"), "unknown");
});

test("parseReceiptEmail parses standard Uber English receipt", () => {
  const email = `
    Thanks for riding with us, Omar
    Total: EGP 86.50
    September 21, 2026 at 08:30 AM
    Pickup: Nasr City
    Dropoff: University Campus
  `;
  const result = parseReceiptEmail(email, { subject: "Your Monday morning trip with Uber" });
  assert.equal(result.service, "uber");
  assert.equal(result.amount, 86.5);
  assert.equal(result.direction, "campus");
  assert.equal(result.confidence, "high");
  assert.ok(result.ride_at.startsWith("2026-09-21"));
  assert.equal(result.notes, "Uber receipt auto-logged");
});

test("parseReceiptEmail parses Uber HTML receipt with subtotals", () => {
  const html = `
    <html>
      <body>
        <div>Uber Receipt</div>
        <table>
          <tr><td>Trip fare</td><td>EGP 70.00</td></tr>
          <tr><td>Tolls</td><td>EGP 10.00</td></tr>
          <tr><td>Total</td><td>EGP 80.00</td></tr>
        </table>
        <div>Dropoff: New Cairo Home</div>
      </body>
    </html>
  `;
  const result = parseReceiptEmail(html, { subject: "Your trip with Uber", emailDate: "2026-09-21T15:00:00Z" });
  assert.equal(result.service, "uber");
  assert.equal(result.amount, 80);
  assert.equal(result.direction, "home");
  assert.equal(result.confidence, "high");
});

test("parseReceiptEmail parses DiDi English receipt", () => {
  const email = `
    DiDi Trip Receipt
    Total Paid: EGP 62.00
    2026-09-21 14:10
    From: Faculty of Engineering, AUC Campus
    To: Home
  `;
  const result = parseReceiptEmail(email, { subject: "DiDi Trip Invoice" });
  assert.equal(result.service, "didi");
  assert.equal(result.amount, 62);
  assert.equal(result.direction, "home"); // Destination is Home
  assert.equal(result.confidence, "high");
});

test("parseReceiptEmail parses Arabic receipt with Arabic numerals", () => {
  const email = `
    شكراً لاستخدامك ديدي
    المبلغ الإجمالي: ٧٥.٥٠ ج.م
    تاريخ الرحلة: 2026-09-21
  `;
  const result = parseReceiptEmail(email, { subject: "إيصال رحلة ديدي" });
  assert.equal(result.service, "didi");
  assert.equal(result.amount, 75.5);
  assert.equal(result.confidence, "high");
});

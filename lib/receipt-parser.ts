/**
 * Ridewise Receipt Parser
 * Automatically parses ride receipts from Uber, DiDi, Careem, etc.
 * Supports plain text, HTML, English, and Arabic formats.
 */

export interface ParsedReceipt {
  service: "uber" | "didi" | "careem" | "indrive" | "unknown";
  amount: number | null;
  ride_at: string; // ISO 8601 string
  direction: "campus" | "home";
  notes: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Converts Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) to standard ASCII digits (0-9).
 */
export function normalizeArabicDigits(input: string): string {
  const arabicDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  let out = input;
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(arabicDigits[i], String(i));
  }
  return out;
}

/**
 * Strips HTML tags and normalizes whitespace.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects the ride hailing service from email text or subject.
 */
export function detectService(text: string): ParsedReceipt["service"] {
  const lower = text.toLowerCase();
  if (lower.includes("uber") || lower.includes("أوبر") || lower.includes("اوبر")) return "uber";
  if (lower.includes("didi") || lower.includes("ديدي")) return "didi";
  if (lower.includes("careem") || lower.includes("كريم")) return "careem";
  if (lower.includes("indrive") || lower.includes("ان درايف") || lower.includes("اندرايف")) return "indrive";
  return "unknown";
}

/**
 * Extracts ride fare / total amount in EGP.
 */
export function extractAmount(text: string): { amount: number | null; confidence: "high" | "medium" | "low" } {
  const clean = normalizeArabicDigits(text);

  // High Priority: Strict Total phrases (takes precedence over subtotals like "trip fare" or "tolls")
  const strictTotalRegexes = [
    /(?:total\s*paid|المبلغ\s*الإجمالي)[:\s]*(?:egp|le|l\.e\.|ج\.م)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:egp|le|l\.e\.|ج\.م)?/i,
    /\btotal\b[:\s]*(?:egp|le|l\.e\.|ج\.م)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:egp|le|l\.e\.|ج\.م)?/i,
    /(?:المجموع|الإجمالي)[:\s]*(?:egp|le|l\.e\.|ج\.م)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:egp|le|l\.e\.|ج\.م)?/i,
    /(?:egp|le|l\.e\.|ج\.م)\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:\n|\r|\s)*(?:total|المجموع)/i,
  ];

  // In HTML tables, find all matches for Total and take the last/largest one (handles multiple totals/subtotals)
  for (const regex of strictTotalRegexes) {
    const globalRegex = new RegExp(regex.source, "gi");
    let match: RegExpExecArray | null;
    let foundVal: number | null = null;
    while ((match = globalRegex.exec(clean)) !== null) {
      if (match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        if (Number.isFinite(val) && val > 0 && val < 10000) {
          foundVal = val;
        }
      }
    }
    if (foundVal !== null) {
      return { amount: foundVal, confidence: "high" };
    }
  }

  // Medium Priority: "Fare" or "Cost"
  const fareMatch = clean.match(/(?:trip\s*fare|fare|cost)[:\s]*(?:egp|le|l\.e\.|ج\.م)?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
  if (fareMatch && fareMatch[1]) {
    const val = parseFloat(fareMatch[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0 && val < 10000) {
      return { amount: val, confidence: "medium" };
    }
  }

  // Fallback: All standalone currency mentions
  const currencyMatches: number[] = [];
  const currRegexes = [
    /(?:egp|le|l\.e\.|ج\.م)\s*([0-9]+(?:[.,][0-9]{1,2})?)/gi,
    /([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:egp|le|l\.e\.|ج\.م)/gi,
  ];

  for (const regex of currRegexes) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(clean)) !== null) {
      if (m[1]) {
        const val = parseFloat(m[1].replace(",", "."));
        if (Number.isFinite(val) && val > 5 && val < 10000) {
          currencyMatches.push(val);
        }
      }
    }
  }

  if (currencyMatches.length > 0) {
    return { amount: Math.max(...currencyMatches), confidence: "medium" };
  }

  return { amount: null, confidence: "low" };
}

/**
 * Extracts or computes the ride date and time.
 */
export function extractDate(text: string, fallbackDate: Date = new Date()): string {
  const clean = normalizeArabicDigits(text);

  // Look for ISO timestamps: "2026-09-21", "2026-09-21 14:15"
  const isoMatch = clean.match(/\b(202\d-[01]\d-[0-3]\d(?:[T\s][0-2]\d:[0-5]\d(?::[0-5]\d)?)?)\b/);
  if (isoMatch) {
    const d = new Date(isoMatch[1].replace(" ", "T"));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Look for standard written dates: "September 21, 2026 at 08:30 AM" or "Sep 21, 2026"
  const standardDateMatch = clean.match(
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}(?:\s*(?:at|,)?\s*\d{1,2}:\d{2}\s*(?:am|pm)?)?/i
  );
  if (standardDateMatch) {
    const sanitized = standardDateMatch[0].replace(/\s+at\s+/i, " ").replace(",", "");
    const d = new Date(sanitized);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const dayFirstMatch = clean.match(
    /\b\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4}(?:\s*(?:at|,)?\s*\d{1,2}:\d{2}\s*(?:am|pm)?)?/i
  );
  if (dayFirstMatch) {
    const sanitized = dayFirstMatch[0].replace(/\s+at\s+/i, " ");
    const d = new Date(sanitized);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Fallback to provided date (e.g. email reception timestamp)
  return fallbackDate.toISOString();
}

/**
 * Determines trip direction: "campus" or "home".
 */
export function extractDirection(text: string, rideDate: Date): "campus" | "home" {
  const lower = text.toLowerCase();

  const campusKeywords = ["campus", "university", "auc", "guc", "bue", "جامعة", "الجامعة", "college", "faculty", "acad"];
  const homeKeywords = ["home", "البيت", "المنزل", "residence", "house"];

  // Check destination line first if explicitly present ("To: ...", "Dropoff: ...", "إلى: ...")
  const destMatch = lower.match(/(?:to|dropoff|destination|إلى|الوصول)[:\s]+([^,\n\r]+)/i);
  if (destMatch && destMatch[1]) {
    const dest = destMatch[1];
    if (campusKeywords.some((k) => dest.includes(k))) return "campus";
    if (homeKeywords.some((k) => dest.includes(k))) return "home";
  }

  // Check general keywords across the receipt
  const hasCampus = campusKeywords.some((k) => lower.includes(k));
  const hasHome = homeKeywords.some((k) => lower.includes(k));

  if (hasCampus && !hasHome) return "campus";
  if (hasHome && !hasCampus) return "home";

  // Fallback based on Cairo commute time:
  // Before 1:00 PM (13:00) -> going to campus
  // 1:00 PM or later -> heading home
  const hours = rideDate.getHours();
  return hours < 13 ? "campus" : "home";
}

/**
 * Main parser entry point.
 */
export function parseReceiptEmail(
  rawContent: string,
  options: {
    subject?: string;
    emailDate?: string | Date;
  } = {}
): ParsedReceipt {
  const subject = options.subject ?? "";
  const combined = `${subject}\n${rawContent}`;
  const plainText = stripHtml(combined);

  const service = detectService(plainText);
  const { amount, confidence } = extractAmount(plainText);

  const fallbackDate = options.emailDate ? new Date(options.emailDate) : new Date();
  const validFallback = isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate;

  const ride_at = extractDate(plainText, validFallback);
  const dateObj = new Date(ride_at);
  const direction = extractDirection(plainText, dateObj);

  const serviceLabel =
    service === "uber"
      ? "Uber"
      : service === "didi"
      ? "DiDi"
      : service === "careem"
      ? "Careem"
      : service === "indrive"
      ? "inDrive"
      : "Ride";

  const notes = `${serviceLabel} receipt auto-logged`;

  return {
    service,
    amount,
    ride_at,
    direction,
    notes,
    confidence,
  };
}

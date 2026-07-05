// Turn uploaded files (docx / xlsx / csv / txt / md) into plain text.
import path from "path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";

export async function fileToText(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if ([".xlsx", ".xls", ".csv"].includes(ext)) {
    const wb = XLSX.read(file.buffer, { type: "buffer" });
    return wb.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      return `--- sheet: ${name} ---\n${csv}`;
    }).join("\n\n");
  }
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }
  return file.buffer.toString("utf8");
}

/**
 * Split a pasted blob of many sample scripts into individual scripts.
 * Tries separators from most to least explicit; the first pattern that
 * actually produces 2+ chunks wins. If nothing splits, the whole blob is
 * returned as one sample — the style analyst then identifies the individual
 * scripts itself.
 */
const SPLIT_PATTERNS = [
  /\n\s*(?:-{3,}|={3,}|#{3,}|\*{3,}|_{3,})\s*\n/,             // ---  ===  ###  ***  ___
  /\n\s*(?:script|reel|video|hook)\s*#?\d+\s*[:.)\-]?\s*\n/i,  // "Script 12:" on its own line
  /\n\s*\d{1,3}\s*[).:\-]?\s*\n/,                              // a bare "12." / "12)" line
  /\n\s*\n(?=\s*hook\b\s*[:\-–—])/i,                           // blank line before "HOOK:"
  /\n{3,}/                                                     // 2+ empty lines between scripts
];

export function splitScripts(blob) {
  const text = String(blob || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  for (const re of SPLIT_PATTERNS) {
    const parts = text.split(re).map((s) => s.trim()).filter((s) => s.length > 40);
    if (parts.length >= 2) return parts;
  }
  return [text];
}

/** CSV encoding and streaming. RFC 4180 quoting, CRLF line endings. */

export type CsvValue = string | number | boolean | null | undefined;

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Encode one field. Strings that a spreadsheet would run as a formula are
 * prefixed with an apostrophe (numbers are left alone, so -0.12 stays numeric).
 */
export function encodeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = value;
  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function encodeRow(row: readonly CsvValue[]): string {
  return row.map(encodeField).join(",") + "\r\n";
}

/**
 * Stream rows as UTF-8 CSV. Rows are pulled lazily from the iterable, so the
 * whole file is never held as one string; `chunkRows` rows are encoded per
 * enqueue.
 */
export function csvStream(
  rows: Iterable<readonly CsvValue[]>,
  options: { chunkRows?: number; bom?: boolean } = {},
): ReadableStream<Uint8Array> {
  const chunkRows = Math.max(1, options.chunkRows ?? 200);
  const encoder = new TextEncoder();
  const iterator = rows[Symbol.iterator]();
  let first = true;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      let buffer = first && options.bom ? "﻿" : "";
      first = false;
      let count = 0;
      while (count < chunkRows) {
        const next = iterator.next();
        if (next.done) {
          if (buffer) controller.enqueue(encoder.encode(buffer));
          controller.close();
          return;
        }
        buffer += encodeRow(next.value);
        count += 1;
      }
      controller.enqueue(encoder.encode(buffer));
    },
  });
}

/** Test helper and small-file convenience: drain a stream to a string. */
export async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

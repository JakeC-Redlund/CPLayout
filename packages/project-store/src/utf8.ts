import { strFromU8 } from "fflate";

/** Preserve exact text, including a leading BOM, with native or portable fflate decoders. */
export function decodeUtf8Strict(bytes: Uint8Array, label: string): string {
  const matches = (text: string): boolean => {
    let index = 0;
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 8192, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      // The language's UTF-8 encoder handles surrogate pairs without TextEncoder or fflate's fallback.
      const encoded = encodeURIComponent(text.slice(start, end));
      for (let offset = 0; offset < encoded.length; offset++) {
        const escaped = encoded[offset] === "%";
        const value = escaped ? Number.parseInt(encoded.slice(offset + 1, offset + 3), 16) : encoded.charCodeAt(offset);
        if (escaped) offset += 2;
        if (value !== bytes[index++]) return false;
      }
      start = end;
    }
    return index === bytes.byteLength;
  };
  try {
    const text = strFromU8(bytes);
    if (matches(text)) return text;
    // Native TextDecoder can consume one BOM; it is data unless the format layer removes it.
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && matches(`\ufeff${text}`)) return `\ufeff${text}`;
  } catch {
    // Portable decoder failures and noncanonical encodings have the same admission outcome.
  }
  throw new Error(`${label} invalid UTF-8 encoding; use a valid UTF-8 file.`);
}

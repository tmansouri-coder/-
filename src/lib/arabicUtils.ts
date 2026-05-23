// This is a minimal check for Arabic support. 
// Standard jsPDF doesn't support Arabic, so we need a font and reshaping.
import { reshape } from 'arabic-reshaper';
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

export function fixArabic(text: string | undefined | null): string {
  if (!text) return '';
  // Check if text contains Arabic characters
  const arabicPattern = /[\u0600-\u06FF]/;
  if (!arabicPattern.test(text)) return text;

  try {
    const reshaped = reshape(text);
    return bidi.getReorderedArabic(reshaped);
  } catch (e) {
    console.error('Arabic reshaping error:', e);
    return text;
  }
}

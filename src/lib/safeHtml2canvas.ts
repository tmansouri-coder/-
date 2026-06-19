import html2canvas from 'html2canvas';

// OKLCH coordinates conversion to RGB
function convertOklchToRgb(oklchStr: string): string | null {
  // Matches oklch(L C H) or oklch(L C H / alpha)
  const regex = /oklch\(\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)(?:\s*[\/\s,]\s*([\d.%]+))?\s*\)/i;
  const match = oklchStr.match(regex);
  if (!match) return null;
  const L = parseFloat(match[1]);
  const C = parseFloat(match[2]);
  const H = parseFloat(match[3]);
  const A = match[4] ? (match[4].endsWith('%') ? parseFloat(match[4])/100 : parseFloat(match[4])) : 1;
  return oklchToRgba(L, C, H, A);
}

// OKLAB coordinates conversion to RGB
function convertOklabToRgb(oklabStr: string): string | null {
  // Matches oklab(L a b) or oklab(L a b / alpha)
  const regex = /oklab\(\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)(?:\s*[\/\s,]\s*([\d.%]+))?\s*\)/i;
  const match = oklabStr.match(regex);
  if (!match) return null;
  const L = parseFloat(match[1]);
  const a = parseFloat(match[2]);
  const b = parseFloat(match[3]);
  const A = match[4] ? (match[4].endsWith('%') ? parseFloat(match[4])/100 : parseFloat(match[4])) : 1;
  return oklabToRgba(L, a, b, A);
}

function oklchToRgba(L: number, C: number, H: number, alpha = 1): string {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return oklabToRgba(L, a, b, alpha);
}

function oklabToRgba(L: number, a: number, b: number, alpha = 1): string {
  // 1. Convert OKLab to LMS
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  // 2. Decode LMS
  const l = Math.pow(Math.max(0, l_), 3);
  const m = Math.pow(Math.max(0, m_), 3);
  const s = Math.pow(Math.max(0, s_), 3);

  // 3. LMS to Linear sRGB
  const r_lin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  // 4. Linear sRGB to standard sRGB (gamma correction)
  const f = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  
  const outR = Math.max(0, Math.min(255, Math.round(f(r_lin) * 255)));
  const outG = Math.max(0, Math.min(255, Math.round(f(g_lin) * 255)));
  const outB = Math.max(0, Math.min(255, Math.round(f(b_lin) * 255)));

  return `rgba(${outR}, ${outG}, ${outB}, ${alpha})`;
}

function sanitizeOklchColor(propertyName: string, value: any): any {
  if (typeof value !== 'string') return value;
  
  let sanitized = value;
  
  // Replace oklch(...) 
  const oklchRegex = /oklch\(\s*[\d.-]+\s+[\d.-]+\s+[\d.-]+(?:\s*[\/\s,]\s*[\d.%]+)?\s*\)/gi;
  sanitized = sanitized.replace(oklchRegex, (match) => {
    try {
      const converted = convertOklchToRgb(match);
      return converted || match;
    } catch {
      return match;
    }
  });

  // Replace oklab(...)
  const oklabRegex = /oklab\(\s*[\d.-]+\s+[\d.-]+\s+[\d.-]+(?:\s*[\/\s,]\s*[\d.%]+)?\s*\)/gi;
  sanitized = sanitized.replace(oklabRegex, (match) => {
    try {
      const converted = convertOklabToRgb(match);
      return converted || match;
    } catch {
      return match;
    }
  });

  return sanitized;
}

export default async function safeHtml2canvas(
  element: HTMLElement,
  options?: any
): Promise<HTMLCanvasElement> {
  const styleElements = Array.from(document.querySelectorAll('style'));
  const linkElements = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];

  // Save original style content
  const savedStyles = styleElements.map(style => ({
    element: style,
    originalText: style.textContent || ''
  }));

  // Save original link active status
  const savedLinks = linkElements.map(link => ({
    element: link,
    disabled: link.disabled
  }));

  const inlineStylesCreated: HTMLStyleElement[] = [];

  // Temporary monkeypatch window.getComputedStyle to translate oklch / oklab colors dynamically
  const originalGetComputedStyle = window.getComputedStyle;
  
  window.getComputedStyle = function (el: Element, pseudoElt?: string) {
    const style = originalGetComputedStyle.call(this, el, pseudoElt);
    return new Proxy(style, {
      get(target, prop) {
        const val = Reflect.get(target, prop);
        if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab'))) {
          return sanitizeOklchColor(String(prop), val);
        }
        if (typeof val === 'function') {
          if (prop === 'getPropertyValue') {
            return function(propertyName: string) {
              const v = target.getPropertyValue(propertyName);
              if (typeof v === 'string' && (v.includes('oklch') || v.includes('oklab'))) {
                return sanitizeOklchColor(propertyName, v);
              }
              return v;
            };
          }
          return val.bind(target);
        }
        return val;
      }
    }) as CSSStyleDeclaration;
  };

  try {
    // 1. Process link elements. If same-origin, convert rules to inline, replacing oklch & oklab
    for (const link of linkElements) {
      try {
        const sheet = Array.from(document.styleSheets).find(s => s.ownerNode === link);
        if (sheet) {
          const rulesText = Array.from(sheet.cssRules)
            .map(rule => rule.cssText)
            .join('\n');
          
          if (rulesText.includes('oklch') || rulesText.includes('oklab')) {
            const cleanedRules = sanitizeOklchColor('stylesheet', rulesText);
            const newStyle = document.createElement('style');
            newStyle.textContent = cleanedRules;
            document.head.appendChild(newStyle);
            inlineStylesCreated.push(newStyle);
            
            // Disable original linked stylesheet so html2canvas doesn't try to parse it
            link.disabled = true;
          }
        }
      } catch (err) {
        // Suppress errors (like CORS or inaccessible stylesheets)
        console.warn('Skipped oklch/oklab conversion for external stylesheet:', link.href, err);
      }
    }

    // 2. Process inline <style> tags and clean of oklch & oklab
    styleElements.forEach(style => {
      if (style.textContent && (style.textContent.includes('oklch') || style.textContent.includes('oklab'))) {
        style.textContent = sanitizeOklchColor('inline-style', style.textContent);
      }
    });

    // 3. Ensure all web fonts (such as Almarai) are fully loaded so Arabic text renders perfectly without fallback
    if (document.fonts && typeof document.fonts.ready !== 'undefined') {
      await document.fonts.ready;
    }

    // 4. Render the standard html2canvas wrapper
    return await html2canvas(element, options);

  } finally {
    // Restore window.getComputedStyle
    window.getComputedStyle = originalGetComputedStyle;

    // Restore original inline style tags
    savedStyles.forEach(saved => {
      saved.element.textContent = saved.originalText;
    });

    // Restore original link elements
    savedLinks.forEach(saved => {
      saved.element.disabled = saved.disabled;
    });

    // Delete the temporary generated style tags
    inlineStylesCreated.forEach(el => el.remove());
  }
}

// Turns an HTML template into a PNG with a headless Chrome or Edge.
//
// Rendering is kept repeatable: a fixed viewport and pixel ratio, no font
// hinting or LCD text, sRGB colors, and no network unless asked for. Fonts are
// passed in as files and embedded, so a figure looks the same on any machine
// that has the font file, whatever fonts the system has.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import puppeteer, { type Browser } from 'puppeteer-core';

import { findBrowser } from './browser.js';

export { BrowserNotFoundError, browserCandidates, findBrowser } from './browser.js';

export interface FontFile {
  /** The CSS font-family name the template uses. */
  family: string;
  /** Path to a .ttf, .otf, .woff or .woff2 file. */
  path: string;
  weight?: number | string;
  style?: 'normal' | 'italic';
}

export interface RenderOptions {
  /** Viewport width in CSS pixels. Default 1200. */
  width?: number;
  /** Viewport height in CSS pixels; the shot grows past it to fit the element. Default 800. */
  height?: number;
  /** Device pixel ratio: 2 gives sharp images on high-density screens. Default 2. */
  scale?: number;
  /** CSS selector of the element to capture. Default "body"; give body `display: inline-block` to shrink-wrap the content. */
  selector?: string;
  /** Fonts to embed, so the result doesn't depend on installed fonts. */
  fonts?: FontFile[];
  /** Allow http(s) requests, such as remote images. Default false: everything must be inline or embedded. */
  allowNetwork?: boolean;
  /** Browser executable; default is findBrowser(). */
  executablePath?: string;
  /**
   * Run the browser without its sandbox. Only for trusted templates with the
   * network off, where the system blocks the sandbox (CI containers, Chrome
   * for Testing on Ubuntu). DRAFTSMAN_NO_SANDBOX=1 does the same.
   */
  noSandbox?: boolean;
}

const FONT_TYPES: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function fontFaceCss(fonts: FontFile[]): Promise<string> {
  const rules = await Promise.all(
    fonts.map(async (f) => {
      const type = FONT_TYPES[path.extname(f.path).toLowerCase()];
      if (!type) throw new Error(`unsupported font file ${f.path}; use .ttf, .otf, .woff or .woff2`);
      const data = (await readFile(f.path)).toString('base64');
      return (
        `@font-face { font-family: ${JSON.stringify(f.family)}; src: url(data:${type};base64,${data}); ` +
        `font-weight: ${f.weight ?? 'normal'}; font-style: ${f.style ?? 'normal'}; }`
      );
    }),
  );
  return rules.join('\n');
}

/** Puts a <style> block at the start of the document's <head>, or of the document if it has none. */
function withHeadStyle(html: string, css: string): string {
  const style = `<style>\n${css}\n</style>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + style + html.slice(head.index + head[0].length);
  return style + html;
}

/** Fills {{name}} markers in a template, HTML-escaping each value. Unknown markers are an error. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  const escape = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`template value "${name}" is missing`);
    return escape(String(values[name]));
  });
}

const BROWSER_ARGS = [
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
];

/** Renders an HTML document to PNG bytes. */
export async function renderHtml(html: string, options: RenderOptions = {}): Promise<Buffer> {
  const { width = 1200, height = 800, scale = 2, selector = 'body', fonts = [], allowNetwork = false } = options;

  const args = [...BROWSER_ARGS];
  // Never the default; see RenderOptions.noSandbox.
  if (options.noSandbox || process.env['DRAFTSMAN_NO_SANDBOX'] === '1') args.push('--no-sandbox');

  const browser: Browser = await puppeteer.launch({
    executablePath: options.executablePath ?? findBrowser(),
    headless: true,
    args,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scale });

    if (!allowNetwork) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('about:')) void req.continue();
        else void req.abort('blockedbyclient');
      });
    }

    // The font rules go into the page before it loads, then each font is
    // loaded and checked by name. Adding them afterwards and waiting on
    // document.fonts.ready raced: in CI the shot was taken with the fallback
    // font (Nov 25), which no test here could see because this machine's
    // fallback was the same font.
    const pageHtml = fonts.length ? withHeadStyle(html, await fontFaceCss(fonts)) : html;
    await page.setContent(pageHtml, { waitUntil: 'load' });
    // document.fonts.check() is no use here: it says true when no face of
    // that family exists at all. Each declared face's own status is checked.
    // (No named functions inside: tsx injects a __name helper the page lacks.)
    const missing = await page.evaluate(async (families: string[]) => {
      const faces = [...document.fonts];
      await Promise.all(faces.map((f) => f.load().catch(() => undefined)));
      await document.fonts.ready;
      return families.filter(
        (family) => !faces.some((f) => f.family.replace(/^["']|["']$/g, '') === family && f.status === 'loaded'),
      );
    }, fonts.map((f) => f.family));
    if (missing.length) throw new Error(`font(s) did not load: ${missing.join(', ')}`);

    const element = await page.$(selector);
    if (!element) throw new Error(`nothing in the template matches "${selector}"`);
    const png = await element.screenshot({ type: 'png', omitBackground: false });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}

// build_carousel: a portrait slide deck (Marp markdown) and PDF, 1080 by 1350,
// from the article's summary block and its images.

import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Marp } from '@marp-team/marp-core';

import { ImageError } from './images.js';
import { findFences, isBlank, parseDoc } from './markdown.js';
import { renderPdf, type RenderOptions } from './render/index.js';
import type { LoadedStyle } from './styles.js';

export const SLIDE = { width: 1080, height: 1350 };
export const DEFAULT_SUMMARY_HEADINGS = ['Executive Summary', 'Summary', 'Key takeaways'];

export interface SummaryPoint {
  /** The bold label, for "**The Problem:** \u2026" points. */
  label: string | null;
  /** The point's markdown. */
  markdown: string;
}

export interface Summary {
  /** 1-based line of the heading. */
  line: number;
  heading: string;
  /** Paragraphs before the points, when the points are bullets. */
  lead: string | null;
  points: SummaryPoint[];
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;
const LABELED = /^\*\*([^*]+?):?\*\*:?\s*(.*)$/s;

const plain = (s: string) =>
  s
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Joins a run of lines into paragraphs (split on blank lines). */
function paragraphsOf(lines: string[]): string[] {
  const out: string[][] = [[]];
  for (const l of lines) {
    if (isBlank(l)) {
      if (out[out.length - 1]!.length) out.push([]);
    } else out[out.length - 1]!.push(l.trim());
  }
  return out.filter((p) => p.length).map((p) => p.join(' '));
}

/**
 * The summary block: the section under a heading named like one of `names`
 * (any level, also inside a blockquote), up to the next heading, thematic
 * break, or the end of the blockquote.
 */
export function findSummary(text: string, names = DEFAULT_SUMMARY_HEADINGS): Summary | null {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  const wanted = names.map((n) => n.toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    if (fenceOf[i]) continue;
    const quoted = /^ {0,3}>/.test(lines[i]!);
    const unquote = (l: string) => (quoted ? l.replace(/^ {0,3}> ?/, '') : l);
    const h = HEADING.exec(unquote(lines[i]!));
    if (!h) continue;
    const heading = plain(h[2]!);
    const lower = heading.toLowerCase();
    if (!wanted.some((n) => lower === n || lower.startsWith(`${n}:`) || lower.startsWith(`${n} \u2014`) || lower.startsWith(`${n} -`))) continue;

    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (quoted && !/^ {0,3}>/.test(lines[j]!)) break;
      const l = unquote(lines[j]!);
      if (!fenceOf[j] && (HEADING.test(l) || RULE.test(l))) break;
      body.push(l);
    }

    // Bullets win; then bold-labeled paragraphs; then the one paragraph.
    const items: string[][] = [];
    const lead: string[] = [];
    for (const l of body) {
      const m = ITEM.exec(l);
      if (m) items.push([m[2]!]);
      else if (items.length && !isBlank(l)) items[items.length - 1]!.push(l.trim());
      else if (!items.length) lead.push(l);
    }
    if (items.length) {
      const leadText = paragraphsOf(lead).join('\n\n');
      return { line: i + 1, heading, lead: leadText || null, points: items.map((it) => ({ label: null, markdown: it.join(' ') })) };
    }
    const paras = paragraphsOf(body);
    const labeled = paras.map((p) => LABELED.exec(p));
    if (labeled.length && labeled.every((m) => m)) {
      return { line: i + 1, heading, lead: null, points: labeled.map((m) => ({ label: plain(m![1]!), markdown: m![2]!.trim() })) };
    }
    if (paras.length === 1) return { line: i + 1, heading, lead: null, points: [{ label: null, markdown: paras[0]! }] };
    if (paras.length > 1) {
      // Some paragraphs labeled, some not: the unlabeled ones lead, the labeled ones are points.
      const pts = paras.flatMap((p) => {
        const m = LABELED.exec(p);
        return m ? [{ label: plain(m[1]!), markdown: m[2]!.trim() }] : [];
      });
      if (pts.length) return { line: i + 1, heading, lead: paras.filter((p) => !LABELED.test(p)).join('\n\n') || null, points: pts };
      return { line: i + 1, heading, lead: null, points: [{ label: null, markdown: paras.join(' ') }] };
    }
  }
  return null;
}

export interface ArticleImage {
  /** Path relative to the article, as written. */
  src: string;
  alt: string;
  /** The credit from its provenance file, when it has one. */
  credit: string | null;
  /** License obligations from its provenance file. */
  obligations: string[];
}

/** Local images in the article, in order: not placeholders, not remote, not tables or pull quotes. */
export async function articleImages(text: string, articleDir: string): Promise<ArticleImage[]> {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  const out: ArticleImage[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenceOf[i]) continue;
    for (const m of lines[i]!.matchAll(/!\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const src = m[2]!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue; // draftsman:pending, http(s):, data:
      const file = path.resolve(articleDir, decodeURI(src));
      if (!existsSync(file)) continue;
      const prov = file.replace(/\.[^.]+$/, '.provenance.json');
      let credit: string | null = null;
      let obligations: string[] = [];
      if (existsSync(prov)) {
        try {
          const p = JSON.parse(await readFile(prov, 'utf8')) as { kind?: string; credit?: string; license?: { obligations?: unknown } };
          if (p.kind && p.kind !== 'image') continue; // tables and pull quotes are figures, not photos
          credit = typeof p.credit === 'string' ? p.credit : null;
          if (Array.isArray(p.license?.obligations)) obligations = p.license.obligations.map((o) => (typeof o === 'string' ? o : JSON.stringify(o)));
        } catch {
          // An unreadable provenance file: use the image without a credit.
        }
      }
      out.push({ src, alt: m[1]!.replace(/\\(.)/g, '$1'), credit, obligations });
    }
  }
  return out;
}

/** The article's title: its first level-one heading. */
export function articleTitle(text: string): string | null {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  for (let i = 0; i < lines.length; i++) {
    const m = !fenceOf[i] && /^ {0,3}#\s+(.*?)\s*#*\s*$/.exec(lines[i]!);
    if (m) return plain(m[1]!);
  }
  return null;
}

const mdImage = (img: ArticleImage, height: number) => `![h:${height}](${img.src.includes(' ') ? `<${img.src}>` : img.src})`;

/** The deck's Marp markdown. */
export function deckMarkdown(o: { title: string; summary: Summary; images: ArticleImage[]; theme: string; footer?: string; link?: string }): string {
  const slides: string[] = [];
  const credit = (img: ArticleImage | undefined) => (img?.credit ? `\n\n<div class="credit">\n\n${img.credit}\n\n</div>` : '');
  const [first, ...rest] = o.images;
  slides.push(
    ['<!-- _class: title -->', '', first ? mdImage(first, 620) : '', '', `# ${o.title}`, o.summary.lead ? `\n${o.summary.lead}` : '', credit(first)]
      .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
      .join('\n')
      .trim(),
  );
  o.summary.points.forEach((p, i) => {
    const img = rest[i];
    const parts = [img ? '<!-- _class: point image -->' : '<!-- _class: point -->', ''];
    if (img) parts.push(mdImage(img, 560), '');
    if (p.label) parts.push(`## ${p.label}`, '');
    parts.push(p.markdown);
    slides.push(parts.join('\n') + credit(img));
  });
  if (o.link) slides.push(['<!-- _class: closing -->', '', '## Read the full article', '', o.link].join('\n'));
  const header = ['---', 'marp: true', `theme: ${o.theme}`, 'size: 1080x1350', 'paginate: true', ...(o.footer ? [`footer: ${JSON.stringify(o.footer)}`] : []), '---'];
  return `${header.join('\n')}\n\n${slides.join('\n\n---\n\n')}\n`;
}

/** A Marp theme from the Draftsman style. */
export function styleTheme(loaded: LoadedStyle): string {
  const { style } = loaded;
  const c = style.colors;
  const fam = (f: string | undefined, fb: string) => (f ? `${JSON.stringify(f)}, ${fb}` : fb);
  const text = fam(style.fonts.text.family, 'sans-serif');
  const heading = fam(style.fonts.heading?.family ?? style.fonts.text.family, 'sans-serif');
  const accent = style.pullquote.ruleColor ?? c.strongRule;
  return `/* @theme draftsman */
/* @size 1080x1350 1080px 1350px */
section { width: 1080px; height: 1350px; box-sizing: border-box; padding: 90px 90px 110px; background: ${c.background}; color: ${c.text}; font-family: ${text}; font-size: 40px; line-height: 1.35; display: flex; flex-direction: column; justify-content: center; }
section h1, section h2 { font-family: ${heading}; font-weight: bold; color: ${c.text}; margin: 0 0 30px; line-height: 1.15; }
section h1 { font-size: 72px; }
section h2 { font-size: 54px; border-left: 10px solid ${accent}; padding-left: 28px; }
section p { margin: 0 0 24px; }
section img { display: block; max-width: 100%; object-fit: cover; margin: 0 auto 40px; border-radius: 6px; }
section strong { color: ${accent}; }
section .credit { position: absolute; left: 90px; right: 90px; bottom: 58px; font-size: 18px; color: ${c.muted}; }
section .credit p { margin: 0; }
section.title h1 { font-size: 80px; }
section.point p { font-size: 60px; line-height: 1.25; }
section.point.image p { font-size: 44px; line-height: 1.3; }
section.point h2 + p { font-size: 48px; }
section a { color: ${accent}; text-decoration: none; }
section.closing p { font-size: 40px; }
section.closing { text-align: center; }
section.closing h2 { border: 0; padding: 0; }
section footer { position: absolute; left: 90px; bottom: 30px; font-size: 18px; color: ${c.muted}; }
section::after { position: absolute; right: 90px; bottom: 30px; padding: 0; line-height: 1.35; font-size: 18px; color: ${c.muted}; }
section footer { line-height: 1.35; }
`;
}

/** The theme name declared in a Marp theme file. */
export function themeName(css: string): string | null {
  return /\/\*\s*@theme\s+([\w-]+)\s*\*\//.exec(css)?.[1] ?? null;
}

/** Local image links in rendered HTML become data: URLs, so the browser needs no file or network access. */
async function inlineImages(html: string, deckDir: string): Promise<string> {
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
  const srcs = new Set([...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!));
  let out = html;
  for (const src of srcs) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
    const file = path.resolve(deckDir, decodeURI(src.replace(/&amp;/g, '&')));
    const type = types[path.extname(file).toLowerCase()];
    if (!type || !existsSync(file)) throw new ImageError(`The deck uses ${src}, which isn't a local image file next to it.`);
    const data = `data:${type};base64,${(await readFile(file)).toString('base64')}`;
    out = out.split(`src="${src}"`).join(`src="${data}"`);
  }
  return out;
}

/** The deck as one HTML page, through Marp's own converter, with its images inlined. */
export async function deckHtml(deck: string, o: { deckDir: string; themes: string[] }): Promise<string> {
  const marp = new Marp({ inlineSVG: false, html: true, script: false });
  for (const t of o.themes) marp.themeSet.add(t);
  const { html, css } = marp.render(deck);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${await inlineImages(html, o.deckDir)}</body></html>`;
}

/** The deck rendered to PDF with Marp's converter and the installed browser. */
export async function deckPdf(deck: string, o: { deckDir: string; themes: string[]; style: LoadedStyle; renderOptions?: RenderOptions }): Promise<{ pdf: Buffer; pages: number }> {
  const page = await deckHtml(deck, o);
  return renderPdf(page, {
    ...o.renderOptions,
    fonts: o.style.fonts,
    pageWidth: SLIDE.width,
    pageHeight: SLIDE.height,
    pageSelector: 'div.marpit > section',
  });
}

export interface CarouselOptions {
  cwd: string;
  style: LoadedStyle;
  /** The user's own Marp theme file, relative to the project folder. */
  theme?: string | undefined;
  summaryHeadings?: string[] | undefined;
  renderOptions?: RenderOptions;
  /** For tests: replaces the PDF rendering. */
  pdf?: typeof deckPdf;
}

export class Carousel {
  constructor(private readonly o: CarouselOptions) {}

  private async themes(): Promise<{ css: string[]; name: string }> {
    if (!this.o.theme) return { css: [styleTheme(this.o.style)], name: 'draftsman' };
    const file = path.resolve(this.o.cwd, this.o.theme);
    const css = await readFile(file, 'utf8').catch(() => {
      throw new ImageError(`The carousel theme ${file} (from .draftsman/config.json) was not found.`);
    });
    const name = themeName(css);
    if (!name) throw new ImageError(`${file} isn't a Marp theme: it needs a /* @theme name */ comment.`);
    return { css: [styleTheme(this.o.style), css], name };
  }

  async build(args: { path: string; link?: string; fromArticle?: boolean }) {
    const full = path.resolve(this.o.cwd, args.path);
    if (!/\.(md|markdown)$/i.test(full)) throw new ImageError(`${args.path} is not a markdown file (.md or .markdown).`);
    const text = await readFile(full, 'utf8').catch(() => {
      throw new ImageError(`${full} does not exist.`);
    });
    const dir = path.dirname(full);
    const stem = path.basename(full).replace(/\.(md|markdown)$/i, '').replace(/-post$/, '');
    const deckFile = path.join(dir, `${stem}-carousel.md`);
    const pdfFile = path.join(dir, `${stem}-carousel.pdf`);
    const themes = await this.themes();
    const warnings: string[] = [];

    let deck: string;
    let points: number | null = null;
    const fromArticle = args.fromArticle || !existsSync(deckFile);
    if (fromArticle) {
      const names = this.o.summaryHeadings?.length ? this.o.summaryHeadings : DEFAULT_SUMMARY_HEADINGS;
      const summary = findSummary(text, names);
      if (!summary) {
        throw new ImageError(
          `The article has no summary block. Add a heading named ${names.map((n) => `"${n}"`).join(' or ')} with the points as bullets (or "**Label:** text" paragraphs) under it.`,
        );
      }
      const images = await articleImages(text, dir);
      const used = images.slice(0, summary.points.length + 1);
      for (const img of used) for (const ob of img.obligations) warnings.push(`${img.src}: its license asks: ${ob}`);
      if (images.length === 0) warnings.push('The article has no local images, so the slides have none.');
      deck = deckMarkdown({
        title: articleTitle(text) ?? stem,
        summary,
        images,
        theme: themes.name,
        ...(this.o.style.style.watermark ? { footer: this.o.style.style.watermark.text } : {}),
        ...(args.link ? { link: args.link } : {}),
      });
      points = summary.points.length;
    } else {
      deck = await readFile(deckFile, 'utf8');
      warnings.push(`Built from the existing deck ${path.basename(deckFile)}, which may have been edited. Pass fromArticle to rebuild it from the article.`);
    }

    const { pdf, pages } = await (this.o.pdf ?? deckPdf)(deck, { deckDir: dir, themes: themes.css, style: this.o.style, ...(this.o.renderOptions ? { renderOptions: this.o.renderOptions } : {}) });
    const written: string[] = [];
    try {
      if (fromArticle) {
        await writeFile(deckFile, deck);
        written.push(deckFile);
      }
      await writeFile(pdfFile, pdf);
    } catch (e) {
      await Promise.all(written.map((f) => rm(f, { force: true })));
      throw e;
    }
    return { path: full, deck: deckFile, pdf: pdfFile, slides: pages, points, size: `${SLIDE.width}x${SLIDE.height}`, rebuiltDeck: fromArticle, warnings };
  }
}

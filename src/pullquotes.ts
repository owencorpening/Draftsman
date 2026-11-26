// render_pullquote and find_blockquotes: a quote from the article, or one of
// its blockquotes, becomes a styled image placed by its source.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageError } from './images.js';
import { formatDoc, isBlank, parseDoc } from './markdown.js';
import { alreadyPlaced, findBlockquotes, locateQuote, QuoteError, quoteText, type Blockquote } from './quotes.js';
import { renderHtml, type RenderOptions } from './render/index.js';
import { pullquoteHtml } from './render/pullquote.js';
import { markdownUrl } from './sources/fields.js';
import type { LoadedStyle } from './styles.js';
import { slug, type Render } from './table-figures.js';
import { VERSION } from './version.js';

export interface PullQuoteOptions {
  cwd: string;
  imagesFolder: string;
  style: LoadedStyle;
  render?: Render;
  renderOptions?: RenderOptions;
  now?: () => Date;
}

export interface RenderPullQuoteResult {
  path: string;
  kind: 'pullquote' | 'blockquote';
  quote: string;
  attribution: string | null;
  /** 1-based lines of the paragraph or blockquote it came from, before the edit. */
  source: [number, number];
  image: string;
  alt: string;
  provenance: string;
}

export class PullQuotes {
  constructor(private readonly o: PullQuoteOptions) {}

  private article(p: string): string {
    const full = path.resolve(this.o.cwd, p);
    if (!/\.(md|markdown)$/i.test(full)) throw new ImageError(`${p} is not a markdown file (.md or .markdown).`);
    return full;
  }

  private async read(full: string): Promise<string> {
    return readFile(full, 'utf8').catch(() => {
      throw new ImageError(`${full} does not exist.`);
    });
  }

  async findBlockquotes(p: string): Promise<{ path: string; blockquotes: Blockquote[] }> {
    const full = this.article(p);
    return { path: full, blockquotes: findBlockquotes(await this.read(full)) };
  }

  /**
   * With a quote: the quote, checked word for word, goes in as an image after
   * its paragraph. Without one: the blockquote at `line` is replaced by its image.
   */
  async render(args: { path: string; quote?: string; line?: number }): Promise<RenderPullQuoteResult> {
    const full = this.article(args.path);
    const text = await this.read(full);
    const max = this.o.style.style.pullquote.maxLength;

    let kind: 'pullquote' | 'blockquote';
    let quote: string;
    let attribution: string | null = null;
    let source: [number, number];
    if (args.quote !== undefined) {
      kind = 'pullquote';
      if (alreadyPlaced(text, args.quote)) throw new ImageError('That quote is already placed as a pull quote in this article.');
      let para;
      try {
        para = locateQuote(text, args.quote, args.line);
      } catch (e) {
        throw e instanceof QuoteError ? new ImageError(e.message) : e;
      }
      quote = quoteText(args.quote);
      source = [para.startLine, para.endLine];
    } else {
      kind = 'blockquote';
      if (args.line === undefined) throw new ImageError('Give either a quote, or the line of a blockquote to style.');
      const bq = findBlockquotes(text).find((b) => b.startLine <= args.line! && args.line! <= b.endLine);
      if (!bq) throw new ImageError(`There's no blockquote at line ${args.line} of ${args.path}. Use find_blockquotes to list them.`);
      if (bq.kind === 'alert') throw new ImageError(`The blockquote at line ${bq.startLine} is a GitHub alert (> [!NOTE] and the like), which stays as text.`);
      if (!bq.text) throw new ImageError(`The blockquote at line ${bq.startLine} is empty.`);
      quote = bq.text;
      attribution = bq.attribution;
      source = [bq.startLine, bq.endLine];
    }
    if (quote.length > max) {
      throw new ImageError(`The quote is ${quote.length} characters; this style takes at most ${max}. Choose a shorter one.`);
    }

    const alt = (attribution ? `${quote} \u2014 ${attribution}` : quote).replace(/\s*\n\s*/g, ' ');
    const dir = path.dirname(full);
    const imagesDir = path.join(dir, this.o.imagesFolder);
    const stem = slug(quote.split(/\s+/).slice(0, 8).join(' '));
    let base = `${stem}-pullquote`;
    for (let n = 2; existsSync(path.join(imagesDir, `${base}.png`)); n++) base = `${stem}-pullquote-${n}`;
    const imageFile = path.join(imagesDir, `${base}.png`);
    const provenanceFile = path.join(imagesDir, `${base}.provenance.json`);
    const written: string[] = [];

    try {
      const png = await (this.o.render ?? renderHtml)(pullquoteHtml(quote, attribution, this.o.style), {
        width: this.o.style.style.pullquote.width,
        height: 600,
        scale: 2,
        ...this.o.renderOptions,
        fonts: this.o.style.fonts,
      });
      await mkdir(imagesDir, { recursive: true });
      await writeFile(imageFile, png);
      written.push(imageFile);

      const rel = path.relative(dir, imageFile).split(path.sep).join('/');
      const imageLine = `![${alt.replace(/[\\[\]]/g, '\\$&')}](${markdownUrl(rel)})`;
      const doc = parseDoc(text);
      if (kind === 'pullquote') {
        // After the paragraph, as its own block.
        const after = source[1]; // 0-based index of the line after the paragraph
        const insert = ['', imageLine];
        if (after < doc.lines.length && !isBlank(doc.lines[after]!)) insert.push('');
        doc.lines.splice(after, 0, ...insert);
      } else {
        const start = source[0] - 1;
        const insert = [imageLine];
        if (start > 0 && !isBlank(doc.lines[start - 1]!)) insert.unshift('');
        if (source[1] < doc.lines.length && !isBlank(doc.lines[source[1]]!)) insert.push('');
        doc.lines.splice(start, source[1] - start, ...insert);
      }

      const provenance = {
        draftsman: VERSION,
        kind,
        renderedAt: (this.o.now ?? (() => new Date()))().toISOString(),
        article: { file: path.relative(imagesDir, full).split(path.sep).join('/'), lines: source },
        image: { file: path.basename(imageFile), sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length, alt },
        quote,
        attribution,
        style: { id: this.o.style.style.id, name: this.o.style.style.name },
      };
      await writeFile(provenanceFile, JSON.stringify(provenance, null, 2) + '\n');
      written.push(provenanceFile);

      // The article, last.
      await writeFile(full, formatDoc(doc));
      return { path: full, kind, quote, attribution, source, image: imageFile, alt, provenance: provenanceFile };
    } catch (e) {
      await Promise.all(written.map((f) => rm(f, { force: true })));
      throw e instanceof ImageError ? e : new ImageError((e as Error).message);
    }
  }
}

// render_table: a markdown table becomes a styled image with a numbered
// caption, linked to a new Google Sheet of its data when Google is set up.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { renumberFigures, type Renumbered } from './figures.js';
import { GoogleError, type Google, type Sheet } from './google.js';
import { ImageError } from './images.js';
import { formatDoc, isBlank, parseDoc } from './markdown.js';
import { renderHtml, type RenderOptions } from './render/index.js';
import { tableHtml } from './render/table.js';
import { escapeMarkdown, markdownUrl } from './sources/fields.js';
import type { LoadedStyle } from './styles.js';
import { findTables, plainText, type Table } from './tables.js';
import { VERSION } from './version.js';

export type Render = (html: string, options: RenderOptions) => Promise<Buffer>;

export interface TableFigureOptions {
  cwd: string;
  imagesFolder: string;
  style: LoadedStyle;
  google: Google;
  render?: Render;
  /** Extra render options, e.g. a pinned browser in tests. */
  renderOptions?: RenderOptions;
  log?: (message: string) => void;
  now?: () => Date;
}

export interface RenderTableResult {
  path: string;
  figure: number;
  caption: string;
  image: string;
  alt: string;
  sheet: Sheet | null;
  /** Why there's no sheet, or why it isn't shared, when that happens. */
  warnings: string[];
  provenance: string;
  renumbered: Pick<Renumbered, 'updated' | 'problems'>;
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '') || 'table'
  );
}

/** A default alt text: what the table is and its shape; the numbers are in the sheet. */
export function defaultAlt(table: Table, caption: string, linked: boolean): string {
  const cols = table.header.map(plainText).join(', ');
  return `Table: ${caption}. Columns: ${cols}. ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}${linked ? '; the data is in the linked sheet' : ''}.`;
}

export class TableFigures {
  constructor(private readonly o: TableFigureOptions) {}

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

  async find(p: string): Promise<{ path: string; tables: Table[] }> {
    const full = this.article(p);
    return { path: full, tables: findTables(await this.read(full)) };
  }

  async renumber(p: string): Promise<{ path: string } & Renumbered> {
    const full = this.article(p);
    const before = await this.read(full);
    const r = renumberFigures(before);
    if (r.text !== before) await writeFile(full, r.text);
    return { path: full, ...r };
  }

  async render(args: { path: string; line: number; caption: string; alt?: string }): Promise<RenderTableResult> {
    const full = this.article(args.path);
    const text = await this.read(full);
    const table = findTables(text).find((t) => t.startLine <= args.line && args.line <= t.endLine);
    if (!table) throw new ImageError(`There's no table at line ${args.line} of ${args.path}. Use find_tables to list them.`);
    const caption = args.caption.trim().replace(/\.$/, '');
    if (!caption || /[\r\n]/.test(caption)) throw new ImageError('The caption must be one line of text.');

    const dir = path.dirname(full);
    const imagesDir = path.join(dir, this.o.imagesFolder);
    let base = `${slug(caption)}-table`;
    for (let n = 2; existsSync(path.join(imagesDir, `${base}.png`)); n++) base = `${slug(caption)}-table-${n}`;
    const imageFile = path.join(imagesDir, `${base}.png`);
    const provenanceFile = path.join(imagesDir, `${base}.provenance.json`);
    const written: string[] = [];
    const warnings: string[] = [];

    try {
      // 1. The image.
      const png = await (this.o.render ?? renderHtml)(tableHtml(table, this.o.style), {
        width: 1200,
        height: 800,
        scale: 2,
        ...this.o.renderOptions,
        fonts: this.o.style.fonts,
      });
      await mkdir(imagesDir, { recursive: true });
      await writeFile(imageFile, png);
      written.push(imageFile);

      // 2. The sheet, when Google is set up. A failure here is a warning, not an error: the image still goes in.
      let sheet: Sheet | null = null;
      const why = await this.o.google.unavailable();
      if (why) warnings.push(`No sheet: ${why}`);
      else {
        try {
          const rows = [table.header, ...table.rows].map((r) => r.map(plainText));
          const made = await this.o.google.createSheet(caption.slice(0, 100), rows);
          sheet = { id: made.id, url: made.url, shared: made.shared };
          if (!made.shared) warnings.push(`The sheet was made but couldn't be shared with anyone who has the link: ${made.shareError}. Readers can't open it until it's shared.`);
        } catch (e) {
          if (!(e instanceof GoogleError)) throw e;
          warnings.push(`No sheet: ${e.message}`);
          this.o.log?.(`render_table: ${e.message}`);
        }
      }
      const linked = !!sheet?.shared;

      // 3. The article text: the image (linked to the sheet when shared) and a caption numbered later.
      const alt = (args.alt ?? defaultAlt(table, caption, linked)).trim();
      if (/[\r\n]/.test(alt)) throw new ImageError('The alt text must be one line.');
      const rel = path.relative(dir, imageFile).split(path.sep).join('/');
      const image = `![${alt.replace(/[\\[\]]/g, '\\$&')}](${markdownUrl(rel)})`;
      const imageLine = linked ? `[${image}](${markdownUrl(sheet!.url)})` : image;
      const captionLine = `*Figure ?. ${escapeMarkdown(caption)}.*`;

      const doc = parseDoc(text);
      const start = table.startLine - 1;
      const end = table.endLine; // exclusive, 0-based
      const insert = [imageLine, '', captionLine];
      if (start > 0 && !isBlank(doc.lines[start - 1]!)) insert.unshift('');
      if (end < doc.lines.length && !isBlank(doc.lines[end]!)) insert.push('');
      doc.lines.splice(start, end - start, ...insert);
      const captionIndex = start + insert.indexOf(captionLine);
      const renumbered = renumberFigures(formatDoc(doc));
      const number = renumbered.figures.find((f) => f.line === captionIndex + 1)!.to;

      // 4. Provenance beside the image.
      const provenance = {
        draftsman: VERSION,
        kind: 'table',
        renderedAt: (this.o.now ?? (() => new Date()))().toISOString(),
        article: { file: path.relative(imagesDir, full).split(path.sep).join('/'), lines: [table.startLine, table.endLine] },
        image: { file: path.basename(imageFile), sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length, alt },
        figure: { number, caption },
        style: { id: this.o.style.style.id, name: this.o.style.style.name },
        table: { markdown: table.markdown, header: table.header, align: table.align, rows: table.rows },
        sheet,
        warnings,
      };
      await writeFile(provenanceFile, this.scrub(JSON.stringify(provenance, null, 2)) + '\n');
      written.push(provenanceFile);

      // 5. The article, last.
      await writeFile(full, renumbered.text);

      return {
        path: full,
        figure: number,
        caption,
        image: imageFile,
        alt,
        sheet,
        warnings,
        provenance: provenanceFile,
        renumbered: { updated: renumbered.updated, problems: renumbered.problems },
      };
    } catch (e) {
      await Promise.all(written.map((f) => rm(f, { force: true })));
      throw e instanceof ImageError ? e : new ImageError(this.scrub((e as Error).message));
    }
  }

  private scrub(text: string): string {
    let out = text;
    for (const s of this.o.google.secrets) if (s) out = out.split(s).join('REDACTED');
    return out;
  }
}

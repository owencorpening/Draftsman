// Reading values out of a source's search results, and filling templates.

import type { FieldSpec } from './schema.js';

/** Follows a dot path ("a.b.0.c") into a value; undefined if any step is missing. */
export function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** A value as text: strings and numbers only; anything else is missing. */
export function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Strips tags and decodes the common entities: for fields like Wikimedia's Artist, which hold HTML. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith('#') && e !== '#39') return String.fromCodePoint(parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fills {path} markers from a result; a marker whose value is missing makes the whole template missing. */
export function fillFromResult(template: string, item: unknown): string | undefined {
  let missing = false;
  const out = template.replace(/\{([^{}]+)\}/g, (_, path: string) => {
    const v = asText(getPath(item, path.trim()));
    if (v === undefined) missing = true;
    return v ?? '';
  });
  return missing ? undefined : out;
}

/** The value of one field of a result, as the source's field map says. */
export function readField(item: unknown, spec: FieldSpec | undefined): string | undefined {
  if (spec === undefined) return undefined;
  if (typeof spec === 'string') return asText(getPath(item, spec));
  if ('template' in spec) return fillFromResult(spec.template, item);
  const v = asText(getPath(item, spec.path));
  return v !== undefined && spec.html ? stripHtml(v) || undefined : v;
}

/** Fills {name} markers in a URL template, URL-encoding each value. */
export function fillUrl(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in values ? encodeURIComponent(String(values[name])) : m));
}

/** Escapes text so markdown shows it as written, inside link text or plain. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>#|]/g, '\\$&');
}

/** Makes a URL safe inside a markdown link: spaces and parentheses encoded. */
export function markdownUrl(url: string): string {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Fills a credit template. Markers are {name}; a segment in [? ... ?] is
 * dropped when any marker inside it is empty, so "[? by {creatorLink}?]"
 * disappears when there's no creator.
 */
export function fillCredit(template: string, values: Record<string, string | undefined>): string {
  const fill = (text: string): { text: string; empty: boolean } => {
    let empty = false;
    const out = text.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = values[name];
      if (!v) empty = true;
      return v ?? '';
    });
    return { text: out, empty };
  };
  const withOptional = template.replace(/\[\?([\s\S]*?)\?\]/g, (_, inner: string) => {
    const r = fill(inner);
    return r.empty ? '' : r.text;
  });
  return fill(withOptional).text.replace(/\s+/g, ' ').trim();
}

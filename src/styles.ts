// Style files: the colors, fonts and optional watermark of every image
// Draftsman renders. Two ship in styles/ (neutral "default" and
// "sample-brand"); a user can name their own in .draftsman/config.json.
// Fonts are files beside the style, embedded when rendering, so a figure looks
// the same on every machine.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as z from 'zod';

import type { FontFile } from './render/index.js';
import { DefinitionError } from './sources/load.js';

export const STYLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles');

const Color = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'a hex color like #1f2933');

const Face = z.strictObject({
  file: z.string().min(1).describe('Font file, relative to the style file'),
  weight: z.union([z.literal('normal'), z.literal('bold'), z.int().min(100).max(900)]).default('normal'),
  style: z.enum(['normal', 'italic']).default('normal'),
});

const Font = z.strictObject({
  family: z.string().min(1).describe('The name the images use for this font'),
  faces: z.array(Face).min(1),
});

export const Style = z.strictObject({
  $schema: z.string().optional(),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase letters, digits and dashes, starting with a letter'),
  name: z.string().min(1),
  fonts: z.strictObject({ text: Font, heading: Font.optional(), code: Font.optional() }),
  colors: z.strictObject({
    background: Color,
    text: Color,
    muted: Color,
    headerBackground: Color,
    headerText: Color,
    rule: Color,
    strongRule: Color,
    stripe: Color.optional(),
  }),
  table: z.strictObject({
    fontSize: z.number().min(8).max(40),
    headerFontSize: z.number().min(8).max(40),
    uppercaseHeader: z.boolean(),
    padding: z.number().min(0).max(60).describe('Padding around the table, in pixels'),
    maxWidth: z.number().min(200).max(4000),
  }),
  watermark: z
    .strictObject({
      text: z.string().min(1).max(80),
      position: z.enum(['bottom-right', 'bottom-left']),
    })
    .optional(),
  /** How generation prompts should be worded (used by a later milestone). */
  promptStyle: z.string().optional(),
});
export type Style = z.infer<typeof Style>;

export interface LoadedStyle {
  style: Style;
  file: string;
  /** Every font face, with absolute paths, ready for the renderer. */
  fonts: FontFile[];
}

/** Checks one style file: the schema, then that every font file exists. */
export function parseStyle(file: string, text: string): LoadedStyle {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new DefinitionError(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = Style.safeParse(json);
  if (!parsed.success) {
    throw new DefinitionError(
      `${file} is not a valid style:\n${parsed.error.issues.map((i) => `  ${i.path.join('.') || '(top level)'}: ${i.message}`).join('\n')}`,
    );
  }
  const style = parsed.data;
  const fonts: FontFile[] = [];
  const missing: string[] = [];
  for (const [role, font] of Object.entries(style.fonts)) {
    if (!font) continue;
    font.faces.forEach((face, i) => {
      const full = path.resolve(path.dirname(file), face.file);
      if (!existsSync(full)) missing.push(`  fonts.${role}.faces.${i}.file: ${face.file} not found`);
      fonts.push({ family: font.family, path: full, weight: face.weight, style: face.style });
    });
  }
  if (missing.length) throw new DefinitionError(`${file} is not a valid style:\n${missing.join('\n')}`);
  return { style, file, fonts };
}

/**
 * The style to render with: a shipped one by id, or the user's own by path
 * (relative to the project folder). Every shipped style is checked too, so a
 * broken one is caught at startup.
 */
export function loadStyle(choice: string, base: string, stylesDir = STYLES_DIR): LoadedStyle {
  const shipped = readdirSync(stylesDir)
    .filter((f) => f.endsWith('.json') && f !== 'style.schema.json')
    .map((f) => parseStyle(path.join(stylesDir, f), readFileSync(path.join(stylesDir, f), 'utf8')));
  const byId = shipped.find((s) => s.style.id === choice);
  if (byId) return byId;
  if (/[\\/]|\.json$/i.test(choice)) {
    const file = path.resolve(base, choice);
    if (!existsSync(file)) throw new DefinitionError(`The style ${file} (from .draftsman/config.json) was not found.`);
    return parseStyle(file, readFileSync(file, 'utf8'));
  }
  throw new DefinitionError(`Unknown style "${choice}". Shipped styles: ${shipped.map((s) => s.style.id).join(', ')}; or give a path to your own .json.`);
}

export function styleJsonSchema(): Record<string, unknown> {
  return { ...z.toJSONSchema(Style, { io: 'input', target: 'draft-2020-12' }), title: 'Draftsman style' };
}

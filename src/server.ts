#!/usr/bin/env node
// Draftsman's MCP server, over stdio. It is deterministic and calls no model:
// the AI host does the talking and judging, and these tools do the file work.

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';

import { defaultCacheDir } from './cache.js';
import { Carousel } from './carousel.js';
import { Changes } from './changes.js';
import { CRITERIA_JOBS, CriteriaError, getCriteria } from './criteria.js';
import { findSlotsInFile, markSlotInFile } from './files.js';
import { liveHttp, type Http } from './http.js';
import { ImageError, ImageService } from './images.js';
import { CLIENT_SECRET_KEY, clientId, Google, keychainStore, runWithInput, signIn } from './google.js';
import { keyLookup, scrubKeys, type KeyLookup } from './keys.js';
import { findLists } from './lists.js';
import { PullQuotes } from './pullquotes.js';
import type { RenderOptions } from './render/index.js';
import { SlotError } from './slots.js';
import { DefinitionError, loadConfig, loadSources } from './sources/load.js';
import { loadStyle } from './styles.js';
import { TableFigures, type Render } from './table-figures.js';
import { VERSION } from './version.js';

export { VERSION } from './version.js';

const slotShape = z.object({
  line: z.number().describe('1-based line of the placeholder'),
  column: z.number().describe('1-based column where it starts'),
  description: z.string().describe('What the image should show (its alt text)'),
  markdown: z.string().describe('The placeholder exactly as written'),
  paragraph: z.string().describe('The block that holds the placeholder'),
  before: z.string().describe('The block before it, or empty'),
  after: z.string().describe('The block after it, or empty'),
});

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

/**
 * Runs a tool body. Bad input from the AI (SlotError, ImageError) becomes a
 * tool error it can read and fix. `scrub` removes any key from the result.
 */
async function run(body: () => Promise<Record<string, unknown>>, scrub: (s: string) => string = (s) => s): Promise<Result> {
  try {
    const out = JSON.parse(scrub(JSON.stringify(await body()))) as Record<string, unknown>;
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
  } catch (e) {
    if (e instanceof SlotError || e instanceof ImageError || e instanceof CriteriaError) return { content: [{ type: 'text', text: scrub(e.message) }], isError: true };
    throw e;
  }
}

export interface ServerOptions {
  /** The working folder: articles and .draftsman/config.json are found from here. */
  cwd?: string;
  /** Network access; tests pass recorded responses. */
  http?: Http;
  keys?: KeyLookup;
  cacheDir?: string;
  presetsDir?: string;
  stylesDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Rendering; tests pass a pinned browser through renderOptions. */
  render?: Render;
  renderOptions?: RenderOptions;
  log?: (message: string) => void;
  now?: () => Date;
}

/**
 * Builds the server. Every source definition and style is checked here; a
 * bad one throws a DefinitionError naming the file, the field and the problem.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const { sources, config } = loadSources(cwd, options.presetsDir);
  const style = loadStyle(config.style, cwd, options.stylesDir);
  const http = options.http ?? liveHttp;
  const keys = options.keys ?? keyLookup(env);
  const log = options.log ?? ((m: string) => console.error(`draftsman: ${m}`));
  const images = new ImageService({
    sources,
    config,
    cwd,
    http,
    keys,
    cacheDir: options.cacheDir ?? defaultCacheDir(env),
    log,
    ...(options.now ? { now: options.now } : {}),
  });
  const google = new Google({ http, keys, clientId: clientId(env, config.google.clientId), ...(options.now ? { now: () => options.now!().getTime() } : {}) });
  const tables = new TableFigures({
    cwd,
    imagesFolder: config.imagesFolder,
    style,
    google,
    ...(options.render ? { render: options.render } : {}),
    ...(options.renderOptions ? { renderOptions: options.renderOptions } : {}),
    log: (m) => log(scrubKeys(m, google.secrets)),
    ...(options.now ? { now: options.now } : {}),
  });
  const changes = new Changes({ cwd, cacheDir: options.cacheDir ?? defaultCacheDir(env), ...(options.now ? { now: options.now } : {}) });
  const carousel = new Carousel({
    cwd,
    style,
    theme: config.carousel.theme,
    summaryHeadings: config.carousel.summaryHeadings,
    ...(options.renderOptions ? { renderOptions: options.renderOptions } : {}),
  });
  const pullquotes = new PullQuotes({
    cwd,
    imagesFolder: config.imagesFolder,
    style,
    ...(options.render ? { render: options.render } : {}),
    ...(options.renderOptions ? { renderOptions: options.renderOptions } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const server = new McpServer({ name: 'draftsman', version: VERSION }, { capabilities: { tools: {} } });
  const scrub = (s: string) => images.scrub(scrubKeys(s, google.secrets));

  server.registerTool(
    'find_slots',
    {
      title: 'Find image spots',
      description:
        'List the image placeholders in a markdown article: markdown images whose link is draftsman:pending, ' +
        'like ![drought map of Texas](draftsman:pending). Each comes with its line, its description and the ' +
        'paragraph around it (plus the blocks before and after), so you can judge what image fits. ' +
        'Placeholders inside code are ignored.',
      inputSchema: z.object({
        path: z.string().describe('The article, a .md or .markdown file; absolute or relative to the working folder'),
      }),
      outputSchema: z.object({ path: z.string(), slots: z.array(slotShape) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ path }) => run(() => findSlotsInFile(path, options.cwd)),
  );

  server.registerTool(
    'mark_slot',
    {
      title: 'Mark an image spot',
      description:
        'Insert one image placeholder, ![description](draftsman:pending), as its own block starting at the given line; ' +
        'the line that was there moves down, and blank lines are added only where needed. Use a blank line or the ' +
        'start or end of a block: the tool refuses a line that would split a paragraph or fall inside a code block.',
      inputSchema: z.object({
        path: z.string().describe('The article, a .md or .markdown file; absolute or relative to the working folder'),
        line: z.number().int().min(1).describe('1-based line where the placeholder goes; one past the last line appends'),
        description: z.string().min(1).describe('One line saying what the image should show; becomes its alt text'),
      }),
      outputSchema: z.object({ path: z.string(), slot: slotShape }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ path, line, description }) => run(() => markSlotInFile(path, line, description, cwd)),
  );

  server.registerTool(
    'search_images',
    {
      title: 'Search for images',
      description:
        'Search the enabled image sources for candidates to fill an image spot. Each result has a ref (use it with ' +
        'check_license and place_image), its source, title, creator, page and thumbnail links, size, and the license as ' +
        'the source states it. When you show results to the user, always say which source each one is from. Sources ' +
        'that need a key and have none are listed under skipped, with how to add one.',
      inputSchema: z.object({
        query: z.string().min(1).describe('What the image should show, in a few words'),
        count: z.number().int().min(1).max(50).optional().describe('Results per source; default 10'),
        sources: z.array(z.string()).optional().describe('Only these source ids; default all enabled sources'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ query, count, sources: only }) =>
      run(async () => ({ ...(await images.search(query, count ?? 10, only)) }), scrub),
  );

  server.registerTool(
    'check_license',
    {
      title: 'Check an image’s license',
      description:
        'Check whether a search result may be used: it passes only when its license is known and clearly allows both ' +
        'commercial use and changes. Anything unknown or missing fails, as do files the source marks as restricted. A pass ' +
        'lists what the license still asks for (credit, share-alike, prohibited uses); tell the user. place_image only ' +
        'accepts images that passed here.',
      inputSchema: z.object({ ref: z.string().min(1).describe('A ref from search_images, like "pixabay:123"') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ref }) => run(async () => ({ ...images.check(ref) }), scrub),
  );

  server.registerTool(
    'place_image',
    {
      title: 'Place an image',
      description:
        'Fill an image spot with an image that passed check_license: download it (or link it, if the source requires) ' +
        'into an images folder beside the article, replace the placeholder on the given line with the image and its alt ' +
        'text, add the credit in the source’s format below it, and save a provenance file beside the image. Refuses any ' +
        'image that hasn’t passed check_license. If any step fails, the article is left unchanged.',
      inputSchema: z.object({
        path: z.string().describe('The article, a .md or .markdown file; absolute or relative to the working folder'),
        line: z.number().int().min(1).describe('The line of the placeholder, from find_slots'),
        ref: z.string().min(1).describe('A ref from search_images that passed check_license'),
        alt: z.string().optional().describe('Alt text describing the image for readers who can’t see it; default is the placeholder’s description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ path, line, ref, alt }) => run(async () => ({ ...(await images.place({ path, line, ref, ...(alt ? { alt } : {}) })) }), scrub),
  );

  const tableShape = z.object({
    startLine: z.number(),
    endLine: z.number(),
    header: z.array(z.string()),
    align: z.array(z.enum(['left', 'center', 'right']).nullable()),
    rows: z.array(z.array(z.string())),
    markdown: z.string(),
    before: z.string(),
  });

  server.registerTool(
    'find_tables',
    {
      title: 'Find tables',
      description:
        'List the markdown tables in an article: their lines, header, column alignment, rows, and the paragraph before ' +
        'each, so you can write a caption. Tables inside code are ignored.',
      inputSchema: z.object({ path: z.string().describe('The article, a .md or .markdown file') }),
      outputSchema: z.object({ path: z.string(), tables: z.array(tableShape) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ path }) => run(async () => ({ ...(await tables.find(path)) }), scrub),
  );

  server.registerTool(
    'render_table',
    {
      title: 'Turn a table into a figure',
      description:
        'Turn one markdown table into a styled image with a numbered caption ("Figure N. …"), in place of the table. ' +
        'When the user is signed in to Google, the data goes into a new Google Sheet that anyone with the link can view, ' +
        'and the image links to it, so the table shows on platforms that can’t render tables and readers can still use ' +
        'the numbers. Without Google the image goes in unlinked and the result says why. Figure numbers in the whole ' +
        'article are updated. Write a short caption saying what the table shows.',
      inputSchema: z.object({
        path: z.string().describe('The article, a .md or .markdown file'),
        line: z.number().int().min(1).describe('Any line of the table, e.g. its startLine from find_tables'),
        caption: z.string().min(1).describe('What the table shows, one line, without "Figure N."'),
        alt: z.string().optional().describe('Alt text; by default it names the table’s columns and row count'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ path, line, caption, alt }) => run(async () => ({ ...(await tables.render({ path, line, caption, ...(alt ? { alt } : {}) })) }), scrub),
  );

  server.registerTool(
    'renumber_figures',
    {
      title: 'Renumber figures',
      description:
        'Put every figure caption ("Figure N." or "Fig. N:") in order, 1, 2, 3 …, and update references in the text ' +
        '("Figure 3", "Figures 2 and 3", "Figs. 2–4") so they still point at the same figures. Use after adding, moving or ' +
        'deleting a figure. References to a figure that no longer exists are left alone and listed under problems.',
      inputSchema: z.object({ path: z.string().describe('The article, a .md or .markdown file') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ path }) =>
      run(async () => {
        const { text: _text, ...r } = await tables.renumber(path);
        return { ...r };
      }, scrub),
  );

  server.registerTool(
    'get_criteria',
    {
      title: 'Get the user’s criteria',
      description:
        'Return the user’s criteria for a job, as text for you to follow: what makes a good pull quote, and how many to ' +
        'suggest. The user’s own file is used when there is one (.draftsman/criteria/<job>.md, or a path in the config); ' +
        'otherwise the shipped sample. Read it before suggesting pull quotes.',
      inputSchema: z.object({ job: z.enum(CRITERIA_JOBS).describe('Which criteria') }),
      outputSchema: z.object({ job: z.string(), from: z.enum(['config', 'project', 'sample']), file: z.string(), text: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ job }) => run(async () => ({ ...(await getCriteria(job, cwd, config)) })),
  );

  server.registerTool(
    'find_blockquotes',
    {
      title: 'Find blockquotes',
      description:
        'List the blockquotes (lines starting with >) in an article: their lines, text, and attribution when the last ' +
        'line is like "— Name". Any of them can be turned into a styled image with render_pullquote, given its line. ' +
        'GitHub alerts (> [!NOTE] and the like) are listed with kind "alert" and stay as text. Blockquotes inside code are ignored.',
      inputSchema: z.object({ path: z.string().describe('The article, a .md or .markdown file') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ path }) => run(async () => ({ ...(await pullquotes.findBlockquotes(path)) })),
  );

  server.registerTool(
    'render_pullquote',
    {
      title: 'Make a pull quote',
      description:
        'Turn a quote from the article into a styled image placed right after the paragraph it comes from. The quote ' +
        'must be copied word for word from one paragraph: only whitespace, inline markdown and curly-versus-straight ' +
        'quote marks and dashes may differ. Anything else is refused, including an ellipsis standing for cut words, ' +
        'and the error says where it stops matching. Give the line when the same words appear twice. The alt text is ' +
        'the quote. Only place quotes the user has chosen. To style an existing blockquote instead, leave out the quote ' +
        'and give the blockquote’s line from find_blockquotes: the blockquote is replaced by its image.',
      inputSchema: z.object({
        path: z.string().describe('The article, a .md or .markdown file'),
        quote: z.string().min(1).optional().describe('The exact words, copied from one paragraph; leave out to style a blockquote'),
        line: z.number().int().min(1).optional().describe('A line of the source paragraph, or of the blockquote to style'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ path, quote, line }) =>
      run(async () => ({ ...(await pullquotes.render({ path, ...(quote !== undefined ? { quote } : {}), ...(line !== undefined ? { line } : {}) })) })),
  );

  server.registerTool(
    'find_lists',
    {
      title: 'Find lists',
      description:
        'List the bullet and numbered lists in an article: their lines, items (nested items under their parent), the ' +
        'list as written, and the paragraph before and after, so you can judge whether a list is really a table, an ' +
        'argument or a paragraph. Read get_criteria with job "lists" first. Lists inside code and blockquotes are ignored.',
      inputSchema: z.object({ path: z.string().describe('The article, a .md or .markdown file') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ path }) =>
      run(async () => {
        const full = nodePath.resolve(cwd, path);
        if (!/\.(md|markdown)$/i.test(full)) throw new ImageError(`${path} is not a markdown file (.md or .markdown).`);
        const text = await readFile(full, 'utf8').catch(() => {
          throw new ImageError(`${full} does not exist.`);
        });
        return { path: full, lists: findLists(text) };
      }),
  );

  server.registerTool(
    'apply_change',
    {
      title: 'Apply an accepted change',
      description:
        'Replace a range of lines in an article with new markdown, as one edit that undo_change can reverse. Only call it ' +
        'after the user has accepted the change you showed them. Give the exact current text of those lines as original: ' +
        'if the article no longer reads that way, nothing is changed and the error shows what the lines say now.',
      inputSchema: z.object({
        path: z.string().describe('The article, a .md or .markdown file'),
        startLine: z.number().int().min(1).describe('First line to replace, 1-based'),
        endLine: z.number().int().min(1).describe('Last line to replace, inclusive'),
        original: z.string().describe('Exactly what those lines say now'),
        replacement: z.string().describe('The new markdown; an empty string deletes the lines'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (args) => run(async () => ({ ...(await changes.apply(args)) })),
  );

  server.registerTool(
    'undo_change',
    {
      title: 'Undo the last change',
      description:
        'Reverse the last apply_change on an article, putting the original lines back where the new text still stands, ' +
        'even if other parts of the file were edited since. Call it again to undo earlier changes, one at a time. If the ' +
        'new text itself was edited, it refuses and changes nothing.',
      inputSchema: z.object({ path: z.string().describe('The article, a .md or .markdown file') }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ path }) => run(async () => ({ ...(await changes.undo({ path })) })),
  );

  server.registerTool(
    'build_carousel',
    {
      title: 'Build the carousel',
      description:
        'Make a portrait slide deck (Marp markdown, <article>-carousel.md) and a PDF (<article>-carousel.pdf, 1080 by 1350 ' +
        'pixels a page, the size LinkedIn carousels use) beside the article, from its summary block and its images: a ' +
        'title slide, one slide per summary point, and a closing slide with the link when you give one. The summary is ' +
        'the section under a heading like "Executive Summary", "Summary" or "Key takeaways". If the deck already exists, ' +
        'the PDF is built from it as it stands (it may have been edited); pass fromArticle to rebuild the deck from the article.',
      inputSchema: z.object({
        path: z.string().describe('The article, a .md or .markdown file'),
        link: z.string().optional().describe('The published article’s link, for the closing slide'),
        fromArticle: z.boolean().optional().describe('Rebuild the deck from the article, replacing an existing one'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ path, link, fromArticle }) =>
      run(async () => ({ ...(await carousel.build({ path, ...(link ? { link } : {}), ...(fromArticle ? { fromArticle } : {}) })) })),
  );

  return server;
}

/** `draftsman google-sign-in`: the one-time Google sign-in, run in a terminal. */
async function googleSignInCommand(): Promise<void> {
  const { config } = loadConfig(process.cwd());
  const id = clientId(process.env, config.google.clientId);
  if (!id) {
    console.error('draftsman: no Google OAuth client ID. Set DRAFTSMAN_GOOGLE_CLIENT_ID, or google.clientId in .draftsman/config.json.');
    process.exit(1);
  }
  const secret = await keyLookup(process.env)(CLIENT_SECRET_KEY);
  await signIn({ http: liveHttp, clientId: id, clientSecret: secret?.key, store: keychainStore(runWithInput), say: (m) => console.error(m) });
  console.error('Signed in to Google. Tables will now link to new sheets in your Drive.');
}

// Start serving when run as a program, not when imported by tests.
const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv[2] === 'google-sign-in') {
    googleSignInCommand().catch((e: Error) => {
      console.error(`draftsman: ${e.message}`);
      process.exit(1);
    });
  } else {
    // Check every source definition and style before serving: a bad one stops
    // here with a readable error instead of failing on first use.
    try {
      createServer();
    } catch (e) {
      if (!(e instanceof DefinitionError)) throw e;
      console.error(`draftsman: can't start.\n${e.message}`);
      process.exit(1);
    }
    // serveStdio speaks protocol 2026-07-28 and still serves hosts that open the
    // older way, from the same factory.
    serveStdio(() => createServer(), { onerror: (e) => console.error(`draftsman: ${e.message}`) });
  }
}

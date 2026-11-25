#!/usr/bin/env node
// Draftsman's MCP server, over stdio. It is deterministic and calls no model:
// the AI host does the talking and judging, and these tools do the file work.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';

import { defaultCacheDir } from './cache.js';
import { findSlotsInFile, markSlotInFile } from './files.js';
import { liveHttp, type Http } from './http.js';
import { ImageError, ImageService } from './images.js';
import { keyLookup, type KeyLookup } from './keys.js';
import { SlotError } from './slots.js';
import { DefinitionError, loadSources } from './sources/load.js';
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
    if (e instanceof SlotError || e instanceof ImageError) return { content: [{ type: 'text', text: scrub(e.message) }], isError: true };
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
  log?: (message: string) => void;
  now?: () => Date;
}

/**
 * Builds the server. Every source definition is checked here; a bad one
 * throws a DefinitionError naming the file, the field and the problem.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const { sources, config } = loadSources(cwd, options.presetsDir);
  const images = new ImageService({
    sources,
    config,
    cwd,
    http: options.http ?? liveHttp,
    keys: options.keys ?? keyLookup(),
    cacheDir: options.cacheDir ?? defaultCacheDir(),
    log: options.log ?? ((m) => console.error(`draftsman: ${m}`)),
    ...(options.now ? { now: options.now } : {}),
  });
  const server = new McpServer({ name: 'draftsman', version: VERSION }, { capabilities: { tools: {} } });
  const scrub = (s: string) => images.scrub(s);

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

  return server;
}

// Start serving when run as a program, not when imported by tests.
const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  // Check every source definition before serving: a bad one stops here with
  // a readable error instead of failing on the first search.
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

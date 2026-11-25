#!/usr/bin/env node
// Draftsman's MCP server, over stdio. It is deterministic and calls no model:
// the AI host does the talking and judging, and these tools do the file work.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';

import { findSlotsInFile, markSlotInFile } from './files.js';
import { SlotError } from './slots.js';

export const VERSION = '0.0.0';

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

/** Runs a tool body; a SlotError (bad input from the AI) becomes a tool error it can read and fix. */
async function run(body: () => Promise<Record<string, unknown>>): Promise<Result> {
  try {
    const out = await body();
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
  } catch (e) {
    if (e instanceof SlotError) return { content: [{ type: 'text', text: e.message }], isError: true };
    throw e;
  }
}

export function createServer(options: { cwd?: string } = {}): McpServer {
  const server = new McpServer({ name: 'draftsman', version: VERSION }, { capabilities: { tools: {} } });

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
    ({ path, line, description }) => run(() => markSlotInFile(path, line, description, options.cwd)),
  );

  return server;
}

// Start serving when run as a program, not when imported by tests.
const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  // serveStdio speaks protocol 2026-07-28 and still serves hosts that open the
  // older way, from the same factory.
  serveStdio(() => createServer(), { onerror: (e) => console.error(`draftsman: ${e.message}`) });
}

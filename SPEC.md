# Draftsman product spec

Nov 25, 2026

## In one line

Draftsman takes a markdown draft to a publish-ready post. You talk to the AI you already use, and Draftsman does the layout work: images found, licensed and credited, tables turned into figures, pull quotes picked and styled, figures numbered, weak lists fixed and a carousel built from the summary. It works with any AI app on your computer that can run MCP tools, such as VS Code, Claude Code, Claude Desktop, Cursor or the ChatGPT desktop app, and it has no model of its own. Web-only chat apps can't reach it, because it works on files on your machine.

## Why a rewrite

- Today this work is spread over separate commands in two extensions plus written procedures, with no stated goal and no finish line.
- The image step has no AI. It takes the first result whose license is safe.
- The pull quote finder calls one AI directly, so it only works with that AI.
- Several steps lean on private setup: a server that holds stock keys and makes data sheets, a separate images repo and fixed local paths.
- So it gets a new repo, written from this spec. The old code is a reference for lessons, not a base to copy.

## Who it's for

- **Main user:** a solo writer who drafts long articles in markdown, in an editor or agent with AI built in (VS Code with Copilot, Claude Code, Cursor, Claude Desktop), and publishes to a newsletter or blog, Substack in particular, which can't show markdown tables.
- **Also:** people writing docs or reports who want credited images and clean figures without a design tool.
- **Not for:** image editing, teams that need a shared asset library, or non-markdown formats.

## What else is out there

No tool found does the whole pass. Each piece exists on its own (checked Nov 25, 2026):

| Tool | Where | What overlaps | What's missing |
| --- | --- | --- | --- |
| [Substack Draft Publisher](https://mcpmarket.com/tools/skills/substack-draft-publisher) | Claude Code skill | Pastes a markdown draft into Substack and turns its tables into styled images | Works only with Claude; no licensed image search, pull quotes or carousel |
| [Substack editor](https://on.substack.com/p/product-news-dashboard-updates) | Substack | Unsplash search in the editor, and AI images per one writer's report | Inside Substack only; no table figures |
| [StockPack](https://wordpress.org/plugins/stockpack/) | WordPress | Eight stock sources, AI generation, license history per image | WordPress only |
| [Image Inserter](https://community.obsidian.md/plugins/insert-unsplash-image) | Obsidian | Unsplash, Pexels and Pixabay search | Images only |
| DevStock, [Kavel](https://marketplace.visualstudio.com/items?itemName=kavel.kavel) | VS Code | Stock search; AI image generation | Images only, with few or no users |
| [Table Exporter](https://forum.obsidian.md/t/table-exporter-export-rendered-markdown-tables-to-png-csv-excel-and-pdf/115162) | Obsidian | Tables to PNG, CSV, Excel or PDF | Tables only, one at a time by hand |
| [GitHub Image Uploader](https://community.obsidian.md/plugins/github-image-uploader), [PicList](https://github.com/Kuingsmile/PicList) | Obsidian, VS Code | Push images to your own GitHub repo and swap in the links | Hosting only |
| [Datawrapper](https://nsokolsky.substack.com/p/how-to-insert-a-table-in-substack) | Web | The usual way to get a table into Substack, as an embed | Manual, and every change means republishing |

### Feature comparison

"No" means the tool's own page doesn't offer it. "Not stated" means its page doesn't say.

| Feature | Draftsman | Substack Draft Publisher | Substack editor | StockPack | Image Inserter | Table Exporter |
| --- | --- | --- | --- | --- | --- | --- |
| Runs in | VS Code, Claude Code, any MCP client | Claude Code | Substack | WordPress | Obsidian | Obsidian |
| Works with any AI | Yes | Claude only | No | No | No | No |
| Stock image search | Yes | No | Yes, Unsplash | Yes, 8 sources | Yes, 3 sources | No |
| License checked and recorded | Yes | No | Not stated | Yes | Not stated | No |
| AI image generation | Yes, your own key | No | Yes, per one writer's report | Yes, paid credits | No | No |
| Tables as images | Yes, clickable, linked to a new Google Sheet | Yes | No | No | No | Yes, by hand |
| Figure numbering | Yes | Not stated | No | No | No | No |
| Pull quotes picked and styled | Yes | Not stated | Not stated | No | No | No |
| Carousel from the summary | Yes | No | No | No | No | No |
| Images pushed to your own repo | Optional | Not stated | No | No | Not stated | No |
| Price | Free | Not stated | Free | Free, AI credits from $5 | Free | Free |

Draftsman's case is the whole pass in one place, with licenses checked and recorded, driven by any AI. The risk to watch: if Substack adds tables of its own, turning tables into images matters less there. This wasn't confirmed either way.

## What a user can do

1. **Mark image spots while writing.** One keystroke drops a placeholder with a short description, so writing never stops for a picture hunt.
2. **Fill the images.** The AI reads the article, offers two or three candidates per spot with their license, the user picks, and Draftsman places each with its credit. When stock fails, it writes a prompt in the user's style, and generates the image if the user has set up a generator.
3. **Turn tables into figures.** Each markdown table becomes a styled, clickable image with a numbered caption. Clicking it opens a new Google Sheet with the full data, so the table shows on platforms that can't render tables and readers can still use the numbers.
4. **Add pull quotes.** The AI suggests sentences that stand on their own, using the user's criteria. Each one the user accepts becomes a styled image placed by its source. Existing blockquotes can be styled the same way.
5. **Keep figures numbered.** Captions stay in order after any figure is added, moved or removed.
6. **Fix weak lists.** The AI flags bullet lists that are really a table, an argument or a paragraph, and proposes the change. Nothing changes until the user accepts.
7. **Build a carousel.** From the article's summary block and its images, Draftsman makes a slide deck and a PDF in the portrait size LinkedIn carousels use.
8. **Check before publishing.** One review lists anything missing: credits, alt text, unpromoted tables, figure numbers out of order, dead links.
9. **Keep a record.** Every image and figure it makes has a provenance file: what it came from, its license and when.

## The AI is the interface

Draftsman has no chat window and makes no model calls. The user's AI host does the talking and judging, and Draftsman gives it tools, rules and the user's criteria. That is what makes it AI-agnostic from the first line of code: whatever model the host runs is the model Draftsman uses.

A typical exchange in any host:

> **You:** Get this post ready to publish. **AI:** It has three image spots, two tables and no pull quotes yet. I'll start with the tables: both are now figures 1 and 2, each linked to a new Google Sheet. For the first image spot I found three photos, all free for commercial use. Which one? **You:** The second. Then pull quotes. **AI:** Placed. Here are four pull quote candidates from your criteria. Which should go in?

This follows where the platforms are heading:

- The MCP spec of July 28, 2026 deprecated sampling, the way a tool server could borrow the host's model, and tells servers to call model providers directly instead. A server that never needs a model avoids that problem.
- VS Code has deprecated chat participants. Its recommended way to ship an AI workflow is an agent plugin: skills plus an MCP server.

### Which AI apps can use it

Draftsman works on files on your computer, so it needs an AI app that runs local MCP tools.

- **Works:** VS Code with Copilot, Claude Code, Claude Desktop, Cursor, Windsurf, and the ChatGPT desktop app and Codex.
- **Doesn't work:** ChatGPT and Claude on the web, and Microsoft Copilot, which only reach tools hosted online. A model on its own, such as a local Ollama model, needs one of the apps above to run it.
- **Probably works, not yet checked:** Zed, JetBrains, Gemini CLI, Cline and Continue.

## How it's built

- **Core: a local MCP server** in TypeScript on the official SDK, at protocol version 2026-07-28, over stdio. It is deterministic and calls no model.
- **Skill files:** plain instructions for the AI, one per job: images, tables, pull quotes, lists, carousel and review. They say when to ask the user, and they never let the AI place anything that fails a check.
- **Criteria files:** the rules for choosing pull quotes and judging lists, kept as editable text the user can replace with their own. Samples ship with it.
- **Renderer:** HTML templates turned into PNGs by a local headless browser. It uses an installed Chrome or Edge when there is one, and otherwise downloads one only after asking.
- **Styles:** one style file sets colors, fonts and an optional watermark for every image it renders, plus the wording style for generation prompts. Neutral by default, with a sample brand style and room for the user's own.
- **Packaging:** a VS Code agent plugin (skills plus the MCP server) on the Marketplace and Open VSX. The same server and skills also install in Claude Code and other MCP clients.
- **One editor command without AI:** the mark-a-spot keystroke, because opening a chat to mark a spot would break the flow of writing.
- **Picking:** an image grid through MCP Apps where the host shows one (experimental in VS Code). Otherwise a plain list in the chat with links. Forms through MCP elicitation where the host supports it.
- **Image sources:** generic source definitions in JSON (search URL, auth, field map, license map and rules such as download or hotlink, credit format, cache time and the URL to call when a photo is picked). Pixabay is the default source. Openverse, Wikimedia Commons and a local folder are ready-made presets, off until the user turns them on. Pexels is a preset only for people who already have a Pexels key, because Pexels paused new API keys in November 2026 with no date to resume. Users add their own keys, kept in the OS keychain or an environment variable and never shipped.
- **Image generators:** the same generic approach, starting with OpenAI-style image endpoints, always on the user's own key.
- **Table data:** each table image links to a new Google Sheet made in the user's own Google account, viewable by anyone with the link. It asks only for Google's narrowest Drive permission, which covers files the app creates and which Google rates non-sensitive, so no Google app review should be needed. A test still has to confirm that this permission also lets it share the new sheet. People who don't sign in to Google get the styled image alone, with no link.
- **Where files go:** a folder in the writer's project by default. An optional destination pushes images to a git repo the user owns and uses its public file links, for platforms that take image links.

### Tools the server offers

| Tool | What it does |
| --- | --- |
| `find_slots`, `mark_slot` | List or add image placeholders |
| `search_images`, `check_license` | Search the enabled sources, and pass only images where commercial use and changes are both clearly allowed |
| `place_image` | Download or hotlink as the source requires, write the credit and alt text, save provenance, call the on-pick URL |
| `style_prompt`, `generate_image` | Write a generation prompt in the chosen style, and generate through a generator the user has set up |
| `find_tables`, `render_table` | List tables, and turn one into a clickable styled image with a caption, linked to a new Google Sheet of its data |
| `render_pullquote` | Turn a quote into a styled image placed by its source, refusing any text not found word for word in the article |
| `find_blockquotes` | List blockquotes so they can be styled the same way |
| `renumber_figures` | Put every figure caption in order |
| `find_lists`, `apply_change` | List bullet lists with their context, and apply an accepted change as one edit the user can undo |
| `build_carousel` | Make the slide deck and PDF from the summary block and the article's images |
| `review_article` | List every problem the jobs above would catch |
| `list_setup` | Show which sources, generators, styles and destinations are set up and working |

The image placeholder is a markdown image with a `draftsman:` address, like `![drought map of Texas](draftsman:pending)`. It stays plain markdown and shows up as a missing image in any preview, so an unfilled spot is easy to see.

## Definition of done

### Version 1 is done when all of these are true

1. A new user on a clean machine can install it, add a Pixabay key, sign in to Google and take the demo article (three image spots, two tables, a summary block) to a publish-ready post plus a carousel PDF in under 15 minutes, using only the README.
2. Every job works in VS Code with Copilot agent mode and in Claude Code, each shown by a recorded run on the demo article.
3. Draftsman makes no model calls. A test fails the build if any model SDK appears in its dependencies.
4. No image is placed unless `check_license` passes. Tests cover the license mapping of every preset, including at least one rejection each.
5. Every placed image has a credit in the source's required format, alt text and a provenance file, and each source's rules on downloading, hotlinking, caching and on-pick calls are followed. Tests use recorded responses, not live APIs.
6. Every table becomes a clickable image with a numbered caption, linked to a new Google Sheet that anyone with the link can view. Users without Google get the image alone. Rendered images match reference images in tests within a small tolerance.
7. Pull quotes are always word for word from the article. A test feeds altered text and expects a refusal.
8. Figure numbers are in order after any add, move or delete. Tests cover each case.
9. A list changes only after the user accepts, and the change is one edit that undo reverses.
10. The carousel PDF is portrait 1080 by 1350, built from the summary block and the article's images. A test checks the page size and that every summary point has a slide.
11. Running `review_article` on the finished demo article reports nothing.
12. Keys never appear in the repo, logs or provenance files. A test scans all of them.
13. No private repo names appear in the package, README or source. The name check runs in CI.
14. CI runs the tests on every push, and a tag publishes to both stores.
15. The author has used it on three real articles and published them.

### Any piece of work is done when

- Its acceptance check is written in SPEC.md before the code.
- It has automated tests, and they pass in CI.
- It works from the chat in both VS Code and Claude Code.
- The README covers it.
- Any new network call has a recorded test response.

## Acceptance checks

One list per piece, written before its code or with it. Each list names the tests that hold it.

### Server

- It runs over stdio and agrees protocol 2026-07-28 with a client that asks for it. A client that opens with the older `initialize` handshake is still served.
- It offers the tools built so far, and marks the read-only ones read-only.
- A tool given bad input returns an error the AI can read and act on, and changes no file.

Tests: `test/server.test.ts`

### Image placeholders: `find_slots` and `mark_slot`

- `find_slots` lists every `![description](draftsman:pending)` in a .md or .markdown file, with its line, column and description, the block that holds it, and the blocks before and after.
- It accepts a title, angle brackets around the link, escaped characters and one level of brackets in the description, and several placeholders on one line.
- It ignores placeholders in fenced code (including a fence that is never closed) and in inline code, and ignores ordinary images and other `draftsman:` addresses.
- `mark_slot` puts one placeholder at the given line as its own block, adds blank lines only where needed, and returns it as `find_slots` would.
- It refuses, and leaves the file unchanged, for: a line that would split a block, a line inside a code block, a line outside the file, an empty or multi-line description, and a file that isn't markdown or doesn't exist.
- It keeps the file's line endings and whether the file ends with a newline.
- A description with brackets or backslashes comes back from `find_slots` unchanged.

Tests: `test/slots.test.ts`, `test/server.test.ts`

### Renderer

- It turns an HTML template into a PNG with an installed Chrome or Edge, or the browser named in `DRAFTSMAN_BROWSER`. With none, it fails with a message saying what to install, and downloads nothing.
- It makes no network requests unless asked to.
- Fonts passed in are embedded. A font that doesn't load is an error, never a silent switch to another font.
- A sample table renders within 8 pixels of its reference image on any machine. Changing one digit in the table fails the comparison.
- The test renders with one pinned Chrome for Testing build and a fixed font setup, so a browser update or a machine's font settings can't change the result. Draftsman itself still uses the installed browser.

Tests: `test/render.test.ts`

### Private names check and CI

- `scripts/check-private-names.sh` fails if any pattern in `PRIVATE_NAMES` (one per line, any case) appears in a file's contents or path, or in a commit message. Files git ignores are skipped; new files that aren't ignored are checked.
- Its output says where a match is, never the matching text or the pattern.
- It fails when `PRIVATE_NAMES` is empty or unset, or holds an invalid pattern, so a missing secret can't pass.
- The patterns are never written into the repo.
- CI runs lint, the type check, the tests and the name check on every push. The name check reads the `PRIVATE_NAMES` repository secret.

Tests: `test/check-private-names.test.ts`; CI: `.github/workflows/ci.yml`

### Images: sources, `search_images`, `check_license` and `place_image`

Source definitions and presets

- Each source is one JSON file: search URL, auth, field map, license map, the download or hotlink rule, credit format, cache time, an optional on-pick URL, and links to the terms its rules came from. A JSON Schema describes the format, and the committed schema matches the code.
- Every definition, preset or the user's own, is checked when the server starts. A bad one stops it with an error naming the file, the field and what is wrong.
- Presets: Pixabay is on by default. Openverse, Wikimedia Commons, a local folder and Pexels are off until the user turns them on. Pexels is for people who already have a key.
- Each preset's rules follow its terms as read on Nov 25, 2026, and cite them: Pixabay images are downloaded, never hotlinked, and its searches are cached for 24 hours. No preset has an on-pick URL, because none of the five sources asks for one.

Tests: `test/sources.test.ts`

Keys

- A key comes from an environment variable or the OS keychain. A source that needs a key and has none is skipped with a message saying how to add one, and the other sources still search.
- No key appears in the repo, test recordings, logs, provenance files, the search cache or tool results. A test runs a search and a placement with a known fake key and scans all of them for it, and scans the repo for anything shaped like a Pixabay or Pexels key.

Tests: `test/keys.test.ts`, `test/no-keys.test.ts`

`search_images`

- It searches the enabled sources and returns candidates with source, title, creator, page and thumbnail links, size, and the license as the source states it. One source failing doesn't stop the others.
- A repeated search within a source's cache time is answered from the cache.
- Tests use recorded responses only, with keys scrubbed. A request with no recording fails the test, so no test reaches a live API.

Tests: `test/images.test.ts`

`check_license`

- It passes only when the license is known and allows both commercial use and changes. Unknown or missing licenses, non-commercial, no-derivatives and sampling licenses fail, with the reason. So does a file the source flags as restricted (trademarks, personality rights) or non-free.
- A pass lists what the license still asks for: credit, share-alike, and the source's prohibited uses.
- Each preset's license mapping is tested with at least one pass and one rejection, using recorded results.

Tests: `test/licenses.test.ts`

`place_image`

- It refuses any image that hasn't passed `check_license` in this session, and any image that no search returned.
- It downloads or hotlinks as the source's rule says. A downloaded image goes in an `images` folder beside the article.
- It replaces the placeholder at the given line with the image and its alt text, and adds the credit in the source's format as its own paragraph below.
- It writes a provenance file beside the image: source and terms link, page, original URL, creator, license and its check, credit, alt text, the article and line, the file's hash, and when it was placed.
- It calls the source's on-pick URL where there is one, and records the result. A test source covers this, since no preset has one.
- If a step fails, the article is left unchanged.

Tests: `test/images.test.ts`

## Not in version 1

- A paid tier.
- Unsplash. Its terms rule out downloading and need app approval.
- Image editing, or hosting beyond pushing to the user's own repo.
- Posting to Substack, LinkedIn or anywhere else. It prepares files; the user publishes.
- A chat window of Draftsman's own.
- Formats other than markdown. Google Docs and Word are planned for version 2. The same tools work on a Google Doc, driven by the user's AI app, with Google's Docs MCP server or the Docs API making the edits and Draftsman's images uploaded to the user's Drive. Word (.docx) files are edited directly on the user's computer. No add-ins and no hosted server.

## Milestones

The wider scope moves the first release to mid-January.

| Week of | Done means |
| --- | --- |
| Dec 1 | New repo with SPEC.md, server skeleton, image placeholders, the renderer, CI and the name check |
| Dec 8 | Images: sources, license check, placing, credits and provenance |
| Dec 15 | Tables as clickable figures linked to new Google Sheets, and figure numbering |
| Dec 22 | Pull quotes and blockquotes, skills and plugin packaging, working in VS Code and Claude Code |
| Dec 29 | Lists and the carousel |
| Jan 5 | Review, optional destinations and generators, use on three real articles |
| Jan 12 | Listing and first release. LinkedIn post after. |

## Decisions (Nov 25)

1. The name stays Draftsman, though it now covers more than images. A Marketplace and Open VSX name check comes before the first publish.
2. Version 1 promises VS Code and Claude Code. Cursor and the other apps that work are best effort: supported if they run it, but not tested before each release.

## Sources

- [VS Code: AI extensibility overview](https://code.visualstudio.com/api/extension-guides/ai/ai-extensibility-overview), read Nov 25, 2026
- [VS Code: chat participants (deprecated)](https://code.visualstudio.com/api/extension-guides/chat), read Nov 25, 2026
- [VS Code: MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp), read Nov 25, 2026
- [MCP: client concepts, 2026-07-28](https://modelcontextprotocol.io/docs/2026-07-28/learn/client-concepts)
- [MCP blog: the 2026-07-28 specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

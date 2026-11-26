# Draftsman

Draftsman takes a markdown draft to a publish-ready post. You talk to the AI you already use, and Draftsman does the layout work: images found, licensed and credited, tables turned into figures, pull quotes picked and styled, figures numbered, weak lists fixed and a carousel built from the summary.

It is a local [MCP](https://modelcontextprotocol.io) server. It works with any AI app on your computer that runs local MCP tools, such as VS Code, Claude Code, Claude Desktop or Cursor. It calls no model of its own.

**Status: early work, not ready to use.** [SPEC.md](SPEC.md) describes what version 1 will do. Built so far:

- `find_slots` lists the image spots in an article. An image spot is a markdown image whose link is `draftsman:pending`, like `![drought map of Texas](draftsman:pending)`.
- `mark_slot` adds an image spot at a given line.
- `search_images` searches the image sources you've turned on.
- `check_license` passes an image only when its license clearly allows both commercial use and changes.
- `place_image` fills an image spot with an image that passed: it saves the image beside the article, writes the credit and alt text, and keeps a provenance file recording where the image came from and under what license.
- `find_tables` lists the markdown tables in an article.
- `render_table` turns a table into a styled image with a numbered caption. If you're signed in to Google, the data also goes into a new Google Sheet that anyone with the link can view, and the image links to it. Without Google you get the image alone.
- `renumber_figures` puts figure captions back in order after you add, move or delete one, and updates "Figure 3"-style references to match.
- `get_criteria` gives the AI your rules for picking pull quotes.
- `render_pullquote` turns a sentence from the article into a styled image placed after its paragraph. The quote must be word for word from one paragraph; anything else is refused. It can also turn an existing blockquote into the same kind of image.
- `find_blockquotes` lists the blockquotes in an article.
- A renderer that turns an HTML template into a PNG with your installed Chrome or Edge.

## Styles

Every image Draftsman draws uses one style file: colors, fonts and an optional watermark. Two ship in [styles/](styles/): `default` (neutral) and `sample-brand` (an example to copy). Pick one, or point to your own, in `.draftsman/config.json`:

```json
{ "style": "sample-brand" }
```

A style's fonts are files beside it, embedded when rendering, so a figure looks the same on any computer. The format is [styles/style.schema.json](styles/style.schema.json). The shipped fonts are DejaVu, whose license is in [styles/fonts/](styles/fonts/).

## Criteria

What makes a good pull quote is up to you. Draftsman ships a sample in [criteria/pullquotes.md](criteria/pullquotes.md); copy it to `.draftsman/criteria/pullquotes.md` in your project and edit it, or name another file in the config as `"criteria": { "pullquotes": "path/to/file.md" }`. The AI reads it through `get_criteria` before it suggests quotes.

A style's `pullquote` section sets the quote's font (`text` or `heading`), size, image width, the large quote mark, the accent color and the longest quote accepted. Every field has a default.

## Google Sheets for tables

To link table images to sheets, sign in once from a terminal:

```sh
DRAFTSMAN_GOOGLE_CLIENT_ID=<your OAuth client ID> npx draftsman google-sign-in
```

It opens Google's consent page in your browser and asks only for permission to manage the files Draftsman creates (`drive.file`), nothing else in your Drive. The sign-in is kept in your system keychain. On Ubuntu that needs `secret-tool` (`sudo apt install libsecret-tools`). You can also set `DRAFTSMAN_GOOGLE_REFRESH_TOKEN` yourself. The client ID can also go in the config as `"google": { "clientId": "…" }`; it isn't secret.

Google also requires the OAuth client's secret, even with PKCE. Set `DRAFTSMAN_GOOGLE_CLIENT_SECRET`, or store it in the keychain (`secret-tool store --label="Draftsman Google client secret" service draftsman account google-client-secret`). It never goes in the config or any file.

## Image sources

| Source | On by default | Needs a key |
| --- | --- | --- |
| Pixabay | Yes | Yes, free: [pixabay.com/api/docs](https://pixabay.com/api/docs/) |
| Openverse | No | No |
| Wikimedia Commons | No | No |
| Pexels | No | Yes. Pexels has paused new keys, so this is only for people who already have one. |
| A local folder | No | No |

Turn sources on or off in `.draftsman/config.json` in your project folder:

```json
{
  "sources": { "openverse": true, "wikimedia": true, "local": { "folder": "~/Pictures/blog" } }
}
```

Each source is a JSON file in [sources/](sources/), and the rules in it (download or link, how long to cache, how to credit) come from that source's own terms, which the file links to. You can add your own source: write a file in the same format ([sources/source.schema.json](sources/source.schema.json)) and list it under `"extraSources"` in the config.

### Keys

Draftsman reads a key from an environment variable, or else from your system keychain. It never writes a key to a file.

- Environment: `DRAFTSMAN_PIXABAY_KEY`, `DRAFTSMAN_PEXELS_KEY`
- Linux keychain: `secret-tool store --label="Draftsman pixabay" service draftsman account pixabay`
- macOS keychain: `security add-generic-password -s draftsman -a pixabay -w`
- Windows: use the environment variable.

### A local folder of images

Draftsman can't tell an image's license from the file, so each image in your folder needs a sidecar file with the same name and `.json` in place of the image extension. An image without one fails the license check.

```json
{ "license": "own", "title": "Harbor light at dusk", "creator": "Your Name", "creatorUrl": "https://example.com" }
```

`license` can be `own`, `cc0`, `public domain`, `cc-by` or `cc-by-sa`.

Openverse: image search through Openverse is made using the [Openverse API](https://openverse.org). Draftsman is not endorsed or certified by Openverse.

## Try it

You need Node 22.12 or later, and Chrome or Edge for rendering.

```sh
npm install
npm run test-browser   # once: the pinned Chrome for Testing the render test uses (~170 MB)
npm test
npm run build
```

To try it in an MCP client, point the client at `node /path/to/Draftsman/dist/server.js` over stdio. To render with a browser in a non-standard place, set `DRAFTSMAN_BROWSER` to its path.

## Development

- `npm run lint`, `npm run typecheck`, `npm test`
- `UPDATE_REFERENCE=1 npm test` rewrites the reference image after a deliberate change to the sample table.
- Tests never reach a live API: they use recorded responses in `test/fixtures/recordings/`. `npm run record` records a new one, with any key replaced by `REDACTED`. The Pixabay and Pexels recordings were built from those APIs' documentation, because no key was available; each says so in its `note`.
- `npm run schema` regenerates `sources/source.schema.json` after a change to the definition format.
- `scripts/check-private-names.sh` fails if any name in the `PRIVATE_NAMES` environment variable (one per line) appears in the repo. CI runs it with the repository secret of the same name.

## License

MIT

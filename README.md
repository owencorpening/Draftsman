# Draftsman

Draftsman takes a markdown draft to a publish-ready post. You talk to the AI you already use, and Draftsman does the layout work: images found, licensed and credited, tables turned into figures, pull quotes picked and styled, figures numbered, weak lists fixed and a carousel built from the summary.

It is a local [MCP](https://modelcontextprotocol.io) server. It works with any AI app on your computer that runs local MCP tools, such as VS Code, Claude Code, Claude Desktop or Cursor. It calls no model of its own.

**Status: early work, not ready to use.** [SPEC.md](SPEC.md) describes what version 1 will do. Built so far:

- `find_slots` lists the image spots in an article. An image spot is a markdown image whose link is `draftsman:pending`, like `![drought map of Texas](draftsman:pending)`.
- `mark_slot` adds an image spot at a given line.
- `search_images` searches the image sources you've turned on.
- `check_license` passes an image only when its license clearly allows both commercial use and changes.
- `place_image` fills an image spot with an image that passed: it saves the image beside the article, writes the credit and alt text, and keeps a provenance file recording where the image came from and under what license.
- A renderer that turns an HTML template into a PNG with your installed Chrome or Edge.

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

# Draftsman

Draftsman takes a markdown draft to a publish-ready post. You talk to the AI you already use, and Draftsman does the layout work: images found, licensed and credited, tables turned into figures, pull quotes picked and styled, figures numbered, weak lists fixed and a carousel built from the summary.

It is a local [MCP](https://modelcontextprotocol.io) server. It works with any AI app on your computer that runs local MCP tools, such as VS Code, Claude Code, Claude Desktop or Cursor. It calls no model of its own.

**Status: early work, not ready to use.** [SPEC.md](SPEC.md) describes what version 1 will do. Built so far:

- `find_slots` lists the image spots in an article. An image spot is a markdown image whose link is `draftsman:pending`, like `![drought map of Texas](draftsman:pending)`.
- `mark_slot` adds an image spot at a given line.
- A renderer that turns an HTML template into a PNG with your installed Chrome or Edge.

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
- `scripts/check-private-names.sh` fails if any name in the `PRIVATE_NAMES` environment variable (one per line) appears in the repo. CI runs it with the repository secret of the same name.

## License

MIT

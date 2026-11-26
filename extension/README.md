# Draftsman: Mark Image Spot

One keystroke drops an image placeholder into a markdown draft, so writing never stops for a picture hunt.

Press **Ctrl+Alt+Shift+I** (**Cmd+Alt+Shift+I** on a Mac) in a markdown file, or run **Draftsman: Mark Image Spot**, and say in a few words what the image should show. It inserts:

```markdown
![drought map of Texas](draftsman:pending)
```

On a blank line it goes right there; inside a paragraph it goes after the paragraph, so the paragraph stays whole. It needs no AI and no server. Later, [Draftsman](https://github.com/owencorpening/Draftsman) finds every placeholder and fills it with a licensed, credited image.

## Development

`npm test` builds the extension and runs its tests inside VS Code 1.140, downloaded to `.vscode-test/` the first time (about 330 MB). On Linux without a display, use `xvfb-run -a npm test`.

---
name: pull-quotes
description: Suggest pull quotes from a markdown article by the user's own criteria and place the chosen ones as styled images, or style existing blockquotes, using the Draftsman tools. Use when the user asks for pull quotes or wants blockquotes styled.
---

# Pull quotes

A pull quote is a sentence from the article, set large as an image beside where it appears. It must be the article's own words, exactly.

## Steps

1. Call `get_criteria` with job `pullquotes` and follow what it says. It is the user's own file when they have one.
2. Read the article and pick more candidates than the criteria say to use. For each, give the exact sentence, its line, and why it meets the criteria.
3. Wait for the user to choose. Never place a pull quote the user hasn't picked, unless pull quotes are on auto-accept in a batch run (see below).
4. Call `render_pullquote` with each chosen quote, copied exactly from the article. If the same words appear twice, give the line.
5. If it's refused because the words don't match, copy the sentence again from the article. Never shorten a quote with "…" or change a word to make it fit; pick a different sentence instead.

## Blockquotes

- Call `find_blockquotes` to list them. Offer to style the ones the user wants, then call `render_pullquote` with the blockquote's line and no quote. The blockquote is replaced by its image.
- GitHub alerts (`> [!NOTE]` and the like) stay as text.

## Rules

- The quote's alt text is the quote itself, so it must read well on its own.
- Line numbers change after each placement. Read the article again before the next one.
- Each placement is one edit that `undo_change` reverses; tell the user so.

## In a batch with pull quotes on auto-accept

Only inside a batch run, and only when `plan_batch` shows `pullquotes` on: still call `get_criteria` first, then place the best candidates yourself, no more than the criteria say to use, instead of waiting for the user to pick. List each placed quote with its line in your report. Blockquotes are styled only if the user asked for that in the batch.

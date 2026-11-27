---
name: lists
description: Find bullet lists in a markdown article that are really a table, an argument or a paragraph, by the user's own criteria, and change only the ones the user accepts, using the Draftsman tools. Use when the user asks to fix, check or tighten the lists in a draft.
---

# Lists

A list that's really a table, an argument or a paragraph reads worse than what it should be. You judge; Draftsman finds the lists and makes the edits, each one reversible.

## Steps

1. Call `get_criteria` with job `lists` and follow what it says. It is the user's own file when they have one.
2. Call `find_lists` on the article. Judge each list by the criteria, using the text before and after it.
3. For each list worth changing, show the list as it is, the proposed version, and one line on why. Leave the rest alone and don't list them.
4. Wait for the user to accept, reject or adjust each proposal. Never change a list the user hasn't accepted.
5. For each accepted change, call `apply_change` with the list's lines, its exact current text as `original`, and the new markdown. If it refuses because the lines changed, call `find_lists` again and show the user the list as it now reads.
6. After each change, tell the user it's done and that `undo_change` reverses it.

## Rules

- Change structure, not wording. Keep the author's words; only rejoin, reorder into columns or renumber them.
- A list that becomes a table can then go through the tables skill to become a figure. Offer it, don't do it unasked.
- Line numbers move after each change. Call `find_lists` again before the next one.
- If the user asks to undo, call `undo_change`; call it again for each earlier change they want reversed.

## In a batch with lists on auto-accept

Only inside a batch run, and only when `plan_batch` shows `lists` on: skip steps 3 and 4. Apply each change the criteria clearly call for, and list each one as before and after in your report. When a list is a close call, leave it alone and mention it instead.

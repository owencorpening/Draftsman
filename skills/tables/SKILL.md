---
name: tables
description: Turn the markdown tables in an article into numbered, styled figure images linked to a Google Sheet of the data, using the Draftsman tools. Use when the user wants tables made publish-ready, made into figures, or figure numbers fixed.
---

# Tables

Many platforms can't show a markdown table. Draftsman turns each one into a styled image with a numbered caption. When the user is signed in to Google, the image links to a new Google Sheet that anyone with the link can view, so readers can still use the numbers.

## Steps

1. Call `find_tables` on the article.
2. For each table, write a short caption saying what it shows, from the table and the paragraph before it. Show the captions to the user and let them change any before rendering.
3. Call `render_table` for each table with its line and caption. Line numbers change after each one, so call `find_tables` again before the next.
4. Pass on any warnings. If there's no sheet because Google isn't set up or the user isn't signed in, say so once and tell them they can run `draftsman google-sign-in` in a terminal. The image still goes in.
5. After adding, moving or deleting any figure by hand, call `renumber_figures`, and tell the user about any reference it couldn't match.

## Rules

- Don't write "Figure N." in the caption; Draftsman numbers it.
- Alt text names the columns and row count by default. Give better alt text when the table's point can be said in a sentence.
- Each `render_table` and each `renumber_figures` is one edit that `undo_change` reverses. Undoing a table puts it back but can't delete its Google Sheet; tell the user it's still in their Drive.

## In a batch on auto-accept

Only inside a batch run:

- When `plan_batch` shows `figures` on, call `renumber_figures` on each article whose figures are out of order, without asking, and report what changed.
- When it shows `tables` on, write each caption and render each table without waiting for the user, and list each caption and sheet link in your report. Tables have their own switch because every one makes a Google Sheet anyone with the link can open; if `tables` is off, show the captions and wait as usual, even when other jobs are on.

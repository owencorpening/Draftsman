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

---
name: images
description: Fill the image spots in a markdown article with licensed, credited images using the Draftsman tools. Use when the user wants images found, chosen or placed for a draft, or asks to mark where an image should go.
---

# Images

Draftsman marks an image spot as a markdown image whose link is `draftsman:pending`, like `![drought map of Texas](draftsman:pending)`. You find candidates, the user picks, and Draftsman places the pick with its credit, alt text and provenance.

## Steps

1. Call `find_slots` on the article. If there are none and the user wants images, read the article, propose where images would help, and call `mark_slot` only for the spots the user agrees to.
2. For each spot, read its description and the paragraph around it, and call `search_images` with a few words saying what the image should show.
3. Call `check_license` on each candidate you might offer. Drop any that fail. Never offer or place an image that hasn't passed.
4. Offer two or three candidates per spot: title, creator, source, thumbnail link and what the license still asks for (credit, share-alike). Always say which source each one is from.
5. Wait for the user to choose. Never pick for them.
6. Call `place_image` with the spot's line and the chosen ref. Write alt text that says what the image shows for someone who can't see it; the spot's description is the default.
7. Tell the user what was placed, the credit that was added, and anything the license still asks of them.

## Rules

- No image goes in unless `check_license` passed it in this session. If none pass, say so and suggest a different search; don't lower the bar.
- If a source is skipped for lack of a key, pass on the message about how to add one.
- Line numbers change after each placement. Call `find_slots` again before placing the next one.

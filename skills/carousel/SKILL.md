---
name: carousel
description: Build a portrait LinkedIn-style carousel (a Marp slide deck and a 1080 by 1350 PDF) from a markdown article's summary block and images, using the Draftsman tools. Use when the user asks for a carousel, slides or a LinkedIn post deck from an article.
---

# Carousel

Draftsman builds the carousel from the article's summary block: the section under a heading like "Executive Summary", "Summary" or "Key takeaways". Each point becomes a slide, paired with the article's images in order.

## Steps

1. Read the article and find its summary block. Show the user the points that will become slides and which image goes with each.
2. If there's no summary block, offer to draft one from the article for the user to review. Add it only after they accept it, with `apply_change`.
3. Ask for the published article's link if the user has it, for the closing slide.
4. Wait for the user to confirm, then call `build_carousel`.
5. Tell the user where the deck and the PDF went, how many slides there are, and pass on every warning. When an image's license asks for something, such as credit, make sure the user sees it; the slides already carry the credits Draftsman recorded.

## Editing

- The deck is Marp markdown beside the article. The user can edit it and open it in their own Marp tools.
- After the user edits the deck, call `build_carousel` again: the PDF is rebuilt from the edited deck, and the deck is left alone.
- To start over from the article, call `build_carousel` with `fromArticle`, but only after telling the user it replaces their edits to the deck.

---
name: batch
description: Run Draftsman's jobs over a whole folder or file pattern of markdown articles, starting with a dry run of the plan and ending with a summary of what changed in each file, honoring the user's per-job auto-accept settings. Use when the user asks to process, prepare or fix many articles at once, a folder, or a glob.
---

# Batch

A batch runs the same jobs over many articles. It always starts with a dry run the user approves and always ends with one summary per file. Auto-accept decides which jobs may change an article without asking; everything else is asked as usual.

## Steps

1. Call `plan_batch` with the folder, file or glob the user named. It changes nothing.
2. Show the whole plan: each article and the work found in it, every refused article with its reason, every warning, and the auto-accept setting for each job. Say plainly when a folder isn't under git: `undo_change` is then the only way back.
3. Ask which jobs to run, and wait for the user to say go. Change nothing before they do.
4. Work one article at a time, one job at a time, following that job's skill: `images`, `tables`, `pull-quotes`, `lists`, and figure numbering from `tables`. Each skill says what changes when its job is on auto-accept.
5. When every article is done, call `summarize_batch` with the batch id and show its summary: one entry per article, then the refused ones.
6. Remind the user that each change is one edit, and `undo_change` on an article reverses its changes one at a time, newest first.

## Auto-accept

- The settings come from `plan_batch`, which reads `autoAccept` in `.draftsman/config.json`. Everything is off unless the user turned it on. Never treat a job as auto-accepted because the user's request sounded hurried; only the config turns it on.
- Pull quotes, figure numbering and list fixes may run without asking when their job is on: each is one edit that `undo_change` reverses.
- Images auto-place only results that passed `check_license`. If none pass, skip the spot and list it in your report; never lower the bar.
- Tables run without asking only when `tables` is on by name, because each table makes a Google Sheet anyone with the link can open. `autoAccept: true` never turns it on.
- A job that's off still runs the normal way: propose, wait for the user, then act.

## Rules

- Don't touch an article `plan_batch` refused. If the user commits it and wants it in, call `plan_batch` again.
- If a tool refuses or fails on one article, note it, leave that article as it is, and carry on with the next. Report it at the end beside the summary.
- Line numbers move after each change. Read the article again before the next change in it.
- Keep your progress reports short: one line per article as you finish it.

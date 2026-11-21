---
title: Studio
description: Edit a page in the browser, next to the page itself.
badges: [Beta]
---

The Studio is an editor that opens beside the page you are reading. It is part of `shabd dev` only. A built site
does not contain it.

Open it with **Edit page** in the header. It shows the Markdown source of the current page. When you stop typing, it
writes the file, and the page next to it updates. It can also make a new page, and rename or delete the one on
screen.

There is no preview pane. The page beside the editor is the real page, rendered from the file that was just saved.

## The editor

The editor is [CodeMirror](https://codemirror.net/). It colours a page's frontmatter and its Markdown, and the code
inside a fence that names JavaScript, TypeScript, JSX, TSX, YAML or Markdown.

Its colours are the theme's own. It is drawn in the same custom properties as the page, and only in the eight that
[a test holds to a contrast floor](../configuration/theme.md#presets) in every preset. Switching between light and
dark, or picking another palette from the theme menu, changes the editor with everything else.

| Key | In the editor |
| --- | --- |
| <kbd>Tab</kbd> | Indents the line. <kbd>Shift</kbd> + <kbd>Tab</kbd> takes the indent back |
| <kbd>Esc</kbd>, then <kbd>Tab</kbd> | Moves on to the next control. Tab alone cannot, because it indents. A line under the text says so while the editor has focus |
| <kbd>Enter</kbd> | In a list or a quote, starts the next item |
| <kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>Z</kbd> | Undoes what you typed. Text that came from the file, or from another editor, is not undone |
| <kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>S</kbd> | Saves now |

CodeMirror is downloaded the first time the Studio is opened, not with the page.

## Where the file is written

The Studio has two ways to write, and uses the first one available.

| | How | Where it works |
| --- | --- | --- |
| A connected folder | The browser writes the file itself, with the File System Access API | Chrome, Edge and other Chromium browsers |
| The dev server | The browser sends the text to the dev server, which writes it | Every browser |

To use the first, choose **Connect a folder** and pick the site's content folder. The browser asks for permission
once, and remembers the folder for later visits. From then on the dev server has no part in saving.

Either way the result is a normal file on disk. Your editor, `git diff` and everything else see the change.

## Saving

- A pause of a quarter of a second saves. <kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>S</kbd> saves at once.
- The line under the editor says when the save happened and how long the page took to update.
- If the file changes on disk while the Studio has no unsaved edits, the editor follows the file. Only the part
  that changed is replaced, so the cursor stays where it was unless it was inside that part.
- If the file changes on disk while you *do* have unsaved edits, the Studio stops and asks which version to keep.
- A file whose lines end the way Windows writes them keeps those line endings.
- A half-typed line can be invalid for a moment, for example a `layout:` name you have not finished. The page then
  shows what is wrong where its content would be, keeps its title and layout, and returns as soon as the line is
  valid. Nothing reloads and the editor stays open.

## Making, renaming and deleting pages

Three buttons under the Studio's header work on whole pages.

| Button | What it does |
| --- | --- |
| **New page** | Asks for a file in the content folder, such as `guide/new-page.md`, and makes it. `.md` is added if you leave it out, and folders that are missing are made. The page starts with a title taken from its file name, and the Studio goes to it |
| **Rename** | Moves the file of the page on screen. What you had typed and not saved goes with it, and the Studio follows the page to its new address |
| **Delete** | Asks first. Then it removes the file from disk and goes to the page before it in the sidebar |

A name is refused while you type it if the file would not be a page: it would be outside the content folder, it
does not end in `.md` or `.mdx`, a part of it starts with `_` or `.`, or a page already has the address it would
get. Nothing is written over a file that is there.

### What a rename leaves behind

A page's address comes from its file name, so a renamed page has a new address, and a deleted one has none. Links
to the old address in other pages still point there. The Studio does not rewrite them.

It tells you about them. Before and after each of the three, it asks the dev server what
[`shabd check`](../reference/cli.md) reports, and lists what was not reported before: a link that now leads
nowhere, an entry in `sidebar.yaml` that names the old file, a redirect that led to the old address, a new page
that the sidebar does not list.

After a rename it also offers to add a [redirect](../configuration/site.md#redirects) from the old address to the
new one. That is one line more under `redirects:` in `shabd.config.yaml`. Nothing else in the file changes: your
comments, your quoting and the order of your keys stay as they are, and the result is read back to make sure of
it. Where a line cannot be put in like that, for example because the redirects are written between braces on one
line, the Studio makes no offer and shows you the line to add yourself.

## Editing with someone else

`features.studio.sync` decides whether drafts are shared before they are saved.

| Value | Drafts go to |
| --- | --- |
| `off` | Nobody |
| `tabs` | Other tabs and windows of the same browser. The default |
| `peers` | Another person's browser, directly, over WebRTC |

A draft arrives as the whole page. The editor puts in only the part that differs from what it shows, so your
cursor stays where it is.

With `peers`, the Studio gets an **Edit together** section. One person creates an invite and sends it; the other
pastes it and sends back the reply. The two codes are how the browsers find each other. After that, drafts travel
between the two browsers with no server in between, and each Studio saves to its own copy of the files.

> [!WARNING] Take turns
> Sync replaces the whole draft with the newest one. Two people typing in the same page at the same moment will
> overwrite each other. It suits handing a page back and forth, not simultaneous editing.

The invite exchange uses a public STUN server to learn each browser's network address. No draft passes through it.

If the two browsers cannot reach each other, or the connection drops, the Studio says so and offers to start again
with a new invite.

The connection has been tested between two separate browser sessions on one machine, in Chromium, Firefox and
WebKit. It has not been tested between two machines on different networks, where firewalls decide whether a direct
connection is possible.

## Is it safe to leave on?

The Studio's endpoints exist only in the dev server, and they are narrow on purpose:

- They only accept requests from the docs site itself, and require a token that only that site can read.
- A page that exists is looked up by its name. Saving, renaming and deleting take no path from the request for the
  file they act on, so they cannot reach a file that is not a page.
- A new page, and the new name of a renamed one, do come as a path. It is refused unless it names an `.md` or
  `.mdx` file inside the content folder, with no part that is `..` or that starts with `_` or `.`. The folder it
  names is then followed through any symbolic link, and has to be inside the content folder still.
- A new file is made in a way that fails if anything has that name already, a symbolic link included. Nothing is
  written over, and a page is not deleted if the file has changed since the Studio last read it.
- One file outside the content folder can change: `shabd.config.yaml` gains a line when you accept the offer of a
  redirect. The redirect must lead from an address that has no page to one that has.

In a connected folder the browser does this work, and holds a name to the same rules before it touches a file.
It cannot make a file in one step that fails if the name is taken: it looks first and then writes.

Set `features.studio: false` to remove the Studio and its endpoints.

## Limits

- A rename or a delete does not change other pages, the sidebar file or existing redirects. What it broke is
  listed, and mending it is yours to do.
- A deleted page is gone from disk. The Studio keeps no copy, and its undo does not bring a file back: that is
  what version control is for.
- It renames one page at a time and does not move or rename folders. A folder left empty stays.
- A rename that changes only capitals is refused on a disk that does not tell them apart, such as the usual
  one on macOS and Windows: to the disk the new name is taken.
- The list of what `shabd check` reports comes from the dev server, which also shows drafts. `shabd check` itself
  leaves drafts out, so the two can differ for a link to a draft.
- With a connected folder, the list and the redirect still come from the dev server. The config is not in the
  content folder, so the browser could not write to it.
- Making, renaming and deleting through a connected folder is tested with a folder in the browser's private file
  system standing in for a real one, because a test cannot click the folder picker.
- The editor has no autocomplete and no search of its own. The browser's find only sees the lines near the ones
  on screen, because the editor draws no more of a long page than that.
- Code in a fence is coloured for the six languages named above and no others. An `.mdx` page is coloured as
  Markdown: its JSX as the HTML it resembles, and its `import` and `export` lines not at all.
- The editor has been driven by keyboard and mouse in Chromium, Firefox and WebKit. It has not been tried with a
  screen reader, on a phone, or with an input method such as the ones for Chinese and Japanese.

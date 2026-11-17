---
title: Studio
description: Edit a page in the browser, next to the page itself.
badges: [Beta]
---

The Studio is an editor that opens beside the page you are reading. It is part of `shabd dev` only. A built site
does not contain it.

Open it with **Edit page** in the header. It shows the Markdown source of the current page. When you stop typing, it
writes the file, and the page next to it updates.

There is no preview pane. The page beside the editor is the real page, rendered from the file that was just saved.

## Where the file is written

The Studio has two ways to write, and uses the first one available.

| | How | Where it works |
| --- | --- | --- |
| A connected folder | The browser writes the file itself, with the File System Access API | Chrome, Edge and other Chromium browsers |
| The dev server | The browser sends the text to the dev server, which writes it | Every browser |

To use the first, choose **Connect a folder** and pick the site's content folder. The browser asks for permission
once, and remembers the folder for later visits. From then on the dev server has no part in saving.

Either way the result is a normal file on disk. Your editor, `git diff` and everything else see the change.

## The editor

The editor is a text area. Typing, selecting, undo and input methods work as they do in any text area of your
browser. On top of that it shows the source in colour and gives a few keys a meaning.

The colours mark what a writer looks for: frontmatter keys, headings, emphasis, code, where a link goes, the tags of
HTML and MDX, and the characters of the syntax itself. They are the theme's own colours, so they follow the palette
and the light or dark mode of the page beside the editor. A code block is one colour; the language inside it is not
coloured.

| Key | What it does |
| --- | --- |
| <kbd>Tab</kbd> | Types two spaces. With several lines selected, moves them in |
| <kbd>Shift</kbd> + <kbd>Tab</kbd> | Moves the line, or the selected lines, out |
| <kbd>Enter</kbd> | Goes on with a list or a quote: the next bullet, the next number, an unticked task. On an item with nothing in it, ends the list. Any other line keeps its indentation |
| <kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>B</kbd> | Puts `**` around the selection, or takes it away |
| <kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>I</kbd> | The same with `_` |
| <kbd>Esc</kbd>, then <kbd>Tab</kbd> | Leaves the editor with the keyboard. Tab alone would indent |

Undo is the browser's own, and takes back what these keys did as well.

## Saving

- A pause of a quarter of a second saves. <kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>S</kbd> saves at once.
- The line under the editor says when the save happened and how long the page took to update.
- If the file changes on disk while the Studio has no unsaved edits, the editor follows the file.
- If the file changes on disk while you *do* have unsaved edits, the Studio stops and asks which version to keep.
- A half-typed line can be invalid for a moment, for example a `layout:` name you have not finished. The page then
  shows what is wrong where its content would be, keeps its title and layout, and returns as soon as the line is
  valid. Nothing reloads and the editor stays open.

## Adding, renaming and deleting pages

Under the Studio's header are three buttons. Each changes a file in the content folder.

| Button | What it does |
| --- | --- |
| **New page** | Asks for a path, creates the file, and opens the new page |
| **Rename** | Asks for the new path, moves the file, and opens the page at its new address |
| **Delete** | Asks once, removes the file from disk, and goes to the home page |

A path is written from the content folder, with forward slashes, and ends in `.md` or `.mdx`: `guide/new-page.md`.
A new file holds a title made from its name and one line of text to replace.

The Studio refuses a path that is taken, a path whose address another page already has, and a name that could not
be a page, and says which it was. Each part of a path starts with a letter or a digit, and has only letters, digits,
hyphens, underscores and dots.

**Rename** is off while the page has edits that are not saved yet.

These three always go through the dev server, also when a folder is connected, because the dev server is what
keeps `sidebar.yaml` in step.

### What happens to sidebar.yaml

| After | The sidebar file |
| --- | --- |
| **New page** | Is not changed. The page appears in the sidebar where its folder is [generated](../configuration/sidebar.md#folders-you-did-not-mention). In a folder you list by hand, add a line for it |
| **Rename** | Every entry that names the page names it under its new path. Nothing else in the file changes |
| **Delete** | The page's entry is taken out, where it stands on lines of its own and is not the only entry of its list |

Where a deleted page's entry cannot be taken out that way, the file is left as it is and the Studio says that it
still lists the page. The dev server's log names the line, as it does for
[any entry that matches nothing](../configuration/sidebar.md#when-an-entry-matches-nothing).

Links to the page from other pages are not rewritten. `shabd check` lists the ones that lead nowhere after a
rename or a delete.

## Editing with someone else

`features.studio.sync` decides whether drafts are shared before they are saved.

| Value | Drafts go to |
| --- | --- |
| `off` | Nobody |
| `tabs` | Other tabs and windows of the same browser. The default |
| `peers` | Another person's browser, directly, over WebRTC |

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

The Studio's write endpoint exists only in the dev server, and it is narrow on purpose:

- It only accepts requests from the docs site itself, and requires a token that only that site can read.
- It can save, rename and delete only files that are already pages. The page is looked up by name.
- It can create only a new `.md` or `.mdx` file inside the content folder, and never writes over a file that is
  there. The same check applies to the path a page is renamed to.
- The only other file it changes is `sidebar.yaml`, and only where that names the page.

Set `features.studio: false` to remove the Studio and its endpoint.

## Limits

- A deleted file is gone from disk. The Studio keeps no copy; Git is how you get it back.
- A folder left empty by a rename or a delete is not removed.
- The editor has no autocomplete and no line numbers.
- The colours are a reading aid. They come from a small reader of Markdown that goes line by line, not from the
  compiler that makes the page. It follows frontmatter, code blocks and comments over as many lines as they have;
  a tag whose attributes go on to the next line is coloured on its first line only. Where the colours and the page
  disagree, the page is right.

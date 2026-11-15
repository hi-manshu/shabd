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

## Saving

- A pause of a quarter of a second saves. <kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>S</kbd> saves at once.
- The line under the editor says when the save happened and how long the page took to update.
- If the file changes on disk while the Studio has no unsaved edits, the editor follows the file.
- If the file changes on disk while you *do* have unsaved edits, the Studio stops and asks which version to keep.
- A half-typed line can be invalid for a moment, for example a `layout:` name you have not finished. The page then
  shows what is wrong where its content would be, keeps its title and layout, and returns as soon as the line is
  valid. Nothing reloads and the editor stays open.

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
- It can only write files that are already pages. The page is looked up by name; no path is taken from the request.

Set `features.studio: false` to remove the Studio and its endpoint.

## Limits

- It edits existing pages. Create and rename files in your editor.
- The editor is a plain text area: no syntax colours and no autocomplete yet.

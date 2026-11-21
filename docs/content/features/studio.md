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

### Images

Paste an image into the editor, or drop one on it. The Studio saves the file beside the page and puts a Markdown
image where the cursor was, or where the image was dropped:

```md
![](./screenshot.png)
```

The cursor is left between the square brackets, for the words that describe the picture to someone who cannot
see it. Shabd bundles an image that a page refers to by a relative path, so the picture shows in the page beside
the editor as soon as the page is saved, and is part of a build.

- PNG, JPEG, GIF, WebP and AVIF are taken, up to 10 MB each. What a file is, is read from its first bytes, not
  from its name.
- The file is named after what it was called, in lower case, with hyphens where there was anything but a letter
  or a digit, and with the extension of what it is: `Screen Shot 1.PNG` becomes `screen-shot-1.png`.
- A name that is taken is not written over. The next one is used: `screen-shot-1-2.png`.

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

A page is not moved to another folder if it would not find there what it uses by a path relative to itself: an
image beside it, shown as `./shot.png`, or a file that an `.mdx` page imports. The Studio moves the page and
nothing else, and a page whose image is missing cannot be shown at all, so the Studio could not be opened on it
again to mend the link. It says which files they are when you send the name. Move the page and those files
together in your file manager, or keep the page in its folder, where any name will do.

While one of the three is under way the page stays on screen and the editor cannot be typed into, until the
Studio has gone to the page that comes next.

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

## Trying a theme

The Studio has a second tab, **Theme**. It lists the colours of the site's [theme](../configuration/theme.md#colours),
each for the light mode and for the dark one, and the preset the theme starts from. Change one, and the page beside
the Studio is drawn in it at once. The config is not touched.

Under the colours is their contrast: each colour that is read, against the page and against a panel, as a ratio
from 1 to 21 beside the least it should be. Text is held to 7, and links, secondary text and the five colours of
callouts to 4.5: the numbers every built-in preset is held to. A colour that falls short is marked "too faint", in
the mode where it does.

When the colours are right, **Write to shabd.config.yaml** puts them into the config. Only the lines that say the
change are written. A colour that is there is replaced where it stands, one that is not is added on a line of its
own, and your comments and everything else are left as they are. Where that cannot be done, as when `colors:` is
written on one line, the Studio shows the lines for you to add yourself. **Put back**, or leaving the tab, returns
the page to the theme the config has.

A value can be anything the config takes for a colour. Contrast is measured for what is written as hex or as
`rgb()`. Another form, such as `oklch()`, is drawn and shown as "not measured".

## Editing with someone else

`features.studio.sync` decides whether drafts are shared before they are saved.

| Value | Drafts go to |
| --- | --- |
| `off` | Nobody |
| `tabs` | Other tabs and windows of the same browser. The default |
| `peers` | Another person's browser, directly, over WebRTC |

What is typed in one editor is sent to the others as the change it was, and each of them makes that change
where it was made. Two people can type in the same page at the same moment: both keep what they typed, and both
editors end up with the same text. Your cursor stays where it is while the text around it changes. The merging is
done by [Yjs](https://yjs.dev) in the browsers themselves.

Every editor saves the text it holds a quarter of a second after it last changed, whoever typed the change.

With `peers`, the Studio gets an **Edit together** section. One person chooses **Create an invite** and is given
a link, which they send to the other. The other pastes it into their own Studio and chooses **Join**. That is all
either of them does: the two browsers find each other, and from then on drafts travel between them with no server
in between. Each Studio saves to its own copy of the files.

The link leads to the dev server of the person who invites. Their browser left a note there that says how it can
be reached, and the other person's Studio reads that note and leaves its own. So the link works from a machine
that can reach that dev server:

- From the same machine, always.
- From the same network, when the dev server is started with `shabd dev --host`. The link then carries the
  machine's address on the network, and the Studio says which of the two it has given you.
- From another network, only over a tunnel or a VPN that you set up yourself.

Where the link cannot be opened, choose **Use codes instead**. The two notes are then two long codes: you send
yours, the other person pastes it and sends theirs back, and you paste that. It is more copying, and it works
wherever the two of you can send each other a message.

An invitation is for one person and lasts ten minutes. The two notes are all that passes through the dev server:
no draft does.

Making a note asks a public STUN server for the browser's network address. No draft passes through that either.

If the two browsers cannot reach each other, or the connection drops, the Studio says so and offers to start again
with a new invite.

The connection has been tested between two separate browser sessions on one machine, in Chromium, Firefox and
WebKit, by a link and by codes. It has not been tested between two machines on different networks, where firewalls
decide whether a direct connection is possible. The link has not been opened from a second machine, or by a
Studio that another dev server sent: that a page of another site may read a note and answer it is tested without
a browser.

### When two editors meet

Each editor begins with the text of its own file. Changes can only be merged into one text, so when two editors
meet, in two tabs or over an invite, one of them takes the other's:

- A page that has been typed in is kept over one that has not.
- Between two alike, the one that was opened first is kept.

Most of the time the two hold the same text already and nothing on screen changes. Where they differ, the editor
that gives way shows the other's text and saves it to its own file.

> [!WARNING] Connect before you both type
> If two people have each typed in the same page before they connect, the text of the one who opened the page
> first replaces the other's. What was replaced is in version control if it was committed, and nowhere else.

A file that changes on disk under an editor with nothing unsaved is followed, [as before](#saving), and the
editors it is connected to follow it too. An editor with something unsaved keeps what it has until that is saved.

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
- An image is saved in the folder of a page that exists, and nowhere else. Nothing that is sent with it chooses
  its folder, its name or its kind: the name is made by the dev server from letters, digits and hyphens, the
  extension follows from what the first bytes say the file is, and a file that is not one of the five kinds of
  image, or is larger than 10 MB, is refused.
- With `sync: peers`, two requests are answered for a page of any site, because the other person's Studio is
  one: reading the note that an invitation holds, and answering it. Both take the invitation's name, which is
  twelve characters made up for it, lasts ten minutes and is used up by the first answer. Making an invitation,
  waiting on it and taking it back are for the site's own pages, like everything else here.
- One file outside the content folder can change: `shabd.config.yaml` gains a line when you accept the offer of a
  redirect, and the lines of a theme when you write one from the Theme tab. The redirect must lead from an address
  that has no page to one that has. The theme is read as the config reads one before a line is written, so a
  value the config would refuse is refused there, and what is written is read back and has to say the change and
  nothing else.

In a connected folder the browser does this work, and holds a name and an image to the same rules before it
touches a file. It cannot make a file in one step that fails if the name is taken: it looks first and then writes.

Set `features.studio: false` to remove the Studio and its endpoints.

## Limits

- A rename or a delete does not change other pages, the sidebar file or existing redirects. What it broke is
  listed, and mending it is yours to do.
- A deleted page is gone from disk. The Studio keeps no copy, and its undo does not bring a file back: that is
  what version control is for.
- It renames one page at a time and does not move or rename folders. A folder left empty stays.
- An image beside a page is not moved, renamed or deleted with the page. A page that uses one stays in its
  folder, as said above, and the images of a deleted page stay where they were. What a page would not find from
  another folder is worked out from its imports: an image written as an HTML tag in an `.mdx` page, with a path
  in `src`, is not one of them and is not noticed.
- For a moment while a page is renamed or deleted, its breadcrumbs, its previous and next links and its mark in
  the sidebar are gone: the page is still on screen, and the site no longer lists it at its old address. That
  lasts as long as the browser takes to fetch and draw the page that comes next: about a hundredth of a second
  for a short page, and most of a second for a very long one.
- A rename that changes only capitals is refused on a disk that does not tell them apart, such as the usual
  one on macOS and Windows: to the disk the new name is taken.
- The list of what `shabd check` reports comes from the dev server, which also shows drafts. `shabd check` itself
  leaves drafts out, so the two can differ for a link to a draft.
- With a connected folder, the list and the redirect still come from the dev server. The config is not in the
  content folder, so the browser could not write to it.
- Making, renaming and deleting through a connected folder is tested with a folder in the browser's private file
  system standing in for a real one, because a test cannot click the folder picker.
- An SVG is not taken as an image. It is text, it can hold a script, and nothing in its first bytes tells one
  from any other text. Put it in the folder yourself. HEIC pictures are not taken either: browsers do not show
  them.
- A picture is pasted only when it was copied as a picture: a screenshot, or "Copy image" in a browser. What is
  copied in a file manager or a spreadsheet arrives with text, and the text is what is pasted, as before. Drop
  the file instead.
- An image is saved as it is, at the size it has. When its link is deleted from the page, the file stays.
- Pasting and dropping are tested with events that the test makes and attaches files to, because a test cannot
  use the real clipboard of every browser or drag a file in from outside the page.
- The Theme tab tries the preset and the colours. Fonts, sizes, corners and the rest of the theme are changed in
  the config. A colour can be changed there and not taken out: to go back to the preset's, delete its line.
- Code keeps the colours it was compiled with until a theme is written. They are worked out against what code is
  drawn on, so a trial that changes that shows the page's code as it was.
- Beside the open Studio a page has the width that is left, and on a screen narrower than about 1,500 pixels that
  is too little for its outline as well: the text is squeezed. Close the Studio to read the page as readers do.
- You do not see where the other person's cursor is, and undo takes back what you typed, not what they typed.
- Typing at the same moment is tested between two tabs in Chromium, Firefox and WebKit, and between two browser
  sessions on one machine. It has not been tried between two machines, or with more than two editors on a page
  outside a unit test.
- The editor has no autocomplete and no search of its own. The browser's find only sees the lines near the ones
  on screen, because the editor draws no more of a long page than that.
- Code in a fence is coloured for the six languages named above and no others. An `.mdx` page is coloured as
  Markdown: its JSX as the HTML it resembles, and its `import` and `export` lines not at all.
- The editor has been driven by keyboard and mouse in Chromium, Firefox and WebKit. It has not been tried with a
  screen reader, on a phone, or with an input method such as the ones for Chinese and Japanese.

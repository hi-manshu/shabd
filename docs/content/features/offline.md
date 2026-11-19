---
title: Reading offline
description: Keep a built site in the reader's browser, so that it opens without a connection.
badges: [New]
---

With `features.offline` on, a reader who has visited the site once can open it with no connection: any page of it,
not only the ones they read. This site does it. Open a page, wait a moment, cut the connection and follow a link.

```yaml title="shabd.config.yaml"
features:
  offline: true
```

It is off unless you turn it on, because it has a cost: see [What it costs](#what-it-costs).

## How it works

`shabd build` writes a service worker, `shabd-sw.js`, beside the site. A reader's browser installs it after the
first page has loaded. In the background it then fetches what any page needs to be read, and keeps it:

- every page
- the scripts and styles the pages load, and the fonts
- the pictures and other files in `public/`
- the search index

From then on the worker answers for the site:

| Asked for | With a connection | Without one |
| --- | --- | --- |
| A page, or any file that can change | From the network, so what is read is what is published | The copy that was kept |
| A script or style named after its contents | The copy, at once: such a file never changes | The copy |
| A page the browser has no copy of | From the network | A page that says there is no connection |

A reader with a connection sees no difference, apart from scripts and styles that load a little faster. Nothing
is shown from a copy while the network is there to be asked.

The copy belongs to one build. Build the site again and the worker's file changes; the browser notices on the
reader's next visit, fetches the new files in the background, and deletes the old copy when the new one is whole.

## What is not fetched ahead

What only some pages load, and only when a reader gets to it, is megabytes that most readers never ask for:

- the library that draws [diagrams](../guide/writing/markdown.md#diagrams)
- the compiler of a [live sandbox](./sandbox.mdx)
- the model for [search by meaning](./search.md)

Each is kept from the first time a page uses it, with a connection. A reader who has seen a diagram has the
library, and diagrams are drawn offline from then on. One who has not gets the page with the diagram as the text
it was written as. Without the model, search works by keyword.

Left out altogether, because no reader's browser asks for them: the Markdown copy of each page, `llms.txt`, the
sitemap, the feed and the pictures made for sharing.

## What it costs

Every reader who visits once downloads every page, whether or not they read it. A build says how much:

```text
✓ offline: 120 files, 3.4 MB, fetched by a reader's browser after a first visit
```

That is this site, with 32 pages. It is fetched after the page has loaded and does not hold it up, but it is the
reader's connection and the reader's storage. For a site of thousands of pages it is a great deal, and this is
not the feature for it as it stands: there is no way yet to keep only the pages a reader has opened.

## Turning it off again

A service worker stays in a browser until it is told to go. So a site that sets `offline` back to `false` does not
simply stop writing the worker: its pages take the old one away. A reader who comes back gets the new build's
script, because pages are asked of the network first, and that script removes the worker and deletes its copies.
A reader who never comes back keeps a copy nobody updates, which they only see without a connection.

## Things to know

- A browser only runs a service worker on `https`, or on `localhost`.
- `shabd dev` has no worker. `shabd preview` serves the one the build wrote, so it can be tried there.
- The worker answers for the folder the site is served from (`site.base`) and for nothing outside it. Two sites
  on one host keep their copies apart.
- It only answers requests that read. Anything a page sends elsewhere, such as a request tried from an
  [API page](../configuration/frontmatter.md#trying-a-request), is not its business.
- If one file cannot be fetched, the worker is not installed and nothing is kept. The browser tries again on the
  next visit. Half a site is never taken for a whole one.
- It was tried in Chromium, Firefox and WebKit as the tests drive them. Without a connection it was tried in
  Chromium and WebKit: the test's Firefox leaves a worker its connection when a page's is cut. It has not been
  tried in Safari or on a phone.

---
title: Getting started
description: Run the site, change it, and build it.
---

## Run it

```sh
npm install
npm run dev
```

The dev server prints its address. Edit any file in this folder and the page updates without a reload.

## Change it

| To change | Edit |
| --- | --- |
| The title, the header links, the theme | `shabd.config.yaml` |
| The navigation on the left | `sidebar.yaml` |
| This page | `content/guide/getting-started.md` |
| The home page | `content/index.mdx` |

`npm run check` reads every file and reports mistakes with the file and line they are on.

## Build it

```sh
npm run build
```

The static site is written to `dist/`. Any static host can serve it. `npm run preview` serves it locally.

## Search

Search matches keywords out of the box. To also match by meaning, install one more package:

```sh
npm install @huggingface/transformers
```

Then set `features.search.semantic` to `true` in `shabd.config.yaml` and build again.

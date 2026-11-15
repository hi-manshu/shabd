---
title: Installation
description: Create a site, run the dev server and build for production.
---

Shabd needs Node.js 22 or newer.

## Create a site

Make a folder and install Shabd with React:

```sh
mkdir my-docs && cd my-docs
npm init -y
npm install shabd react react-dom
```

Add the one required file. `site.title` is the only key Shabd insists on.

```yaml title="shabd.config.yaml"
site:
  title: My docs
```

Then write a first page:

```md title="content/index.md"
# Hello

This is the home page.
```

## Run it

```sh
npx shabd dev
```

The dev server prints its address. Edit `content/index.md` and the page updates without a reload.

There is no `sidebar.yaml` yet, and that is fine. Shabd generates the sidebar from the folder structure until you write
one. See [Sidebar](../configuration/sidebar.md).

## Build

```sh
npx shabd build
```

The static site is written to `dist/`. Any static host can serve it.

> [!NOTE]
> The MCP endpoint needs a server, because it answers `POST` requests. `shabd preview` serves it locally. For
> production, see [MCP and llms.txt](../features/mcp.md).

## Semantic search

Semantic search is optional and needs one more package:

```sh
npm install @huggingface/transformers
```

Without it, search still works and matches keywords.

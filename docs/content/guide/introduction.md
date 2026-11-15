---
title: Introduction
description: What Shabd is, and how its pieces fit together.
---

Shabd builds a documentation site from a folder of Markdown files. You describe the site in YAML, and Shabd turns that
description into pages.

The name is the Hindi and Sanskrit word for "word" (शब्द).

## The three inputs

A Shabd site has three kinds of input, and each one has a single job.

| Input | What it decides |
| --- | --- |
| `shabd.config.yaml` | The site's identity, theme tokens, page layouts and feature switches |
| `sidebar.yaml` | The navigation: categories, folders, badges and links |
| `content/**/*.md` | The pages. Frontmatter at the top of a file picks its layout |

None of them is code. You can change the header, hide the sidebar on one page, or add a whole new page layout by
editing YAML.

## How a page is made

When a page is requested, its Markdown goes through one pipeline:

1. The frontmatter is parsed and checked. A typo is reported with the file, line and column.
2. The body is compiled to a React component. Headings get anchors, code is highlighted, and `> [!NOTE]` blocks become
   callouts.
3. The layout named in the frontmatter is looked up. It lists regions, such as `sidebar` and `main`, and the blocks
   inside each.
4. The page's own switches are applied. `sidebar: false` removes the sidebar region, for example.

> [!TIP]
> Start with [Installation](./installation.md), then read [Layouts](../configuration/layouts.md) to see how step 3
> works.

## What is included

- Keyword search, and optional [semantic search](../features/search.md) that runs in the reader's browser
- [`llms.txt` and an MCP endpoint](../features/mcp.md) for AI agents
- A [Studio](../features/studio.md) for editing pages in the browser during development
- [Live code sandboxes](../features/sandbox.mdx) in MDX pages

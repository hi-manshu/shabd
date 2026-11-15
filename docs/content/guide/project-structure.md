---
title: Project structure
description: Which files Shabd reads, and how a file path becomes a page address.
---

A site is a folder. Shabd reads two YAML files and one content folder from it, and writes its output to `dist/`.

```text
my-docs/
├── shabd.config.yaml     required: site, theme, layouts, features
├── sidebar.yaml          optional: navigation
├── content/              the pages
│   ├── index.mdx
│   ├── guide/
│   │   ├── index.md
│   │   └── install.md
│   └── _snippets/        not pages: the name starts with an underscore
├── components/           your React components, if you have any
├── public/               copied to the site root as-is
└── dist/                 written by `shabd build`
```

Only `shabd.config.yaml` and the content folder are required. The names `content` and `sidebar.yaml` are defaults that
[the config can change](../configuration/site.md#content).

## From file to address

Every `.md` and `.mdx` file in the content folder becomes a page. Its address is its path without the extension.

| File | Address |
| --- | --- |
| `content/index.mdx` | `/` |
| `content/guide/index.md` | `/guide` |
| `content/guide/install.md` | `/guide/install` |
| `content/guide/Getting Started.md` | `/guide/getting-started` |

Two rules apply on top of that:

- A file or folder whose name starts with `_` or `.` is skipped. Use this for partials you import into other pages.
- Two files that would get the same address, such as `guide.md` and `guide/index.md`, are an error. Shabd names both
  files and stops.

## Where a page's title comes from

Shabd looks in three places, in this order:

1. `title` in the page's frontmatter
2. A `# Heading` on the first line of the body
3. The file name

The second rule means a plain Markdown file that starts with a heading needs no frontmatter at all. When the title
comes from that heading, the layout renders it as the page title and the body starts after it, so it is not shown
twice.

## The cache

Compiled pages and search embeddings are cached in `node_modules/.shabd`, or in `.shabd` when the site folder has no
`node_modules`. The cache is safe to delete. Add `.shabd` and `dist` to `.gitignore`.

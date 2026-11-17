---
title: Writing pages
description: Where pages go and what Markdown can do here.
---

A page is a `.md` or `.mdx` file under `content/`. `content/guide/writing.md` is this page, at `/guide/writing`.

## Frontmatter

The block at the top of a file sets the page's title and description. Both are optional: without a title, the first
heading is used.

```md title="content/guide/example.md"
---
title: An example
description: Shown under the title and in search results.
---

The page starts here.
```

## Callouts

> [!TIP]
> Write a callout as a quote that starts with `[!TIP]`, `[!NOTE]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`.

## Code

Code is highlighted when the site is built. A title and highlighted lines go after the language:

```ts title="greet.ts" {2}
export function greet(name: string) {
  return `Hello, ${name}`
}
```

## A new page

Add a file, then add its path to `sidebar.yaml`. A page that is not in the sidebar file still appears: its folder is
added at the end of the navigation.

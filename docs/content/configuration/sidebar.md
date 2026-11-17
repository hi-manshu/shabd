---
title: Sidebar
description: Define the navigation in sidebar.yaml, or let Shabd generate it from your folders.
---

`sidebar.yaml` is a list. Each entry is one of five kinds, and its key says which.

```yaml title="sidebar.yaml"
- category: Guide # a section heading
  items:
    - guide/introduction # a page
    - file: guide/installation # a page, with overrides
      label: Install
      badge: New
    - folder: Writing content # a collapsible group
      collapsed: true
      items:
        - guide/writing/markdown

- category: Reference
  autogenerate: reference # fill this section from a folder

- link: https://github.com/your-org/your-repo # a link to somewhere else
  label: GitHub
```

## Entries

| Entry | Keys | Notes |
| --- | --- | --- |
| A string | none | A page, by its path in the content folder. The label is the page's title |
| `file` | `label`, `badge` | A page with a different label or a badge |
| `folder` | `items` or `autogenerate`, `collapsed`, `badge` | A group the reader can open and close |
| `category` | `items` or `autogenerate`, `badge` | A section heading. Top level only |
| `link` | `label` (required), `badge` | A URL, or a path on this site |

Pages can be written as `guide/install`, `/guide/install` or `guide/install.md`. All three mean the same file.

A folder that holds the current page opens by itself, whatever `collapsed` says.

## Badges

A badge is a word, or a word with a colour.

```yaml
- file: features/search
  badge: New
- file: features/studio
  badge: { text: Soon, variant: note }
```

The variants are `default`, `note`, `tip`, `success`, `caution` and `danger`. A few common words pick their own:
`New` is `success`, `Beta`, `Alpha` and `Experimental` are `caution`, and `Deprecated` is `danger`.

## Folders you did not mention

A content folder that no entry mentions is added to the end of the sidebar, sorted alphabetically. A new folder of
pages appears in the navigation without anyone editing YAML.

A folder counts as mentioned when an entry lists a page inside it, at any depth, or when an `autogenerate` covers it.
The sidebar of this site lists pages under `guide/`, `configuration/` and `features/`. It says nothing about
`reference/`, so the Reference section you see was generated.

With no `sidebar.yaml` at all, the whole sidebar is generated this way.

A page left out of a folder you *did* mention is not added for you, because that folder is curated by hand.
`shabd check` lists those pages so you can decide.

## How generated groups are ordered

1. A folder's `index` page comes first.
2. Then pages with `sidebar.order` in their frontmatter, lowest first.
3. Then everything else, alphabetically by label. Numbers sort as numbers, so "Item 2" comes before "Item 10".

A page controls its own generated entry from its frontmatter:

```yaml
---
title: A long descriptive title
sidebar:
  label: Short label
  order: 1
  badge: Beta
  exclude: false # true leaves the page out of generated groups
---
```

## More than one sidebar

On a large site, one sidebar for everything gets long. Written as a map instead of a list, `sidebar.yaml` gives
each part of the site a sidebar of its own. Each key is the part of the site a sidebar belongs to, and under it is
a list like any other.

```yaml title="sidebar.yaml"
/guide/:
  - category: Guide
    items:
      - guide/introduction
      - guide/installation

/reference/:
  - category: Reference
    autogenerate: reference
```

A page is shown with the sidebar of the longest key it is under: with the two above, `/guide/installation` has the
guide's sidebar and `/reference/cli` the reference's. Previous and next, and the breadcrumbs, stay inside that
sidebar. Readers move between the parts through the links in the header (`site.nav`).

- A key of `/` is the sidebar of every page that is under no other key. Without it, those pages get a sidebar made
  from their folders, as a site with no `sidebar.yaml` does.
- [Folders you did not mention](#folders-you-did-not-mention) are added to the sidebar of the part they are in.
- An entry may name a page from another part of the site. The page is still shown with its own part's sidebar.
- `llms.txt` lists every sidebar's pages, in the order the file has them.

## When an entry matches nothing

An entry that points at a page that does not exist is skipped with a warning that names the line. It does not stop
the dev server or the build.

```text
shabd sidebar.yaml:18 "guide/project-structure" does not match any page in the content directory
```

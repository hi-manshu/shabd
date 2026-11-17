---
title: Importing a site
description: Make a Shabd site from documentation written for Docusaurus, VitePress, Starlight or MkDocs.
---

`shabd import` reads a documentation site made with another tool and writes a Shabd site from it: the pages, the
navigation and the site's settings. It is there so that trying Shabd on documentation you already have does not
start with rewriting a sidebar by hand.

```sh
npx @himanshoe/shabd import path/to/your-site
```

The site you point it at is only read. The new site is written to a folder beside it, named after it with `-shabd`
at the end.

| Option | Meaning |
| --- | --- |
| `--out <folder>` | Where to write the new site. It may not be inside the site being imported |
| `--from <tool>` | The tool that made the site: `docusaurus`, `vitepress`, `starlight` or `mkdocs`. Without it, the config file decides |
| `--force` | Write into a folder that is not empty. Pages and the two YAML files replace the ones there, a `package.json` and a `.gitignore` that are there are kept, and nothing is deleted |

## What it reads

| Tool | Recognised by | Pages | Navigation |
| --- | --- | --- | --- |
| Docusaurus | `docusaurus.config.*` | `docs/`, or the `path` of the docs plugin | The sidebar file, `_category_` files, `sidebar_position` |
| VitePress | `.vitepress/config.*`, in the folder given or in `docs` inside it | The folder that holds `.vitepress`, or its `srcDir` | `themeConfig.sidebar` |
| Starlight | An `astro.config.*` that mentions Starlight | `src/content/docs/` | The `sidebar` option |
| MkDocs, Material for MkDocs | `mkdocs.yml` | `docs/`, or `docs_dir` | `nav:` |

## What it writes

```text
your-site-shabd/
├── shabd.config.yaml   title, description, address, repository, social and header links
├── sidebar.yaml        the navigation
├── content/            the pages, with the pictures that sit beside them
├── public/             what the source served from its root: static/ or public/
├── assets/             pictures a page names that are kept elsewhere in the project
├── package.json        what is needed to install and run the site
└── .gitignore
```

`assets/` is only there when a page needs it, as Starlight's pages do for pictures in `src/assets/`. Then:

```sh
cd your-site-shabd
npm install
npm run dev
```

`site.repo` is set to the repository the source names. "Edit this page" also needs the branch and the folder the new
site will have in that repository: see [`site.repo`](../configuration/site.md#site).

## What is converted

### Callouts

Each tool's callouts become GitHub alerts, which is what [Shabd reads](./writing/markdown.md#callouts).

| Tool | Written as | Becomes |
| --- | --- | --- |
| Docusaurus | `:::note Title`, `:::note[Title]` | `> [!NOTE] Title` |
| VitePress | `::: info Title`, `::: details Title` | `> [!NOTE] Title` |
| Starlight | `:::note[Title]` | `> [!NOTE] Title` |
| MkDocs | `!!! note "Title"`, `??? note "Title"` with an indented body | `> [!NOTE] Title` |

Shabd has five types, so the tools' own are mapped onto them:

| Shabd | From |
| --- | --- |
| `NOTE` | `note`, `info`, and types with no counterpart, such as `details`, `example` and `question` |
| `TIP` | `tip`, `hint`, `success` |
| `IMPORTANT` | `important` |
| `WARNING` | `warning`, the `caution` of Docusaurus, Starlight and MkDocs, `bug` |
| `CAUTION` | `danger`, `error`, `failure` |

In Docusaurus, Starlight and MkDocs `caution` is the yellow box and `danger` the red one. In Shabd, as on GitHub,
`WARNING` is the yellow one and `CAUTION` the red. A type that is not one of Shabd's five, nor another word for
one, keeps its name as the title, so an `example` is still headed "Example".

A callout inside a callout is converted too. A block that opens and closes (`::: details`, `???`) becomes a callout
that is always open, and is listed in the report.

### Tabs

| Tool | Written as |
| --- | --- |
| Docusaurus | `<Tabs>` and `<TabItem>`, with their two imports |
| Starlight | `<Tabs>` and `<TabItem>`, imported from `@astrojs/starlight/components` |
| VitePress | `::: code-group`, each code block labelled in brackets after its language |
| MkDocs | `=== "Label"` with an indented body |

All four become `<Tabs>` and `<Tab label="…">`, and the imports are removed. Components only work in `.mdx` files, so
a `.md` page that gains tabs is written as `.mdx`. The rest of that page then has to read as MDX: a `{`, a `<` that
does not start a tag, a comment and a tag HTML leaves open are rewritten so that they do.

In Docusaurus a `.md` file is MDX already. One that holds a tag, an import or an expression is written as `.mdx`, and
one that is plain Markdown stays `.md`.

### Code blocks

Nothing inside a code fence is ever changed. The options after the language are:

| Tool | Written as | Becomes |
| --- | --- | --- |
| MkDocs | `hl_lines="2 4-5"` | `{2,4-5}` |
| MkDocs | `linenums="1"` | `showLineNumbers` |
| VitePress | `js{4}` | `js {4}` |
| VitePress | `ts:line-numbers` | `ts showLineNumbers` |
| VitePress | `js [config.js]` | `js title="config.js"` |

Docusaurus and Starlight already write `title="…"`, `{2,4-6}` and `showLineNumbers` as Shabd reads them.

### Frontmatter

Keys with a counterpart are renamed. Shabd ignores keys it does not know, so the others stay as they are, and a key
that was not changed keeps its comments and its formatting.

| Tool | Key | Becomes |
| --- | --- | --- |
| Docusaurus | `sidebar_label`, `sidebar_position` | `sidebar.label`, `sidebar.order` |
| Docusaurus | `hide_table_of_contents`, `toc_min_heading_level`, `toc_max_heading_level` | `toc` |
| Docusaurus | `custom_edit_url: null` | `editLink: false` |
| Docusaurus | `unlisted: true` | `sidebar.exclude` and `noindex` |
| VitePress | `layout: home` with `hero` | `layout: splash` with `hero` |
| VitePress | `features` | Cards under the hero |
| VitePress | `outline`, `aside: false` | `toc` |
| Starlight | `template: splash` with `hero` | `layout: splash` with `hero` |
| Starlight | `tableOfContents`, `sidebar.hidden`, `editUrl: false` | `toc`, `sidebar.exclude`, `editLink: false` |
| MkDocs | `hide: [navigation, toc, footer]` | `sidebar: false`, `toc: false`, `pagination: false` |
| MkDocs | `status: new` | `sidebar.badge: New` |

`draft`, `title` and `description` mean the same everywhere. The three tools that can hide the previous or the next
link do so one at a time; `pagination: false` is written when a page hides both.

A key Shabd knows must have the shape Shabd expects, or it refuses the page. One that does not, such as a `layout`
that names a template of the source, is left out and listed in the report.

### Links and pictures

Shabd links to a page by the path of its file, as GitHub does, and most links in the four tools already work that
way. Those are left alone. A link is rewritten when the page it led to is known and Shabd would read it as another
address:

- a page that was renamed on the way in, such as `01-intro.md` in Docusaurus or `README.md` in MkDocs
- an address with the site's base, or Docusaurus's `/docs`, in front
- a relative link in Starlight, which starts from the page's address and not from its folder
- a link to a built page, such as `./install.html` in VitePress

Pictures named by a relative path are copied with the pages. One kept outside the content folder is copied to
`assets/` or `public/`, and the page is pointed at the copy.

### Components

Starlight's `<Card>`, `<CardGrid>`, `<LinkCard>`, `<Badge>` and `<Aside>` become Shabd's `<Card>`, `<CardGrid>`,
`<Badge>` and `<Callout>`. So does Docusaurus's `<Admonition>`. `<Steps>` and `<FileTree>` are kept as they are:
Shabd has [components of those names](./writing/components.mdx#steps) that wrap the same lists.

VitePress's `<Badge>` becomes Shabd's in a page that is written as `.mdx` for its tabs or its cards. In a page that
stays `.md` it is left as it is, where it is not a component: Shabd's check, which runs at the end, warns about it.

HTML in a page that stays `.md` is kept as it is. Shabd [renders it](./writing/markdown.md#html).

## Navigation

The `nav:` of MkDocs is YAML and is read as it is.

The other three keep their navigation in JavaScript or TypeScript, so the config file is run to read it. The tool
itself does not have to be installed: `vitepress`, `astro/config` and `@astrojs/starlight` are stood in for, and so
is any other package the config imports that is not in the source's `node_modules`.

> [!WARNING] The config file is run
> Running a config file runs whatever code is in it, as the tool it belongs to does on every build. Import a site
> you trust.

When a config cannot be run, or the sidebar in it is made by code that is not there, `sidebar.yaml` is written with
no entries and the report says why. Shabd then [generates the sidebar](../configuration/sidebar.md#folders-you-did-not-mention)
from the folders. The pages are imported all the same.

A group at the top of the source's navigation becomes a `category`, and a group inside a group a `folder`. A group
the source says is collapsed becomes a `folder` at any level, because a category cannot be closed. A page keeps the
label the source gave it only where that differs from its title.

Docusaurus can generate its navigation from the folders, with a label and a position for each folder in a
`_category_.json`. Shabd has nowhere to keep a folder's label but `sidebar.yaml`, so that navigation is written out
in full, in Docusaurus's order. A number at the front of a file or folder name (`01-intro.md`) is left out of the
name, as Docusaurus leaves it out of the address, and becomes the page's `sidebar.order`.

A source with several sidebars, as Docusaurus and VitePress allow, gets one: they follow each other in the order
they were written.

## The report

The command ends with a report, and with what [`shabd check`](../reference/cli.md) says about the new site.

```text
Imported a MkDocs site into your-site-shabd

  Copied      2 pages (1 written as .mdx, because it uses a component), 0 other files
  Converted   1 tab group, 1 callout
  Navigation  From `nav:` in mkdocs.yml.

Needs a hand (1 place)

  A block that opens and closes is written as a callout, which is always open.
    content/index.md:5

What `shabd check` says about the new site

  error  content/index.md:12  Broken link: no page at /missing

  2 pages checked: 1 error, 0 warnings
```

"Needs a hand" lists what could not be converted, each with the files and lines of the new site it applies to. The
check is the same one `shabd check` runs, so a page Shabd would refuse is shown here and not found later. The
command exits with 1 when the check finds an error. The site has been written either way.

## What is left to you

- **Components Shabd does not have.** They are left in the page and listed. A page with one does not render until
  the component is replaced, or registered under [`components:`](./writing/components.mdx#your-own-components).
  `import` lines for components of your own are left too, and the new site cannot resolve them.
- **Vue in VitePress pages.** A `<script>` or `<style>` block is left out, and listed. `{{ expressions }}`, included
  files and `<<<` snippets are left as they are written.
- **MkDocs extensions.** Snippets (`--8<--`) and macros are listed and not expanded. Icon shortcodes and attribute
  lists other than heading ids are left as text. What plugins add to a page is not imported.
- **Heading ids.** `## Install {#setup}` loses its id, because Shabd names a heading after its text. Where that
  gives another id the heading is listed, and `shabd check` reports the links that pointed at the old one.
- **Addresses the source set by hand.** A page keeps the address of its file. A `slug` is listed, and no
  [redirect](../configuration/site.md#redirects) is written from an old address. Docusaurus serves its docs under
  `/docs`; the new site serves them from the root.
- **Other parts of a Docusaurus site.** The blog, pages under `src/pages`, older versions of the docs and
  translations are not imported.
- **Menus in the header.** Shabd's header has links, not menus. A menu becomes one link, to its first entry.
- **The look.** Colours, fonts, custom CSS and custom layouts are not carried over. See [Theme](../configuration/theme.md).

## Things to know

- Code written by indenting it four spaces is not a code fence. Text in it is converted like the text around it.
- A config that uses top-level `await`, or that needs its tool to really be there, cannot be run. The navigation is
  then generated, as described above.
- The import has been run on small sites written for its tests, one for each tool, and each of those was also built.
  It has not yet been run on a large site.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="img/shabd-logo-dark.svg"/>
    <img src="img/shabd-logo.svg" alt="Shabd" width="360"/>
  </picture>
</p>

<p align="center">
<strong>Documentation sites configured in YAML.</strong>
</p>

Shabd (शब्द, "word") builds a documentation site from a folder of Markdown and two YAML files.

```text
my-docs/
├── shabd.config.yaml   site, theme tokens, layouts, feature switches
├── sidebar.yaml        navigation (optional)
└── content/            .md and .mdx pages
```

The YAML is the whole configuration surface. The header, the sidebar, the theme and the layout of each page are
described there, not in components.

> [!NOTE]
> Shabd is at 0.1.0 and has not been published to npm. Configuration keys may change before 1.0.

## What is in it

- **Layouts as data.** A layout is a table of regions (`header`, `sidebar`, `main`, …) and the blocks in each. A page
  picks one with `layout:` in its frontmatter. Editing a layout, or adding one, is a YAML change.
- **A sidebar that fills itself in.** `sidebar.yaml` is used as written. Any content folder it does not mention is
  appended, sorted alphabetically.
- **Errors that point at the YAML.** Config, sidebar and frontmatter problems are reported with file, line, column and,
  for typos, the key you probably meant.
- **A Markdown and MDX pipeline** built on remark and rehype: heading anchors, GitHub-style callouts, code highlighted
  at build time with Shiki, and components available in MDX without imports.
- **Search in the browser.** Keyword search, plus optional semantic search: pages are embedded at build time with
  Transformers.js, and a Web Worker embeds the query on the reader's device. For large sites the index can be a
  SQLite database, searched with FTS5 and kept in the browser's private file system.
- **Output for AI agents.** `llms.txt`, `llms-full.txt`, a Markdown copy of every page, and an MCP endpoint with
  `search_docs`, `read_page` and `list_pages`.
- **Studio.** In `shabd dev`, edit the page you are looking at. Saves go to the file on disk through the File System
  Access API or the dev server, and the page beside the editor hot-updates.
- **Live sandboxes.** A `tsx live` code fence runs on the page, next to its source and a panel of its state.

## Try it

You need Node.js 22 or newer.

```sh
git clone https://github.com/hi-manshu/shabd.git
cd shabd
npm install
npm run dev
```

`npm run dev` builds the `shabd` package and starts the dev server for `docs/`, which is Shabd's own documentation
written with Shabd. Edit anything in `docs/` and watch it update.

```sh
npm test             # unit and integration tests
npm run test:e2e     # browser tests in Chromium, Firefox and WebKit
npm run typecheck    # Node and browser code
npm run docs:build   # static site in docs/dist
npm run docs:preview # serve docs/dist, including /mcp
```

## Repository layout

```text
shabd/
├── packages/shabd/                 the framework (npm package "shabd")
│   ├── bin/shabd.js                CLI entry
│   ├── schemas/                    JSON Schemas for editor autocompletion (generated)
│   ├── src/
│   │   ├── shared/                 runs in Node and in the browser
│   │   │   ├── schema.ts           Zod schemas: config, sidebar, frontmatter
│   │   │   ├── layout.ts           built-in layouts, `extends`, per-page resolution
│   │   │   ├── blocks.ts           region and block names
│   │   │   ├── search-core.ts      BM25, vector similarity, rank fusion, the store interface
│   │   │   └── sqlite-store.ts     the search index as a SQLite database
│   │   ├── node/
│   │   │   ├── config/             YAML loader, source-mapped errors, tokens → CSS
│   │   │   ├── content/            content store, frontmatter, sidebar resolver
│   │   │   ├── markdown/           remark/rehype pipeline, plugins, compile cache
│   │   │   ├── vite/               Vite plugin: virtual modules, HMR, dev endpoints
│   │   │   ├── build/              static build, prerender, preview server
│   │   │   ├── search/             sections, embeddings, index
│   │   │   ├── llms/               llms.txt, llms-full.txt, Markdown copies
│   │   │   ├── mcp/                MCP server, HTTP handler, stdio
│   │   │   └── cli.ts              dev, build, preview, check, mcp
│   │   └── client/                 shipped as source, compiled by the site's build
│   │       ├── app/                router, stores, hot-update hub
│   │       ├── layout/             PageLayout (the layout engine) and its blocks
│   │       ├── mdx/                components Markdown renders as
│   │       ├── search/             search worker and dialog
│   │       ├── studio/             editor, file backends, draft sync
│   │       ├── sandbox/            live code sandboxes
│   │       └── styles/             the default theme
│   └── test/                       unit and integration tests
├── e2e/                            browser tests, and the small site they run against
└── docs/                           the documentation site, built with Shabd
    ├── shabd.config.yaml
    ├── sidebar.yaml
    ├── content/
    ├── components/                 a custom MDX component and a custom layout block
    └── styles/
```

## How a page is made

```text
shabd.config.yaml ─┐
sidebar.yaml ──────┼─▶ validate (Zod) ─▶ content store ─▶ virtual:shabd/data  (site, layouts, sidebar)
content/**/*.md ───┘                          │           virtual:shabd/routes (path → page module)
                                              ▼
                        remark ─▶ rehype ─▶ ES module: component + frontmatter + toc
                                              │
                                              ▼
              frontmatter.layout ─▶ resolvePageLayout() ─▶ <PageLayout> ─▶ regions ─▶ blocks
```

In development each arrow is incremental: a saved page recompiles alone, and a YAML change replaces data in the
running page. In a build the same modules are bundled, every route is prerendered to HTML, and the page hydrates.

## What has been checked

On one machine (macOS 26, Node 22.16), with the docs site and a small test site in this repository:

- 101 unit and integration tests pass. They cover config and sidebar validation, the sidebar resolver, the Markdown
  pipeline, layout resolution, search ranking, both search stores, the content store, and the MCP endpoint driven by
  the official MCP client.
- 107 browser tests pass in Playwright's Chromium, Firefox and WebKit: prerendered pages with and without
  JavaScript, hydration, navigation, every layout, the sidebar, search, sandboxes, hot updates of pages and YAML, the
  Studio including conflicts and its folder backend, and two editors connecting peer to peer.
- The same suite passes with the search index held in SQLite, and semantic search with the real embedding model
  found a section by meaning in all three engines on both stores.
- A saved edit to a page reached the DOM in a median of 42 ms (10 saves, 35 to 49 ms after the first, which took
  116 ms), measured in Chromium.
- The 18-page docs site builds in about 2 seconds with embeddings, and in about 1 second when they are cached.
- The package was packed, installed into an empty project, and built a site there.

Not yet checked:

- Chrome, Firefox and Safari as people install them, and any operating system other than macOS.
- The system folder picker in the Studio. Its code runs in the tests against real file handles, but the picker
  itself needs a person.
- Peer editing between two machines on different networks.
- The MCP handler on a serverless or edge host.
- Sites with thousands of real pages.

See [ROADMAP.md](./ROADMAP.md) for what comes next and how to put the project on GitHub.

## The logo

The parrot is the bird that repeats words. It sits on the shirorekha, the headline bar that letters hang from in
Devanagari, and the name hangs from the same bar. The site's theme uses that bar the same way: page titles, code
blocks and callouts hang from one. The files are in [`img/`](./img).

## License

MIT

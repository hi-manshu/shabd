# Contributing to Shabd

## Set up

```sh
npm install
npm run dev
```

`npm run dev` compiles the Node side of `packages/shabd` once and starts the dev server for `docs/`. Two kinds of
source behave differently while it runs:

- `packages/shabd/src/client` and `src/shared` are served as source. Edits show up in the browser straight away.
- `packages/shabd/src/node` runs from `dist/`. Run `npm run dev -w packages/shabd` in a second terminal to recompile it on
  save, then restart the dev server.

## Before you open a pull request

```sh
npm run build
npm run typecheck
npm test
node packages/shabd/bin/shabd.js check docs
npm run test:e2e
```

## Browser tests

`npm run test:e2e` runs the tests in `e2e/` in Chromium, Firefox and WebKit with Playwright. The first time, install
the browsers with `npx playwright install chromium firefox webkit`.

The tests start two servers on copies of the small site in `e2e/site`: `shabd dev` for tests that edit files and
watch the page follow, and `shabd preview` of a production build for the rest. Nothing in `e2e/site` or `docs/` is
modified.

Three variations are switched on from the environment:

```sh
SHABD_E2E_STORE=sqlite npx playwright test                 # the whole suite on the SQLite search store
SHABD_E2E_SEMANTIC=1 npx playwright test e2e/semantic.spec.ts   # the real embedding model (downloads 22 MB)
npx playwright test --project=firefox e2e/dev.spec.ts      # one browser, one file
```

On macOS the tests keep the display awake while they run. Without that, WebKit stopped answering clicks in runs
where the display had gone to sleep. The cause was not proven; the note in `e2e/support/global-setup.ts` has the
evidence.

A new feature that has something to click belongs in these tests. They have caught bugs the unit tests could not:
a hydration error, a hot update that reloaded into a blank page, and a watcher that reported deleted files as
changed.

## Where things go

- A new config key starts in `src/shared/schema.ts`. Types and the editor JSON Schemas follow from it.
- A new layout block needs a name in `src/shared/blocks.ts` and a component in `src/client/layout/registry.tsx`. The
  registry's type makes the compiler insist on both.
- A new Markdown feature is a remark or rehype plugin in `src/node/markdown/plugins/`, added to the list in
  `src/node/markdown/compile.ts`. Bump `PIPELINE_VERSION` in `src/node/config/load.ts` when compiled output changes,
  so cached pages are rebuilt.
- Anything that runs in the browser must not import `src/shared/schema.ts` except for types. It would pull Zod into
  every page.

## Writing docs

The site in `docs/` is the documentation and the test bed. A feature is not finished until a page there uses it.
Describe what Shabd does today, and say so plainly when something is untested or has a limit.

## Repository layout

```text
shabd/
├── packages/shabd/                 the framework (npm package "@himanshoe/shabd")
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
├── packages/create-shabd/          the starter (npm package "@himanshoe/create-shabd")
│   ├── src/create.js               writes a new site; no dependencies
│   └── template/                   the files it copies, laid out as the site they become
├── scripts/logo/                   draws the logo files
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

To try your changes in a site of your own, pack Shabd and run the starter from the clone. Packing builds the
package first:

```sh
npm pack -w packages/shabd --pack-destination ..
node packages/create-shabd/bin/create-shabd.js ../my-docs --shabd file:../himanshoe-shabd-0.1.0.tgz
```

## The logo

The chick is a young parrot, the bird that repeats words. It sits on the shirorekha, the headline bar that letters
hang from in Devanagari, and the name hangs from the same bar. The site's theme uses that bar the same way: page
titles, code blocks and callouts hang from one.

The chick is marigold on a light background and indigo on a dark one. In the logo it hops once, then every ten
seconds cocks its head and says something. The motion is CSS inside the SVG, and it stops for readers who have
asked their system to reduce motion.

The files are in [`img/`](./img). They are drawn by [`scripts/logo/make-logo.mjs`](./scripts/logo/make-logo.mjs);
after changing it, run `npm run logo`.

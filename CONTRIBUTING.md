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

Five variations are switched on from the environment:

```sh
SHABD_E2E_STORE=sqlite npx playwright test                 # the whole suite on the SQLite search store
SHABD_E2E_SEMANTIC=1 npx playwright test e2e/semantic.spec.ts   # the real embedding model (downloads 22 MB)
SHABD_E2E_SEMANTIC=1 SHABD_E2E_MODEL=site npx playwright test e2e/semantic.spec.ts   # the model served from the site
SHABD_E2E_OFFLINE=1 npx playwright test e2e/offline.spec.ts     # the worker that keeps the site for reading offline
npx playwright test --project=firefox e2e/dev.spec.ts      # one browser, one file
```

The tests on GitHub run the suite as it is and once more on the SQLite store. The model and the worker are not
run there: run those here when you change search, or what a build writes for a reader's browser.

On macOS the tests keep the display awake while they run. Without that, WebKit stopped answering clicks in runs
where the display had gone to sleep. The cause was not proven; the note in `e2e/support/global-setup.ts` has the
evidence.

The log of a run is full of `Invalid page` and `Invalid configuration` messages from `[WebServer]`. They are not
failures. Several tests break a page or the config on purpose, to see that the mistake is shown and that fixing it
clears it, and the dev server reports each one as it would to you. The count at the end is what says how the run
went. Some tests are skipped where a browser lacks what they need: the clipboard and the File System Access API
outside Chromium, and the SQLite and semantic tests unless they are switched on.

A new feature that has something to click belongs in these tests. They have caught bugs the unit tests could not:
a hydration error, a hot update that reloaded into a blank page, and a watcher that reported deleted files as
changed.

`e2e/a11y.spec.ts` is where accessibility is tested. It runs [axe](https://github.com/dequelabs/axe-core) over each
kind of page in both colour modes, and over the parts that open over a page: search, the theme menu, the
navigation on a small screen, the form that tries a request. A new kind of page, or a new thing that opens,
belongs in its list. axe finds what can be found by rule, such as a control with no name or text that is too
faint. It cannot tell where the focus goes, so the tests after it press the keys: add one for anything that opens,
closes or moves the focus.

## Large sites

`npm run bench` measures Shabd on sites far larger than its own docs. It writes a site of 1,000 pages and one of
5,000 under `.shabd/bench/`, which Git ignores, and times reading the site, a build with nothing cached, the same
build again, `shabd check`, `shabd dev` (the first page, a page not seen before, an edit) and, on the built site,
a page and a search. It reports the most memory each took and what the build wrote. Build the package first, and
install Playwright's Chromium: two of the measurements open the site in a browser.

```sh
npm run bench                                    # 1,000 and 5,000 made-up pages
npm run bench -- 200 2000                        # other sizes
npm run bench -- 5000 --corpus path/to/markdown  # real pages, from a folder of Markdown
npm run bench -- 1000 --only build,check         # some of the measurements
npm run bench -- 1000 --semantic                 # with embeddings, which take far longer than the rest
```

The made-up pages are shaped like reference documentation, and the same number always gives the same site. They
cannot show what real Markdown does to the pipeline, so run it on real pages as well. `--corpus` copies the first
pages of any folder of Markdown, with the files beside them, and cuts their frontmatter down to a title and a
description. The numbers in the roadmap came from [MDN's content](https://github.com/mdn/content): thousands of
pages of plain Markdown, each in a folder of its own with its pictures.

Run it before and after a change to the content store, the sidebar resolver or the build. The first run found
three places where the time grew with the square of the number of pages.

## Where things go

- A new config key starts in `src/shared/schema.ts`. Types and the editor JSON Schemas follow from it.
- A new layout block needs a name in `src/shared/blocks.ts` and a component in `src/client/layout/registry.tsx`. The
  registry's type makes the compiler insist on both.
- A new Markdown feature is a remark or rehype plugin in `src/node/markdown/plugins/`, added to the list in
  `src/node/markdown/compile.ts`. Bump `PIPELINE_VERSION` in `src/node/config/load.ts` when compiled output changes,
  so cached pages are rebuilt.
- Anything that runs in the browser must not import `src/shared/schema.ts` except for types. It would pull Zod into
  every page.
- A file in `src/client/` that exports a component exports nothing else: a hook, a helper or a table goes in a
  file beside it. React can then take a change to the component in place while `shabd dev` runs, where a file
  that mixes the two starts the whole page again. `test/refresh.test.ts` holds every file to this.
- A new host adapter needs a name in `src/shared/adapters.ts` and a module in `src/node/adapters/`. The registry's
  type makes the compiler insist on both. The module's header says which page of the host's documentation each
  detail comes from. What runs on the host is in `src/node/adapters/function/`. It is bundled into one file, so it
  must not import anything from Node.

## Writing docs

The site in `docs/` is the documentation and the test bed. A feature is not finished until a page there uses it.
Describe what Shabd does today, and say so plainly when something is untested or has a limit.

## Releasing

Shabd is on npm under two names, each with its starter, so a release is four packages: `@himanshoe/shabd`,
`@himanshoe/create-shabd`, `shabd-docs` and `create-shabd-docs`. `scripts/release/publish.mjs` publishes them from
one source, and skips a version that is already on npm.

**From GitHub.** Actions → Release → Run workflow, with the version, such as `0.1.1`. Tick "dry run" to try it:
every step runs, and nothing is committed, tagged or published. Only the repository's owner can run it. The
workflow sets the version everywhere it is written, runs the checks, commits and tags the version, and publishes.

npm has to be told once that this workflow may publish. On npmjs.com, for each of the four packages: **Settings →
Trusted Publisher → GitHub Actions**, with

| Field | Value |
| --- | --- |
| Organization or user | `hi-manshu` |
| Repository | `shabd` |
| Workflow filename | `release.yml` |
| Allowed actions | allow `npm publish` |

npm drops a trusted publisher that has not published within two days of being added, so add them when a release is
due. Until they are there, the workflow's publish step fails and nothing goes out.

**From your machine.** No setup, but npm asks for your second factor:

```sh
node scripts/release/set-version.mjs 0.1.1
npm test
git commit -am "Release 0.1.1" && git tag v0.1.1 && git push origin main v0.1.1
npm run release
```

`npm run release -- --dry-run` prepares the four packages and publishes nothing.

After a release, run both `npm create` commands in an empty folder outside this repository: inside it, npm would
run the local copy.

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
│   │   │   ├── import/             shabd import: one module for each tool it reads
│   │   │   ├── adapters/           what `shabd build --adapter` writes for a host, and the function it deploys
│   │   │   ├── openapi/            pages made from an OpenAPI description
│   │   │   ├── sandbox/            the script that runs in the frame of an isolated snippet
│   │   │   └── cli.ts              dev, build, preview, check, mcp, import
│   │   └── client/                 shipped as source, compiled by the site's build
│   │       ├── app/                router, stores, hot-update hub
│   │       ├── layout/             PageLayout (the layout engine) and its blocks
│   │       ├── mdx/                components Markdown renders as
│   │       ├── search/             search worker and dialog
│   │       ├── studio/             the Studio's panel, file backends, draft sync
│   │       ├── editor/             the code editor (CodeMirror), fetched when one is shown
│   │       ├── sandbox/            live code sandboxes, in the page and in a frame of their own
│   │       └── styles/             the default theme
│   └── test/                       unit and integration tests
├── packages/create-shabd/          the starter (npm package "@himanshoe/create-shabd")
│   ├── src/create.js               writes a new site; no dependencies
│   └── template/                   the files it copies, laid out as the site they become
├── scripts/logo/                   draws the logo files
├── scripts/bench/                  measures Shabd on sites of thousands of pages
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

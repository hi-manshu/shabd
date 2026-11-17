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

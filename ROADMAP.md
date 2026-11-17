# Roadmap

Three parts: what is left of putting this project on GitHub and npm, where version 0.1 stands, and what to build
next.

## Part 1: Bootstrap on GitHub

Done so far: the project is its own Git repository, pushed to <https://github.com/hi-manshu/shabd> as a private
repository, with the repository's address filled in where the docs and the package refer to it.

What is left, in order:

### 1. Watch the first CI run

`.github/workflows/ci.yml` runs on every push and pull request. One job builds, typechecks, runs the unit tests,
checks the docs and builds them with keyword search. A second job runs the browser tests in Chromium, Firefox and
WebKit.

Both run on Ubuntu. Shabd had only been run on macOS before the first push, so expect to fix something. Add
`macos-latest` and `windows-latest` to a matrix after that; file paths are the likely trouble on Windows.

### 2. Decide when to make it public

```sh
gh repo edit hi-manshu/shabd --visibility public --accept-visibility-change-consequences
```

Before that, check `LICENSE` names the copyright holder you want. It says "Shabd contributors".

### 3. Protect `main`

In the repository: **Settings → Rules → Rulesets → New branch ruleset**, targeting `main`:

- Require a pull request before merging
- Require status checks to pass: the `test` and `browsers` jobs

### 4. Publish the documentation

`.github/workflows/docs.yml` builds `docs/` and deploys it to GitHub Pages. It has not been run, and it only starts
by hand until you turn it on:

1. **Settings → Pages → Source: GitHub Actions**
2. In `docs/shabd.config.yaml`, set `site.url` to `https://hi-manshu.github.io` and `site.base` to `/shabd/`
3. In the workflow, add `push: { branches: [main] }` under `on:`

The MCP endpoint will not exist on GitHub Pages, which serves static files only. `llms.txt` and the Markdown copies
will.

### 5. Publish to npm

The names `shabd` and `create-shabd` were unclaimed on npm on 16 November 2026. Check again before you rely on that.

```sh
npm login
npm run build
npm publish -w shabd --access public
npm publish -w create-shabd --access public
```

`create-shabd` writes `"shabd": "^0.1.0"` into a new site, so publish `shabd` first. `shabd` builds itself before
it is packed, so the `npm run build` above is a second look and not a requirement. A published version cannot be
published again, so read what `npm publish -w shabd --dry-run` lists first.

After both are out, run `npm create shabd@latest my-docs` in an empty folder outside this repository: that command
has never been run from the registry, and inside the repository npm would run the local copy. Then take the
"not on npm yet" wording out of `docs/content/guide/installation.md`, `README.md` and this file.

After the first release, switch to trusted publishing so no token is stored: on npmjs.com, open the package's
settings, add a trusted publisher for this repository, and publish from a workflow that runs on version tags with
`id-token: write` permission and `npm publish -w shabd --provenance --access public`.

### 6. Add the community files

`CONTRIBUTING.md` is written. Still to add:

- `SECURITY.md`, with a private way to report vulnerabilities. This matters here: the dev server can write files.
- `CODE_OF_CONDUCT.md`
- Issue forms and a pull request template under `.github/`
- A changelog. [Changesets](https://github.com/changesets/changesets) suits a monorepo with one published package.

## Part 2: Where 0.1 stands

| Area | State |
| --- | --- |
| YAML config, sidebar and frontmatter: schemas, loader, source-mapped errors | Built, tested |
| Sidebar resolver with automatic fallback | Built, tested |
| Layout engine: regions, blocks, `extends`, per-page switches, custom blocks | Built, tested in three browser engines |
| Markdown/MDX pipeline, compile cache | Built, tested |
| Dev server with hot updates for pages and YAML | Built, tested in three browser engines |
| Static build, prerendering, hydration | Built, tested in three browser engines |
| Keyword and semantic search | Built, tested in three browser engines with the real model |
| SQLite search store (FTS5, kept in the browser's private file system) | Built, tested. WebKit under test fell back to memory |
| `llms.txt`, Markdown copies | Built, tested |
| MCP: dev route, `shabd preview`, stdio | Built; protocol tested with the official client |
| MCP on a serverless host | Handler exported; no adapter, not tested on a host |
| Studio: dev-server saving, tab sync, conflicts | Built, tested in three browser engines |
| Studio: folder saving (File System Access API) | Built, tested in Chromium against real file handles; the system folder picker itself needs a person |
| Studio: peer editing over WebRTC | Built, tested between two browser sessions on one machine; not across networks |
| Live sandboxes | Built, tested in three browser engines |
| Themes: 23 presets, the reader's menu, code colours that follow the chosen preset | Built, tested in three browser engines |
| Readable code: every syntax colour at 4.5:1 or more against what is behind it | Built, tested for all 23 presets in both modes on a sample of code in eight languages |
| Contrast of every preset | Tested: colour against colour for all 23, and text against every pixel of the rendered page for the ten themes, in three browser engines |
| `create-shabd`, the starter | Built, tested. A generated site was installed from a packed copy of Shabd, checked, built and served. `npm create shabd` itself needs the packages published |

"Three browser engines" means the Chromium, Firefox and WebKit builds that Playwright drives, on macOS. It does not
mean Chrome, Firefox and Safari as people install them, and it does not cover Linux or Windows.

## Part 3: What comes next

### 0.2: Make what exists dependable

- Run the browser tests on Linux and Windows. The CI workflow has a job for Linux that has never run.
- Try the real browsers by hand, Safari above all. WebKit under test did not offer its private file system to the
  search worker; whether Safari does needs checking.
- Peer editing between two machines on different networks.
- An accessibility pass: the sidebar panel on small screens, the search dialog, tabs.
- A benchmark with 1,000 and 5,000 real pages: startup, build time, index size. The design scans and holds every
  page in memory, which is fine for hundreds and unmeasured beyond. The search stores have been measured on their
  own, up to 20,000 synthetic sections.
- Frosted panels in real browsers. The Firefox and WebKit builds the tests drive do not blur what is behind a
  translucent header or sidebar; Chromium does. The themes are readable either way, which the contrast test
  checks, but whether Firefox and Safari as people install them blur it has not been looked at.
- The logo's animation under "Reduce motion" in Safari. It was checked in Chromium and Firefox.
- Lighter pages on a site with a theme menu. Each page carries the colours of its own code for every syntax theme
  the menu can reach, in its HTML and again in its script. On the docs site, which offers all 23 presets, that is
  about 39 KB in each on the page with the most code. The themes a reader has to pick could live in one shared
  stylesheet, fetched when one is picked; for the docs site it would be an estimated 78 KB, fetched once.
- Type declarations for `shabd/client`. It ships as TypeScript source today, which a site's own type check cannot
  follow into the generated `virtual:` modules.
- Keep React Fast Refresh working while editing the theme's own source. A few client modules export both components
  and helpers, which forces a page reload when they change. This affects contributors, not site authors.

### 0.3: Finish the four headline features

**Search**

- Serve the embedding model from the site, so nothing is fetched from Hugging Face.
- In the SQLite store, compare vectors outside SQL. Semantic queries took 72 ms at 20,000 sections against 19 ms in
  the memory store, because each row crosses from SQLite into JavaScript.
- Word segmentation for Chinese, Japanese and Thai keyword search.

**MCP**

- Adapters for Cloudflare, Vercel and Netlify, written by `shabd build --adapter <name>`.
- Semantic search behind the endpoint where the host can afford the model.

**Studio**

- A real code editor in place of the text area.
- Create, rename and delete pages. Paste images.
- A CRDT (Yjs) for drafts, so two people can type at once. Today the newest draft replaces the other.
- Signalling that does not need two codes pasted by hand.

**Sandboxes**

- Syntax colours in the editor.
- An option to run a snippet in an isolated frame.
- More modules to import, declared in the config.

### Later

- Translations and versioned docs
- More than one sidebar, chosen by section
- `trailingSlash` and `.html` output options
- Conditions on layout blocks, and a two-column `api` layout with prose beside code
- Pages generated from an OpenAPI file
- Remark and rehype plugins named in YAML
- "Last updated" from Git history, an RSS feed, social images

### 1.0

The config schema stops changing without a migration note. Until then, expect keys to move.

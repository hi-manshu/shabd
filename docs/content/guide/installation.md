---
title: Installation
description: Create a site, run the dev server and build for production.
---

Shabd needs Node.js 22 or newer.

## Create a site

The starter writes a small site that runs as it is: `package.json`, `.gitignore`, `shabd.config.yaml`,
`sidebar.yaml`, a home page and two guide pages.

Shabd is not on npm yet. Until it is, run the starter from a clone of the repository, and point the new site at a
packed copy of Shabd:

```sh
git clone https://github.com/hi-manshu/shabd.git
cd shabd
npm install
npm run build
npm pack -w packages/shabd --pack-destination ..
node packages/create-shabd/bin/create-shabd.js ../my-docs --shabd file:../himanshoe-shabd-0.1.0.tgz
cd ../my-docs
npm install
npm run dev
```

Once `@himanshoe/shabd` and its starter are published, one command is meant to replace the first six lines. It
cannot be tried before then:

```sh
npm create @himanshoe/shabd@latest my-docs
```

| Option | Meaning |
| --- | --- |
| `--title <text>` | The site's title. Without it, the directory name is used: `my-docs` becomes "My docs" |
| `--preset <name>` | A [built-in theme](../configuration/theme.md#presets), such as `forest` or `macos` |
| `--shabd <spec>` | What to install as `shabd`: a version range, or the path of a local build or tarball |
| `--force` | Write into a directory that is not empty. Files that are already there are kept, not replaced |

Through `npm create`, the options need `--` before them, or npm keeps them for itself:

```sh
npm create @himanshoe/shabd@latest my-docs -- --preset forest
```

The starter refuses a directory that already has files in it unless you pass `--force`. A `.git` folder does not
count, so you can run `git init` first. It never deletes or replaces a file.

### By hand

A site needs very little. Make a folder and install Shabd with React:

```sh
mkdir my-docs && cd my-docs
npm init -y
npm install @himanshoe/shabd react react-dom
```

Until Shabd is on npm, give the path of the packed file from the steps above in place of the name:
`npm install ../himanshoe-shabd-0.1.0.tgz react react-dom`.

Add the one required file. `site.title` is the only key Shabd insists on.

```yaml title="shabd.config.yaml"
site:
  title: My docs
```

Then write a first page:

```md title="content/index.md"
# Hello

This is the home page.
```

## Run it

```sh
npx shabd dev
```

The dev server prints its address. Edit `content/index.md` and the page updates without a reload.

There is no `sidebar.yaml` yet, and that is fine. Shabd generates the sidebar from the folder structure until you write
one. See [Sidebar](../configuration/sidebar.md).

## Build

```sh
npx shabd build
```

The static site is written to `dist/`. Any static host can serve it.

> [!NOTE]
> The MCP endpoint needs a server, because it answers `POST` requests. `shabd preview` serves it locally. For
> production, see [MCP and llms.txt](../features/mcp.md).

## Semantic search

Semantic search is optional and needs one more package:

```sh
npm install @huggingface/transformers
```

Without it, search still works and matches keywords. A site made by the starter has `features.search.semantic` set
to `false`; set it to `true` once the package is installed.

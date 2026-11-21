---
title: Installation
description: Create a site, run the dev server and build for production.
---

Shabd needs Node.js {{node}} or newer.

## Create a site

The starter writes a small site that runs as it is: `package.json`, `.gitignore`, `shabd.config.yaml`,
`sidebar.yaml`, a home page and two guide pages.

```sh
npm create @himanshoe/shabd@latest my-docs
cd my-docs
npm install
npm run dev
```

| Option | Meaning |
| --- | --- |
| `--title <text>` | The site's title. Without it, the directory name is used: `my-docs` becomes "My docs" |
| `--preset <name>` | A [built-in theme](../configuration/theme.md#presets), such as `forest` or `macos` |
| `--shabd <spec>` | What to install as Shabd: a version range, or the path of a local build or tarball |
| `--force` | Write into a directory that is not empty. Files that are already there are kept, not replaced |

Through `npm create`, the options need `--` before them, or npm keeps them for itself:

```sh
npm create @himanshoe/shabd@latest my-docs -- --preset forest
```

The starter refuses a directory that already has files in it unless you pass `--force`. A `.git` folder does not
count, so you can run `git init` first. It never deletes or replaces a file.

### Two names

npm would not take the name `shabd`, so the package is published twice: as `@himanshoe/shabd` and as `shabd-docs`.
They hold the same files, each has its starter, and the command is `shabd` under both. This documentation writes
`@himanshoe/shabd`. Wherever it does, `shabd-docs` works as well:

```sh
npm create shabd-docs@latest my-docs
```

Pick one and stay with it. They are two separate copies, and a site should not install both.

### By hand

A site needs very little. Make a folder and install Shabd with React:

```sh
mkdir my-docs && cd my-docs
npm init -y
npm install @himanshoe/shabd react react-dom
```

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
> production, `shabd build --adapter` writes what Cloudflare, Vercel or Netlify needs to answer it: see
> [Deploying](./deploying.md).

## From the repository

To try a change that has not been released, pack Shabd from a clone and point a new site at the packed file.
Packing builds the package first.

```sh
git clone https://github.com/hi-manshu/shabd.git
cd shabd
npm install
npm pack -w packages/shabd --pack-destination ..
node packages/create-shabd/bin/create-shabd.js ../my-docs --shabd file:../himanshoe-shabd-0.1.0.tgz
```

## Semantic search

Semantic search is optional and needs one more package:

```sh
npm install @huggingface/transformers
```

Without it, search still works and matches keywords. A site made by the starter has `features.search.semantic` set
to `false`; set it to `true` once the package is installed.

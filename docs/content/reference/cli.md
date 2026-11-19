---
title: CLI
description: The shabd command and its options.
layout: reference
---

Every command but `import` takes the site folder as an optional argument. It defaults to the current folder.

| Command | What it does |
| --- | --- |
| `shabd dev [root]` | Starts the dev server |
| `shabd build [root]` | Builds the static site into `dist/` |
| `shabd preview [root]` | Serves `dist/`, including the MCP route |
| `shabd check [root]` | Validates the config, sidebar, frontmatter and links: see [what it looks for](#what-check-looks-for) |
| `shabd mcp [root]` | Runs the docs MCP server over stdio |
| `shabd import <site>` | Makes a Shabd site from a Docusaurus, VitePress, Starlight or MkDocs site: see [Importing a site](../guide/importing.md) |

## Options

| Option | Applies to | Effect |
| --- | --- | --- |
| `--port <number>` | `dev`, `preview` | Listen on this port |
| `--host [address]` | `dev`, `preview` | Listen on the network, not only on localhost |
| `--open` | `dev` | Open the browser when the server starts |
| `--no-semantic` | `build` | Skip embeddings and build keyword search only |
| `--adapter <name>` | `build` | Also write what one host needs for the MCP endpoint and for redirects: `cloudflare`, `vercel` or `netlify`. See [Deploying](../guide/deploying.md) |
| `--external` | `check` | Also ask the links that lead to other sites whether they answer |
| `--format <name>` | `check` | How the result is printed: `text`, `json` or `github` |
| `--out <folder>` | `import` | Write the new site here. Without it, the folder is named after the site, with `-shabd` at the end |
| `--from <tool>` | `import` | The tool that made the site: `docusaurus`, `vitepress`, `starlight` or `mkdocs`. Without it, the site's config file decides |
| `--force` | `import` | Write into a folder that is not empty |

`--adapter` wins over [`build.adapter`](../configuration/site.md#build) in the config. A name that is not an adapter
is an error, and the message lists the three.

## What check looks for

`shabd check` reads the whole site without building it, and exits with an error if anything in the first group is
found. A build runs the same checks and prints what they find.

Always errors:

- A mistake in `shabd.config.yaml`, `sidebar.yaml` or a page's frontmatter, and a page that does not compile.
- A link to a page that does not exist, or to a heading the page does not have.
- A [redirect](../configuration/site.md#redirects) that leads to no page, or whose old address still has a page.
- A [live snippet](../features/sandbox.mdx) that cannot be made into a script, or that imports what the site has
  not [said it may](../features/sandbox.mdx#modules-a-snippet-may-import).

Always warnings:

- A sidebar entry that matches no page, or lists a page twice.
- A link to an address that a redirect has moved.
- A name in braces that is nearly a [variable](../guide/writing/markdown.md#variables).

A page that is published but is not in the sidebar is a note.

Each finding names its file and, where it can, the line. The rest is a matter of a site's own standards, and
[`check:` in the config](../configuration/site.md#check) says how seriously each is taken:

| Rule | By default | What it finds |
| --- | --- | --- |
| `altText` | a warning | A picture with no alternative text |
| `descriptions` | off | A page with no description |
| `externalLinks` | off | A link to another site that does not answer |

### Links to other sites

Asking other sites takes time and needs the network, so it happens when `check.externalLinks` is on or when
`--external` is given, and never in a build.

Each address is asked for once, with ten seconds to answer. An address that answers 404, or does not answer, is
reported at the level of the rule. One that answers 401, 403 or 429 would not say to a program what it says to a
browser: that is a note, and nothing is held against the page. Addresses on names set aside for examples, such as
`example.com` and anything ending in `.test`, are not asked.

### For a program, and for pull requests

`--format json` prints one JSON object and nothing else: the number of pages, of errors, warnings and notes, and
every finding with its `level`, `rule`, `file`, `line` and `message`.

`--format github` prints each finding as a GitHub Actions annotation, which GitHub shows beside the line in a pull
request:

```yaml
- run: npx shabd check docs --format github
```

The exit code is the same in every format: 1 when there is an error, 0 otherwise.

---
title: Deploying
description: Where a built site can go, and what an adapter adds for Cloudflare, Vercel and Netlify.
---

`shabd build` writes a static site to `dist/`. Any host that serves files can serve it: upload the folder.

Two things a site may have need more than files.

- **The MCP endpoint** answers `POST`, and a host that serves files answers `GET`. There, `/mcp` does not exist.
- **Redirects.** A host that serves files cannot answer an address that has moved with a redirect, so the build
  writes a page at that address which sends the reader on. A host that can redirect does it in one step, and tells
  search engines so with a `301`.

An adapter writes both in the form one host takes them. There are three.

> [!WARNING] Not tested on the hosts
> What the adapters write follows each host's documentation, and the functions are tested here by calling them the
> way each host does. None of it has been deployed. [What has been tested](#what-has-been-tested) says exactly what
> was run and what was only read.

## Using an adapter

```sh
npx shabd build --adapter cloudflare
```

| Adapter | Host | What you deploy |
| --- | --- | --- |
| `cloudflare` | Cloudflare Pages, or Cloudflare Workers with static assets | `dist/` |
| `vercel` | Vercel | `.vercel/output/` |
| `netlify` | Netlify | `dist/`, with `.netlify/v1/` beside it |

A host usually runs the site's own build command. To leave that command as `shabd build`, name the adapter in the
config:

```yaml title="shabd.config.yaml"
build:
  adapter: cloudflare
```

The command line wins over the config. A name that is not an adapter stops the build, and the message lists the
three.

The folder that holds `shabd.config.yaml` has to be the folder the host builds in: the "root directory" on
Cloudflare and Vercel, the "base directory" on Netlify. The adapters write beside `dist/`, and that is where the
hosts look.

## What an adapter writes

**The function.** One JavaScript file of about 400 KB, the same for every site: Shabd's MCP handler and the MCP
SDK, bundled. It holds none of the site's text. The first time it is asked something it fetches `_shabd/docs.json`
from the site's own files, and before the first search `_shabd/search-index.json`. It keeps both for as long as
the host keeps it loaded. The host is told to run it for the MCP route and for nothing else, so pages and assets
are still served as files, at the cost of files.

**The redirects.** Each entry of [`redirects`](../configuration/site.md#redirects) becomes a rule of the host's
own, answered with a `301`. A rule covers the three ways the old address can be written, `/old`, `/old/` and
`/old.html`, because an old link carries whichever the site used when the link was made. The pages that send the
reader on are still written: they answer wherever a rule does not.

Both follow `site.base` and `site.urls`. A site without an MCP endpoint (`features.mcp: false`) gets the redirects
alone.

Search through the function matches keywords. It does not rank by meaning: see
[MCP and llms.txt](../features/mcp.md#in-production).

## Cloudflare

Everything is written into `dist/`, which is the folder you deploy.

| File | What it is |
| --- | --- |
| `_worker.js` | The function |
| `_routes.json` | For Pages: run the function for the MCP route only |
| `_redirects` | The redirects |
| `.assetsignore` | For Workers: do not publish `_worker.js` and `_routes.json` as files of the site |

A `_redirects` or an `.assetsignore` of your own in `public/` is kept. Shabd's redirects are written above yours.
A `_worker.js` or a `_routes.json` of your own stops the build, since the adapter would write over it.

**Pages.** Set the build command to `npx shabd build --adapter cloudflare` and the build output directory to
`dist`, or run `npx wrangler pages deploy dist`. Pages needs nothing else.

**Workers.** A Worker needs a Wrangler configuration. It names the Worker and its account, so it is yours to
write. These are the lines Shabd depends on:

```json title="wrangler.jsonc"
{
  "name": "my-docs",
  "compatibility_date": "2026-11-17",
  "main": "./dist/_worker.js",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": ["/mcp"],
    "not_found_handling": "404-page"
  }
}
```

Then run `npx wrangler deploy`. Without `"binding": "ASSETS"` the function cannot reach the site's files, and says
so in its answer.

Two things to know about Cloudflare:

- It serves a page that is a folder at the address with a slash at the end, and redirects the address without
  one. Set [`site.urls`](../configuration/site.md#addresses) to `slash`, so that links are written that way to
  begin with. On Workers, `"html_handling": "drop-trailing-slash"` under `assets` does the opposite and suits
  `clean`.
- With [`site.base`](../configuration/site.md#site) set, use Workers: add `"base_path": "/docs"` under `assets`
  (the base without its last slash, Wrangler 4.148 or newer), and write the base into `run_worker_first` too. The
  build prints the value. Pages serves `dist/` from the root of its address, and its documentation has no setting
  for a sub-path.

## Vercel

The whole deployment is written to `.vercel/output/` in the site folder, in the shape of Vercel's Build Output
API. An earlier `.vercel/output/` is removed first.

| File | What it is |
| --- | --- |
| `config.json` | The redirects, then the files, then `404.html` for every other address |
| `static/` | A copy of `dist/`, under the site's base |
| `functions/mcp.func/` | The function, with `.vc-config.json` beside it. It runs on Node.js |

Set the build command to `npx shabd build --adapter vercel`. Vercel deploys `.vercel/output/` when a build leaves
one. From your own machine, `npx vercel deploy --prebuilt` uploads it.

The function runs on the major version of Node.js that the build ran on, which on Vercel is the one set for the
project. An odd version is rounded down to the even one below it, since Vercel offers those.

Add `.vercel` to `.gitignore`.

## Netlify

Netlify publishes `dist/` as it is. What the adapter writes goes beside it, in `.netlify/v1/`, where Netlify's
Frameworks API reads it.

| File | What it is |
| --- | --- |
| `.netlify/v1/functions/shabd-mcp.mjs` | The function, and the address Netlify runs it for |
| `.netlify/v1/config.json` | The redirects |

Set the build command to `npx shabd build --adapter netlify` and the publish directory to `dist`.

The redirects are not written to `dist/_redirects`, so a `_redirects` of your own stays yours, and Netlify reads
it first. With `site.base` set, one more rule serves `dist/` from under the base.

Add `.netlify` to `.gitignore`.

## What has been tested

Shabd's tests build a small site with each adapter, check every file written, then load the function and call it
with the official MCP client: the handshake, the list of tools, `search_docs` and `read_page`.

| Host | What the tests run | What they do not |
| --- | --- | --- |
| Cloudflare | `_worker.js` loaded by Node and called as `fetch(request, env)`, with a stand-in for `env.ASSETS` that serves `dist/`. A request for any other address is handed to `env.ASSETS` unchanged. The same file also runs where `process`, `Buffer` and the rest of Node's globals do not exist and code cannot be made from strings, as in a Worker | Cloudflare's runtime, Wrangler, a deployment. Whether Pages and Workers read `_routes.json`, `_redirects` and `.assetsignore` as documented |
| Vercel | `index.mjs` called with Node's request and response by a local server that also serves `.vercel/output/static/`. The client talks to it over HTTP. Each redirect's pattern is matched against the three forms of its address, by JavaScript, where Vercel's patterns are PCRE | `vercel build`, a deployment. Whether Vercel serves `index.html` for a folder and `404.html` for a missing address, as its own presets for static sites rely on. Whether it loads a function that is an ES module: the example in its documentation is CommonJS |
| Netlify | `shabd-mcp.mjs` called with a web `Request`, fetching the site's files over HTTP from a local server of `dist/`. Its `config` is read back from the file | `netlify dev`, a deployment. The redirects are only checked as written. Whether the rule for `site.base` and the function agree on a real site |

In each case the function was also given a site that cannot be read, a request that is not a `POST`, and a
request for an address that is not the MCP route.

## Limits

- **Search is keyword search.** The function does not load the embedding model.
- **A site behind a login.** On Vercel and Netlify the function fetches its two files over HTTP from the address
  the request came to, and passes on the caller's cookie and `Authorization` header. A deployment that answers
  with a login page all the same cannot be read, and the endpoint's answer says so. On Cloudflare the function
  reads the files through its binding to them, not at the site's public address.
- **The first search after a cold start builds the index.** In Node on a laptop, with sections of 120 words, that
  took 4 ms for 100 sections, 57 ms for 2,000 and 540 ms for 20,000. Reading each of the two files took about a
  millisecond per megabyte. Cloudflare's free plan allows a Worker 10 ms of CPU time per request, so there the
  first search of a site with more than a few hundred sections may be cut off. This has not been tried.
- **Memory.** The function holds every page's Markdown and every section's text. A Cloudflare Worker has 128 MB.
- **Cloudflare takes files of up to 25 MiB.** The `_shabd/docs.json` of a very large site is larger than that,
  and so is the 27 MB runtime that [semantic search](../features/search.md#what-it-costs) adds to `dist/assets/`.
- **How many redirects a host takes.** Cloudflare reads 2,000 plain rules from `_redirects`, which is 666 of
  Shabd's redirects in all three forms. Vercel documents a limit of 2,048 redirects. The build says how many were
  left out, and those addresses are still answered by their pages.
- **Addresses with `*` or `:name` in them** are patterns to Cloudflare and Netlify. Such a redirect is left to its
  page, and the build says so.
- **Addresses with letters outside ASCII** are written as they are sent, percent-encoded. Whether each host
  matches them that way has not been tried.
- **On Cloudflare Workers** a request for an address that has no file, and that is not a browser opening a page,
  runs the function, which hands it back to the static site for the 404 page. Cloudflare's documentation shows
  no setting that avoids this. On Pages, Vercel and Netlify only the MCP route runs the function.

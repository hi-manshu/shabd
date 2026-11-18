---
title: Search
description: Keyword search, plus semantic search that runs in the reader's browser.
badges: [New]
---

Shabd's search runs in the reader's browser. Nothing is sent to a search service, because there is none: the index is
a static file, and the ranking happens in a Web Worker on the reader's device.

There are two kinds of matching, and results combine both.

- **Keyword** search finds sections that contain the words typed. It works as soon as the index has loaded.
- **Semantic** search finds sections that mean something similar, even with no word in common. Searching this site
  for "warn the reader about something dangerous" finds the section on callouts.

## How it works

When the site is built:

1. Every page is split into sections at its headings. Long sections are split again into passages of about 200
   words.
2. Each passage is turned into a vector of 384 numbers by an embedding model, using
   [Transformers.js](https://huggingface.co/docs/transformers.js).
3. Each number is stored as one byte. A section costs 384 bytes in the vector file.

When a reader opens search:

1. A worker fetches the index and the vectors. Keyword search is ready.
2. The worker loads the same embedding model. Until it has, results are keyword-only.
3. Each query is embedded on the device and compared with every stored vector.
4. The keyword ranking and the semantic ranking are merged with reciprocal rank fusion.

A result that matched by meaning alone is labelled "Related", so it is clear why a section without the typed words is
on the list.

## Setup

Keyword search needs nothing. For semantic search, install Transformers.js in the site:

```sh
npm install @huggingface/transformers
```

```yaml title="shabd.config.yaml"
features:
  search:
    semantic: true
    model: Xenova/all-MiniLM-L6-v2
    maxResults: 8
    minSimilarity: 0.35
    store: memory
```

`minSimilarity` is how close a section must be to a query to count as a semantic match, from 0 to 1. The default
suits the default model. On this site, sections that answered a query scored 0.37 to 0.52 and the nearest section to
an unrelated query scored about 0.31. Other models spread their scores differently, so adjust it if you change
`model`.

If the package is not installed, the build says so and produces keyword search only. `shabd build --no-semantic`
does the same on purpose.

## What it costs

Nothing below is downloaded until a reader opens search. The sizes are from this site's own build, which has about
a hundred sections.

| | Size | Notes |
| --- | --- | --- |
| Search index | About 50 KB | The text of every section |
| Vectors | 384 bytes per section | About 36 KB here |
| Embedding model | 22 MB | Fetched from Hugging Face, then cached by the browser |
| ONNX runtime | 27 MB on disk, about 5 MB compressed | Part of your build, served from your own site |

Keyword search needs only the first row. The model and the runtime are fetched once, the first time a reader opens
search, and only for semantic search. A reader whose browser is set to save data is not sent them and keeps keyword
search.

The runtime is one 27 MB file in `dist/assets/`. Some hosts limit the size of a single file, so check yours before
turning semantic search on. Cloudflare Pages, for example, allows 25 MiB.

The first build downloads the model too, into `node_modules/@huggingface/transformers/.cache`. Later builds reuse it,
and only embed passages whose text changed.

## Choosing a store

`store` decides how the index is held in the reader's browser. There are two, and they give the same results for the
same query.

| | `memory` (the default) | `sqlite` |
| --- | --- | --- |
| The index is | JSON and a file of vectors | One SQLite database |
| Keyword search by | An index built in JavaScript when search opens | SQLite's FTS5 |
| Kept between visits | By the browser's HTTP cache | In the browser's private file system, where it offers one |
| Extra download | None | SQLite itself: about 460 KB compressed |

The SQLite store needs one more package:

```sh
npm install @sqlite.org/sqlite-wasm
```

```yaml
features:
  search:
    store: sqlite
```

Which one to use depends on the size of the site. These numbers are from a synthetic index of 120-word sections
with 384-dimension vectors, run in Node with the same code and the same SQLite build the browser uses:

| | 2,000 sections | 20,000 sections |
| --- | --- | --- |
| `memory`: download, compressed | 1.3 MB | 13 MB |
| `memory`: time to open | 88 ms | 846 ms |
| `memory`: held in memory | about 17 MB | about 122 MB |
| `memory`: keyword query, with semantic | 0.5 ms, 1.9 ms | 2.7 ms, 19 ms |
| `sqlite`: download, compressed | 2.2 MB | 21 MB |
| `sqlite`: time to open | 2 ms | 6 ms |
| `sqlite`: keyword query, with semantic | 1.0 ms, 7.4 ms | 6.5 ms, 72 ms |

The memory store is smaller to download and faster to query at both sizes. What it pays is the time to build its
index on every visit and the memory that index takes, and both grow with the site. The SQLite store opens at once
and builds nothing, in exchange for a larger file and slower queries.

So keep `memory` for a site of hundreds or a few thousand sections, which is most documentation. Consider `sqlite`
when search takes noticeably long to open. This site has about a hundred sections: its JSON index is about 16 KB
compressed, and the same index as SQLite would be about 76 KB plus SQLite itself.

In tests, Chromium and Firefox kept the database between visits and did not download it a second time. WebKit, as
driven by the test runner, did not offer its private file system to the worker; the store then reads the database
from memory, which works the same but downloads it on each visit. A second tab does the same while the first has the
stored file open.

If the package is missing, or the database cannot be opened, search uses the memory store.

## Things to know

- Queries never leave the device. The model itself is downloaded from Hugging Face by Transformers.js, which is a
  request to a third party. Serving the model from your own site is on the roadmap.
- An agent is ranked what a reader is ranked. Where `shabd dev`, `shabd preview` or `shabd mcp` serves the
  [MCP endpoint](./mcp.md#search-by-meaning), `search_docs` matches by keyword and by meaning, with the same model
  and the same ranking. There the query is embedded by that process, not in a browser.
- The default model was trained mostly on English. For other languages, set `model` to a multilingual embedding
  model that Transformers.js supports. The build and the browser always use the same one.
- Keyword search splits text on letters and digits. Languages written without spaces between words, such as
  Chinese and Japanese, are matched by meaning but poorly by keyword.
- Vectors are compared with a plain scan in both stores, not an approximate index. At 20,000 sections that is 19 ms
  in the memory store and 72 ms in the SQLite store.
- Keyword, semantic and SQLite search were each run in Chromium, Firefox and WebKit.

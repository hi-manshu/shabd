---
title: Search
description: Keyword search, plus semantic search that runs in the reader's browser.
badges: [New]
---

Shabd's search runs in the reader's browser. Nothing is sent to a search service, because there is none: the index is
a static file, and the ranking happens in a Web Worker on the reader's device.

There are two kinds of matching, and results combine both.

- **Keyword** search finds sections that contain the words typed. It works as soon as the index has loaded. The
  word still being typed matches as the start of a longer word, and a word that matches nothing is taken for a
  [misspelling](#misspelt-words).
- **Semantic** search finds sections that mean something similar, even with no word in common. Searching this site
  for "warn the reader about something dangerous" finds the section on callouts.

Search opens from the button in the header, with `/`, or with Ctrl and K (Command and K on a Mac). The arrow keys
move through the results while the field keeps the focus, Enter goes to the one that is marked, and Escape closes
search and puts the focus back where it was. A screen reader is told how many results there are as they change.

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

## Misspelt words

A word that no section contains is looked up again as the words close to it. Searching this site for "calouts"
finds the section on callouts.

- Close means one edit away, or two for a word of eight letters or more. An edit is a letter added, dropped or
  changed, or two neighbouring letters swapped.
- Only a word that matches nothing is treated this way. A word the site does use is never taken for another one.
- A match by a misspelt word counts for half of an exact match, and for a quarter at two edits, so a section with
  the words as they were typed comes first.
- Words of fewer than four letters are not guessed at, because nearly every short word is one edit from another.
  Neither are words with a digit in them: `8081` is not a misspelling of `8080`. And a word is never taken for a
  filler word such as "for" or "from".
- In a result, the word that is marked is the one the site has, not the one that was typed.

Both stores pick the close words with the same code, from the same list of words, and the MCP endpoint does it
too.

## Languages written without spaces

Elsewhere a word is what stands between spaces and punctuation. Chinese, Japanese and Thai are written without
spaces, so there words are found with a dictionary: the one behind `Intl.Segmenter`, which Node and current
browsers carry. 搜索功能 is indexed as 搜索 and 功能, and typing either finds it.

- The in-memory store cuts the text into words in the reader's browser, when search opens. The SQLite store's
  index is cut by Node when the site is built, and the browser cuts only what is typed.
- Two engines do not always cut a text in the same places, and one engine cuts a word differently alone and in a
  sentence. Playwright's Firefox takes サイドバー for one word where Node takes it for サイド and バー. So a word
  that is not found is tried twice more: as the start of a longer word, and cut again along the words the index
  does have.
- That was measured on 59 words and phrases in the three languages, each typed alone and looked for in sentences
  cut by Node. As Chromium and WebKit cut them, every word of 58 was in the index. As Firefox cut them, every
  word of 51 was, and 6 found nothing. With the two further tries all 59 found their sentence in all three
  engines, and 58 had it as the first result.
- A browser without `Intl.Segmenter` takes every pair of neighbouring letters for a word: 搜索功能 becomes 搜索,
  索功 and 功能. That is how the in-memory store then cuts its index too. This path was run in the unit tests,
  with the segmenter taken away, and not in a browser that lacks it.
- Cutting by dictionary takes time, and the in-memory store does it each time search opens. In Node, 2,000
  sections of Chinese, about 270 characters each, took 486 ms to open, where 2,000 sections of English of 120
  words took 84 ms. For 20,000 sections it was 4.9 s against 0.8 s. The SQLite store's index is cut when the site
  is built, so it opens as it does for any other text: it is the one to use for a large site in these languages.
- A passage is about 200 of these words, as it is 200 words elsewhere.
- Searching a page in the three languages is part of the browser tests: in Chromium, Firefox and WebKit, on both
  stores.
- Lao, Khmer and Burmese are cut the same way. They were not tried. Korean puts spaces between words and is
  left as it was.

Semantic search needs a model that knows the language: see [Things to know](#things-to-know).

## Where a result leads

A result's address is its section's: `/guide/installation#create-a-site`. Choosing a result does more than follow
that address. The page opens at the passage that matched, with the words of the query marked in it.

- In a short section the passage is the whole section, so the page opens at the heading, with the marks under it.
  In a long section it opens where the passage starts, however far under the heading that is. If the first marked
  word would still be out of sight, as it can be under a long code sample, the page moves to that word.
- The marks stay until you press <kbd>Esc</kbd> or go somewhere else, and another heading of the same page counts
  as somewhere else. They are still there after a reload. They do not come back when you return with the back
  button.
- The passage and the words travel in the browser's history, not in the address. So the address stays one you can
  share, and a copied link, or a result opened in a new tab, leads to the heading.
- The marks are drawn with the CSS Custom Highlight API, in the theme's `highlight` colour, and add nothing to the
  page's markup. A browser without the API goes to the passage and marks nothing.

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
    modelSource: huggingface
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
| ONNX runtime | 27 MB, 6.6 MB compressed with gzip | Fetched from jsDelivr, then cached by the browser |

Keyword search needs only the first row. The model and the runtime are fetched once, the first time a reader opens
search, and only for semantic search. A reader whose browser is set to save data is not sent them and keeps keyword
search.

Those two are requests to other hosts. [Serving the model yourself](#serving-the-model-yourself) keeps them on
your own site.

The build writes the runtime into `dist/assets/` as well, as one file of 27 MB, because the bundler finds it named
in Transformers.js. A reader's browser does not ask for that copy: Transformers.js sends it to jsDelivr. The file
is in the output all the same. Some hosts limit the size of a single file, so check yours before turning semantic
search on. Cloudflare Pages, for example, allows 25 MiB.

The first build downloads the model too, into `node_modules/@huggingface/transformers/.cache`. Later builds reuse it,
and only embed passages whose text changed.

### Serving the model yourself

```yaml
features:
  search:
    modelSource: site
```

With `modelSource: site` the reader's browser gets the model, and the runtime that executes it, from your site,
and asks no other host for anything.

- The build copies the model into `dist/_shabd/models/`. These are the files Transformers.js downloaded to embed
  your pages, out of its cache in `node_modules`, so nothing is downloaded a second time.
- It copies the runtime into `dist/_shabd/runtime/`, out of `onnxruntime-web` in `node_modules`: two builds of it,
  because Transformers.js asks Safari before version 26 for a plainer one than it asks other browsers for.
- The dev server serves the same files at the same addresses.
- Transformers.js keeps what it fetched in the browser's cache storage, as it does with the default. A second
  visit was not tested.

With the default model that is eight more files in `dist/`, 62 MiB in all:

| | Size | Compressed with gzip |
| --- | --- | --- |
| The model's weights, `onnx/model_quantized.onnx` | 21.9 MiB | 15.5 MiB |
| Its tokeniser and two small files | 0.7 MiB | |
| The runtime for most browsers, `ort-wasm-simd-threaded.asyncify.wasm` | 25.6 MiB | 6.3 MiB |
| The runtime for Safari before 26, `ort-wasm-simd-threaded.wasm` | 13.6 MiB | 3.5 MiB |

A reader downloads the model and one of the two runtimes. The build prints the size of the largest file it
copied, because that is the one a host is most likely to refuse. With the default model it is the runtime, at
25.6 MiB: over the 25 MiB that Cloudflare Pages allows for one file. Another model is another size, and
multilingual ones are often several times larger, so look at the model's files before choosing one to serve.

The copy of the runtime that the bundler writes into `dist/assets/` is still there, and still unused.

If Transformers.js is not installed, or the build runs with `--no-semantic`, there is no model to copy and
nothing is. If the files cannot be found where Transformers.js keeps them, the build says so, and readers get
keyword search.

This was run with the real model in Chromium, Firefox and WebKit, on both stores, from a build and from the dev
server. Behind a proxy that cuts off every host but the site's own, search by meaning loaded; with the default
source it did not. In Chromium, where a test can see what a worker asks for, every request went to the site. The
runtime for Safari before 26 was not run in such a browser.

## Choosing a store

`store` decides how the index is held in the reader's browser. There are two. They hold the same words, take a
misspelt word for the same words, and rank by meaning with the same code. They score a keyword match with
different formulas, so they do not always put results in the same order: see [how far they agree](#how-far-they-agree).

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
| `memory`: download, compressed | 1.2 MB | 11.6 MB |
| `memory`: time to open | 75 ms | 716 ms |
| `memory`: held in memory | about 17 MB | about 108 MB |
| `memory`: keyword query, with semantic | 0.33 ms, 1.4 ms | 0.46 ms, 14 ms |
| `memory`: query with a misspelt word | 2.0 ms | 3.7 ms |
| `sqlite`: download, compressed | 2.0 MB | 19.0 MB |
| `sqlite`: time to open | 0.5 ms | 1.3 ms |
| `sqlite`: keyword query, with semantic | 0.64 ms, 2.0 ms | 1.0 ms, 15 ms |
| `sqlite`: the first query with semantic | 6.5 ms | 63 ms |
| `sqlite`: query with a misspelt word | 2.6 ms | 4.8 ms |
| `sqlite`: the first query with a misspelt word | 37 ms | 117 ms |

They were measured with `node --expose-gc scripts/bench/search-stores.mjs`, on an Apple M2 Pro with Node 22.16.
Each time is the median of 200 queries, or of five runs for what is done once, and the figure given is the middle
one of three runs of the script. A keyword query is two words, the second with its first four letters typed. The
script builds the same index on every run, so the numbers can be made again. It does not measure a browser: not
the download, and not the SQLite store reading its file from the browser's private file system.

The memory store is smaller to download. What it pays is the time to build its index on every visit and the
memory that index takes, and both grow with the site. The SQLite store opens at once and builds nothing, in
exchange for a larger file. A query takes about as long in either. By keyword it is a millisecond or less. By
meaning it is as long as it takes to compare the query with every vector, which both stores do the same way: the
SQLite store reads the vectors out of its database on the first such query, and holds them from then on, 384
bytes a section.

So keep `memory` for a site of hundreds or a few thousand sections, which is most documentation. Consider `sqlite`
when search takes noticeably long to open. This site has about a hundred sections: its JSON index is about 16 KB
compressed, and the same index as SQLite would be about 76 KB plus SQLite itself.

### How far they agree

A query by meaning is ranked by the same code over the same vectors in both stores, and comes out the same. A
keyword match is scored by SQLite's FTS5 in one and by Shabd's own code in the other. Both use BM25, with the same
weights for a title, a heading and the text, but they are not the same formula, and they treat a word that is
still being typed differently: the in-memory store looks up as many as 40 words that start with what was typed,
each on its own and at a discount, and FTS5 takes all of them as one word.

On this site's own index of 132 sections, with 300 queries of each kind made from its words
(`node scripts/bench/store-agreement.mjs docs`):

| Query | Same first result | Same eight sections | In the same order |
| --- | --- | --- | --- |
| One word, finished | 293 of 300 | 299 | 275 |
| Two words, finished | 286 | 292 | 223 |
| One misspelt word | 294 | 297 | 268 |
| A misspelt word and a right one | 287 | 289 | 245 |
| One word with its first four letters typed | 236 | 239 | 163 |
| Two words, the second with four letters typed | 201 | 202 | 55 |

So for words typed in full the two stores nearly always find the same sections, mostly in the same order. While
a word is still being typed they often show different results.

In tests, Chromium and Firefox kept the database between visits and did not download it a second time. WebKit, as
driven by the test runner, did not offer its private file system to the worker; the store then reads the database
from memory, which works the same but downloads it on each visit. A second tab does the same while the first has the
stored file open.

If the package is missing, or the database cannot be opened, search uses the memory store.

## Things to know

- Queries never leave the device. By default the model is downloaded from Hugging Face and the runtime that
  executes it from jsDelivr, which are requests to two third parties. With
  [`modelSource: site`](#serving-the-model-yourself) both come from your own site.
- An agent is ranked what a reader is ranked. Where `shabd dev`, `shabd preview` or `shabd mcp` serves the
  [MCP endpoint](./mcp.md#search-by-meaning), `search_docs` matches by keyword and by meaning, with the same model
  and the same ranking. There the query is embedded by that process, not in a browser.
- The default model was trained mostly on English. For other languages, set `model` to a multilingual embedding
  model that Transformers.js supports. The build and the browser always use the same one.
- A misspelt word is compared with whole words. While it is still being typed it is too far from any of them, so
  results can go away in the middle of a word and come back when it is finished.
- Misspellings are counted in letters, which suits an alphabet. They were tried in English, and on one word of
  Hindi.
- The SQLite store reads the list of its words the first time a word is not found. That happens once per visit,
  and takes longer the larger the index is: 37 ms at 2,000 sections and 117 ms at 20,000.
- Vectors are compared with a plain scan in both stores, not an approximate index. At 20,000 sections that is 14 ms
  in the memory store and 15 ms in the SQLite store.
- A passage is found on the page by its words, so it is found only where the page shows them as text. Words in a
  tab that is not open, or under a folded `<details>`, cannot be scrolled to or marked: the page then opens at the
  section's heading. That case has no test.
- Keyword, semantic and SQLite search were each run in Chromium, Firefox and WebKit. So was going to a passage and
  marking it: all three have the Custom Highlight API, and the path without it was run by taking the API away.

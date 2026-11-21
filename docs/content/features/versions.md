---
title: Versions and languages
description: Keep the docs of an older version beside the current ones, and the site in more than one language.
badges: [New]
---

A site can hold the docs of more than one version of what it documents, and it can hold them in more than one
language. Both work the same way: each version, and each language, is one folder of the content, and the first of
its kind is the site itself.

## Versions

List the versions in the config, the current one first. Each of the others names the folder its pages are in:

```yaml title="shabd.config.yaml"
versions:
  - label: "2.x" # the current version: the pages of the site itself
  - { label: "1.x", path: /v1 } # the pages of content/v1, served under /v1
```

```text
content/
├── guide/install.md          /guide/install       in 2.x
└── v1/
    ├── index.md              /v1                  where 1.x starts
    └── guide/install.md      /v1/guide/install    the same page, in 1.x
```

A page has the same path inside each version, and that is how Shabd knows which pages are the same page. To cut a
new version, copy the pages as they are into a folder and add a line for it.

With more than one version:

- The header has a menu of the versions. It leads to the page a reader is on, in the version they pick, or to
  where that version starts when it has no such page.
- A page of an older version says so at its top, with a link to the current one.
- Each version has a sidebar of its own, made from its own folder. To write one by hand, give it a key in
  [`sidebar.yaml`](../configuration/sidebar.md#more-than-one-sidebar): `/v1:` and its list.
- Search finds what is in the version a reader is in.
- Search engines are asked not to list the pages of an older version, and the sitemap leaves them out, so that a
  search leads to the current docs. `index: true` on a version has them listed.
- `llms.txt`, `llms-full.txt` and the feed are of the current version. `llms.txt` ends with where the others are.

## Languages

List the languages, the one the site is written in first. Each of the others is a folder named after its code:

```yaml title="shabd.config.yaml"
languages:
  - { code: en, label: English } # the language of the site itself
  - { code: de, label: Deutsch } # the pages of content/de, served under /de
  - { code: ar, label: العربية, dir: rtl }
  - { code: pt-BR, label: Português, path: /br } # in a folder with another name
```

Write `label` in the language itself: it is what a reader of that language looks for in the menu.

With more than one language:

- The header has a menu of the languages, which leads to the page a reader is on in the language they pick.
- Each page says which language it is in (`lang`, and `dir` for one written right to left), and tells search
  engines where the same page is in the other languages. The second needs [`site.url`](../configuration/site.md).
- Each language has its own sidebar and its own search, as a version does.
- The site's title leads to where the reader's language starts, and the day a page was last updated is written
  as that language writes a day.
- `site.lang` is the first language. Leave it out, or make the two agree.

A page that a language does not have is simply not there in that language: the menu leads to where the language
starts. Shabd does not show the page in another language in its place.

### The header's links and the footer

[`site.nav`](../configuration/site.md) is written once. A link in it leads to its page in the reader's own
language, and in the version they are reading, where the page is there: `/guide/install` is `/de/guide/install`
to a reader of German. Where it is not there, the link leads where it is written.

That leaves the words of the links in the site's first language. A language can have links of its own, and a
footer of its own:

```yaml title="shabd.config.yaml"
site:
  title: Acme
  nav:
    - { label: Guide, link: /guide/install }
  footer: Released under the MIT licence.

languages:
  - { code: en, label: English }
  - code: de
    label: Deutsch
    nav:
      - { label: Anleitung, link: /de/guide/install }
    footer: Unter der MIT-Lizenz veröffentlicht.
```

A language that gives neither has the site's. The first language is the site's own, so its links and its footer
are the ones under `site`: giving them again under `languages` is an error.

### The site's own words

The words around a page, "Search" and "On this page", are English unless a language gives its own under `ui`:

```yaml title="shabd.config.yaml"
languages:
  - { code: en, label: English }
  - code: de
    label: Deutsch
    ui:
      search: Suche
      toc: Auf dieser Seite
      search.count.many: "{count} Treffer"
```

A word in braces is filled in when the sentence is shown, so keep it as it is. A key that is not one of Shabd's
is an error when the config loads, and a key a language leaves out is said in English. The first language can
give words too: a site written in German lists German first and gives it a `ui`.

Getting about:

| Key | In English | Where it is |
| --- | --- | --- |
| `skip` | `Skip to content` | The first link of a page, for a reader who uses the keyboard |
| `region.sidebar` | `Documentation` | The name of the sidebar, to a screen reader |
| `toc` | `On this page` | Above the list of a page's headings |
| `nav.main` | `Main` | The name of the header's links, to a screen reader |
| `nav.open` | `Open navigation` | The button that opens the sidebar on a small screen |
| `nav.close` | `Close navigation` | The same button, when the sidebar is open |
| `breadcrumb` | `Breadcrumb` | The name of the trail above a page's title, to a screen reader |
| `pagination` | `Previous and next page` | The name of the two links under a page, to a screen reader |
| `pagination.previous` | `Previous` | Above the link to the page before |
| `pagination.next` | `Next` | Above the link to the page after |
| `heading.link` | `Link to this section` | The link beside a heading |
| `table` | `Table` | The name of a table that scrolls sideways, to a screen reader |
| `notFound.title` | `Page not found` | The title of the page for an address that does not exist |
| `notFound.text` | `No page lives at this address. It may have been moved or renamed. Try the search, or start again from the {home}.` | What that page says. `{home}` is a link, whose words are the next key |
| `notFound.home` | `home page` | The words of that link |

A page:

| Key | In English | Where it is |
| --- | --- | --- |
| `page.edit` | `Edit this page` | The link to a page's source |
| `page.updated` | `Last updated` | Before the day a page was last changed |
| `page.actions` | `This page for AI assistants` | The name of the three that follow, to a screen reader |
| `page.copy` | `Copy page` | The button that copies a page as Markdown |
| `page.copied` | `Copied` | On that button, once it has copied |
| `page.copyFailed` | `Could not copy` | On that button, when the browser would not |
| `page.markdown` | `View as Markdown` | The link to a page's Markdown copy |
| `page.openIn` | `Open in {assistant}` | The links that open a page in an assistant |
| `code.copy` | `Copy` | The button on a block of code |
| `code.copied` | `Copied` | On that button, once it has copied |
| `callout.note` | `Note` | The title of a note that is given none |
| `callout.tip` | `Tip` | The same, of a tip |
| `callout.important` | `Important` | The same, of what is important |
| `callout.warning` | `Warning` | The same, of a warning |
| `callout.caution` | `Caution` | The same, of a caution |

Search:

| Key | In English | Where it is |
| --- | --- | --- |
| `search` | `Search` | On the button in the header |
| `search.dialog` | `Search the documentation` | The name of the search dialog, to a screen reader |
| `search.field` | `Search the docs` | In the field, before anything is typed |
| `search.close` | `Esc: close search` | The name of the button that closes the dialog, to a screen reader |
| `search.results` | `Results` | The name of the list of results, to a screen reader |
| `search.count.one` | `1 result` | Said to a screen reader when a query has one result |
| `search.count.many` | `{count} results` | Said when it has more |
| `search.none` | `Nothing matches “{query}”. Try other words, or fewer of them.` | When a query has none |
| `search.byMeaning` | `Found by meaning: it does not contain your words` | The hint on a result that search by meaning found |
| `search.unavailable` | `Search is unavailable.` | At the foot of the dialog, when the index could not be loaded |
| `search.loading` | `Loading the search index…` | There, while it loads |
| `search.keyword` | `Searching by keyword.` | There, once it has |
| `search.modelLoading` | `Searching by keyword. Loading the language model for search by meaning: {progress}%` | There, while the model for search by meaning loads |
| `search.hybrid` | `Searching by keyword and by meaning. Your query stays on this device.` | There, once the model has loaded |

How the site looks:

| Key | In English | Where it is |
| --- | --- | --- |
| `theme.mode` | `Switch colour theme` | The name of the button that switches between light and dark |
| `theme.choose` | `Choose a theme` | The name of the button that opens the menu of themes |
| `theme.list` | `Theme` | The name of that menu, to a screen reader |
| `theme.themes` | `Themes` | Above the themes in the menu, when it has palettes too |
| `theme.palettes` | `Palettes` | Above the palettes in it |

Versions and languages:

| Key | In English | Where it is |
| --- | --- | --- |
| `version.menu` | `Version: {version}` | The name of the menu of versions, to a screen reader |
| `version.old` | `You are reading the documentation for {version}.` | At the top of a page of an older version |
| `version.thisPage` | `Read this page in {version}, the current version.` | The link after it, where the current version has the page |
| `version.current` | `Go to {version}, the current version.` | The link after it, where it has not |
| `language.menu` | `Language: {language}` | The name of the menu of languages, to a screen reader |

### What stays as it is written

Some of what a reader sees is not in the table, and is the same in every language:

- `site.title` and `site.description`. A site has one name.
- The words of an [API reference](openapi.md): "Try it", and the form it opens.
- The words of a [live example](sandbox.mdx): its title when it is given none, and "Reset code".
- The page for an address that does not exist. A build writes it once, as `404.html`, in the site's first
  language. A reader whose browser runs scripts sees it in the language of the address they asked for, with that
  language's sidebar. A reader whose browser does not sees the first language's.

## Both at once

A language is the outer of the two: German's older version is `content/de/v1`, served under `/de/v1`. A language
need not have every version, and a version need not be in every language.

## Things to know

- The menus are in the header of the built-in layouts, and the notice at the top of `doc` and `api` pages. A site
  that [writes its own header](../configuration/layouts.md) adds the blocks `version-menu` and `language-menu` to
  it, and `version-notice` where it wants the notice.
- A page's place in a version or a language is its folder, so a version cannot be the pages of two folders.
- The MCP endpoint searches the whole site: every version and every language.
- Search asks for more results than it shows and leaves out the ones from elsewhere. Where versions differ a great
  deal, a query can be left with fewer results than a site with one version would show.

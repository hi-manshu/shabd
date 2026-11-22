---
title: Feed
description: An RSS feed of the pages that have a day, for readers who follow a site in a feed reader.
---

With the feed on, a build writes `rss.xml`, and every page tells feed readers where to find it.

```yaml title="shabd.config.yaml"
site:
  url: https://docs.example.com
features:
  feed: true
```

The feed needs `site.url`, because a feed reader is given full addresses. Without it the config is refused, with
the line to fix.

## Which pages are in it

A page is in the feed when it has a day to be listed under. Shabd looks in two places, in this order:

1. `date` in the page's frontmatter: the day the page was published.
2. The day the page was [last changed](../configuration/site.md#when-a-page-was-last-changed), when the site shows
   that day or the page states it.

A page with neither is left out, and so is a page that is `noindex`. The pages are listed newest first.

`date` suits pages that are written once, such as release notes. A page with a `date` stays where it was published,
however often a typo in it is fixed afterwards.

```md
---
title: Version 2.0
description: Faster builds, and a feed.
date: 2026-11-17
---
```

A feed reader shows the title and the description of the page. The body of the page is not in the feed.

## Options

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | the site's title | The feed's own title |
| `directory` | none | A content folder whose pages make up the feed, such as `changelog`. Left out, every page with a day is in it |
| `limit` | `20` | How many pages the feed holds |

```yaml title="shabd.config.yaml"
features:
  feed:
    directory: changelog
    title: Acme releases
```

## Things to know

- The feed is as new as its newest page, not as new as the build. The file stays the same until a page changes, so
  a feed reader is not sent it again for nothing.
- `shabd dev` serves the feed at the same address, written from the files as they are.
- The feed is RSS 2.0. The tests read it back as text and parse it with the XML parsers of Chromium, Firefox and
  WebKit. It has not been tried in feed readers.

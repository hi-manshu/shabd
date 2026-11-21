---
title: Social pictures
description: What other sites show when a page is shared, and the picture a build can draw for each page.
---

When a link to a page is posted in a chat or on a social site, that site shows a title, a description and, if the
page names one, a picture. Shabd writes the title, the description and the site's name into every page. The
picture can come from three places.

| | Where it comes from |
| --- | --- |
| `image` in a page's frontmatter | A picture you made for that page |
| A picture the build draws | `features.socialImages`, described below |
| `site.image` | One picture for every page that has neither of the above |

`image` and `site.image` take a path to a file in `public/`, or a full address.

```yaml title="shabd.config.yaml"
site:
  url: https://docs.example.com
  image: /social.png
```

The site that shows the picture fetches it from outside, by its full address. So a path only works once `site.url`
is set, and a picture named without it is left out of the page.

## Pictures drawn by the build

With `socialImages` on, a build draws a picture for each page that has no `image` of its own: the page's title and
description in the site's colours, with the title hanging from the headline bar as it does on the page.

![The picture for the Installation page of this site: its title under a dark bar, its description, the site's name and where the site lives.](/social-example.png)

```yaml title="shabd.config.yaml"
site:
  url: https://docs.example.com
features:
  socialImages: true
```

It needs one more package, which draws the picture:

```sh
npm install @resvg/resvg-js
```

If the package is not installed, the build says so and draws nothing. `site.url` is required, and the config is
refused without it.

A picture is 1200 by 630 pixels and about 25 KB. It is written to `_shabd/social/`, under the page's own path.
A build keeps the pictures it has drawn and only draws those whose title, description, colours or font changed:
this site's nineteen took 0.6 seconds the first time and 0.2 seconds after that.

### The font

The pictures cannot be set in the font the site uses. That font is shipped as WOFF2, for browsers, and the package
that draws reads TrueType and OpenType files only. So name the files to use, a regular and a bold face:

```yaml title="shabd.config.yaml"
features:
  socialImages:
    font: [./fonts/Inter-Regular.ttf, ./fonts/Inter-Bold.ttf]
```

Without `font`, Shabd looks for a font the machine that builds comes with: Helvetica or Arial on macOS, DejaVu Sans
or Liberation Sans on Linux, Arial on Windows. The pictures then differ from one machine to the next, and a
machine with none of those draws nothing and says so. Naming the files gives the same picture everywhere.

A font draws only the characters it has. For a title in a script the font lacks, name a font that has it.

## Things to know

- The pictures are drawn in a build, not in `shabd dev`.
- They use the light colours of the site's own palette. A colour written in a form other than hex or `rgb()` is
  replaced by a plain one.
- The site's logo is not on the picture.
- A title that does not fit in three lines at the largest size is set smaller, down to a point, and then cut short
  with an ellipsis. A word wider than a line is broken.
- Drawing was run on macOS with Helvetica. The fonts looked for on Linux and Windows are named from where those
  systems keep them, and were not tried.

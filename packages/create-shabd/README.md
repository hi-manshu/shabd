# @himanshoe/create-shabd

Starts a [Shabd](https://github.com/hi-manshu/shabd) documentation site.

```sh
npm create @himanshoe/shabd@latest my-docs
cd my-docs
npm install
npm run dev
```

It writes a `package.json`, a `.gitignore`, `shabd.config.yaml`, `sidebar.yaml`, a home page and two guide pages,
and nothing else. It needs Node.js 22 or newer.

| Option | Meaning |
| --- | --- |
| `--title <text>` | The site's title. Without it, the directory name is used |
| `--preset <name>` | A built-in theme, such as `forest` or `macos` |
| `--shabd <spec>` | What to install as `@himanshoe/shabd`: a version range, or the path of a local build or tarball |
| `--force` | Write into a directory that is not empty. Files already there are kept |

Through `npm create`, options need `--` before them, or npm keeps them for itself:

```sh
npm create @himanshoe/shabd@latest my-docs -- --preset forest
```

The files it copies are in
[`template/`](https://github.com/hi-manshu/shabd/tree/main/packages/create-shabd/template), laid out as the site
they become.

# create-shabd

Starts a [Shabd](https://github.com/hi-manshu/shabd) documentation site.

```sh
npm create shabd my-docs
cd my-docs
npm install
npm run dev
```

It writes a `package.json`, a `.gitignore`, `shabd.config.yaml`, `sidebar.yaml`, a home page and two guide pages,
and nothing else.

Neither `shabd` nor `create-shabd` is on npm yet, so the command above does not work today. Until they are
published, run the starter from a clone of the repository and point the new site at a packed copy of Shabd:

```sh
npm run build
npm pack -w shabd --pack-destination ..
node packages/create-shabd/bin/create-shabd.js ../my-docs --shabd file:../shabd-0.1.0.tgz
```

| Option | Meaning |
| --- | --- |
| `--title <text>` | The site's title. Without it, the directory name is used |
| `--preset <name>` | A built-in theme, such as `forest` or `macos` |
| `--shabd <spec>` | What to install as `shabd`: a version range, or the path of a local build or tarball |
| `--force` | Write into a directory that is not empty. Files already there are kept |

The files it copies are in [`template/`](./template), laid out as the site they become.

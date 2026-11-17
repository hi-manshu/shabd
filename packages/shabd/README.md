# shabd

Documentation sites configured in YAML, with in-browser search, an MCP endpoint for AI agents, an in-browser editor
for development, and live code sandboxes.

The starter writes a small site that runs as it is:

```sh
npm create shabd@latest my-docs
```

Or add Shabd to a folder by hand:

```sh
npm install shabd react react-dom
```

```yaml
# shabd.config.yaml
site:
  title: My docs
```

```sh
npx shabd dev      # dev server
npx shabd build    # static site in dist/
npx shabd check    # validate config, sidebar, frontmatter and links
```

Pages are `.md` and `.mdx` files in `content/`. The documentation is in the repository, under
[`docs/content`](https://github.com/hi-manshu/shabd/tree/main/docs/content), and is itself a Shabd site.

Requires Node.js 22 or newer. Semantic search additionally needs `@huggingface/transformers`, and the SQLite search
store needs `@sqlite.org/sqlite-wasm`.

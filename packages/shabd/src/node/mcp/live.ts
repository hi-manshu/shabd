/**
 * A DocsSource over a running process's content store: always current.
 *
 * Search goes through the process's SearchService, so it ranks by keyword
 * and, where the index has vectors, by meaning: what a reader's search
 * does. `features.mcp.semantic: false` keeps it to keywords.
 */
import type { ShabdContext } from '../context.js'
import { markdownPath, publicUrl } from '../llms/llms-txt.js'
import { pageMarkdown } from '../llms/markdown.js'
import type { SearchService } from '../search/service.js'
import { toRoutePath, type DocsPage, type DocsSource } from './source.js'

export function liveDocs(context: () => ShabdContext, searchService: SearchService): DocsSource {
  const toPage = (record: ReturnType<ShabdContext['store']['pages']>[number]): DocsPage => ({
    path: record.path,
    title: record.title,
    description: record.description,
    url: publicUrl(context(), markdownPath(record.path)),
    markdown: pageMarkdown(record),
  })
  return {
    get name() {
      return context().config.config.site.title
    },
    get description() {
      return context().config.config.site.description
    },
    pages: () => context().store.pages().map(toPage),
    page: (routePath) => {
      const record = context().store.byPath(toRoutePath(routePath))
      return record ? toPage(record) : undefined
    },
    // Read for each search: the dev server takes an edited config without restarting.
    search: (query, limit) =>
      searchService.search(query, limit, { semantic: context().config.config.features.mcp.semantic }),
  }
}

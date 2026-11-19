import 'virtual:shabd/fonts'
import './styles/index.css'
import 'virtual:shabd/math-styles'
import 'virtual:shabd/user-styles'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setUpOffline } from './app/offline.js'
import { currentRoute, loadPage } from './app/router.js'
import { siteStore } from './app/store.js'

const container = document.getElementById('app')
if (!container) throw new Error('Shabd: #app element is missing from the document')

// Load the page's module before the first render. A prerendered page then
// hydrates against identical markup; a dev page renders once, complete.
const initial = await loadPage(currentRoute())

if (container.hasChildNodes()) {
  hydrateRoot(container, <App initial={initial} />)
} else {
  createRoot(container).render(<App initial={initial} />)
}

// Keeping the site for reading without a connection, or no longer keeping it.
setUpOffline(siteStore.get())

/** Transient interface state shared by blocks that do not otherwise know about each other. */
import { createStore, useStore } from './store.js'

export interface UiState {
  /** The sidebar drawer on narrow screens. */
  sidebarOpen: boolean
  searchOpen: boolean
  studioOpen: boolean
}

export const uiStore = createStore<UiState>({ sidebarOpen: false, searchOpen: false, studioOpen: false })

export function useUi(): UiState {
  return useStore(uiStore)
}

export function setUi(patch: Partial<UiState>): void {
  uiStore.update((state) => ({ ...state, ...patch }))
}

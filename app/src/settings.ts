import { useSyncExternalStore } from 'react'
import type { Lang } from './i18n'

export interface Settings {
  lang: Lang
  theme: 'light' | 'dark'
  /** Масштаб кореневого шрифту у відсотках. */
  zoom: number
}

export const ZOOM_MIN = 70
export const ZOOM_MAX = 150

const KEY = 'marie.settings'
const THEME_KEY = 'marie.theme'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* сховище недоступне (приватний режим тощо) */
  }
}

const saved = read<Partial<Settings>>(KEY) ?? {}
let settings: Settings = {
  lang: saved.lang ?? 'uk',
  // Клас уже виставив public/theme.js до першого малювання.
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  zoom: saved.zoom ?? 100,
}

const listeners = new Set<() => void>()

function apply() {
  const root = document.documentElement
  root.classList.toggle('dark', settings.theme === 'dark')
  root.style.fontSize = `${settings.zoom}%`
  root.lang = settings.lang
}
apply()

export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  apply()
  write(KEY, JSON.stringify({ lang: settings.lang, zoom: settings.zoom }))
  if (patch.theme) write(THEME_KEY, patch.theme)
  listeners.forEach((l) => l())
}

export const getSettings = () => settings

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => settings,
  )
}

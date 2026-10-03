import { EXAMPLES } from '@/core/examples'
import { discarding, exportListing, exportMap, loadExample, newFile, openProject, saveProject } from '@/core/fileActions'
import { projectStore } from '@/core/project'
import { useT } from '@/i18n'
import { updateSettings, useSettings } from '@/settings'
import { ChevronDown, Moon, Sun } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from './styles'

export type Tab = 'editor' | 'simulator' | 'datapath'
export type DialogName = 'about' | 'isa' | 'dump'

const TABS: Tab[] = ['editor', 'simulator', 'datapath']

const chromeButton = 'flex h-11 items-center gap-1.5 rounded-md border border-line px-3.5 hover:bg-line/30'
const menuItem =
  'flex h-10 cursor-pointer items-center justify-between gap-6 rounded-sm px-3 outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-45 data-[highlighted]:bg-line/40'

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={chromeButton}>
        {label}
        <ChevronDown className="size-4" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-64 rounded-md border border-line bg-chrome p-1 text-chrome-fg shadow-[0_8px_24px_rgb(0_0_0/0.3)]"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const Shortcut = ({ children }: { children: string }) => <span className="font-mono text-xs text-ed-dim">{children}</span>

export function Header({
  tab,
  onTab,
  onDialog,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
  onDialog: (name: DialogName) => void
}) {
  const t = useT()
  const { lang, theme } = useSettings()
  const report = projectStore.use((s) => s.report)

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-chrome px-5 py-2">
      <div className="font-condensed text-xl font-bold tracking-[0.16em]">MARIE·16</div>

      <nav aria-label={t.appName} className="flex gap-1">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            aria-current={tab === name ? 'page' : undefined}
            className={cn(
              'flex h-11 items-center rounded-md px-4 font-medium',
              tab === name ? 'bg-tab font-semibold text-tab-fg' : 'hover:bg-line/30',
            )}
            onClick={() => onTab(name)}
          >
            {t.tabs[name]}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex flex-wrap gap-1.5">
        <Menu label={t.menu.file}>
          <DropdownMenu.Item className={menuItem} onSelect={() => discarding(newFile)}>
            {t.menu.new}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => discarding(openProject)}>
            {t.menu.open} <Shortcut>Ctrl O</Shortcut>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => saveProject()}>
            {t.menu.save} <Shortcut>Ctrl S</Shortcut>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => saveProject(true)}>
            {t.menu.saveAs}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={menuItem} disabled={!report} onSelect={() => exportListing()}>
            {t.menu.exportListing}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} disabled={!report?.map} onSelect={() => exportMap()}>
            {t.menu.exportMap}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => onDialog('dump')}>
            {t.menu.coreDump}
          </DropdownMenu.Item>
        </Menu>

        <Menu label={t.menu.examples}>
          {EXAMPLES.map((example) => (
            <DropdownMenu.Item
              key={example.id}
              className={menuItem}
              onSelect={() =>
                discarding(() => {
                  loadExample(example)
                  onTab('editor')
                })
              }
            >
              {t.examples[example.id]}
            </DropdownMenu.Item>
          ))}
        </Menu>

        <Menu label={t.menu.help}>
          <DropdownMenu.Item className={menuItem} onSelect={() => onDialog('isa')}>
            {t.menu.instructionSet} <Shortcut>F1</Shortcut>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => onDialog('about')}>
            {t.menu.about}
          </DropdownMenu.Item>
        </Menu>

        <button
          type="button"
          className={cn(chromeButton, 'min-w-13 justify-center font-semibold')}
          aria-label={t.menu.language}
          title={t.menu.language}
          onClick={() => updateSettings({ lang: lang === 'uk' ? 'en' : 'uk' })}
        >
          {lang === 'uk' ? 'УКР' : 'EN'}
        </button>
        <button
          type="button"
          className={cn(chromeButton, 'w-11 justify-center px-0')}
          aria-label={t.menu.theme}
          title={t.menu.theme}
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
        >
          {theme === 'dark' ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
        </button>
      </div>
    </header>
  )
}

import type { LucideIcon } from 'lucide-react'
import type { Version, VersionSource } from '../db/db'
import { IconAi, IconAutofix, IconGallery, IconImport, IconManual, IconRestore, IconSlider } from '../ui/icons'

export const SOURCE_CAPTION: Record<VersionSource, string> = {
  ai: 'from AI',
  manual: 'edited by hand',
  slider: 'edited by slider',
  autofix: 'auto-fixed',
  restore: 'restored',
  gallery: 'from an example',
  import: 'imported',
}

export const SOURCE_NAME: Record<VersionSource, string> = {
  ai: 'AI',
  manual: 'Manual',
  slider: 'Slider',
  autofix: 'Auto-fix',
  restore: 'Restore',
  gallery: 'Example',
  import: 'Import',
}

export const SOURCE_ICON: Record<VersionSource, LucideIcon> = {
  ai: IconAi,
  manual: IconManual,
  slider: IconSlider,
  autofix: IconAutofix,
  restore: IconRestore,
  gallery: IconGallery,
  import: IconImport,
}

/** Code pane caption (screen Main): "v3 · edited by slider", or "v3 · editing" while the change is not a version yet. */
export function versionCaption(head: Version | null, editing: boolean): string | null {
  if (!head) return null
  return `${head.label} · ${editing ? 'editing' : SOURCE_CAPTION[head.source]}`
}

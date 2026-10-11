import type { ComponentType } from 'react'
import { AppearanceSection } from './sections/AppearanceSection'
import { LibrariesSection } from './sections/LibrariesSection'
import { RenderingSection } from './sections/RenderingSection'
import { SecuritySection } from './sections/SecuritySection'
import { StorageSection } from './sections/StorageSection'
import { UsageSection } from './sections/UsageSection'

export type SettingsSectionId = 'providers' | 'usage' | 'rendering' | 'libraries' | 'appearance' | 'storage' | 'security'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  /** null: rendered by M2's AI providers page. */
  Component: ComponentType | null
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'providers', label: 'AI providers', Component: null },
  { id: 'usage', label: 'Usage and cost', Component: UsageSection },
  { id: 'rendering', label: 'Rendering', Component: RenderingSection },
  { id: 'libraries', label: 'Libraries', Component: LibrariesSection },
  { id: 'appearance', label: 'Appearance', Component: AppearanceSection },
  { id: 'storage', label: 'Storage and backup', Component: StorageSection },
  { id: 'security', label: 'Security', Component: SecuritySection },
]

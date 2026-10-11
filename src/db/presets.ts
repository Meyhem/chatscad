import { db, type Preset } from './db'

export const listPresets = (projectId: string): Promise<Preset[]> => db.presets.where('projectId').equals(projectId).sortBy('name')

export async function putPreset(p: Preset): Promise<void> {
  await db.presets.put(p)
}

export async function deletePreset(id: string): Promise<void> {
  await db.presets.delete(id)
}

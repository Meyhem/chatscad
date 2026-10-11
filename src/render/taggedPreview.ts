import { listTaggableStatements } from '../scad/statements'
import { tagCode } from '../scad/tagging'

/** The preview source for click-to-refine: the editor code with one colour tag per part. */
export function prepareTaggedSource(code: string): { code: string; maxTag: number } {
  const statements = listTaggableStatements(code)
  return { code: tagCode(code, statements), maxTag: statements.length }
}

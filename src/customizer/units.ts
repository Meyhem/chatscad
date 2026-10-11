import type { CustomizerParam } from '../scad/customizer'

const COUNT = /(^n$|^n_|_n$|count|num|qty|teeth|slots|ridges|knuckles|holes|segments|sides|steps)/i

/** Unit shown next to a numeric parameter. Models are in millimetres unless the parameter says otherwise. */
export function unitFor(p: CustomizerParam): string {
  const explicit = /\((mm|°|deg|degrees|%)\)/i.exec(p.description)
  if (explicit) {
    const unit = explicit[1]!.toLowerCase()
    return unit.startsWith('deg') ? '°' : unit
  }
  if (/angle|_deg$|^deg/i.test(p.name) || /\bangle\b/i.test(p.description)) return '°'
  if (COUNT.test(p.name) || /\b(number|count) of\b/i.test(p.description)) return ''
  return 'mm'
}

import { useEffect, useState } from 'react'
import type { ProviderProfile } from '../../db/db'
import { listProfiles } from '../../db/profiles'
import { startOfDay, startOfMonth, usageTotalsSince, type UsageTotal } from '../../db/usageTotals'
import { formatCost, formatTokens } from '../../ui/format'

const EMPTY: UsageTotal = { tokens: 0, cost: 0, unpriced: 0 }
const cell = (t: UsageTotal | undefined) => `${formatCost((t ?? EMPTY).cost)} · ${formatTokens((t ?? EMPTY).tokens)}`

export function UsageSection() {
  const [rows, setRows] = useState<{ profiles: ProviderProfile[]; today: Map<string, UsageTotal>; month: Map<string, UsageTotal> } | null>(null)

  useEffect(() => {
    let live = true
    const now = Date.now()
    void Promise.all([listProfiles(), usageTotalsSince(startOfDay(now)), usageTotalsSince(startOfMonth(now))]).then(([profiles, today, month]) => {
      if (live) setRows({ profiles, today, month })
    })
    return () => {
      live = false
    }
  }, [])

  const unpriced = rows ? [...rows.month.values()].reduce((n, t) => n + t.unpriced, 0) : 0
  const ids = rows ? [...new Set([...rows.profiles.map((p) => p.id), ...rows.month.keys()])] : []

  return (
    <section aria-labelledby="usage-title" className="flex max-w-[720px] flex-col gap-5 p-6">
      <h2 id="usage-title" className="text-[20px] leading-[26px] font-semibold">
        Usage and cost
      </h2>
      {!rows ? (
        <p className="pc-caption">Loading usage…</p>
      ) : ids.length === 0 ? (
        <p className="pc-caption">No AI calls yet.</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 gap-y-2">
          <span className="pc-label">Profile</span>
          <span className="pc-label">Today</span>
          <span className="pc-label">This month</span>
          {ids.map((id) => (
            <div key={id} className="contents" data-testid={`usage-${id}`}>
              <span>{rows.profiles.find((p) => p.id === id)?.name ?? 'Deleted profile'}</span>
              <span className="pc-mono">{cell(rows.today.get(id))}</span>
              <span className="pc-mono">{cell(rows.month.get(id))}</span>
            </div>
          ))}
        </div>
      )}
      {unpriced > 0 && (
        <p className="pc-hint">
          {unpriced} calls this month had no price and count as $0.000. Set prices in the profile's price table under AI providers.
        </p>
      )}
    </section>
  )
}

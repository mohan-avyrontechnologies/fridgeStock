import { formatDisplay, type Insights, type InsightsPeriod, type InsightsWeek } from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { EmptyState, SectionTitle, SkeletonList, LoadError } from '../components/ui';
import { insightsCopy } from '../copy';
import { formatMoney } from '../lib/format';
import { useAuthStore } from '../stores/authStore';

const hasActivity = (p: InsightsPeriod) => p.used + p.wasted > 0;

function Tile({ value, label, className }: { value: string | number; label: string; className: string }) {
  return (
    <li className={`rounded-card px-3 py-4 text-center ${className}`}>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-xs leading-tight font-semibold">{label}</p>
    </li>
  );
}

/** Eight stacked bars: used (green) under wasted (red). A table below gives screen readers the same numbers. */
function WeeksChart({ weeks }: { weeks: InsightsWeek[] }) {
  const tallest = Math.max(1, ...weeks.map((w) => w.used + w.wasted));
  return (
    <figure>
      <div
        role="img"
        aria-label={insightsCopy.chartLabel}
        className="flex h-40 items-end gap-2 rounded-card border border-line bg-card px-3 pt-3 pb-2"
      >
        {weeks.map((w) => (
          <div key={w.from} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-0.5">
            <div className="flex flex-col justify-end" style={{ height: `${((w.used + w.wasted) / tallest) * 100}%` }}>
              {w.wasted > 0 && (
                <div className="min-h-1 rounded-t bg-past-bar" style={{ flexGrow: w.wasted }} title={`${w.wasted}`} />
              )}
              {w.used > 0 && (
                <div
                  className={`min-h-1 bg-ok-bar ${w.wasted > 0 ? '' : 'rounded-t'}`}
                  style={{ flexGrow: w.used }}
                  title={`${w.used}`}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex gap-2 px-3 text-xs text-muted">
        {weeks.map((w) => (
          <span key={w.from} className="min-w-0 flex-1 break-words text-center">
            {formatDisplay(w.from).replace(/ \d{4}$/, '')}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-ok-bar" /> {insightsCopy.used}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-past-bar" /> {insightsCopy.wasted}
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>{insightsCopy.chartLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">{insightsCopy.used}</th>
            <th scope="col">{insightsCopy.wasted}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.from}>
              <th scope="row">
                {formatDisplay(w.from)} to {formatDisplay(w.to)}
              </th>
              <td>{w.used}</td>
              <td>{w.wasted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function InsightsPage() {
  const currency = useAuthStore((s) => s.user?.currency) ?? 'USD';
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    api.insights().then(setData, () => setError(true));
  }, [attempt]);

  const empty = data && !data.weeks.some(hasActivity);
  const showMoney = data && (data.thisWeek.pricedEntries > 0 || data.last30Days.pricedEntries > 0);

  return (
    <>
      <PageHeader title="Insights" subtitle={insightsCopy.subtitle} />
      <PageBody narrow>
        {error && (
          <LoadError
            title={insightsCopy.loadError}
            onRetry={() => {
              setError(false);
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {!data && !error && <SkeletonList />}
        {empty && (
          <EmptyState title={insightsCopy.emptyTitle}>
            {insightsCopy.emptyBody}
            <Link to="/history" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
              {insightsCopy.seeHistory}
            </Link>
          </EmptyState>
        )}
        {data && !empty && (
          <>
            <section aria-labelledby="this-week">
              <SectionTitle id="this-week">{insightsCopy.thisWeek}</SectionTitle>
              <ul className="grid grid-cols-2 gap-2">
                <Tile value={data.thisWeek.used} label={insightsCopy.used} className="bg-ok text-ok-ink" />
                <Tile value={data.thisWeek.wasted} label={insightsCopy.wasted} className="bg-past text-past-ink" />
              </ul>
              <p className="mt-3 text-sm text-muted">
                {data.thisWeek.wasteRate === null
                  ? insightsCopy.nothingFinishedThisWeek
                  : insightsCopy.rate(Math.round(data.thisWeek.wasteRate * 100))}{' '}
                {insightsCopy.lastWeek(data.lastWeek.used, data.lastWeek.wasted)}
              </p>
            </section>

            {showMoney && (
              <section aria-labelledby="money">
                <SectionTitle id="money">{insightsCopy.moneyTitle}</SectionTitle>
                <ul className="grid grid-cols-2 gap-2">
                  <Tile
                    value={formatMoney(data.thisWeek.savedValue, currency)}
                    label={insightsCopy.savedThisWeek}
                    className="bg-ok text-ok-ink"
                  />
                  <Tile
                    value={formatMoney(data.thisWeek.lostValue, currency)}
                    label={insightsCopy.lostThisWeek}
                    className="bg-past text-past-ink"
                  />
                  <Tile
                    value={formatMoney(data.last30Days.savedValue, currency)}
                    label={insightsCopy.savedMonth}
                    className="bg-calm text-calm-ink"
                  />
                  <Tile
                    value={formatMoney(data.last30Days.lostValue, currency)}
                    label={insightsCopy.lostMonth}
                    className="bg-calm text-calm-ink"
                  />
                </ul>
                <p className="mt-3 text-sm text-muted">{insightsCopy.moneyNote}</p>
              </section>
            )}

            <section aria-labelledby="weeks">
              <SectionTitle id="weeks">{insightsCopy.weeksTitle}</SectionTitle>
              <WeeksChart weeks={data.weeks} />
            </section>

            {data.topWasted.length > 0 && (
              <section aria-labelledby="top-wasted">
                <SectionTitle id="top-wasted">{insightsCopy.topWastedTitle}</SectionTitle>
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
                  {data.topWasted.map((f) => (
                    <li key={f.name} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1 break-words font-semibold">{f.name}</span>
                      {f.lostValue > 0 && (
                        <span className="text-sm text-muted">{formatMoney(f.lostValue, currency)}</span>
                      )}
                      <span className="rounded-full bg-past px-2.5 py-0.5 text-xs font-semibold text-past-ink">
                        {insightsCopy.times(f.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.tips.length > 0 && (
              <section aria-labelledby="tips">
                <SectionTitle id="tips">{insightsCopy.tipsTitle}</SectionTitle>
                <ul className="space-y-2">
                  {data.tips.map((tip) => (
                    <li key={tip.id} className="rounded-card bg-brand-soft px-4 py-3 text-ink">
                      {tip.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

import {
  useAnalyticsQuery,
  BarChart,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Alert,
  AlertDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import { num, toNum } from '../lib/governance';

const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

export function CostPage() {
  const [days, setDays] = useState(30);
  const params = useMemo(() => ({ days: sql.int(days) }), [days]);

  const byWorkload = useAnalyticsQuery('cost_by_workload', params);
  const daily = useAnalyticsQuery('cost_daily', params);
  const coverage = useAnalyticsQuery('cost_tag_coverage', params);

  const rows = useMemo(
    () =>
      (byWorkload.data ?? []).map((r) => ({
        ...r,
        dbus: toNum(r.dbus),
        list_usd: toNum(r.list_usd),
      })),
    [byWorkload.data],
  );
  const total = rows.reduce((s, r) => s + r.list_usd, 0);
  const totalDbus = rows.reduce((s, r) => s + r.dbus, 0);
  const pipeline = rows.find((r) => r.workload.startsWith('ELT pipeline'));
  const tagged = toNum((coverage.data ?? []).find((c) => c.attributed_by === 'tag')?.list_usd);

  // Long (date, workload, $) -> wide rows for a stacked bar.
  const { wide, workloads } = useMemo(() => {
    const names = new Set<string>();
    const byDate = new Map<string, Record<string, string | number>>();
    for (const r of daily.data ?? []) {
      names.add(r.workload);
      const row = byDate.get(r.usage_date) ?? { usage_date: r.usage_date };
      row[r.workload] = toNum(r.list_usd);
      byDate.set(r.usage_date, row);
    }
    const ws = [...names];
    const out = [...byDate.values()].map((row) => {
      for (const w of ws) if (row[w] === undefined) row[w] = 0;
      return row;
    });
    return { wide: out, workloads: ws };
  }, [daily.data]);

  return (
    <div className="space-y-4 max-w-[1300px] mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">What this demo costs</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every workload behind Buyer 360, from <code>system.billing.usage</code> × <code>list_prices</code> via{' '}
            <code>auc_gold.v_demo_cost</code>. List prices, before any discount.
          </p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-36" aria-label="Window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {byWorkload.error && (
        <Alert variant="destructive">
          <AlertDescription>Couldn’t load billing: {byWorkload.error}. Your identity needs SELECT on system.billing.</AlertDescription>
        </Alert>
      )}

      {byWorkload.loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label={`Total, last ${days} days`} value={usd2.format(total)} hint={`${num.format(Math.round(totalDbus))} DBUs across ${rows.length} workloads`} />
          <Kpi label="ELT pipeline (raw → gold)" value={usd2.format(pipeline?.list_usd ?? 0)} hint={`${(pipeline?.dbus ?? 0).toFixed(2)} DBUs, serverless`} />
          <Kpi label="Attributed by cost tag" value={total > 0 ? `${Math.round((tagged / total) * 100)}%` : '—'} hint="the rest by resource ID" />
          <Kpi label="Largest line" value={rows[0]?.workload ?? '—'} hint={rows[0] ? usd2.format(rows[0].list_usd) : ''} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Spend by workload</CardTitle>
            <CardDescription>List $ for the window. Badge shows how the line was attributed.</CardDescription>
          </CardHeader>
          <CardContent>
            {byWorkload.loading && <Skeleton className="h-48 w-full" />}
            {!byWorkload.loading && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No usage in this window yet; billing data lags a few hours.</p>
            )}
            {rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workload</TableHead>
                    <TableHead className="text-right">DBUs</TableHead>
                    <TableHead className="text-right">List $</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.workload}>
                      <TableCell>
                        <div className="text-sm text-foreground">{r.workload}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge variant={r.attributed_by === 'tag' ? 'secondary' : 'outline'} className="gap-1 text-[10px] px-1.5 py-0">
                            {r.attributed_by === 'tag' && <Tag className="h-3 w-3" />} {r.attributed_by}
                          </Badge>
                          <span className="text-xs text-muted-foreground">last {r.last_usage}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.dbus.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd2.format(r.list_usd)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {total > 0 ? `${Math.round((r.list_usd / total) * 100)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-base">Daily spend</CardTitle>
            <CardDescription>List $ per day, stacked by workload</CardDescription>
          </CardHeader>
          <CardContent>
            {daily.loading && <Skeleton className="h-72 w-full" />}
            {daily.error && <p className="text-sm text-destructive">{daily.error}</p>}
            {wide.length > 0 && (
              <BarChart data={wide} xKey="usage_date" yKey={workloads} stacked colorPalette="categorical" height={300} showLegend ariaLabel="Daily spend by workload" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
          <p>
            <strong className="text-foreground">How attribution works.</strong> A serverless usage policy stamps tags like{' '}
            <code>project=auctionco</code>, <code>workload=elt</code> and <code>cost_center=data-eng</code> onto every DBU the
            pipeline, app and Lakebase project consume. They land in <code>system.billing.usage.custom_tags</code>. Usage recorded
            before the policy was attached is matched by resource ID (pipeline ID, app name, Lakebase project, Genie space,
            endpoint) so nothing is lost.
          </p>
          <p>
            Apps bill per hour while running, which is why they dominate here. The pipeline only bills while it runs. Genie usage
            shows $0 because it’s on the free promotional SKU until January 2027.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

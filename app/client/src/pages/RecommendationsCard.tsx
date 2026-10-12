import {
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
} from '@databricks/appkit-ui/react';
import { Zap } from 'lucide-react';
import { usd } from '../lib/governance';
import type { RecsState } from '../lib/recs';

export function RecommendationsCard({ rows, ms, error }: RecsState) {

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Next-best lots</CardTitle>
            <CardDescription>Bid-affinity recommendations served from Lakebase Postgres</CardDescription>
          </div>
          {ms !== null && (
            <Badge variant="secondary" className="gap-1 tabular-nums">
              <Zap className="h-3.5 w-3.5" /> {ms} ms
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!rows && !error && (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No recommendations yet for this buyer: not enough bid history.</p>
        )}
        {rows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead className="text-right">Reserve</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.rec_rank}>
                  <TableCell className="text-muted-foreground">{r.rec_rank}</TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">{r.title ?? `Lot ${r.item_id}`}</div>
                    <div className="text-xs text-muted-foreground">
                      Lot {r.item_id} · {r.category}
                      {r.auction_date ? ` · closes ${r.auction_date}` : ''} · {r.reason}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{usd.format(r.reserve_price)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Computed in the lakehouse (<code>auc_gold.buyer_recommendations</code>), served as an indexed point-read
          from Lakebase <code>auction-recs</code>. Latency is measured server-side for the Postgres query alone.
        </p>
      </CardContent>
    </Card>
  );
}

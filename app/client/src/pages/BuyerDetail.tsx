import {
  useAnalyticsQuery,
  BarChart,
  LineChart,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Alert,
  AlertDescription,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { useMemo } from 'react';
import { EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { displayName, isEncrypted, isPartiallyMasked, num, piiVisible, toNum, toNumOrNull, truncateCipher, usd } from '../lib/governance';
import { PERSONAS, usePersona } from '../lib/persona';
import { RecommendationsCard } from './RecommendationsCard';
import { useRecsWithTitles } from '../lib/recs';
import { OutreachCard } from './OutreachCard';

function PiiField({ label, value, mask }: { label: string; value: string; mask: string }) {
  const enc = isEncrypted(value);
  const partial = isPartiallyMasked(value);
  const hidden = enc || partial;
  const title = enc
    ? `AES-GCM ciphertext returned by ${mask}`
    : partial
      ? `Masked to last 4 by ${mask} (partial PII tier)`
      : `Plaintext: ${mask} allowed this identity`;
  return (
    <div className="min-w-0" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm truncate flex items-center gap-1 ${hidden ? 'font-mono text-muted-foreground' : 'text-foreground'}`}>
        {enc && <Lock className="h-3 w-3 shrink-0" />}
        {partial && <EyeOff className="h-3 w-3 shrink-0" />}
        {enc ? truncateCipher(value) : value}
      </div>
      <div className="text-[10px] text-muted-foreground font-mono truncate">{mask.replace('auc_gov.', '')}</div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

export function BuyerDetail({ accountId }: { accountId: number }) {
  const params = useMemo(() => ({ accountId: sql.bigint(accountId) }), [accountId]);
  const { persona } = usePersona();
  const { data, loading, error } = useAnalyticsQuery(persona === 'me' ? 'buyer_profile' : 'buyer_profile_marketing', params);
  const recs = useRecsWithTitles(accountId);
  const row = data?.[0];
  const p = useMemo(
    () =>
      row && {
        ...row,
        account_id: toNum(row.account_id),
        buyer_rating: toNum(row.buyer_rating),
        total_bids: toNum(row.total_bids),
        bids_30d: toNumOrNull(row.bids_30d),
        lots_bid: toNumOrNull(row.lots_bid),
        bid_value: toNumOrNull(row.bid_value),
        max_bid: toNumOrNull(row.max_bid),
      },
    [row],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Couldn’t load buyer #{accountId}: {error}</AlertDescription>
      </Alert>
    );
  }
  if (!p) {
    return (
      <Alert>
        <AlertDescription>Buyer #{accountId} isn’t visible to you.</AlertDescription>
      </Alert>
    );
  }

  const visible = piiVisible(p.email);
  const partialTier = isPartiallyMasked(p.phone) || isPartiallyMasked(p.tax_id);
  const lastBid = p.last_bid_ts ? new Date(p.last_bid_ts).toLocaleDateString() : '—';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                {!visible && <Lock className="h-4 w-4 text-muted-foreground" />}
                {displayName(p.first_name, p.last_name, p.email)}
              </CardTitle>
              <CardDescription>
                Account #{p.account_id} · {p.account_type} · {p.state} · buyer rating {p.buyer_rating.toFixed(1)} / 5
              </CardDescription>
            </div>
            {visible && partialTier ? (
              <Badge variant="outline" className="gap-1">
                <EyeOff className="h-3.5 w-3.5" /> Partial PII: phone and tax ID masked for this identity
              </Badge>
            ) : visible ? (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> Full PII: this identity is on the data-team allowlist
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3.5 w-3.5" /> PII encrypted for your identity
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <PiiField label="First name" value={p.first_name} mask="auc_gov.enc_pii" />
            <PiiField label="Last name" value={p.last_name} mask="auc_gov.enc_pii" />
            <PiiField label="Email" value={p.email} mask="auc_gov.enc_pii" />
            <PiiField label="Phone" value={p.phone} mask="auc_gov.mask_last4" />
            <PiiField label="Tax ID" value={p.tax_id} mask="auc_gov.mask_last4" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Masked at read time by Unity Catalog column masks on <code>auc_silver.dim_account</code>: <code>enc_pii</code> on
            names and email, <code>mask_last4</code> on phone and tax ID. This query ran as{' '}
            <strong className="text-foreground">{PERSONAS[persona].identity}</strong> ({PERSONAS[persona].tier}), so what you
            see is exactly what UC grants that identity. Same table, same view, no PII-stripped copy.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Bids (demo window)" value={num.format(p.bids_30d ?? 0)} hint={`across ${num.format(p.lots_bid ?? 0)} lots`} />
        <Kpi label="Total bid value" value={usd.format(p.bid_value ?? 0)} hint="sum of bid amounts" />
        <Kpi label="Largest bid" value={usd.format(p.max_bid ?? 0)} hint={`top category: ${p.top_category ?? '—'}`} />
        <Kpi label="Last active" value={lastBid} hint={`prefers ${p.top_channel ?? '—'} bidding`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-base">Where their attention goes</CardTitle>
            <CardDescription>Bids by equipment category · auc_gold.fact_bids</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              queryKey="buyer_categories"
              parameters={params}
              xKey="category"
              yKey="bids"
              orientation="horizontal"
              colorPalette="categorical"
              height={260}
              ariaLabel="Bids by category"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-base">Bidding activity</CardTitle>
            <CardDescription>Bids per day · auc_gold.fact_bids</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart
              queryKey="buyer_daily"
              parameters={params}
              xKey="bid_date"
              yKey="bids"
              showSymbol
              height={260}
              ariaLabel="Bids per day"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RecommendationsCard {...recs} />
        <OutreachCard key={accountId} profile={p} recs={recs.rows} />
      </div>
    </div>
  );
}

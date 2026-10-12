import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { useEffect, useMemo, useState } from 'react';

export interface Rec {
  rec_rank: number;
  item_id: number;
  category: string;
  reserve_price: number;
  affinity_bids: number;
  reason: string;
  title?: string;
  auction_date?: string;
}

interface RecsResponse {
  rows: Rec[];
  ms: number;
}

function isRecsResponse(v: unknown): v is RecsResponse {
  return typeof v === 'object' && v !== null && Array.isArray((v as RecsResponse).rows);
}

function useLakebaseRecs(accountId: number) {
  const [state, setState] = useState<{ rows: Rec[] | null; ms: number | null; error: string | null }>({
    rows: null,
    ms: null,
    error: null,
  });
  useEffect(() => {
    // BuyerDetail is keyed by accountId, so this hook remounts per buyer.
    let cancelled = false;
    fetch(`/api/recs/${accountId}`)
      .then(async (r) => {
        const body: unknown = await r.json();
        if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText);
        if (!isRecsResponse(body)) throw new Error('Unexpected response');
        if (!cancelled) setState({ rows: body.rows, ms: body.ms, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ rows: null, ms: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return state;
}

export function useRecsWithTitles(accountId: number) {
  const recs = useLakebaseRecs(accountId);
  const params = useMemo(() => ({ accountId: sql.bigint(accountId) }), [accountId]);
  const { data: lots } = useAnalyticsQuery('rec_lots', params);
  const rows = useMemo(() => {
    if (!recs.rows) return null;
    const byId = new Map((lots ?? []).map((l) => [Number(l.item_id), l]));
    return recs.rows.map((r) => ({
      ...r,
      rec_rank: Number(r.rec_rank),
      item_id: Number(r.item_id),
      affinity_bids: Number(r.affinity_bids),
      reserve_price: Number(r.reserve_price),
      title: byId.get(Number(r.item_id))?.title,
      auction_date: byId.get(Number(r.item_id))?.auction_date,
    }));
  }, [recs.rows, lots]);
  return { rows, ms: recs.ms, error: recs.error };
}

export type RecsState = ReturnType<typeof useRecsWithTitles>;

import {
  useAnalyticsQuery,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Alert,
  AlertDescription,
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { useEffect, useMemo, useState } from 'react';
import { Lock, Search } from 'lucide-react';
import { displayName, num, piiVisible, toNum } from '../lib/governance';
import { usePersona } from '../lib/persona';

export function BuyerList({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');

  // Debounce so every keystroke doesn’t hit the warehouse.
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const params = useMemo(() => ({ search: sql.string(search) }), [search]);
  const { persona } = usePersona();
  const { data: raw, loading, error } = useAnalyticsQuery(persona === 'me' ? 'buyers' : 'buyers_marketing', params);
  const data = useMemo(
    () =>
      raw?.map((b) => ({
        ...b,
        account_id: toNum(b.account_id),
        total_bids: toNum(b.total_bids),
        buyer_rating: toNum(b.buyer_rating),
      })),
    [raw],
  );

  useEffect(() => {
    if (selectedId === null && data && data.length > 0) onSelect(data[0].account_id);
  }, [data, selectedId, onSelect]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Active buyers</CardTitle>
        <CardDescription>Top 25 by bid volume · auc_gold.v_account_360</CardDescription>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Name, account ID, or state (e.g. KS)"
            className="pl-8"
            aria-label="Search buyers"
          />
        </div>
      </CardHeader>
      <CardContent className="px-2">
        {loading && (
          <div className="space-y-2 px-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t load buyers: {error}</AlertDescription>
          </Alert>
        )}
        {data && data.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No buyers match</EmptyTitle>
              <EmptyDescription>
                Try an account ID or a state code. Name search only works on plaintext PII, so
                encrypted viewers can’t search by name.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {data && data.length > 0 && (
          <ul className="max-h-[calc(100vh-260px)] overflow-y-auto">
            {data.map((b) => {
              const visible = piiVisible(b.email);
              const active = b.account_id === selectedId;
              return (
                <li key={b.account_id}>
                  <button
                    type="button"
                    onClick={() => onSelect(b.account_id)}
                    className={`w-full text-left rounded-md px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                      active ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                        {!visible && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        {displayName(b.first_name, b.last_name, b.email)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        #{b.account_id} · {b.state} · {b.account_type}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm tabular-nums text-foreground">{num.format(b.total_bids)}</div>
                      <div className="text-xs text-muted-foreground">bids</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import { Application } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

// Recommendations are computed in the lakehouse (auc_gold.buyer_recommendations)
// and served from Lakebase Postgres as an indexed point-read on account_id.
const RECS_SQL = `
  SELECT rec_rank, item_id, category, reserve_price, affinity_bids, reason
  FROM public.buyer_recommendations
  WHERE account_id = $1
  ORDER BY rec_rank`;

export function setupBuyerRoutes(appkit: AppKitWithLakebase) {
  appkit.server.extend((app) => {
    app.get('/api/whoami', (req, res) => {
      res.json({
        email: req.header('x-forwarded-email') ?? null,
        user: req.header('x-forwarded-user') ?? null,
      });
    });

    app.get('/api/recs/:accountId', async (req, res) => {
      const accountId = Number(req.params.accountId);
      if (!Number.isInteger(accountId) || accountId <= 0) {
        res.status(400).json({ error: 'accountId must be a positive integer' });
        return;
      }
      try {
        const started = performance.now();
        const result = await appkit.lakebase.query(RECS_SQL, [accountId]);
        const ms = Math.round((performance.now() - started) * 10) / 10;
        res.json({ rows: result.rows, ms });
      } catch (err) {
        console.error('Lakebase recs lookup failed:', err);
        res.status(500).json({ error: `Lakebase lookup failed: ${(err as Error).message}` });
      }
    });
  });
}

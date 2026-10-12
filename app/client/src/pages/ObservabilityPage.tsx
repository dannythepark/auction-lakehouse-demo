import {
  useAnalyticsQuery,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import type { ReactNode } from 'react';
import { CheckCircle2, EyeOff, Lock, ShieldCheck, XCircle } from 'lucide-react';
import { num, toNum } from '../lib/governance';

function Panel({
  title,
  description,
  source,
  loading,
  error,
  empty,
  children,
}: {
  title: string;
  description: string;
  source: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <Skeleton className="h-32 w-full" />}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && empty && <p className="text-sm text-muted-foreground">No events in this window yet.</p>}
        {!loading && !error && !empty && children}
        <p className="text-[11px] text-muted-foreground mt-3 font-mono">{source}</p>
      </CardContent>
    </Card>
  );
}

const shortId = (p: string) => (p.includes('@') ? p : `${p.slice(0, 8)}…`);

export function ObservabilityPage() {
  const dq = useAnalyticsQuery('obs_data_quality', {});
  const runs = useAnalyticsQuery('obs_pipeline_runs', {});
  const pii = useAnalyticsQuery('obs_pii_access', {});
  const surfaces = useAnalyticsQuery('obs_ai_surfaces', {});
  const llm = useAnalyticsQuery('obs_llm_usage', {});

  return (
    <div className="space-y-4 max-w-[1300px] mx-auto">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Observability: close the loop</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Is the data right, who touched the PII, and what did the AI do with it? Every panel is a query over the pipeline event
          log or Unity Catalog system tables. There’s no separate monitoring stack to run.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel
          title="Data quality gates"
          description="Latest result of each pipeline expectation (the dbt-test equivalent, enforced on write)"
          source="auc_gold.event_log_<pipeline_id> · event_type = flow_progress"
          loading={dq.loading}
          error={dq.error}
          empty={(dq.data ?? []).length === 0}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dataset · expectation</TableHead>
                <TableHead className="text-right">Passed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(dq.data ?? []).map((r) => {
                const failed = toNum(r.failed_records);
                return (
                  <TableRow key={`${r.dataset}-${r.expectation}`}>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-foreground">
                        {failed === 0 ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        {r.expectation}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.dataset} · {r.evaluated_at.slice(0, 16)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num.format(toNum(r.passed_records))}</TableCell>
                    <TableCell className={`text-right tabular-nums ${failed > 0 ? 'text-destructive' : ''}`}>{num.format(failed)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Pipeline runs"
          description="auc_demo_elt updates: outcome and wall-clock duration"
          source="auc_gold.event_log_<pipeline_id> · event_type = update_progress"
          loading={runs.loading}
          error={runs.error}
          empty={(runs.data ?? []).length === 0}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs.data ?? []).map((r) => (
                <TableRow key={r.update_id}>
                  <TableCell className="text-sm">{r.started_at.slice(0, 16)}</TableCell>
                  <TableCell>
                    <Badge variant={r.final_state === 'COMPLETED' ? 'secondary' : 'outline'}>{r.final_state}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{toNum(r.duration_s)} s</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="PII exposure audit"
          description="Every principal that read governed account data, and what the mask returned to them"
          source="system.access.table_lineage ⋈ auc_gov.pii_authorized"
          loading={pii.loading}
          error={pii.error}
          empty={(pii.data ?? []).length === 0}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Principal</TableHead>
                <TableHead>Saw</TableHead>
                <TableHead className="text-right">Reads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pii.data ?? []).map((r) => (
                <TableRow key={r.principal}>
                  <TableCell>
                    <div className="text-sm text-foreground">{r.principal_type}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {shortId(r.principal)} · last {r.last_read.slice(0, 16)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.pii_result === 'plaintext' ? (
                      <Badge variant="secondary" className="gap-1">
                        <ShieldCheck className="h-3 w-3" /> plaintext
                      </Badge>
                    ) : r.pii_result === 'partial' ? (
                      <Badge variant="outline" className="gap-1">
                        <EyeOff className="h-3 w-3" /> partial (last 4)
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <Lock className="h-3 w-3" /> ciphertext
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{toNum(r.reads)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Who queried governed data, and through what"
          description="Demo surfaces in the last 30 days: Genie, this app, and the persona service principals"
          source="system.query.history · query_source.genie_space_id, client_application"
          loading={surfaces.loading}
          error={surfaces.error}
          empty={(surfaces.data ?? []).length === 0}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surface</TableHead>
                <TableHead className="text-right">Queries</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(surfaces.data ?? []).map((r) => (
                <TableRow key={r.surface}>
                  <TableCell>
                    <div className="text-sm text-foreground">{r.surface}</div>
                    <div className="text-xs text-muted-foreground">last {r.last_query.slice(0, 16)}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{num.format(toNum(r.queries))}</TableCell>
                  <TableCell className="text-right tabular-nums">{num.format(toNum(r.p50_ms))} ms</TableCell>
                  <TableCell className="text-right tabular-nums">{toNum(r.failed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>

      <Panel
        title="What the LLM did"
        description="Calls to databricks-claude-sonnet-5 through the governed serving endpoint (Buyer 360 outreach + notebooks)"
        source="system.serving.endpoint_usage ⋈ system.serving.served_entities"
        loading={llm.loading}
        error={llm.error}
        empty={(llm.data ?? []).length === 0}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requester</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Input tokens</TableHead>
              <TableHead className="text-right">Output tokens</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead className="text-right">Last call</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(llm.data ?? []).map((r) => (
              <TableRow key={r.requester}>
                <TableCell className="font-mono text-xs">{shortId(r.requester)}</TableCell>
                <TableCell className="text-right tabular-nums">{num.format(toNum(r.requests))}</TableCell>
                <TableCell className="text-right tabular-nums">{num.format(toNum(r.input_tokens))}</TableCell>
                <TableCell className="text-right tabular-nums">{num.format(toNum(r.output_tokens))}</TableCell>
                <TableCell className="text-right tabular-nums">{toNum(r.errors)}</TableCell>
                <TableCell className="text-right text-xs">{r.last_request.slice(0, 16)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-2">
          The app calls the model on-behalf-of the signed-in user, so each request is attributed to a person, not a shared key.
          Turn on AI Gateway inference tables to also capture the full prompt and response for review.
        </p>
      </Panel>
    </div>
  );
}

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  GenieChat,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { PERSONAS, usePersona } from '../lib/persona';
import { PiiCell } from '../components/PiiCell';

const SUGGESTED = [
  'Show the top 5 accounts by total bids with their name, email, phone and tax ID',
  'What is total GMV by equipment category?',
  'Which 5 buyers in Kansas bid the most? Include their phone numbers.',
];

interface GenieAnswer {
  text: string[];
  sql: string | null;
  columns: string[];
  rows: (string | null)[][];
  error: string | null;
  ranAs: string;
}

function isAnswer(v: unknown): v is GenieAnswer {
  return typeof v === 'object' && v !== null && Array.isArray((v as GenieAnswer).rows);
}

// Viewing as the Marketing rep: ask the same Genie space as the app's service principal.
function MarketingGenie() {
  const [question, setQuestion] = useState(SUGGESTED[0]);
  const [answer, setAnswer] = useState<GenieAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    setQuestion(q);
    setBusy(true);
    setAnswer(null);
    setError(null);
    try {
      const r = await fetch('/api/genie/as-marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: q }),
      });
      const body: unknown = await r.json();
      if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText);
      if (!isAnswer(body)) throw new Error('Unexpected response');
      setAnswer(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Ask as the Marketing rep
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) void ask(question.trim());
          }}
        >
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question for Genie" />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Asking…' : 'Ask'}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((q) => (
            <Button key={q} type="button" variant="outline" size="sm" onClick={() => void ask(q)} disabled={busy}>
              {q}
            </Button>
          ))}
        </div>

        {busy && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {answer && (
          <div className="space-y-3">
            {answer.text.length > 0 && <p className="text-sm text-foreground">{answer.text.join(' ')}</p>}
            {answer.error && <p className="text-sm text-destructive">{answer.error}</p>}
            {answer.rows.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {answer.columns.map((c) => (
                        <TableHead key={c}>{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {answer.rows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((v, j) => (
                          <TableCell key={j} className="text-sm">
                            <PiiCell value={v} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {answer.sql && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">SQL Genie generated</summary>
                <pre className="mt-2 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{answer.sql}</pre>
              </details>
            )}
            <div className="flex items-center gap-2">
              <Badge variant="outline">AI-generated</Badge>
              <span className="text-xs text-muted-foreground">Ran as {answer.ranAs}. Check the SQL before trusting a number.</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AskPage() {
  const { persona } = usePersona();
  return (
    <div className="space-y-4 w-full max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Ask the auction data</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Genie space “AuctionCo Auction Analytics” over the masked account view, the bid fact table and the
          <code> metrics_auction</code> metric view.
        </p>
      </div>
      <div className="flex items-start gap-2 rounded-md border p-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
        <span>
          Genie runs the SQL as <strong className="text-foreground">{PERSONAS[persona].label}</strong> (
          {PERSONAS[persona].identity}), so the same Unity Catalog masks decide what comes back.{' '}
          {persona === 'me'
            ? 'Switch View as → Marketing rep to ask the same questions as a marketer.'
            : 'Names and emails come through; phone numbers and tax IDs come back as the last 4 digits.'}
        </span>
      </div>
      {persona === 'me' ? (
        <div className="h-[min(640px,70vh)] border rounded-lg overflow-hidden">
          <GenieChat alias="default" />
        </div>
      ) : (
        <MarketingGenie />
      )}
    </div>
  );
}

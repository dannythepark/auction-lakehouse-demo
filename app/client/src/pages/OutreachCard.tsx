import {
  useServingInvoke,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Alert,
  AlertDescription,
  Separator,
} from '@databricks/appkit-ui/react';
import { useMemo, useState } from 'react';
import { Copy, Lock, Sparkles } from 'lucide-react';
import { piiVisible, usd } from '../lib/governance';
import type { Rec } from '../lib/recs';

interface Profile {
  account_id: number;
  first_name: string;
  last_name: string;
  email: string;
  state: string;
  account_type: string;
  buyer_rating: number;
  bids_30d: number | null;
  lots_bid: number | null;
  max_bid: number | null;
  top_category: string | null;
  top_channel: string | null;
  last_bid_ts: string | null;
}

interface Draft {
  buyer_summary: string;
  next_best_action: string;
  subject: string;
  body: string;
}

function parseDraft(content: string): Draft | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const d: unknown = JSON.parse(match[0]);
    if (typeof d !== 'object' || d === null) return null;
    const o = d as Record<string, unknown>;
    if (typeof o.subject !== 'string' || typeof o.body !== 'string') return null;
    return {
      buyer_summary: typeof o.buyer_summary === 'string' ? o.buyer_summary : '',
      next_best_action: typeof o.next_best_action === 'string' ? o.next_best_action : '',
      subject: o.subject,
      body: o.body,
    };
  } catch {
    return null;
  }
}

function extractContent(data: unknown): string {
  const choices = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        const text = typeof c === 'object' && c !== null ? (c as { text?: unknown }).text : undefined;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return '';
}

// Build the model context ONLY from what the viewer’s governed query returned.
// If UC handed this viewer ciphertext, the model gets a merge tag instead: it
// never sees the plaintext, and it never gets ciphertext it could echo back.
function buildContext(p: Profile, recs: Rec[]) {
  const visible = piiVisible(p.email);
  const facts: [string, string][] = [
    ['first_name', visible ? p.first_name : '{{first_name}} (encrypted for this viewer — use merge tag)'],
    ['account_type', p.account_type],
    ['home_state', p.state],
    ['buyer_rating_of_5', p.buyer_rating.toFixed(1)],
    ['bids_in_window', String(p.bids_30d ?? 0)],
    ['distinct_lots_bid', String(p.lots_bid ?? 0)],
    ['largest_bid_usd', usd.format(p.max_bid ?? 0)],
    ['top_category', p.top_category ?? 'unknown'],
    ['preferred_channel', p.top_channel ?? 'unknown'],
    ['last_active', p.last_bid_ts ? new Date(p.last_bid_ts).toDateString() : 'unknown'],
  ];
  const lots = recs.slice(0, 5).map(
    (r) =>
      `- Lot ${r.item_id}: ${r.title ?? r.category} (${r.category}), reserve ${usd.format(r.reserve_price)}` +
      (r.auction_date ? `, closes ${r.auction_date}` : '') +
      `. Why: ${r.reason}`,
  );
  return { visible, facts, lots };
}

const SYSTEM = `You are a marketing copilot for AuctionCo, an online heavy-equipment and ag auction company.
Write for real buyers: farmers, contractors, fleet managers. Plain, specific, no hype, no emojis.
Rules:
- Use ONLY the facts provided. Never invent prices, lots, dates, or personal details.
- If a field says to use a merge tag, write the merge tag literally (e.g. {{first_name}}).
- Never include email addresses, phone numbers, or tax IDs.
- Reference 2-3 of the recommended lots by lot number and title.
Return ONLY strict JSON with keys:
"buyer_summary" (1 sentence on who this buyer is and what they want),
"next_best_action" (1 sentence for the account rep),
"subject" (email subject, <= 70 chars),
"body" (email body, <= 140 words, sign off as "The AuctionCo team").`;

export function OutreachCard({ profile, recs }: { profile: Profile; recs: Rec[] | null }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { invoke, loading, error } = useServingInvoke({ messages: [] });

  const ctx = useMemo(() => buildContext(profile, recs ?? []), [profile, recs]);

  function generate() {
    setDraft(null);
    setRaw(null);
    const user =
      `Buyer facts:\n${ctx.facts.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n` +
      `Recommended lots (from Lakebase):\n${ctx.lots.join('\n') || '- none'}\n\n` +
      `Write the outreach.`;
    void invoke({
      messages: [{ role: 'user', content: `${SYSTEM}\n\n${user}` }],
      max_tokens: 700,
    }).then((result) => {
      if (!result) return;
      const content = extractContent(result);
      const d = parseDraft(content);
      if (d) setDraft(d);
      else setRaw(content || JSON.stringify(result));
    });
  }

  function copy() {
    if (!draft) return;
    void navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> AI outreach
            </CardTitle>
            <CardDescription>Personalized email + rep guidance · databricks-claude-sonnet-5</CardDescription>
          </div>
          <Button size="sm" onClick={generate} disabled={loading || recs === null}>
            {loading ? 'Drafting…' : draft ? 'Regenerate' : 'Draft outreach'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ctx.visible && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              PII is encrypted for you, so the model receives <code>{'{{first_name}}'}</code> instead of the name. The
              AI physically can’t leak what Unity Catalog hides.
            </AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>Model call failed: {error}</AlertDescription>
          </Alert>
        )}

        {draft && (
          <div className="space-y-3">
            <div className="grid gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Who this buyer is</div>
                <p className="text-sm text-foreground">{draft.buyer_summary}</p>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Next best action for the rep</div>
                <p className="text-sm text-foreground">{draft.next_best_action}</p>
              </div>
            </div>
            <Separator />
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">{draft.subject}</div>
                <Button size="sm" variant="ghost" onClick={copy} aria-label="Copy email">
                  <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-2">{draft.body}</p>
            </div>
          </div>
        )}
        {raw && <p className="text-sm whitespace-pre-wrap text-foreground">{raw}</p>}

        {!draft && !raw && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            Drafts a just-in-time email from this buyer’s bid behavior and their Lakebase recommendations.
          </p>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">What the model was given ({ctx.facts.length} governed fields)</summary>
          <ul className="mt-2 space-y-0.5 font-mono">
            {ctx.facts.map(([k, v]) => (
              <li key={k}>
                {k}: {v}
              </li>
            ))}
          </ul>
          <p className="mt-1">No email, phone, or tax ID is ever sent to the model.</p>
        </details>
        <div className="flex items-center gap-2">
          <Badge variant="outline">AI-generated</Badge>
          <span className="text-xs text-muted-foreground">Review before sending. Grounded only in the fields above.</span>
        </div>
      </CardContent>
    </Card>
  );
}

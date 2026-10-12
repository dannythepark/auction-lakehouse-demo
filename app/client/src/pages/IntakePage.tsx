import {
  useAnalyticsQuery,
  Alert,
  AlertDescription,
  Badge,
  Button,
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
import { sql } from '@databricks/appkit-ui/js';
import { useMemo, useRef, useState } from 'react';
import { Camera, Sparkles, Upload } from 'lucide-react';
import { num, piiVisible, toNum, usd } from '../lib/governance';
import { PiiCell } from '../components/PiiCell';
import { PERSONAS, usePersona } from '../lib/persona';

const SAMPLES = [
  { file: 'john_deere_8r_370_tractor.jpg', label: 'Tractor' },
  { file: 'komatsu_pc210_excavator.jpg', label: 'Excavator' },
  { file: 'bobcat_s650_skid_steer.jpg', label: 'Skid steer' },
  { file: 'freightliner_cascadia_semi.jpg', label: 'Semi truck' },
  { file: 'combine_harvester.jpg', label: 'Combine' },
];

interface Appraisal {
  category: string;
  make?: string;
  model?: string;
  year_estimate?: string;
  condition_1to5?: number;
  notable_damage?: string;
  estimated_value_low_usd?: number;
  estimated_value_high_usd?: number;
  listing_title?: string;
  listing_description?: string;
  confidence?: string;
}

interface AppraiseResponse {
  appraisal: Appraisal;
  ms: number;
  endpoint: string;
}

function isAppraiseResponse(v: unknown): v is AppraiseResponse {
  return typeof v === 'object' && v !== null && typeof (v as AppraiseResponse).appraisal === 'object';
}

// Downsize in the browser so uploads are small and the model call is fast.
async function toJpegBase64(blob: Blob, maxSide = 1280): Promise<{ dataUrl: string; base64: string }> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground truncate">{value}</div>
    </div>
  );
}

function MarketPanels({ category }: { category: string }) {
  const { persona } = usePersona();
  const params = useMemo(() => ({ category: sql.string(category) }), [category]);
  const comps = useAnalyticsQuery('category_comps', params);
  const buyers = useAnalyticsQuery(persona === 'me' ? 'category_buyers' : 'category_buyers_marketing', params);
  const c = comps.data?.[0];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">What your auctions say about {category.toLowerCase()}s</CardTitle>
          <CardDescription>Your own bid history · auc_gold.fact_bids</CardDescription>
        </CardHeader>
        <CardContent>
          {comps.loading && <Skeleton className="h-24 w-full" />}
          {comps.error && <p className="text-sm text-destructive">{comps.error}</p>}
          {c && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="Lots" value={num.format(toNum(c.lots))} />
              <Field label="Bids" value={num.format(toNum(c.bids))} />
              <Field label="Active bidders" value={num.format(toNum(c.active_bidders))} />
              <Field label="Average bid" value={usd.format(toNum(c.avg_bid))} />
              <Field label="90th percentile bid" value={usd.format(toNum(c.p90_bid))} />
              <Field label="Average reserve" value={usd.format(toNum(c.avg_reserve))} />
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Use this to sanity-check the AI estimate against what your bidders actually pay.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Buyers to notify when it lists</CardTitle>
          <CardDescription>
            Most active bidders in this category · viewing as {PERSONAS[persona].label}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {buyers.loading && <Skeleton className="h-32 w-full" />}
          {buyers.error && <p className="text-sm text-destructive">{buyers.error}</p>}
          {buyers.data && buyers.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Bids here</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.data.map((b) => (
                  <TableRow key={String(b.account_id)}>
                    <TableCell>
                      <div className="text-sm">
                        {piiVisible(b.email) ? `${b.first_name} ${b.last_name}` : <PiiCell value={b.first_name} />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        #{String(b.account_id)} · {b.state}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <PiiCell value={b.phone} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num.format(toNum(b.bids_in_category))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Contact details come through the same Unity Catalog masks as everywhere else. Switch <strong>View as</strong> to
            see them change.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function IntakePage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [result, setResult] = useState<AppraiseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(blob: Blob, name: string) {
    setResult(null);
    setError(null);
    try {
      const { dataUrl, base64: b64 } = await toJpegBase64(blob);
      setPreview(dataUrl);
      setBase64(b64);
      setSource(name);
    } catch (e) {
      setError(`Couldn’t read that image: ${(e as Error).message}`);
    }
  }

  async function pickSample(file: string) {
    const r = await fetch(`/samples/${file}`);
    await load(await r.blob(), file);
  }

  async function appraise() {
    if (!base64) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/appraise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: 'image/jpeg' }),
      });
      const body: unknown = await r.json();
      if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText);
      if (!isAppraiseResponse(body)) throw new Error('Unexpected response');
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const a = result?.appraisal;
  const low = toNum(a?.estimated_value_low_usd);
  const high = toNum(a?.estimated_value_high_usd);

  return (
    <div className="space-y-4 max-w-[1300px] mx-auto">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Lot intake: appraise from a photo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          A seller sends a photo. AI fills in the asset details and a value range, then your own auction history and bidders
          take it from there.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" /> Photo
            </CardTitle>
            <CardDescription>Upload one, or use a sample</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="rounded-lg border border-dashed aspect-[4/3] flex items-center justify-center overflow-hidden bg-muted/30 cursor-pointer"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void load(f, f.name);
              }}
            >
              {preview ? (
                <img src={preview} alt="Equipment to appraise" className="w-full h-full object-contain" />
              ) : (
                <div className="text-center text-sm text-muted-foreground px-4">
                  <Upload className="h-6 w-6 mx-auto mb-2" />
                  Drop a photo here or click to upload
                </div>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Upload equipment photo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void load(f, f.name);
              }}
            />
            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.file}
                  type="button"
                  onClick={() => void pickSample(s.file)}
                  className={`rounded-md border overflow-hidden w-16 h-12 ${source === s.file ? 'ring-2 ring-primary' : ''}`}
                  title={`Sample: ${s.label}`}
                >
                  <img src={`/samples/${s.file}`} alt={s.label} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            <Button className="w-full" onClick={() => void appraise()} disabled={!base64 || busy}>
              <Sparkles className="h-4 w-4" /> {busy ? 'Appraising…' : 'Appraise'}
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">AI appraisal</CardTitle>
                <CardDescription>
                  {result ? `${result.endpoint} · ${(result.ms / 1000).toFixed(1)} s · ran as you` : 'Multimodal model on a governed serving endpoint'}
                </CardDescription>
              </div>
              {a?.confidence && <Badge variant="outline">confidence: {a.confidence}</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {busy && (
              <div className="space-y-2">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
            {!busy && !a && (
              <p className="text-sm text-muted-foreground">Pick a photo and click Appraise.</p>
            )}
            {a && (
              <div className="space-y-4">
                <div>
                  <Badge variant="secondary">{a.category}</Badge>
                  <div className="text-xl font-semibold text-foreground mt-2">
                    {[a.make, a.model].filter(Boolean).join(' ') || 'Unidentified equipment'}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-foreground mt-1">
                    {low && high ? `${usd.format(low)} – ${usd.format(high)}` : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">estimated auction value</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Field label="Year (est.)" value={a.year_estimate ?? '—'} />
                  <Field label="Condition" value={a.condition_1to5 ? `${a.condition_1to5} / 5` : '—'} />
                  <Field label="Notable damage" value={a.notable_damage ?? '—'} />
                </div>
                <div className="rounded-md border bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">Draft listing</div>
                  <div className="text-sm font-medium text-foreground mt-1">{a.listing_title}</div>
                  <p className="text-sm text-foreground mt-1">{a.listing_description}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  AI-generated first pass from the photo only. A specialist confirms before listing.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {a && <MarketPanels category={a.category} />}
    </div>
  );
}

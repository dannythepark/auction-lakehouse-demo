import { Application, Request } from 'express';

interface AppKitWithServer {
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

// The categories AuctionCo's auction data uses, so an appraisal lines up with gold.
export const CATEGORIES = ['Tractor', 'Dump Truck', 'Excavator', 'Trailer', 'Skid Steer', 'Combine', 'Loader', 'Semi Truck'];

const PROMPT = `You are a heavy-equipment appraiser for AuctionCo, an online equipment auction company.
Look at the photo and return ONLY strict JSON with these keys:
"category" (exactly one of: ${CATEGORIES.join(', ')}; pick the closest),
"make" (string), "model" (string, best guess), "year_estimate" (string, e.g. "2015-2018"),
"condition_1to5" (integer, 5 = excellent),
"notable_damage" (string, "none visible" if none),
"estimated_value_low_usd" (integer), "estimated_value_high_usd" (integer),
"listing_title" (string, <= 70 chars),
"listing_description" (string, 2 sentences, factual, no hype),
"confidence" ("low" | "medium" | "high").
Only describe what is visible. Do not invent hours, serial numbers or ownership history.`;

interface AppraiseBody {
  imageBase64?: unknown;
  mediaType?: unknown;
}

function workspaceHost(): string {
  const h = process.env.DATABRICKS_HOST ?? '';
  return h.startsWith('http') ? h.replace(/\/$/, '') : `https://${h}`;
}

function userToken(req: Request): string | undefined {
  const t = req.header('x-forwarded-access-token');
  return t && t.length > 0 ? t : undefined;
}

export function setupAppraiseRoutes(appkit: AppKitWithServer) {
  appkit.server.extend((app) => {
    app.post('/api/appraise', async (req, res) => {
      const body = req.body as AppraiseBody;
      const image = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
      const mediaType = typeof body.mediaType === 'string' && body.mediaType.startsWith('image/') ? body.mediaType : 'image/jpeg';
      if (image.length < 100) {
        res.status(400).json({ error: 'imageBase64 is required' });
        return;
      }
      // Call the model on-behalf-of the signed-in user (serving.serving-endpoints user scope),
      // so the request is governed and attributed to the person, not the app.
      const token = userToken(req);
      if (!token) {
        res.status(401).json({ error: 'No user token: open the app through Databricks Apps to appraise.' });
        return;
      }
      const endpoint = process.env.DATABRICKS_SERVING_ENDPOINT_NAME ?? 'databricks-claude-sonnet-5';
      const started = performance.now();
      try {
        const r = await fetch(`${workspaceHost()}/serving-endpoints/${endpoint}/invocations`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            max_tokens: 600,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: PROMPT },
                  { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
                ],
              },
            ],
          }),
        });
        const payload = (await r.json()) as { choices?: { message?: { content?: unknown } }[]; message?: string };
        if (!r.ok) {
          res.status(r.status).json({ error: payload.message ?? `Model call failed (${r.status})` });
          return;
        }
        const content = payload.choices?.[0]?.message?.content;
        const text = typeof content === 'string' ? content : '';
        const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
        let appraisal: Record<string, unknown>;
        try {
          appraisal = JSON.parse(json) as Record<string, unknown>;
        } catch {
          res.status(502).json({ error: 'The model did not return valid JSON', raw: text });
          return;
        }
        if (typeof appraisal.category !== 'string' || !CATEGORIES.includes(appraisal.category)) {
          appraisal.category = 'Tractor';
          appraisal.category_note = 'Model returned an unknown category; defaulted for comparison.';
        }
        res.json({ appraisal, ms: Math.round(performance.now() - started), endpoint });
      } catch (err) {
        console.error('Appraisal failed:', err);
        res.status(500).json({ error: `Appraisal failed: ${(err as Error).message}` });
      }
    });
  });
}

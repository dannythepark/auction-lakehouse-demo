import { Application } from 'express';

// The genie plugin's HTTP routes always run on-behalf-of the signed-in user. Its
// programmatic sendMessage() runs as the app's service principal, which is the
// "Marketing rep" persona (auc_gov.pii_partial tier). That lets the Ask Genie page
// show what a marketer gets back from the same Genie space.
interface GenieEvent {
  type: string;
  message?: {
    content?: string;
    error?: string;
    attachments?: { query?: { query?: string; description?: string }; text?: { content?: string } }[];
  };
  data?: {
    manifest?: { schema?: { columns?: { name: string }[] } };
    result?: { data_array?: (string | null)[][] };
  };
  error?: string;
}

interface AppKitWithGenie {
  genie: {
    sendMessage(alias: string, content: string, conversationId?: string, options?: { timeout?: number }): AsyncIterable<GenieEvent>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

export function setupGeniePersonaRoutes(appkit: AppKitWithGenie) {
  appkit.server.extend((app) => {
    app.post('/api/genie/as-marketing', async (req, res) => {
      const content = typeof (req.body as { content?: unknown }).content === 'string' ? (req.body as { content: string }).content.trim() : '';
      if (!content) {
        res.status(400).json({ error: 'content is required' });
        return;
      }
      const out: { text: string[]; sql: string | null; columns: string[]; rows: (string | null)[][]; error: string | null } = {
        text: [],
        sql: null,
        columns: [],
        rows: [],
        error: null,
      };
      try {
        for await (const ev of appkit.genie.sendMessage('default', content, undefined, { timeout: 120000 })) {
          if (ev.type === 'message_result' && ev.message) {
            if (ev.message.content) out.text.push(ev.message.content);
            for (const a of ev.message.attachments ?? []) {
              if (a.text?.content) out.text.push(a.text.content);
              if (a.query?.query) out.sql = a.query.query;
              if (a.query?.description) out.text.push(a.query.description);
            }
            if (ev.message.error) out.error = ev.message.error;
          } else if (ev.type === 'query_result' && ev.data) {
            out.columns = (ev.data.manifest?.schema?.columns ?? []).map((c) => c.name);
            out.rows = ev.data.result?.data_array ?? [];
          } else if (ev.type === 'error') {
            out.error = ev.error ?? 'Genie error';
          }
        }
        // the first text item is usually the question echoed back; keep Genie's own words
        out.text = out.text.filter((t) => t.trim() && t.trim() !== content);
        res.json({ ...out, ranAs: 'Marketing rep (app service principal)' });
      } catch (err) {
        console.error('Genie as marketing failed:', err);
        res.status(500).json({ error: `Genie failed: ${(err as Error).message}` });
      }
    });
  });
}

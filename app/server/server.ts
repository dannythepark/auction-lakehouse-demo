import { createApp, analytics, genie, lakebase, server, serving } from '@databricks/appkit';
import { setupBuyerRoutes } from './routes/buyer-routes';
import { setupAppraiseRoutes } from './routes/appraise-routes';
import { setupGeniePersonaRoutes } from './routes/genie-persona-routes';

createApp({
  plugins: [
    analytics(),
    genie(),
    lakebase(),
    // photos are downsized in the browser, but leave headroom for uploads
    server({ bodyLimit: '12mb' }),
    serving(),
  ],
  onPluginsReady(appkit) {
    setupBuyerRoutes(appkit);
    setupAppraiseRoutes(appkit);
    setupGeniePersonaRoutes(appkit);
  },
}).catch(console.error);

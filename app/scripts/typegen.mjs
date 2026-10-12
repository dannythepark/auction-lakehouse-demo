// Regenerate query/serving types locally (where .env points at a CLI profile).
// In the Databricks Apps build there is no .env, so use the committed types
// in shared/appkit-types instead. Otherwise DESCRIBE QUERY runs as the app's
// service principal, which would need READ on the auc_pii_demo secret scope
// just to type-check. At runtime every query is .obo.sql and runs as the viewer.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (!existsSync('.env')) {
  console.log('[typegen] no .env (deployed build): using committed shared/appkit-types');
  process.exit(0);
}
execSync(['appkit generate-types', ...process.argv.slice(2)].join(' '), { stdio: 'inherit' });

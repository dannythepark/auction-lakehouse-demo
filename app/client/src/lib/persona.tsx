import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

// Two real Unity Catalog identities, so governance can be shown with one human:
// - "me": the signed-in user, queries run on-behalf-of (.obo.sql). On the full-PII allowlist.
// - "marketing": the app's service principal (.sql), on the auc_gov.pii_partial tier,
//   so UC returns names/email but masks phone and tax ID to the last 4.
// Demo-only: a production app would not let a viewer switch identities.
export type Persona = 'me' | 'marketing';

export const PERSONAS: Record<Persona, { label: string; tier: string; identity: string }> = {
  me: { label: 'You · data team', tier: 'Full PII (auc_gov.pii_authorized)', identity: 'your login, on-behalf-of' },
  marketing: {
    label: 'Marketing rep',
    tier: 'Partial PII (auc_gov.pii_partial)',
    identity: 'the app service principal',
  },
};

const PersonaContext = createContext<{ persona: Persona; setPersona: (p: Persona) => void }>({
  persona: 'me',
  setPersona: () => {},
});

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersona] = useState<Persona>('me');
  const value = useMemo(() => ({ persona, setPersona }), [persona]);
  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona() {
  return useContext(PersonaContext);
}

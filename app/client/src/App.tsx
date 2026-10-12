import { createBrowserRouter, RouterProvider, NavLink, Outlet, useRouteError } from 'react-router';
import { useCallback, useEffect, useState } from 'react';
import {
  useAnalyticsQuery,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { Gavel, ShieldCheck, UserRound } from 'lucide-react';
import { PERSONAS, PersonaProvider, usePersona } from './lib/persona';
import type { Persona } from './lib/persona';
import { BuyerList } from './pages/BuyerList';
import { BuyerDetail } from './pages/BuyerDetail';
import { AskPage } from './pages/AskPage';
import { CostPage } from './pages/CostPage';
import { IntakePage } from './pages/IntakePage';
import { ObservabilityPage } from './pages/ObservabilityPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function useWhoAmI() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/whoami')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { email?: string | null } | null) => setEmail(d?.email ?? null))
      .catch(() => setEmail(null));
  }, []);
  return email;
}

// Ask the warehouse who it thinks is querying: proof that the persona switch changes
// the Unity Catalog identity, not just the UI.
function UcIdentity() {
  const { persona } = usePersona();
  const { data, loading } = useAnalyticsQuery(persona === 'me' ? 'whoami_uc' : 'whoami_uc_marketing', {});
  const id = data?.[0]?.uc_identity;
  return (
    <Badge variant="outline" className="gap-1 font-mono text-[11px]" title="SELECT current_user() on the SQL warehouse">
      <ShieldCheck className="h-3.5 w-3.5" /> UC sees:{' '}
      {loading ? '…' : id && id.length > 30 ? `${id.slice(0, 8)}…` : (id ?? '?')}
    </Badge>
  );
}

function PersonaSwitch() {
  const { persona, setPersona } = usePersona();
  return (
    <Select value={persona} onValueChange={(v) => setPersona(v as Persona)}>
      <SelectTrigger className="w-44 h-8 text-xs" aria-label="View as">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PERSONAS) as Persona[]).map((k) => (
          <SelectItem key={k} value={k}>
            View as: {PERSONAS[k].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Layout() {
  const email = useWhoAmI();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-4 md:px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Gavel className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">AuctionCo Buyer 360</h1>
        </div>
        <nav className="flex gap-1">
          <NavLink to="/" end className={navLinkClass}>
            Buyers
          </NavLink>
          <NavLink to="/intake" className={navLinkClass}>
            Lot intake
          </NavLink>
          <NavLink to="/ask" className={navLinkClass}>
            Ask Genie
          </NavLink>
          <NavLink to="/cost" className={navLinkClass}>
            Cost
          </NavLink>
          <NavLink to="/observability" className={navLinkClass}>
            Observability
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <UserRound className="h-3.5 w-3.5" /> {email ?? 'Signed in'}
          </Badge>
          <PersonaSwitch />
          <UcIdentity />
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

function PersonaBanner() {
  const { persona } = usePersona();
  if (persona === 'me') return null;
  return (
    <Alert className="max-w-[1500px] mx-auto mb-4">
      <ShieldCheck className="h-4 w-4" />
      <AlertTitle>Viewing as {PERSONAS[persona].label}</AlertTitle>
      <AlertDescription>
        Queries now run as {PERSONAS[persona].identity}, a separate Unity Catalog identity on the{' '}
        {PERSONAS[persona].tier} tier. The app sends the same SQL; Unity Catalog decides what comes back. Demo-only
        switch: in production each person signs in as themselves.
      </AlertDescription>
    </Alert>
  );
}

function BuyersPage() {
  const { persona } = usePersona();
  const [selected, setSelected] = useState<number | null>(null);
  const onSelect = useCallback((id: number) => setSelected(id), []);
  return (
    <>
      <PersonaBanner />
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 max-w-[1500px] mx-auto">
        <BuyerList selectedId={selected} onSelect={onSelect} />
        <div className="min-w-0">
          {selected === null ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Pick a buyer</EmptyTitle>
                <EmptyDescription>
                  Choose a buyer on the left to see their governed profile, recommended lots, and an AI-drafted
                  outreach.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <BuyerDetail key={`${persona}-${selected}`} accountId={selected} />
          )}
        </div>
      </div>
    </>
  );
}

function RouteError() {
  const err = useRouteError();
  const message = err instanceof Error ? err.message : 'Unknown error';
  return (
    <div className="max-w-xl mx-auto mt-16">
      <Alert variant="destructive">
        <AlertTitle>Something went wrong rendering this page</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button className="mt-4" variant="outline" onClick={() => window.location.assign('/')}>
        Back to buyers
      </Button>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <BuyersPage /> },
      { path: '/intake', element: <IntakePage /> },
      { path: '/ask', element: <AskPage /> },
      { path: '/cost', element: <CostPage /> },
      { path: '/observability', element: <ObservabilityPage /> },
    ],
  },
]);

export default function App() {
  return (
    <PersonaProvider>
      <RouterProvider router={router} />
    </PersonaProvider>
  );
}

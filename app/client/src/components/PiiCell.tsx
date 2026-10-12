import { EyeOff, Lock } from 'lucide-react';
import { isEncrypted, isPartiallyMasked, truncateCipher } from '../lib/governance';

// Renders a value the way Unity Catalog returned it: ciphertext with a lock, last-4 with an eye-off.
export function PiiCell({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (isEncrypted(value))
    return (
      <span className="font-mono text-muted-foreground inline-flex items-center gap-1" title="Encrypted by the UC column mask">
        <Lock className="h-3 w-3" />
        {truncateCipher(value)}
      </span>
    );
  if (isPartiallyMasked(value))
    return (
      <span className="font-mono text-muted-foreground inline-flex items-center gap-1" title="Masked to last 4 by the UC column mask">
        <EyeOff className="h-3 w-3" />
        {value}
      </span>
    );
  return <span>{value}</span>;
}

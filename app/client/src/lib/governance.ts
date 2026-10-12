// The UC column mask on dim_account returns AES-GCM ciphertext (base64) to
// principals outside the PII allowlist. A plaintext email always has an "@";
// ciphertext never does, so that is how the UI tells which one it received.
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  return !value.includes('@') && /^[A-Za-z0-9+/=]{16,}$/.test(value);
}

// The partial tier's mask (auc_gov.mask_last4) returns bullets + the last 4 characters.
export function isPartiallyMasked(value: string | null | undefined): boolean {
  return !!value && value.startsWith('•');
}

export function piiVisible(email: string | null | undefined): boolean {
  return !!email && email.includes('@');
}

export function displayName(first: string, last: string, email: string): string {
  return piiVisible(email) ? `${first} ${last}` : 'Encrypted buyer';
}

export function truncateCipher(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

export const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const num = new Intl.NumberFormat('en-US');

// The warehouse's JSON_ARRAY format returns BIGINT/DOUBLE/DECIMAL values as
// strings, even though the generated types say number. Coerce at the boundary.
export function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

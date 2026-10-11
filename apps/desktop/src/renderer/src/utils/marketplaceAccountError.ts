export function marketplaceAccountError(
  error: unknown,
  fallback: string
): string {
  if (!(error instanceof Error)) return fallback;
  return (
    error.message
      .replace(/^Error invoking remote method '[^']+':\s*/u, "")
      .replace(/^(?:[A-Za-z_$][\w$]*Error|Error):\s*/u, "")
      .trim() || fallback
  );
}

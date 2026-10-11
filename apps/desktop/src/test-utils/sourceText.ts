import { expect } from "vitest";

function normalizeSourceText(value: string): string {
  return value.replace(/\s+/gu, "").replace(/'/gu, '"');
}

export function expectSourceToContain(source: string, fragment: string): void {
  expect(normalizeSourceText(source)).toContain(normalizeSourceText(fragment));
}

export function expectSourceNotToContain(
  source: string,
  fragment: string
): void {
  expect(normalizeSourceText(source)).not.toContain(
    normalizeSourceText(fragment)
  );
}

export function sourceTextIndexOf(
  source: string,
  fragment: string,
  fromIndex = 0
): number {
  return normalizeSourceText(source).indexOf(
    normalizeSourceText(fragment),
    fromIndex
  );
}

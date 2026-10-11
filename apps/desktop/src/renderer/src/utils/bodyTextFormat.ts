import type { BodyTextFormat } from "@deepwrite/contracts";

const isBlank = (line: string): boolean => !line.trim();
const isList = (line: string): boolean =>
  /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(line);
const isQuote = (line: string): boolean => /^ {0,3}>/.test(line);
const isHeading = (line: string): boolean => /^ {0,3}#{1,6}(?:\s|$)/.test(line);
const isRule = (line: string): boolean =>
  /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);

function isTableDelimiter(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|");
  return (
    cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
  );
}

/** Returns the exclusive end of a Markdown block whose whitespace is structural. */
function protectedBlockEnd(lines: string[], start: number): number | undefined {
  const line = lines[start]!;
  const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (fence) {
    const marker = fence[1]!;
    const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    let end = start + 1;
    while (end < lines.length && !close.test(lines[end]!)) end += 1;
    return Math.min(lines.length, end + 1);
  }
  if (line.includes("|") && isTableDelimiter(lines[start + 1] ?? "")) {
    let end = start + 2;
    while (
      end < lines.length &&
      lines[end]!.includes("|") &&
      !isBlank(lines[end]!)
    )
      end += 1;
    return end;
  }
  if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[start + 1] ?? "")) return start + 2;
  if (isHeading(line) || isRule(line)) return start + 1;
  if (isList(line) || isQuote(line)) {
    let end = start + 1;
    while (end < lines.length) {
      const next = lines[end]!;
      if (isBlank(next)) {
        let following = end + 1;
        while (following < lines.length && isBlank(lines[following]!))
          following += 1;
        const continuation = lines[following] ?? "";
        if (
          isList(continuation) ||
          isQuote(continuation) ||
          /^[ \t]+\S/.test(continuation)
        ) {
          end = following;
          continue;
        }
        break;
      }
      if (
        isHeading(next) ||
        isRule(next) ||
        /^ {0,3}(?:`{3,}|~{3,})/.test(next)
      )
        break;
      // Unseparated lines can be lazy Markdown list/quote continuations.
      end += 1;
    }
    return end;
  }
  return undefined;
}

/** Normalize prose only; explicit newlines, not visual wrapping, delimit paragraphs. */
export function formatBodyText(source: string, format: BodyTextFormat): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const indent = format.startsWith("indent-") ? "\u3000\u3000" : "";
  const separator = format.endsWith("-spaced") ? "\n\n" : "\n";
  const output: string[] = [];
  let previousEnd = 0;
  let previousProse = false;
  let index = 0;
  while (index < lines.length) {
    if (isBlank(lines[index]!)) {
      index += 1;
      continue;
    }
    const protectedEnd = protectedBlockEnd(lines, index);
    const prose = protectedEnd === undefined;
    const end = protectedEnd ?? index + 1;
    if (output.length) {
      output.push(
        prose && previousProse
          ? separator
          : "\n".repeat(index - previousEnd + 1)
      );
    }
    output.push(
      prose
        ? indent + lines[index]!.replace(/^[ \t\u3000]+/, "")
        : lines.slice(index, end).join("\n")
    );
    previousProse = prose;
    previousEnd = end;
    index = end;
  }
  return output.join("");
}

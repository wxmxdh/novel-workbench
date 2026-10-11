export function chapterNumber(text: string): number | undefined {
  const match = text.match(/第\s*([0-9一二三四五六七八九十百零〇两]+)\s*章/u);
  if (!match) return undefined;
  const token = match[1]!;
  if (/^\d+$/u.test(token)) return Number(token) || undefined;
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    零: 0,
    〇: 0
  };
  let total = 0,
    current = 0;
  for (const char of token) {
    if (char === "十" || char === "百") {
      total += (current || 1) * (char === "十" ? 10 : 100);
      current = 0;
    } else current = digits[char] ?? 0;
  }
  return total + current || undefined;
}

export interface AuthorActionClause {
  text: string;
  quote: string;
}

export function splitAuthorActionClauses(text: string): AuthorActionClause[] {
  const plain = text
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/^\s*>.*$/gmu, "")
    .replace(/"[^"\n]*"/gu, "")
    .replace(/'[^'\n]*'/gu, "")
    .replace(/“[^”\n]*”/gu, "")
    .replace(/‘[^’\n]*’/gu, "");
  const sentences = plain.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [];
  const clauses: AuthorActionClause[] = [];
  for (const sentence of sentences) {
    const quote = sentence.trim();
    if (
      !quote ||
      /[？?]$/u.test(quote) ||
      /(?:吗|么|呢)(?:[，,；;].*)?$/u.test(quote)
    )
      continue;
    let chapterContext = "";
    for (const part of sentence.split(/[，,；;]/u)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const chapter = trimmed.match(
        /第\s*[0-9一二三四五六七八九十百零〇两]+\s*章/u
      )?.[0];
      const refusal = /(?:不要|不许|不能|不得|暂不|先不|还不|别)/u.test(
        trimmed
      );
      clauses.push({
        text: `${chapter ? "" : chapterContext}${trimmed}`.trim(),
        quote
      });
      if (chapter && !refusal) chapterContext = chapter;
    }
  }
  return clauses;
}

function requestedWriterCount(text: string): number | undefined {
  const match = text.match(
    /(?:写|撰写|创作|生成|重试|补跑|再写|重新写)\s*(?:第\s*[0-9一二三四五六七八九十百零〇两]+\s*章\s*)?([1-5一二两三四五])\s*(?:份|个|位|篇|名)(?:\s*(?:独立稿|对照稿|稿件|模型|作者))?/u
  );
  if (!match) return undefined;
  const token = match[1]!;
  return ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 }[token] ?? Number(token)) || undefined;
}

function isOutlinePlanningRequest(text: string): boolean {
  return (
    /(?:写|撰写|创作|生成)\s*(?:第\s*[0-9一二三四五六七八九十百零〇两]+\s*章\s*)?(?:的\s*)?(?:大纲|提纲|章纲)/u.test(
      text
    ) ||
    /^第\s*[0-9一二三四五六七八九十百零〇两]+\s*章[\s，,]*(?:(?:请|先行?|现在|开始|直接|就)[\s，,]*)?(?:写|撰写|创作|生成)\s*(?:个|一份|一版)?\s*(?:本章)?(?:大纲|提纲|章纲)/u.test(
      text
    )
  );
}

/** Conservative author-action detection; discussion about a feature grants no prose permission. */
export function comparisonWritingIntent(
  text: string
): { chapter: number; quote: string; writerCount?: number } | undefined {
  for (const { text: clause, quote } of splitAuthorActionClauses(text)) {
    const request = clause.trim().replace(/^\d+[.、]\s*/u, "");
    if (
      !request ||
      isOutlinePlanningRequest(request) ||
      /(?:不要|不许|不能|别让|(?<!分)别写|暂不|先不|还不|仅讨论|只讨论|是否|能否|可不可以|功能|接口|权限|触发|按钮|代码|程序|例如|比如|假如|如果)/u.test(
        request
      )
    )
      continue;
    const direct = request.match(
      /^(?:按(?:我们)?(?:已选定|选定|确认|当前|这版|已确认|选好的|选定的|确认的)[^。！？\n]{0,60}?(?:大纲|章卡)[，,\s]*)?(?:请\s*)?(?:(?:现在|开始|可以|可以开始|现在可以)\s*)?(?:写|撰写|创作|生成)\s*(?:第[0-9一二三四五六七八九十百零〇两]+卷\s*)?第\s*[0-9一二三四五六七八九十百零〇两]+\s*章(?:[1-5一二两三四五]\s*(?:份|个|位|篇|名))?(?:正文|初稿|草稿|一稿|一份稿|独立稿|对照稿|稿件|成稿)?$/u
    );
    const chapterFirst = request.match(
      /^(?:第[0-9一二三四五六七八九十百零〇两]+卷\s*)?第\s*[0-9一二三四五六七八九十百零〇两]+\s*章[\s，,]*(?:(?:请|先行?|现在|开始|直接|就|分别|各自)[\s，,]*)?(?:(?:按|依照|根据)(?:我们)?(?:已选定|选定|确认|当前|这版|已确认|选好的|选定的|确认的)?(?:大纲|章卡)[\s，,]*)?(?:写|撰写|创作|生成)(?=$|[\s，,]*(?:[1-5一二两三四五]\s*(?:份|个|位|篇|名)|两份?|三份?|四份?|五份?|一稿|一份稿|正文|初稿|草稿|独立稿|对照稿|稿件|成稿))(?:[\s，,]*(?:[1-5一二两三四五]\s*(?:份|个|位|篇|名)|两份?|三份?|四份?|五份?|一稿|一份稿|正文|初稿|草稿|独立稿|对照稿|稿件|成稿))*$/u
    );
    const verbFirstChapterLast = request.match(
      /^(?:请\s*)?(?:(?:现在|开始|按|依照|根据)[^。！？\n]{0,30})?(?:写|撰写|创作|生成)(?:\s*(?:一份|一稿|两份|[1-5]\s*份|正文|初稿|草稿|独立稿|对照稿))*\s*第\s*[0-9一二三四五六七八九十百零〇两]+\s*章(?:正文|初稿|草稿|一稿|一份稿|独立稿|对照稿)?$/u
    );
    const retry =
      /^(?:(?:请|麻烦|帮我|请你|现在)\s*)?(?:重试|补跑|重新(?:写|撰写|创作|生成)|再(?:写|撰写|创作|生成))[^。！？\n]*第\s*[0-9一二三四五六七八九十百零〇两]+\s*章/u.test(
        request
      ) &&
      /(?:正文|初稿|草稿|独立稿|对照稿|稿件|成稿|撰写|创作|生成|重新写|再写)/u.test(
        request
      );
    const delegated =
      /^(?:(?:请|麻烦|帮我|现在)\s*)?(?:让|叫|调用|请)[^。！？\n]*(?:写|撰写|创作|生成)[^。！？\n]*第\s*[0-9一二三四五六七八九十百零〇两]+\s*章/u.test(
        request
      );
    const solo =
      /^(?:主模型|主智能体)(?:单独|直接|现在|先)?(?:写|撰写|创作|生成)[^。！？\n]*第\s*[0-9一二三四五六七八九十百零〇两]+\s*章/u.test(
        request
      );
    const matchedQuote =
      direct?.[0] ??
      chapterFirst?.[0] ??
      verbFirstChapterLast?.[0] ??
      (retry || delegated || solo ? request : undefined);
    const chapter = matchedQuote ? chapterNumber(matchedQuote) : undefined;
    if (chapter && chapter <= 100_000) {
      const writerCount = requestedWriterCount(request);
      return {
        chapter,
        quote,
        ...(writerCount ? { writerCount } : {})
      };
    }
  }
  return undefined;
}

/** Match an action clause, rather than treating preceding corrections as a refusal. */
export function parallelWritingRequest(text: string): string | undefined {
  for (const { text: clause, quote } of splitAuthorActionClauses(text)) {
    const request = clause.trim();
    if (
      isOutlinePlanningRequest(request) ||
      /(?:不要|不许|不能|(?<!分)别(?=让|叫|写|创作|生成)|暂不|先不|还不|只讨论|仅讨论|是否|能否|可不可以|功能|接口|权限|触发|按钮|代码|程序)/u.test(
        request
      )
    )
      continue;
    if (
      /(?:同时|并行|并发|分别|各自|独立|多模型)/u.test(request) &&
      /(?:写|撰写|创作|成稿|交稿)/u.test(request) &&
      /(?:团队|模型|代理|成员)/u.test(request)
    )
      return quote;
  }
  return undefined;
}

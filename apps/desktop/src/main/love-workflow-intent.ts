import {
  chapterNumber,
  splitAuthorActionClauses
} from "./comparison-writing-intent";

function actionClauses(text: string): string[] {
  return splitAuthorActionClauses(text)
    .map(({ text: part }) => part.trim())
    .filter(
      (part) =>
        part &&
        !/(?:不要|不能|不许|不得|不是|暂不|先不|不想|不需要|无需|(?:^|请|你|先)别|讨论|探讨|例如|比如|假如|如果|能否|是否|要不要|可以吗|能不能|你觉得|你认为|怎么|流程|施工|功能|程序)/u.test(
          part
        )
    );
}

export function loveLocalRevisionIntent(
  text: string
): { chapter?: number; quote: string } | undefined {
  for (const clause of actionClauses(text)) {
    if (
      /(?:修改意见|审阅意见)/u.test(clause) &&
      !/(?:按|根据|照着|落实|执行)/u.test(clause)
    )
      continue;
    if (
      /(?:请|帮我|麻烦|现在|直接|按|根据|照着|就|把|只|局部|针对)/u.test(
        clause
      ) &&
      /(?:修改|修订|改一下|改这|改掉|删去|删除这句|扩展这句|扩写这句|润色)/u.test(
        clause
      ) &&
      /(?:稿|正文|批注|句|段|章|审阅意见|审核意见)/u.test(clause)
    ) {
      const chapter = chapterNumber(clause);
      return {
        ...(chapter !== undefined ? { chapter } : {}),
        quote: clause.slice(0, 200)
      };
    }
  }
  return undefined;
}

/** Explicit prose re-creation request; discussion/examples do not grant a writer capability. */
export function loveRedraftIntent(
  text: string
): { chapter?: number; quote: string } | undefined {
  for (const clause of actionClauses(text)) {
    if (
      /(?:再创作|二次创作|重写)/u.test(clause) &&
      /(?:底稿|底板|大纲|已选稿|当前稿|批注)/u.test(clause) &&
      /(?:请|让|现在|进行|开始|按|基于|在.+基础|根据)/u.test(clause)
    ) {
      const chapter = chapterNumber(clause);
      return {
        ...(chapter !== undefined ? { chapter } : {}),
        quote: clause.slice(0, 200)
      };
    }
  }
  return undefined;
}

export interface LoveFailureContinuationIntent {
  chapter?: number;
  writerCount?: number;
  quote: string;
}

/** A continuation request is only a pointer; Main must resolve it to stored failures. */
export function loveFailureContinuationIntent(
  text: string
): LoveFailureContinuationIntent | undefined {
  if (loveWritingAuthorizationRevoked(text)) return undefined;
  for (const clause of actionClauses(text)) {
    if (
      !/(?:继续|接着|重试|补跑|再跑|重新跑|恢复)/u.test(clause) ||
      !/(?:失败|未完成|没完成|中断|报错|出错)/u.test(clause) ||
      !/(?:稿|份|个|位|模型|作者|团队|任务|子任务)/u.test(clause)
    )
      continue;

    const countToken = clause.match(
      /(?:第\s*)?([1-5一二三四五两])\s*(?:份|个|位|篇|稿|名)/u
    )?.[1];
    const count = countToken
      ? ({
          一: 1,
          二: 2,
          两: 2,
          三: 3,
          四: 4,
          五: 5
        }[countToken] ?? Number(countToken))
      : undefined;
    const chapter = chapterNumber(clause);
    return {
      ...(chapter !== undefined ? { chapter } : {}),
      ...(count !== undefined ? { writerCount: count } : {}),
      quote: clause.slice(0, 200)
    };
  }
  return undefined;
}

export function loveWritingAuthorizationRevoked(text: string): boolean {
  const clauses = splitAuthorActionClauses(text);
  return clauses.some(({ text: clause }) => {
    const localScope =
      /(?:其他|其余|剩余|成功|已完成|原稿|旧稿|别的|另外)/u.test(clause);
    if (localScope) return false;
    return (
      /(?:撤销|取消|收回|停止|终止|中止).{0,24}(?:写作|创作|生成|重试|续跑|补跑).{0,8}(?:任务|授权|工作|流程)?/u.test(
        clause
      ) ||
      /(?:不要|别|先别|暂不|先不|不再).{0,16}(?:(?:继续|进行|开始)\s*)?(?:写作|创作|生成|重试|续跑|补跑)(?:任务|工作|授权)?/u.test(
        clause
      )
    );
  });
}

export function loveWorkflowActionAuthorized(
  text: string,
  action: "select_draft" | "attach_notes"
): boolean {
  return actionClauses(text).some((clause) => {
    if (action === "select_draft") {
      return (
        /(?:采用|采纳|选用|选择|就用|暂用|以.+为底稿|作为(?:底稿|当前稿|接续依据))/u.test(
          clause
        ) && /(?:稿|底稿|初稿|草稿|对照稿|独立稿)/u.test(clause)
      );
    }
    return (
      (/(?:批注|审阅意见|修改意见)/u.test(clause) ||
        (/第\s*(?:\d+|[一二两三四五六七八九十]+)\s*(?:(?:[、,，和及与]\s*)第?\s*(?:\d+|[一二两三四五六七八九十]+)\s*)*(?:条|项)/u.test(
          clause
        ) &&
          !/(?:大纲|提纲|章纲|计划|规划|规则|设定|说法|稿件?|正文|场景|人物|情节|事实|方案|建议)/u.test(
            clause
          ))) &&
      (/(?:采用|采纳)/u.test(clause) ||
        (/(?:按|根据|照着|依照)/u.test(clause) &&
          /(?:修改|修订|改写|执行|落实|应用|重写|创作)/u.test(clause)) ||
        /(?:执行|落实|应用)[^。！？\n]{0,24}(?:批注|审阅意见|修改意见)/u.test(
          clause
        ))
    );
  });
}

/** Background annotation access does not authorize adopting the selected items. */
export function loveWorkflowAnnotationContextAuthorized(text: string): boolean {
  return splitAuthorActionClauses(text).some(({ text: rawClause }) => {
    const clause = rawClause.trim();
    if (
      !clause ||
      /(?:不要|不能|不许|不得|不是|暂不|先不|不想|不需要|无需|(?:^|请|你|先)别|是否|能否|可以吗|能不能|要不要)/u.test(
        clause
      )
    )
      return false;
    return (
      /(?:批注|审阅意见|修改意见)/u.test(clause) &&
      /(?:看|查看|阅读|读取|读一下|绑定|关联|附上|作为背景|作讨论参考|讨论|浏览|审阅|复核)/u.test(
        clause
      )
    );
  });
}

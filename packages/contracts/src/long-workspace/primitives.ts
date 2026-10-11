import { z } from "zod";

export const LongTimestampSchema = z.string().datetime();
export const LongTitleSchema = z.string().trim().min(1).max(256);
export const LongTextSchema = z.string().max(200_000);
export const LongShortTextSchema = z.string().max(4_000);

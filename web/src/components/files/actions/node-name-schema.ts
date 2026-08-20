import { z } from "zod"

export const nodeNameSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Name is required")
    .refine((value) => value !== "." && value !== "..", "Dot names are not allowed")
    .refine((value) => ![/[/\\\u0000]/].some((pattern) => pattern.test(value)), "Path separators are not allowed"),
})

export type NodeNameValues = z.infer<typeof nodeNameSchema>
export type ReloadNodes = () => Promise<void>
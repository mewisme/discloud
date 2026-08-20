import { z } from "zod"

export const collectionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string(),
})

export type CollectionFormValues = z.infer<typeof collectionFormSchema>
/** Shared validation and compatibility for worker requests for human action. */
import { z } from 'zod'
import type { Attention, AttentionRequest } from './core/model.ts'

export const AttentionRequestSchema = z.object({
  kind: z.enum(['question', 'authorization']),
  question: z.string().trim().min(1).max(4000),
  action: z.enum(['dynamic-experiment', 'install-tool', 'runtime-access', 'network-access', 'other']).optional(),
  target: z.string().trim().min(1).max(500).optional(),
  scope: z.string().trim().min(1).max(2000).optional(),
  constraints: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  candidateId: z.string().min(1).max(120).optional(),
  roundId: z.string().min(1).max(120).optional(),
  expiresAt: z.string().datetime().optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'authorization') {
    for (const field of ['action', 'target', 'scope'] as const) if (!value[field]) context.addIssue({ code: 'custom', path: [field], message: `${field} is required for authorization Attention` })
  }
})

/** Decode only an explicitly structured request, never infer consent from prose. */
export function encodedAttention(text: string): AttentionRequest | undefined {
  if (!text.trim().startsWith('{')) return undefined
  try {
    const result = AttentionRequestSchema.safeParse(JSON.parse(text))
    return result.success ? result.data : undefined
  } catch { return undefined }
}

export const HumanActionSchema = z.union([AttentionRequestSchema, z.string().trim().min(1).max(8000)])

export const humanAction = (value: z.infer<typeof HumanActionSchema>): AttentionRequest =>
  typeof value === 'string' ? encodedAttention(value) ?? { kind: 'question', question: value } : value

export function normalizeAttention(attention: Attention): Attention {
  const decoded = encodedAttention(attention.question)
  return decoded ? { ...attention, ...decoded, id: attention.id,
    ...(attention.candidateId ? { candidateId: attention.candidateId } : {}),
    ...(attention.roundId ? { roundId: attention.roundId } : {}) } : { ...attention, kind: attention.kind ?? 'question' }
}

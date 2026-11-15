import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'

const absolutePath = z.string().min(1).refine(isAbsolute, 'Expected an absolute path')

export const ProjectContextSchema = z.object({
  repositoryPath: absolutePath,
  revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  topic: z.string().trim().min(1).max(1000),
  knowledgeDirectory: absolutePath,
  targetKind: z.enum(['git', 'directory', 'binary', 'pseudocode']).default('git'),
}).strict()

export type ProjectContext = Omit<z.output<typeof ProjectContextSchema>, 'targetKind'> & {
  targetKind?: z.output<typeof ProjectContextSchema>['targetKind']
}
export type ProjectContextInput = z.input<typeof ProjectContextSchema>

/** Resolve a local research target without fetching, checking out or changing its files. */
export function resolveProjectContext(input: {
  project: string; ref: string; topic: string; knowledgeDirectory: string;
  targetKind?: 'git' | 'directory' | 'binary' | 'pseudocode';
}): ProjectContext {
  const project = realpathSync(input.project)
  const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
  }).trim()
  const repositoryPath = git('rev-parse', '--show-toplevel')
  const revision = git('rev-parse', '--verify', '--end-of-options', `${input.ref}^{commit}`)
  return ProjectContextSchema.parse({
    repositoryPath, revision, topic: input.topic, knowledgeDirectory: resolve(input.knowledgeDirectory), targetKind: input.targetKind ?? 'git',
  })
}

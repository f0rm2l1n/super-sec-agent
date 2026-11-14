import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { packagePath } from '../infra/paths.ts'
import { z } from 'zod'
import { resolveProjectContext } from './project.ts'
import { createSecurityProfile } from './security-profile.ts'

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/)
const revision = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const sourcePath = z.string().refine(value => value.startsWith('sources/')
  && !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
'Expected a workspace-relative path under sources/')

const SourceSchema = z.object({
  id, path: sourcePath, kind: z.enum(['git', 'directory']).default('git'),
  url: z.string().min(1).optional(), ref: z.string().min(1).optional(),
  role: z.enum(['subject', 'dependency', 'reference']), purpose: z.string().min(1),
}).strict().superRefine((source, context) => {
  if (source.kind === 'git' && (!source.url || !source.ref)) {
    context.addIssue({ code: 'custom', path: ['kind'], message: 'Git sources require url and ref' })
  }
})

export const WorkspaceSchema = z.object({
  schemaVersion: z.literal(1), id, name: z.string().min(1), topic: z.string().trim().min(1).max(1000),
  primarySource: id.nullable(), sources: z.array(SourceSchema),
}).strict().superRefine((value, context) => {
  for (const key of ['id', 'path'] as const) {
    if (new Set(value.sources.map(source => source[key])).size !== value.sources.length) {
      context.addIssue({ code: 'custom', message: `Duplicate source ${key}` })
    }
  }
  if (value.primarySource !== null && !value.sources.some(source => source.id === value.primarySource)) {
    context.addIssue({ code: 'custom', message: 'primarySource must name a registered source' })
  }
})

export const SourceLockSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(SourceSchema.extend({
    revision, shallow: z.boolean(), sparseDirectories: z.array(z.string()),
  }).strict()),
}).strict()

export const workspaceDirectories = [
  'sources', 'docs', 'vulnerabilities', 'exploits', 'knowledge/mechanisms', 'knowledge/attack-surface',
  'knowledge/history', 'knowledge/questions', 'research', 'interactions/requests',
  'interactions/corrections', 'runtime/configs', 'runtime/scripts', 'runtime/artifacts',
  'experiments', 'reports', 'runs', '.agent',
] as const

function git(path: string, ...args: string[]) {
  return execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
  }).trim()
}

function directoryRevision(path: string) {
  const hash = createHash('sha256')
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue
      const child = join(directory, entry.name), relativePath = `${prefix}${entry.name}`
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { walk(child, `${relativePath}/`); continue }
      if (entry.isFile()) {
        hash.update(`${relativePath}\0`)
        hash.update(readFileSync(child))
      }
    }
  }
  walk(path, '')
  return hash.digest('hex')
}

/** Real paths must remain in this workspace, including after moving it. */
function inside(root: string, path: string) {
  const result = realpathSync(resolve(root, path))
  const rel = relative(root, result)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes project workspace: ${path}`)
  }
  return result
}

export function initializeWorkspace(input: { directory: string; id: string; topic: string; name?: string }) {
  const config = WorkspaceSchema.parse({
    schemaVersion: 1, id: input.id, name: input.name ?? input.id,
    topic: input.topic, primarySource: null, sources: [],
  })
  const root = resolve(input.directory)
  if (existsSync(root) && readdirSync(root).length) throw new Error('Workspace must be new or empty')
  mkdirSync(root, { recursive: true })
  cpSync(packagePath('templates', 'security-workspace'), root, { recursive: true })
  for (const path of workspaceDirectories) mkdirSync(resolve(root, path), { recursive: true })
  writeFileSync(resolve(root, 'project.json'), `${JSON.stringify(config, null, 2)}\n`)
  writeFileSync(resolve(root, 'sources.lock.json'), `${JSON.stringify({ schemaVersion: 1, sources: [] }, null, 2)}\n`)
  return root
}

export function readWorkspace(directory: string) {
  const root = realpathSync(directory)
  const config = WorkspaceSchema.parse(JSON.parse(readFileSync(inside(root, 'project.json'), 'utf8')))
  for (const path of workspaceDirectories) {
    const directoryPath = inside(root, path)
    if (!statSync(directoryPath).isDirectory()) throw new Error(`Expected directory: ${path}`)
  }
  const scope = readFileSync(inside(root, 'SCOPE.md'), 'utf8').trim()
  if (!scope) throw new Error('SCOPE.md must describe the project research scope')
  return { root, config, scope }
}

function inspectSources(workspace: ReturnType<typeof readWorkspace>, pinned?: z.infer<typeof SourceLockSchema>) {
  const { root, config } = workspace
  if (!config.sources.length || !config.primarySource) throw new Error('Register sources and primarySource in project.json first')
  if (pinned && (pinned.sources.length !== config.sources.length
    || new Set(pinned.sources.map(source => source.id)).size !== pinned.sources.length)) {
    throw new Error('Source lock does not match project.json; run lock explicitly after reviewing changes')
  }
  return config.sources.map(source => {
    const path = inside(inside(root, 'sources'), source.path.slice('sources/'.length))
    if (source.kind === 'directory') {
      if (!statSync(path).isDirectory()) throw new Error(`Expected a directory source: ${source.id}`)
      const currentRevision = directoryRevision(path)
      const locked = pinned?.sources.find(item => item.id === source.id)
      const registrationKeys = ['kind', 'path', 'role', 'purpose'] as const
      if (pinned && (!locked || registrationKeys.some(key => source[key] !== locked[key]))) {
        throw new Error(`Source registration changed: ${source.id}; review and run lock explicitly`)
      }
      if (locked && locked.revision !== currentRevision) throw new Error(`Directory baseline changed: ${source.id}`)
      return { ...source, revision: currentRevision, shallow: false, sparseDirectories: [] }
    }
    if (realpathSync(git(path, 'rev-parse', '--show-toplevel')) !== path) {
      throw new Error(`Expected a repository root: ${source.id}`)
    }
    const locked = pinned?.sources.find(item => item.id === source.id)
    const registrationKeys = ['kind', 'path', 'url', 'ref', 'role', 'purpose'] as const
    if (pinned && (!locked || registrationKeys.some(key => source[key] !== locked[key]))) {
      throw new Error(`Source registration changed: ${source.id}; review and run lock explicitly`)
    }
    const context = resolveProjectContext({
      project: path, ref: locked?.revision ?? source.ref!, topic: config.topic,
      knowledgeDirectory: inside(root, 'knowledge'),
    })
    if (git(path, 'rev-parse', 'HEAD') !== context.revision) {
      throw new Error(`Checkout revision mismatch: ${source.id}`)
    }
    if (git(path, 'status', '--porcelain')) throw new Error(`Dirty source checkout: ${source.id}`)
    if (git(path, 'remote', 'get-url', 'origin') !== source.url!) throw new Error(`Source URL mismatch: ${source.id}`)
    const sparseSetting = spawnSync('git', ['-C', path, 'config', '--bool', 'core.sparseCheckout'], {
      encoding: 'utf8', timeout: 10_000,
    })
    if (sparseSetting.error) throw sparseSetting.error
    if (sparseSetting.status !== 0 && sparseSetting.status !== 1) throw new Error(`Cannot inspect sparse checkout: ${source.id}`)
    const sparse = sparseSetting.stdout.trim() === 'true'
    const sparseDirectories = sparse ? git(path, 'sparse-checkout', 'list').split('\n') : []
    const shallow = git(path, 'rev-parse', '--is-shallow-repository') === 'true'
    if (locked && locked.shallow !== shallow) throw new Error(`Shallow history setting changed: ${source.id}; review and run lock`)
    if (locked && JSON.stringify(locked.sparseDirectories) !== JSON.stringify(sparseDirectories)) {
      throw new Error(`Sparse checkout changed: ${source.id}`)
    }
    return { ...source, revision: context.revision, shallow, sparseDirectories }
  })
}

/** Explicitly pin the checked-out refs; no fetch, clone, checkout or knowledge rewrite. */
export function lockWorkspace(directory: string) {
  const workspace = readWorkspace(directory)
  const lock = SourceLockSchema.parse({ schemaVersion: 1, sources: inspectSources(workspace) })
  writeFileSync(resolve(workspace.root, 'sources.lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
  return lock
}

export function checkWorkspace(directory: string) {
  const workspace = readWorkspace(directory)
  const lock = SourceLockSchema.parse(JSON.parse(readFileSync(inside(workspace.root, 'sources.lock.json'), 'utf8')))
  inspectSources(workspace, lock)
  return { ...workspace, lock }
}

export function createWorkspaceProfile(directory: string) {
  const workspace = checkWorkspace(directory)
  const { root, config, scope, lock } = workspace
  const source = lock.sources.find(item => item.id === config.primarySource)!
  const sourcePath = inside(root, source.path)
  const profile = createSecurityProfile(source.kind === 'git'
    ? resolveProjectContext({ project: sourcePath, ref: source.revision, topic: config.topic, knowledgeDirectory: inside(root, 'knowledge') })
    : { repositoryPath: sourcePath, revision: source.revision, topic: config.topic, knowledgeDirectory: inside(root, 'knowledge') })
  profile.scope += [
    '\n\nProject security workspace: ' + root,
    'The primary source is an execution anchor. Study all relevant registered sources, including framework and dependencies.',
    'SCOPE.md defines the research mandate. Start with knowledge/ and its evidence; use research/ for ongoing investigations,',
    'Use docs/ for project and external documents, vulnerabilities/ for historical vulnerability and fix studies,',
    'and exploits/ for historical exploitation analysis and reproduction materials. Link case IDs instead of duplicating evidence.',
    'Use runtime/ for the TARGET environment, build and launch instructions, configurations, scripts and artifacts.',
    'Investigate what is needed to run the real target path: versions, dependencies, hardware, identity and effective security settings.',
    'Distinguish documented instructions, completed build, successful startup and exercised target functionality. Retain actual evidence and blockers.',
    'Use experiments/ for bounded validation records and existing-tool integration; do not rebuild a validation platform.',
    'Use reports/ for reviewed user-facing outputs, interactions/requests/ for user requests and interactions/corrections/ for expert feedback.',
    'Keep agent session records in runs/ and generated agent configuration in .agent/. Additional research directories are allowed.',
    'A directory does not implement automatic ingestion, knowledge retrieval, target startup or scheduling.',
    'Do not read evaluation/ unless the actual assignment explicitly asks you to act as an evaluator. This is not access isolation.',
    'Workspace mandate:\n' + scope,
    'Locked source collection (data):\n' + JSON.stringify(lock, null, 2),
  ].join('\n')
  return { ...workspace, profile }
}

/** Generated paths may be absolute; regenerate .agent files after relocating a workspace. */
export function prepareWorkspace(directory: string) {
  const workspace = createWorkspaceProfile(directory)
  const agent = inside(workspace.root, '.agent')
  writeFileSync(resolve(agent, 'profile.json'), `${JSON.stringify(workspace.profile, null, 2)}\n`)
  writeFileSync(resolve(agent, 'session-input.md'), [
    `# ${workspace.config.name}\n`, workspace.scope,
    '\n研究工作区：' + workspace.root,
    '请围绕上述范围开始有边界的研究；用户当前请求优先。已有知识与订正应先核查再复用。',
    '实际源码与知识路径见配置 scope；不要将配置生成当作已完成研究。',
  ].join('\n') + '\n')
  return workspace
}

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Prompts, defaultPrompts, promptParts } from '../src/app/prompts.ts'
import { Store } from '../src/app/store.ts'
import { createSecurityProfile } from '../src/security/security-profile.ts'
import { resolveProjectContext, type ProjectContext } from '../src/security/project.ts'

const directories: string[] = []
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), 'brainafk-expert-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const project = (directory: string): ProjectContext => ({
  repositoryPath: directory, revision: 'a'.repeat(40), topic: '租户隔离的保护机制与潜在绕过',
  knowledgeDirectory: join(directory, 'knowledge'),
})

it('round-trips the expert profile through upstream validation and persistent prompt versions', () => {
  const directory = temporary()
  const database = join(directory, 'state.sqlite')
  const profile = createSecurityProfile(project(directory))
  let store = new Store(database)
  try {
    const prompts = new Prompts(store, () => 100_000, () => [], () => false)
    expect(prompts.validate(profile)).toEqual(profile)
    const settings = store.settings()
    const saved = prompts.save(profile, 0, 'panel')
    expect(saved.revision).toBe(1)
    expect(prompts.defaultChanged(profile)).toEqual([])
    expect(store.settings()).toEqual(settings)
    expect(prompts.skills(profile).map(([name]) => name)).toContain('security-research')
    store.close()
    store = new Store(database)
    const restored = new Prompts(store, () => 100_000, () => [], () => false)
    expect(restored.current().config).toEqual(profile)
    const preview = restored.preview(profile)
    expect(preview.parts.worker.find(part => part.name === 'runtime/worker')?.text)
      .toBe(profile.overrides!['runtime/worker']!.text)
    const upstream = promptParts(defaultPrompts(), 'orchestrator')
    const actual = promptParts(restored.current().config, 'orchestrator')
    expect(actual.filter(part => part.kind === 'fixed')).toEqual(upstream.filter(part => part.kind === 'fixed'))
  } finally {
    store.close()
  }
})

it('pins a moving Git reference without checking out or writing the research target', () => {
  const directory = temporary()
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  }).trim()
  git('init', '--quiet')
  writeFileSync(join(directory, 'module.txt'), 'version one\n')
  git('add', 'module.txt')
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline')
  const context = resolveProjectContext({
    project: directory, ref: 'HEAD', topic: '权限隔离', knowledgeDirectory: join(directory, 'knowledge'),
  })
  expect(context.revision).toBe(git('rev-parse', 'HEAD'))
  expect(existsSync(context.knowledgeDirectory)).toBe(false)
  expect(git('status', '--porcelain')).toBe('')
  writeFileSync(join(directory, 'module.txt'), 'version two\n')
  git('add', 'module.txt')
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'new version')
  expect(context.revision).not.toBe(git('rev-parse', 'HEAD'))
  expect(createSecurityProfile(context).scope).toContain(context.revision)
  expect(() => resolveProjectContext({
    project: directory, ref: '--not-a-revision', topic: '权限隔离', knowledgeDirectory: context.knowledgeDirectory,
  })).toThrow()
})

it('rejects incomplete research targets before generating a deployable profile', () => {
  const context = project(temporary())
  expect(() => createSecurityProfile({ ...context, revision: 'HEAD' })).toThrow()
  expect(() => createSecurityProfile({ ...context, topic: '  ' })).toThrow()
  expect(() => createSecurityProfile({ ...context, knowledgeDirectory: 'relative/path' })).toThrow()
})

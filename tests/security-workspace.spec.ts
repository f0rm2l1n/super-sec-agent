import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PromptConfigSchema } from '../src/app/prompts.ts'
import {
  checkWorkspace, createWorkspaceProfile, initializeWorkspace, lockWorkspace, prepareWorkspace,
} from '../src/security/workspace.ts'

const directories: string[] = []
const temporary = () => {
  const path = mkdtempSync(join(tmpdir(), 'brainafk-workspace-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function git(path: string, ...args: string[]) {
  return execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  }).trim()
}

function setup() {
  const root = join(temporary(), 'project')
  initializeWorkspace({ directory: root, id: 'example', topic: '跨层身份与隔离' })
  const config = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
  config.primarySource = 'kernel'
  config.sources = ['kernel', 'framework'].map(id => {
    const path = join(root, 'sources', id)
    execFileSync('git', ['init', '--quiet', path])
    git(path, 'remote', 'add', 'origin', `https://example.invalid/${id}.git`)
    writeFileSync(join(path, 'entry.c'), `/* ${id} baseline */\n`)
    git(path, 'add', 'entry.c')
    git(path, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline')
    return { id, path: `sources/${id}`, url: `https://example.invalid/${id}.git`,
      ref: 'HEAD', role: id === 'kernel' ? 'subject' : 'dependency', purpose: id }
  })
  writeFileSync(join(root, 'project.json'), JSON.stringify(config, null, 2))
  writeFileSync(join(root, 'SCOPE.md'), '理解框架如何使用内核，以及两层身份约束。')
  return root
}

it('prepares a multi-repository profile through the standard workspace, without requiring evaluation data', () => {
  const root = setup()
  expect(() => checkWorkspace(root)).toThrow(/lock/i)
  lockWorkspace(root)
  const runbook = '目标启动方案：等待专用设备；尚未启动。'
  writeFileSync(join(root, 'runtime/run.md'), runbook)
  const workspace = prepareWorkspace(root)
  expect(workspace.lock.sources).toHaveLength(2)
  expect(PromptConfigSchema.parse(workspace.profile)).toEqual(workspace.profile)
  expect(workspace.profile.scope).toContain('sources/framework')
  expect(workspace.profile.scope).toContain('理解框架如何使用内核')
  expect(existsSync(join(root, 'evaluation'))).toBe(false)
  expect(existsSync(join(root, '.agent/profile.json'))).toBe(true)
  expect(existsSync(join(root, 'runtime/profile.json'))).toBe(false)
  expect(readFileSync(join(root, 'runtime/run.md'), 'utf8')).toBe(runbook)
  expect(git(join(root, 'sources/kernel'), 'status', '--porcelain')).toBe('')
})

it('relocates sources, knowledge and corrections without editing portable metadata', () => {
  const root = setup()
  lockWorkspace(root)
  const configBefore = readFileSync(join(root, 'project.json'), 'utf8')
  const lockBefore = readFileSync(join(root, 'sources.lock.json'), 'utf8')
  const correction = 'K-001 的前提只在指定构建配置下成立。'
  writeFileSync(join(root, 'interactions/corrections/001.md'), correction)
  writeFileSync(join(root, 'knowledge/mechanisms/K-001.md'), 'source: kernel, revision: ' +
    checkWorkspace(root).lock.sources[0]!.revision)
  const caseStudy = 'CASE-001：历史漏洞根因研究，关联 exploits/CASE-001.md，尚未复现。'
  writeFileSync(join(root, 'vulnerabilities/CASE-001.md'), caseStudy)
  writeFileSync(join(root, 'runtime/environment.md'), '目标环境：需要两台设备。')
  const destination = join(temporary(), 'moved')
  renameSync(root, destination)
  const { profile } = prepareWorkspace(destination)
  expect(profile.scope).toContain(destination)
  expect(profile.scope).not.toContain(root)
  expect(readFileSync(join(destination, 'project.json'), 'utf8')).toBe(configBefore)
  expect(readFileSync(join(destination, 'sources.lock.json'), 'utf8')).toBe(lockBefore)
  expect(readFileSync(join(destination, 'interactions/corrections/001.md'), 'utf8')).toBe(correction)
  expect(readFileSync(join(destination, 'knowledge/mechanisms/K-001.md'), 'utf8')).toContain('source: kernel')
  expect(readFileSync(join(destination, 'vulnerabilities/CASE-001.md'), 'utf8')).toBe(caseStudy)
  expect(readFileSync(join(destination, 'runtime/environment.md'), 'utf8')).toBe('目标环境：需要两台设备。')
})

it('rejects revision drift, dirty sources and changed registration until an explicit baseline update', () => {
  const root = setup()
  lockWorkspace(root)
  const originalLock = readFileSync(join(root, 'sources.lock.json'), 'utf8')
  const source = join(root, 'sources/framework')
  writeFileSync(join(source, 'entry.c'), '/* modified framework */\n')
  expect(() => checkWorkspace(root)).toThrow(/Dirty/)
  git(source, 'add', 'entry.c')
  git(source, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'changed framework')
  expect(() => createWorkspaceProfile(root)).toThrow(/revision mismatch/)
  expect(readFileSync(join(root, 'sources.lock.json'), 'utf8')).toBe(originalLock)
  lockWorkspace(root)
  expect(checkWorkspace(root).lock.sources[1]!.revision).toBe(git(source, 'rev-parse', 'HEAD'))
  const config = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
  config.sources[1].ref = 'another-branch'
  writeFileSync(join(root, 'project.json'), JSON.stringify(config))
  expect(() => checkWorkspace(root)).toThrow(/registration changed/)
})

it('preserves existing project data and rejects sources that escape the workspace', () => {
  const root = setup()
  expect(() => initializeWorkspace({ directory: root, id: 'other', topic: 'test' })).toThrow(/new or empty/)
  const external = temporary()
  symlinkSync(external, join(root, 'sources/external'))
  const config = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
  config.sources[0].path = 'sources/external'
  writeFileSync(join(root, 'project.json'), JSON.stringify(config))
  expect(() => lockWorkspace(root)).toThrow(/escapes/)
  config.sources[0].path = 'sources/../../outside'
  writeFileSync(join(root, 'project.json'), JSON.stringify(config))
  expect(() => lockWorkspace(root)).toThrow(/workspace-relative/)
})

import { parseArgs } from 'node:util'
import { composePrompt } from '../app/prompts.ts'
import { resolveProjectContext } from './project.ts'
import { createSecurityProfile } from './security-profile.ts'
import {
  checkWorkspace, createWorkspaceProfile, initializeWorkspace, lockWorkspace, prepareWorkspace,
} from './workspace.ts'

const help = `Usage: pnpm expert <init|lock|check|prepare|profile|preview> [options]

  --workspace <path>      Standard project-security workspace
  --id <id>              Project identifier for init (required with --topic)
  --name <text>          Optional display name for init

init creates a portable workspace skeleton without cloning or calling a model.
Edit project.json, add source checkouts, then lock to pin their checked-out refs.
check verifies the workspace and source versions. prepare writes .agent/ config.
runtime/ holds target build and launch research; prepare does not run the target.
profile/preview accept --workspace, or the low-level options below:

  --project <path>        Local Git checkout to study
  --ref <ref>             Revision to resolve; defaults to HEAD
  --topic <text>          Security research topic (required)
  --knowledge-dir <path>  Intended research storage (required; not created)
  --role <worker|orchestrator>  Preview role; defaults to worker
  --help                 Show this help

profile prints a configuration for the upstream prompts API.
preview prints the composed prompt without starting an agent or calling a model.
`

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' }, ref: { type: 'string', default: 'HEAD' },
      workspace: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' },
      topic: { type: 'string' }, 'knowledge-dir': { type: 'string' },
      role: { type: 'string', default: 'worker' }, help: { type: 'boolean' },
    },
  })
  if (values.help) {
    process.stdout.write(help)
  } else {
    const [command, ...extra] = positionals
    if (!command || !['init', 'lock', 'check', 'prepare', 'profile', 'preview'].includes(command) || extra.length) throw new Error(help)
    if (values.role !== 'worker' && values.role !== 'orchestrator') throw new Error('Invalid --role')
    if (values.workspace) {
      if (values.project || values['knowledge-dir'] || values.ref !== 'HEAD'
        || (command !== 'init' && (values.topic || values.id || values.name))) {
        throw new Error('Workspace configuration comes from project.json; do not mix low-level target options')
      }
      if (command === 'init') {
        if (!values.id || !values.topic) throw new Error('init requires --id and --topic')
        const root = initializeWorkspace({ directory: values.workspace, id: values.id, topic: values.topic, name: values.name })
        process.stdout.write(`Created ${root}. Register sources in project.json, then run lock.\n`)
      } else if (command === 'lock') {
        process.stdout.write(`${JSON.stringify(lockWorkspace(values.workspace), null, 2)}\n`)
      } else if (command === 'check') {
        const workspace = checkWorkspace(values.workspace)
        process.stdout.write(`Valid workspace ${workspace.config.id}: ${workspace.lock.sources.length} fixed clean sources. No model run.\n`)
      } else if (command === 'prepare') {
        const workspace = prepareWorkspace(values.workspace)
        process.stdout.write(`Prepared ${workspace.root}/.agent/{profile.json,session-input.md}. No model or target run.\n`)
      } else {
        const { profile } = createWorkspaceProfile(values.workspace)
        process.stdout.write(`${command === 'profile' ? JSON.stringify(profile, null, 2) : composePrompt(profile, values.role)}\n`)
      }
    } else {
      if ((command !== 'profile' && command !== 'preview') || values.id || values.name) throw new Error('This command requires --workspace')
      if (!values.project || !values.topic || !values['knowledge-dir']) {
        throw new Error('--project, --topic and --knowledge-dir are required for low-level profiles')
      }
      const project = resolveProjectContext({
        project: values.project, ref: values.ref!, topic: values.topic,
        knowledgeDirectory: values['knowledge-dir'],
      })
      const profile = createSecurityProfile(project)
      process.stdout.write(`${command === 'profile' ? JSON.stringify(profile, null, 2) : composePrompt(profile, values.role)}\n`)
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

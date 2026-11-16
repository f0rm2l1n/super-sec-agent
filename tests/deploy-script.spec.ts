import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('protects existing baselines and restores service state after failed deployment', () => {
  expect(() => execFileSync('python3', [new URL('./deploy-script.test.py', import.meta.url).pathname], { stdio: 'pipe' })).not.toThrow()
})

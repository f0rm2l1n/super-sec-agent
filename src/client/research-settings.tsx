/** Platform settings for research windows; provider credentials remain owned by DSH's global model settings. */
import type { ApiResponse } from '../app/api.ts'
import { usePoll, type Settings } from './api.ts'
import { Button, Icon, Input, InfoTip } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { Field, Fields, useBlockDraft, useSettings } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint, Section, StatusHead } from './widgets.tsx'

type Config = Settings['research']
type Schedule = Config['schedules'][number]
const blank = (id: string, name: string): Schedule => ({ id, name, timezone: 'Asia/Shanghai', start: '00:30', end: '06:30', maxWorkers: 1, model: null, timeoutSeconds: null })

type ModelChoice = { key: string; label: string; model: Schedule['model'] }
const nextScheduleId = (schedules: Schedule[]) => {
  const ids = new Set(schedules.map(item => item.id))
  let number = schedules.length + 1
  while (ids.has(`schedule-${number}`)) number++
  return `schedule-${number}`
}
const sameModel = (left: Schedule['model'], right: Schedule['model']) => left?.provider === right?.provider
  && left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort
function useModelCatalog() {
  const { call } = usePanel()
  const { data: catalog, error } = usePoll(() => call('GET models'), [call], 10_000)
  return { catalog, error: error ? errorText(error) : undefined }
}

function ResearchModelField({ value, onChange, globalModels, catalog }: {
  value: Schedule['model']; onChange: (value: Schedule['model']) => void; globalModels: ModelChoice[]; catalog?: ApiResponse<'GET models'>
}) {
  const { t } = usePanel()
  const catalogChoices: ModelChoice[] = catalog?.groups.flatMap(group => group.models.map(model => ({
    key: `catalog:${group.id}/${model.id}`,
    label: `${group.name || group.id} / ${model.name || model.id}`,
    model: { provider: group.id, model: model.id },
  }))) ?? []
  const defaultChoice: ModelChoice[] = catalog?.default ? [{ key: 'default-route', label: `${catalog.default.provider} / ${catalog.default.model}`,
    model: catalog.default }] : []
  const choices = [...globalModels, ...defaultChoice, ...catalogChoices].filter((choice, index, all) => all.findIndex(item => sameModel(item.model, choice.model)) === index)
  if (value && !choices.some(choice => sameModel(choice.model, value))) choices.push({ key: 'saved', label: `${value.provider} / ${value.model}`, model: value })
  const providerNames = new Map<string, string>()
  for (const group of catalog?.groups ?? []) providerNames.set(group.id, group.name || group.id)
  for (const choice of choices) if (choice.model && !providerNames.has(choice.model.provider)) providerNames.set(choice.model.provider, choice.model.provider)
  const provider = value?.provider ?? ''
  const models = choices.filter(choice => choice.model?.provider === provider)
  const defaultRoute = catalog?.default ? `${catalog.default.provider} / ${catalog.default.model}` : t('researchModelUnavailable')
  const selectedModel = value?.model ?? ''
  const updateProvider = (next: string) => {
    if (!next) { onChange(null); return }
    const first = choices.find(choice => choice.model?.provider === next)?.model
    onChange(first ?? null)
  }
  return <div className="dt-model">
    <Hint>{t('researchDefaultRoute', { route: defaultRoute })}</Hint>
    <div className="dt-grid2">
      <Field label={t('researchProvider')} hint={t('researchProviderHint')}><select className="dt-select" value={provider} onChange={event => updateProvider(event.target.value)}>
        <option value="">{t('researchUseDefault')}</option>{[...providerNames.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></Field>
      <Field label={t('researchModel')} hint={t('researchModelHint')}><select className="dt-select" value={selectedModel} disabled={!provider}
        onChange={event => onChange(models.find(choice => choice.model?.model === event.target.value)?.model ?? null)}>
        <option value="">{provider ? t('researchChooseModel') : t('researchUseDefault')}</option>{models.map(choice => <option key={choice.model!.model} value={choice.model!.model}>{choice.model!.model}</option>)}
      </select></Field>
    </div>
  </div>
}

function PresetField({ label, hint, value, options, onChange, format }: { label: string; hint?: string; value: number | null | undefined; options: readonly (number | undefined)[];
  onChange: (value: number | undefined) => void; format?: (value: number | undefined) => string }) {
  const values = value !== undefined && value !== null && !options.includes(value) ? [value, ...options] : options
  return <Field label={label} hint={hint}><select className="dt-select" value={value ?? ''} onChange={event => onChange(event.target.value ? Number(event.target.value) : undefined)}>
    {values.map(item => <option key={item ?? 'default'} value={item ?? ''}>{format?.(item) ?? (item === undefined ? 'DSH default' : String(item))}</option>)}
  </select></Field>
}

export function ResearchSettings() {
  const { t } = usePanel()
  const { settings } = useSettings()
  const { catalog, error: catalogError } = useModelCatalog()
  const draft = useBlockDraft('research', settings.blocks.research.value, settings.blocks.research.revision)
  const value = draft.value
  const edit = (next: Partial<Config>) => draft.edit({ ...value, ...next })
  const update = (index: number, next: Partial<Schedule>) => edit({ schedules: value.schedules.map((item, i) => i === index ? { ...item, ...next } : item) })
  const globalModels: ModelChoice[] = [
    { key: 'eval', label: t('researchUseEvalModel'), model: settings.blocks.eval.value.model },
    { key: 'executor', label: t('researchUseExecutorModel'), model: settings.blocks.executor.value.model },
  ].filter(item => item.model)
  return <div className="dt-form">
    <StatusHead hint={t('researchSettingsIntro')} settings="research" />
    <form className="dt-form dt-block" onSubmit={event => { void draft.submit(event) }}>
      <Fields disabled={draft.busy}>
        <h2 className="dt-block-title">{t('researchScheduleTitle')}<InfoTip text={t('researchScheduleHint')} /></h2>
        {catalogError && <p className="dt-error" role="alert">{t('modelCatalogError', { error: catalogError })}</p>}
        <div className="dt-card dt-research-default-schedule">
          <div className="dt-card-head"><strong className="dt-card-title">{t('researchDefaultSchedule')}</strong><span className="dt-tag" data-tone="neutral">{t('researchAllDay')}</span></div>
          <Hint>{t('researchDefaultScheduleHint', { route: catalog?.default ? `${catalog.default.provider} / ${catalog.default.model}` : t('researchModelUnavailable') })}</Hint>
        </div>
        <Section title={t('researchSchedules')} hint={t('researchSchedulesHint')} action={<Button variant="outline" size="sm" icon={<Icon name="plus" />} onClick={() => edit({ schedules: [...value.schedules, blank(nextScheduleId(value.schedules), t('researchNewSchedule'))] })}>{t('addResearchSchedule')}</Button>}>
          {value.schedules.map((item, index) => <div className="dt-card" key={item.id}>
            <div className="dt-card-head"><strong className="dt-card-title">{item.name || t('researchNewSchedule')}</strong>
              <Button variant="ghost" size="sm" icon={<Icon name="trash" />} aria-label={t('removeResearchSchedule')} title={t('removeResearchSchedule')}
                onClick={() => edit({ schedules: value.schedules.filter((_, i) => i !== index) })}>{t('remove')}</Button>
            </div>
            <div className="dt-grid3">
              <Field label={t('researchWindowName')}><Input required value={item.name} onChange={event => update(index, { name: event.target.value })} /></Field>
              <Field label={t('researchTimezone')} hint={t('researchTimezoneHint')}><Input required value={item.timezone} onChange={event => update(index, { timezone: event.target.value })} /></Field>
              <Field label={t('researchWindowStart')}><Input required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" value={item.start} onChange={event => update(index, { start: event.target.value })} /></Field>
              <Field label={t('researchWindowEnd')}><Input required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" value={item.end} onChange={event => update(index, { end: event.target.value })} /></Field>
              <PresetField label={t('researchWorkers')} value={item.maxWorkers} options={[1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]}
                onChange={maxWorkers => update(index, { maxWorkers: maxWorkers ?? 1 })} format={value => value ? String(value) : ''} />
              <PresetField label={t('researchTimeout')} hint={t('researchTimeoutHint')} value={item.timeoutSeconds} options={[undefined, 300, 600, 900, 1800, 3600]}
                onChange={timeoutSeconds => update(index, { timeoutSeconds: timeoutSeconds ?? null })} format={value => value ? t('researchTimeoutValue', { minutes: value / 60 }) : t('researchTimeoutUnlimited')} />
            </div>
            <ResearchModelField value={item.model} globalModels={globalModels} catalog={catalog} onChange={model => update(index, { model })} />
          </div>)}
          {!value.schedules.length && <Hint>{t('researchSchedulesEmpty')}</Hint>}
        </Section>
      </Fields>
      <SaveBar {...draft} onDiscard={draft.discard} />
    </form>
  </div>
}

/** Local project questions share the persistent worker and durable reply channel. */
import { useRef, useState, type FormEvent } from 'react'
import { usePoll } from './api.ts'
import { Button } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { Hint, MarkdownLite, SessionButton, When } from './widgets.tsx'

export function LocalResearchPanel() {
  const { call, t } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET research'), [call], 2000)
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'question' | 'correction'>('question')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [controlling, setControlling] = useState(false)
  const [sent, setSent] = useState(false)
  // Keep the ID after a failed/ambiguous network response so retry cannot create a second request.
  const pending = useRef<{ id: string; text: string; kind: typeof kind }>()
  const submitting = useRef(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current || !text.trim()) return
    submitting.current = true; setBusy(true); setFailure(''); setSent(false)
    const previous = pending.current
    const message = previous?.text === text.trim() && previous.kind === kind ? previous
      : { id: crypto.randomUUID(), text: text.trim(), kind }
    pending.current = message
    try {
      await call('POST research/messages', { body: message })
      pending.current = undefined; setText(''); setSent(true)
      await reload()
    } catch (error) { setFailure(errorText(error)) }
    finally { submitting.current = false; setBusy(false) }
  }
  const continuous = async (enabled: boolean) => {
    setControlling(true); setFailure('')
    try { await call('POST research/continuous', { body: { enabled } }); await reload() }
    catch (error) { setFailure(errorText(error)) }
    finally { setControlling(false) }
  }
  return <div className="dt-research">
    <section className="dt-research-hero">
      <div className="dt-research-hero-copy">
        <p className="dt-research-kicker">{t('research.title')}</p>
        <h2>{data?.name ?? t('loading')}</h2>
        {data && <p className="dt-research-path" title={data.workspace}><span className="dt-research-path-label">{t('research.workspace')}</span><code>{data.workspace}</code></p>}
      </div>
      {data && <div className="dt-research-hero-meta">
        <span className="dt-status-pill" role="status" data-state={data.continuous.error ? 'error' : data.continuous.enabled ? 'active' : 'idle'} aria-label={t(`research.loop.${data.continuous.status}` as Parameters<typeof t>[0])}>
          <span className="dt-status-pill-dot" />{t(`research.loop.${data.continuous.status}` as Parameters<typeof t>[0])}
        </span>
        <span className="dt-research-rounds"><strong>{data.continuous.totalRounds}</strong><span>{t('research.rounds')}</span></span>
      </div>}
    </section>

    {data && <div className="dt-research-grid">
      <section className="dt-research-card dt-research-compose">
        <div className="dt-research-card-head"><div><p className="dt-research-kicker">{t('research.message')}</p><h3>{t('research.question')}</h3></div>
          {data.sessions.map(session => <SessionButton key={session.sessionId} sessionId={session.sessionId}
            label={t('research.openSession')} variant="outline" />)}
        </div>
        <form className="dt-form" onSubmit={event => { void submit(event) }} aria-busy={busy}>
          <label className="dt-field">{t('research.kind')}
            <select className="dt-select" value={kind} disabled={busy}
              onChange={event => { setKind(event.target.value as typeof kind); setSent(false) }}>
              <option value="question">{t('research.question')}</option>
              <option value="correction">{t('research.correction')}</option>
            </select>
          </label>
          <label className="dt-field"><span className="dt-field-label">{t('research.message')}</span>
            <textarea className="dt-textarea" rows={5} required maxLength={20000} value={text} disabled={busy}
              aria-describedby="research-help" aria-invalid={!!failure}
              onChange={event => { setText(event.target.value); setSent(false); setFailure('') }} />
          </label>
          <div className="dt-research-form-foot"><p id="research-help" className="dt-hint">{t('research.help')}</p>
            <Button type="submit" variant="primary" disabled={busy || !data || !text.trim()}>
              {t(busy ? 'research.sending' : 'research.send')}
            </Button>
          </div>
          {failure && <p role="alert" className="dt-error">{failure}</p>}
          {sent && <p role="status" className="dt-success">{t('research.sent')}</p>}
        </form>
      </section>

      <section className="dt-research-card dt-research-status">
        <div className="dt-research-card-head"><div><p className="dt-research-kicker">{t('research.continuous')}</p><h3>{t(`research.loop.${data.continuous.status}` as Parameters<typeof t>[0])}</h3></div>
          <Button variant="outline" disabled={controlling} onClick={() => { void continuous(!data.continuous.enabled || !!data.continuous.error) }}>
            {t(controlling ? 'research.working' : !data.continuous.enabled
              ? data.continuous.error ? 'research.resume' : 'research.start' : 'research.pause')}
          </Button>
        </div>
        {data.attention && <div className="dt-research-attention" role="alert">
          <p className="dt-research-card-caption">{t('research.attention')}</p>
          <MarkdownLite text={data.attention.question} />
          <Hint>{t('research.attentionHelp')}</Hint>
        </div>}
        {data.continuous.active && <div className="dt-research-proposal">
          <p className="dt-research-card-caption">{t('research.proposal')}</p>
          <h4>{data.continuous.active.question}</h4>
          <dl className="dt-research-proposal-grid">
            <div><dt>{t('research.rationale')}</dt><dd>{data.continuous.active.rationale}</dd></div>
            <div><dt>{t('research.hypothesis')}</dt><dd>{data.continuous.active.hypothesis}</dd></div>
            <div><dt>{t('research.evidencePlan')}</dt><dd>{data.continuous.active.evidencePlan}</dd></div>
            <div><dt>{t('research.stopCondition')}</dt><dd>{data.continuous.active.stopCondition}</dd></div>
          </dl>
        </div>}
        {data.continuous.error && <p role="alert" className="dt-error">{data.continuous.error}</p>}
        <Hint>{t('research.continuousHelp')}</Hint>
        {'id' in data.continuous.schedule && <div className="dt-research-schedule" role="status">
          <p className="dt-research-card-caption">{t('research.scheduleActive')}</p>
          <p>{data.continuous.schedule.name} · {data.continuous.schedule.timezone} · {data.continuous.schedule.localTime}</p>
          <p className="dt-hint">{t('research.scheduleWorkers', { count: data.continuous.schedule.maxWorkers })} · {t('research.scheduleRunning', { running: data.continuous.activeRounds.length, count: data.continuous.schedule.maxWorkers })} · {t('research.scheduleUntil')} <When at={data.continuous.schedule.nextTransitionAt} /></p>
        </div>}
        <details open={data.continuous.candidates.length > 0}><summary><span>{t('research.frontier')}</span><span className="dt-research-disclosure-hint"><span className="dt-research-expand">{t('research.expand')}</span><span className="dt-research-collapse">{t('research.collapse')}</span></span></summary>
          {data.continuous.candidates.length === 0 && <Hint>{t('research.frontierEmpty')}</Hint>}
          {data.continuous.candidates.length > 0 && <ul className="dt-research-frontier">{data.continuous.candidates.map(candidate => <li key={candidate.id}>
            <div><strong>{candidate.question}</strong><span className="dt-row-meta">{candidate.status} · {candidate.impact}/{candidate.uncertainty}/{candidate.feasibility}</span></div>
            <p>{candidate.rationale}</p>
          </li>)}</ul>}
        </details>
        <details><summary><span>{t('research.sources')}</span><span className="dt-research-disclosure-hint"><span className="dt-research-expand">{t('research.expand')}</span><span className="dt-research-collapse">{t('research.collapse')}</span></span></summary><ul className="dt-research-sources">{data.sources.map(source =>
          <li key={source.id}><span className="dt-source-kind">{t(source.kind === 'git' ? 'research.sourceGit' : source.kind === 'directory' ? 'research.sourceDirectory' : source.kind === 'binary' ? 'research.sourceBinary' : 'research.sourcePseudocode')}</span><strong>{source.id}</strong><code>{source.path}</code><code>{source.revision}</code></li>)}</ul></details>
      </section>
      <section className="dt-research-card dt-research-checkpoints">
        <div className="dt-research-card-head"><div><p className="dt-research-kicker">{t('research.checkpoints')}</p><h3>{data.continuous.totalRounds}</h3></div><span className="dt-research-card-caption">{t('research.rounds')}</span></div>
        {data.continuous.rounds.length === 0 && <Hint>{t('research.checkpointsEmpty')}</Hint>}
        {data.continuous.rounds.length > 0 && <ul className="dt-list">{data.continuous.rounds.slice().reverse().map(round => <li className="dt-row" key={round.id}>
          <div className="dt-row-main"><p>{round.question}</p><MarkdownLite text={round.summary} />
            <p className="dt-detail"><When at={round.at} /> · {round.artifacts.map(file => file.path).join(', ')}</p>
          </div>
        </li>)}</ul>}
      </section>
    </div>}
    {error && <p role="alert" className="dt-error">{error.message}</p>}
    <section className="dt-research-history">
      <div className="dt-research-section-head"><h3>{t('research.history')}</h3><span>{data?.messages.length ?? 0}</span></div>
      {data?.messages.length === 0 && <Hint>{t('research.empty')}</Hint>}
      <ul className="dt-list">{data?.messages.slice().reverse().map(message => {
        const preview = message.replies.at(-1)?.text || message.text
        return <li className="dt-research-message" key={message.id}>
          <details>
            <summary>
              <span className="dt-research-message-summary">
                <span className="dt-row-meta">{t(message.kind === 'correction' ? 'research.correction' : 'research.question')} · <When at={message.at} /></span>
                <span className="dt-research-preview">{preview}</span>
              </span>
              <span className="dt-research-disclosure-hint"><span className="dt-research-expand">{t('research.expand')}</span><span className="dt-research-collapse">{t('research.collapse')}</span></span>
            </summary>
            <div className="dt-research-message-body">
              <MarkdownLite text={message.text} />
              {message.replies.map(reply => <div className="dt-research-reply" key={reply.id}>
                <div className="dt-row-meta">{reply.status}</div><MarkdownLite text={reply.text} />
              </div>)}
            </div>
          </details>
        </li>
      })}</ul>
    </section>
  </div>
}

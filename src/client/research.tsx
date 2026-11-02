/** Local project questions share the persistent worker and durable reply channel. */
import { useRef, useState, type FormEvent } from 'react'
import { usePoll } from './api.ts'
import { Button } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { Hint, MarkdownLite, Section, SessionButton, When } from './widgets.tsx'

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
  return <Section title={t('research.title')}>
    {data && <>
      <p>{data.name}</p><p className="dt-detail dt-mono">{data.workspace}</p>
      <details><summary>{t('research.sources')}</summary><ul>{data.sources.map(source =>
        <li key={source.id}><code>{source.id} @ {source.revision}</code></li>)}</ul></details>
    </>}
    {data && <div className="dt-block">
      <p role="status">{t('research.continuous')} · {t(`research.loop.${data.continuous.status}` as Parameters<typeof t>[0])} · {t('research.rounds')} {data.continuous.totalRounds}</p>
      {data.continuous.active && <p>{data.continuous.active.question}</p>}
      {data.continuous.error && <p role="alert" className="dt-error">{data.continuous.error}</p>}
      <Button disabled={controlling} onClick={() => { void continuous(!data.continuous.enabled || !!data.continuous.error) }}>
        {t(controlling ? 'research.sending' : !data.continuous.enabled || data.continuous.error ? 'research.start' : 'research.pause')}
      </Button>
      <Hint>{t('research.continuousHelp')}</Hint>
      <details><summary>{t('research.checkpoints')}</summary>
        <ul className="dt-list">{data.continuous.rounds.slice().reverse().map(round => <li className="dt-row" key={round.id}>
          <div className="dt-row-main"><p>{round.question}</p><MarkdownLite text={round.summary} />
            <p className="dt-detail"><When at={round.at} /> · {round.artifacts.map(file => file.path).join(', ')}</p>
          </div>
        </li>)}</ul>
      </details>
    </div>}
    {error && <p role="alert" className="dt-error">{error.message}</p>}
    <form className="dt-form dt-block" onSubmit={event => { void submit(event) }} aria-busy={busy}>
      <label className="dt-field">{t('research.kind')}
        <select className="dt-select" value={kind} disabled={busy}
          onChange={event => { setKind(event.target.value as typeof kind); setSent(false) }}>
          <option value="question">{t('research.question')}</option>
          <option value="correction">{t('research.correction')}</option>
        </select>
      </label>
      <label className="dt-field">{t('research.message')}
        <textarea className="dt-textarea" rows={4} required maxLength={20000} value={text} disabled={busy}
          aria-describedby="research-help" aria-invalid={!!failure}
          onChange={event => { setText(event.target.value); setSent(false); setFailure('') }} />
      </label>
      <p id="research-help" className="dt-hint">{t('research.help')}</p>
      {failure && <p role="alert" className="dt-error">{failure}</p>}
      {sent && <p role="status">{t('research.sent')}</p>}
      <Button type="submit" variant="primary" disabled={busy || !data || !text.trim()}>
        {t(busy ? 'research.sending' : 'research.send')}
      </Button>
    </form>
    {data?.sessions.map(session => <SessionButton key={session.sessionId} sessionId={session.sessionId}
      label={`${t('openSession')} · ${session.title}`} />)}
    {data?.messages.length === 0 && <Hint>{t('research.empty')}</Hint>}
    <ul className="dt-list">{data?.messages.slice().reverse().map(message => <li className="dt-row" key={message.id}>
      <div className="dt-row-main">
        <div className="dt-row-meta">{t(message.kind === 'correction' ? 'research.correction' : 'research.question')} · <When at={message.at} /></div>
        <MarkdownLite text={message.text} />
        {message.replies.map(reply => <div key={reply.id}>
          <div className="dt-row-meta">{reply.status}</div><MarkdownLite text={reply.text} />
        </div>)}
      </div>
    </li>)}</ul>
  </Section>
}

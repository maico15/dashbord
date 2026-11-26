import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import { RequestsStyle } from './itRequestsStyle'
import { CSS, USAGE_WINDOWS, USAGE_KINDS, fmtDate, money } from './aiRegistry/shared'
import { aiToolName } from '../lib/aiTools'

/* /ai-access/respond/:id?t=…&r=confirm|keep — where the manager lands from the
 * Slack DM's two buttons. Public, but only for the holder of the one-time token
 * in the link: it shows this one seat and nothing else, and the token is spent
 * on the first answer, so the link cannot be used to flip it later. */

export default function AIAccessRespond() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') || ''
  const [seat, setSeat] = useState(null)
  const [error, setError] = useState('')
  const [response, setResponse] = useState(params.get('r') === 'keep' ? 'keep' : 'confirm')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    api.get(`/ai-access/${id}/manager-view?t=${encodeURIComponent(token)}`)
      .then(setSeat)
      .catch(() => setError('Ссылка недействительна или уже использована. Если нужно изменить ответ — напишите в IT.'))
  }, [id, token])

  const submit = async (e) => {
    e.preventDefault()
    if (response === 'keep' && !reason.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.post(`/ai-access/${id}/manager-response?t=${encodeURIComponent(token)}`,
        { response, reason: reason.trim(), t: token })
      setDone(response)
    } catch (ex) {
      setError(String(ex.message || 'Не удалось отправить ответ'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main">
        <header className="itr-head">
          <div className="itr-head-main">
            <h1 className="itr-title">Проверка AI-доступа</h1>
            <p className="itr-sub">Платное место, которым почти не пользуются. Решение за руководителем.</p>
          </div>
        </header>

        {error && <div className="itr-err aia-error" role="alert">{error}</div>}

        {done ? (
          <section className="itr-card">
            <h2 className="itr-card-title">Спасибо, ответ записан</h2>
            <p className="itr-hint">
              {done === 'confirm' ? 'IT снимет место и отметит экономию.' : 'Место остаётся; его пересмотрят через 90 дней.'}
            </p>
          </section>
        ) : seat && (
          <form className="itr-card" onSubmit={submit}>
            <h2 className="itr-card-title">{seat.person_name}</h2>
            <p className="itr-hint">
              {seat.person_email} · {aiToolName(seat)}{seat.plan ? ` · ${seat.plan}` : ''}
              {seat.seat_cost != null && ` · ${money(seat.seat_cost, 2)}/мес`}
            </p>
            <table className="aia-ugrid">
              <thead>
                <tr>
                  <th>Обращений за</th>
                  {USAGE_KINDS.map((k) => <th key={k.key}>{k.label}</th>)}
                  <th>Всего</th>
                </tr>
              </thead>
              <tbody>
                {USAGE_WINDOWS.map((w) => (
                  <tr key={w}>
                    <td>{w} дней</td>
                    {USAGE_KINDS.map((k) => <td key={k.key}>{seat[`usage_${k.key}_${w}d`] ?? '—'}</td>)}
                    <td className={`tot${seat[`usage_${w}d`] === 0 ? ' aia-bad' : ''}`}>{seat[`usage_${w}d`] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {seat.usage_verified_at && <p className="aia-muted">Данные на {fmtDate(seat.usage_verified_at)}</p>}

            {seat.manager_response ? (
              <p className="itr-hint">Ответ уже записан {fmtDate(seat.manager_response_at)}.</p>
            ) : (
              <>
                <div className="itr-field aia-f" style={{ marginTop: 14 }}>
                  <label className="aia-radio"><input type="radio" checked={response === 'confirm'} onChange={() => setResponse('confirm')} /> Снять место</label>
                  <label className="aia-radio"><input type="radio" checked={response === 'keep'} onChange={() => setResponse('keep')} /> Оставить</label>
                </div>
                {response === 'keep' && (
                  <label className="itr-field aia-f">
                    <span className="itr-label">Зачем оставить *</span>
                    <textarea className="itr-textarea" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="В отпуске до…, проект стартует в ноябре…" />
                  </label>
                )}
                <div className="itr-actions">
                  <button className={`itr-btn ${response === 'confirm' ? 'itr-btn-danger' : 'itr-btn-primary'}`} type="submit"
                    disabled={busy || (response === 'keep' && !reason.trim())}>
                    {response === 'confirm' ? 'Снять место' : 'Оставить'}
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </main>
      <AppFooter lang="ru" />
      <style>{CSS}</style>
    </div>
  )
}

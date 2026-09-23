import { useState } from 'react'
import { Link } from 'react-router-dom'
import AppFooter from '../components/AppFooter'
import { I18N, readLang } from '../i18n/itRequests'
import { RequestsStyle, PageHead } from './itRequestsStyle'

/* Catch-all route. Without it React Router matches nothing and renders an empty
 * page — which is exactly what a URL newer than the deployed bundle looks like,
 * and impossible to tell apart from a broken build. This says which it is and
 * hands over the footer, where every real address is listed. */
export default function NotFound() {
  const [lang, setLang] = useState(() => readLang('en'))
  const t = I18N[lang]

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main">
        <PageHead title={t.notFound.title} lang={lang} onLang={setLang} />
        <section className="itr-card">
          <p className="itr-hint">{t.notFound.text}</p>
          <p style={{ marginTop: 14 }}>
            <Link className="itr-btn itr-btn-primary" to="/">{t.notFound.home}</Link>
          </p>
        </section>
      </main>
      <AppFooter lang={lang} />
    </div>
  )
}

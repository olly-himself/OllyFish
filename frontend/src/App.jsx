import { useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const API_KEY = import.meta.env.VITE_API_KEY || ''

function downloadCsv(leads) {
  const header = 'Company Name,Website,Expo Name,Expo Date'
  const rows = leads.map(l =>
    [l.companyName, l.website, l.expoName, l.expoDate]
      .map(v => `"${(v || '').replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'leads.csv'
  a.click()
}

const fish = [
  { id: 1, top: '8%',  size: 60, duration: 18, delay: 0,  dir: 1  },
  { id: 2, top: '22%', size: 40, duration: 24, delay: 5,  dir: -1 },
  { id: 3, top: '45%', size: 75, duration: 14, delay: 2,  dir: 1  },
  { id: 4, top: '63%', size: 35, duration: 28, delay: 9,  dir: -1 },
  { id: 5, top: '78%', size: 55, duration: 20, delay: 13, dir: 1  },
  { id: 6, top: '35%', size: 30, duration: 32, delay: 7,  dir: -1 },
  { id: 7, top: '90%', size: 50, duration: 16, delay: 18, dir: 1  },
]

export default function App() {
  const [url, setUrl] = useState('')
  const [expoName, setExpoName] = useState('')
  const [expoDate, setExpoDate] = useState('')
  const [status, setStatus] = useState('idle')
  const [leads, setLeads] = useState([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState([])

  const [clayUrl, setClayUrl] = useState(() => localStorage.getItem('clayUrl') || '')
  const [clayToken, setClayToken] = useState(() => localStorage.getItem('clayToken') || '')
  const [clayStatus, setClayStatus] = useState('idle') // idle | sending | done | error
  const [claySent, setClaySent] = useState(0)
  const [clayFailed, setClayFailed] = useState(0)
  const [clayTotal, setClayTotal] = useState(0)
  const [clayCompany, setClayCompany] = useState('')
  const [clayError, setClayError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('loading')
    setLeads([])
    setProgress([])
    setError('')
    setClayStatus('idle')

    try {
      const res = await fetch(`${API_URL}/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
        },
        body: JSON.stringify({ url, expoName, expoDate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scrape failed')
      setLeads(data.leads)
      setProgress(data.progress || [])
      setStatus('done')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  async function handleSendToClay() {
    if (!clayUrl) return
    localStorage.setItem('clayUrl', clayUrl)
    localStorage.setItem('clayToken', clayToken)

    setClayStatus('sending')
    setClaySent(0)
    setClayFailed(0)
    setClayTotal(leads.length)
    setClayCompany('')
    setClayError('')

    try {
      const res = await fetch(`${API_URL}/push-to-clay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
        },
        body: JSON.stringify({ leads, webhookUrl: clayUrl, authToken: clayToken }),
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'progress') {
              setClaySent(data.sent)
              setClayFailed(data.failed)
              setClayCompany(data.company)
            } else if (data.type === 'done') {
              setClaySent(data.sent)
              setClayStatus('done')
            } else if (data.type === 'error') {
              setClayError(data.message)
              setClayStatus('error')
            }
          } catch {}
        }
      }

      if (clayStatus !== 'error') setClayStatus('done')
    } catch (err) {
      setClayError(err.message)
      setClayStatus('error')
    }
  }

  const clayPct = clayTotal > 0 ? Math.round((claySent / clayTotal) * 100) : 0

  return (
    <div className="app">
      <div className="fish-layer" aria-hidden="true">
        {fish.map(f => (
          <img key={f.id} src="/OllyFish.png" className="fish" style={{
            top: f.top, width: f.size,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
            animationName: f.dir === 1 ? 'swim-right' : 'swim-left',
            transform: f.dir === -1 ? 'scaleX(-1)' : undefined,
          }} />
        ))}
      </div>

      <header>
        <h1>OllyFish</h1>
        <p>A neat little fishing project for finding the biggest fish. (made by olly)</p>
      </header>

      <form onSubmit={handleSubmit} className="scrape-form">
        <div className="field">
          <label>Directory URL</label>
          <input type="url" placeholder="https://expo-site.com/exhibitors"
            value={url} onChange={e => setUrl(e.target.value)} required />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Expo Name</label>
            <input type="text" placeholder="SaaStr Annual 2025"
              value={expoName} onChange={e => setExpoName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Expo Date</label>
            <input type="date" value={expoDate} onChange={e => setExpoDate(e.target.value)} required />
          </div>
        </div>
        <button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Working…' : 'Scrape'}
        </button>
      </form>

      {status === 'loading' && (
        <div className="progress-box">
          <div className="spinner" />
          <div className="progress-log">
            {progress.length === 0
              ? <span className="muted">Starting browser…</span>
              : progress.map((msg, i) => <div key={i}>{msg}</div>)
            }
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="error-box"><strong>Error:</strong> {error}</div>
      )}

      {status === 'done' && (
        <div className="results">
          <div className="results-header">
            <span>{leads.length} companies found for <strong>{expoName}</strong></span>
            <button className="download-btn" onClick={() => downloadCsv(leads)}>
              Download CSV
            </button>
          </div>

          {/* Clay panel */}
          <div className="clay-panel">
            {clayStatus === 'idle' && (
              <>
                <div className="clay-fields">
                  <div className="field">
                    <label>Clay Webhook URL</label>
                    <input type="url" placeholder="https://api.clay.com/v3/sources/webhook/…"
                      value={clayUrl}
                      onChange={e => setClayUrl(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Auth Token <span className="muted">(optional)</span></label>
                    <input type="password" placeholder="x-clay-webhook-auth token"
                      value={clayToken}
                      onChange={e => setClayToken(e.target.value)} />
                  </div>
                </div>
                <button className="clay-btn" onClick={handleSendToClay} disabled={!clayUrl}>
                  Send {leads.length} leads to Clay
                </button>
              </>
            )}

            {clayStatus === 'sending' && (
              <div className="clay-sending">
                <div className="clay-sending-top">
                  <div className="spinner" />
                  <span>Sending to Clay… <strong>{claySent}</strong> of <strong>{clayTotal}</strong></span>
                  {clayFailed > 0 && <span className="clay-failed">{clayFailed} failed</span>}
                </div>
                <div className="clay-bar-track">
                  <div className="clay-bar-fill" style={{ width: `${clayPct}%` }} />
                </div>
                {clayCompany && <div className="clay-company muted">{clayCompany}</div>}
              </div>
            )}

            {clayStatus === 'done' && (
              <div className="clay-done">
                <span className="clay-tick">✓</span>
                <span><strong>{claySent}</strong> leads sent to Clay</span>
                {clayFailed > 0 && <span className="clay-failed">{clayFailed} failed</span>}
              </div>
            )}

            {clayStatus === 'error' && (
              <div className="error-box">
                <strong>Clay error:</strong> {clayError}
              </div>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Company</th>
                  <th>Website</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr key={i}>
                    <td className="row-num">{i + 1}</td>
                    <td className="company-name">{lead.companyName}</td>
                    <td>
                      {lead.website
                        ? <a href={lead.website} target="_blank" rel="noreferrer">
                            {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                          </a>
                        : <span className="muted">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
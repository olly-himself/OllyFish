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

export default function App() {
  const [url, setUrl] = useState('')
  const [expoName, setExpoName] = useState('')
  const [expoDate, setExpoDate] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [leads, setLeads] = useState([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState([])

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('loading')
    setLeads([])
    setProgress([])
    setError('')

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

  const fish = [
    { id: 1, top: '8%',  size: 60,  duration: 18, delay: 0,   dir: 1  },
    { id: 2, top: '22%', size: 40,  duration: 24, delay: 5,   dir: -1 },
    { id: 3, top: '45%', size: 75,  duration: 14, delay: 2,   dir: 1  },
    { id: 4, top: '63%', size: 35,  duration: 28, delay: 9,   dir: -1 },
    { id: 5, top: '78%', size: 55,  duration: 20, delay: 13,  dir: 1  },
    { id: 6, top: '35%', size: 30,  duration: 32, delay: 7,   dir: -1 },
    { id: 7, top: '90%', size: 50,  duration: 16, delay: 18,  dir: 1  },
  ]

  return (
    <div className="app">
      <div className="fish-layer" aria-hidden="true">
        {fish.map(f => (
          <img
            key={f.id}
            src="/OllyFish.png"
            className="fish"
            style={{
              top: f.top,
              width: f.size,
              animationDuration: `${f.duration}s`,
              animationDelay: `${f.delay}s`,
              animationName: f.dir === 1 ? 'swim-right' : 'swim-left',
              transform: f.dir === -1 ? 'scaleX(-1)' : undefined,
            }}
          />
        ))}
      </div>
      <header>
        <h1>OllyFish</h1>
        <p>Paste an expo exhibitor directory URL and get a CSV ready for Apollo.io</p>
      </header>

      <form onSubmit={handleSubmit} className="scrape-form">
        <div className="field">
          <label>Directory URL</label>
          <input
            type="url"
            placeholder="https://expo-site.com/exhibitors"
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Expo Name</label>
            <input
              type="text"
              placeholder="SaaStr Annual 2025"
              value={expoName}
              onChange={e => setExpoName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Expo Date</label>
            <input
              type="date"
              value={expoDate}
              onChange={e => setExpoDate(e.target.value)}
              required
            />
          </div>
        </div>
        <button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Scraping…' : 'Scrape Exhibitors'}
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
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {status === 'done' && (
        <div className="results">
          <div className="results-header">
            <span>{leads.length} leads found for <strong>{expoName}</strong></span>
            <button className="download-btn" onClick={() => downloadCsv(leads)}>
              Download CSV
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Company Name</th>
                  <th>Website</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr key={i}>
                    <td className="row-num">{i + 1}</td>
                    <td>{lead.companyName}</td>
                    <td>
                      {lead.website
                        ? <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a>
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

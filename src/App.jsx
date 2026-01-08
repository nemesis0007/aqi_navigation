import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div id="root">
      <div className="app">
        <header className="header">
          <div style={{display: 'flex', gap: 12}}>
            <a href="https://vite.dev" target="_blank" rel="noreferrer">
              <img src={viteLogo} className="logo" alt="Vite logo" />
            </a>
            <a href="https://react.dev" target="_blank" rel="noreferrer">
              <img src={reactLogo} className="logo react" alt="React logo" />
            </a>
          </div>

          <div className="brand">
            <h1 className="title">AQI Navigation</h1>
            <p className="subtitle">Find cleaner routes — see air quality on the map.</p>
          </div>
        </header>

        <main className="card">
          <div className="controls">
            <button className="btn" onClick={() => setCount((c) => c + 1)}>
              Count is {count}
            </button>
            <button className="btn secondary" onClick={() => setCount(0)}>
              Reset
            </button>
          </div>

          <p>
            Edit <code>src/App.jsx</code> and save to test HMR
          </p>

          <p className="read-the-docs">
            Click on the Vite and React logos to learn more
          </p>
        </main>
      </div>
    </div>
  )
}

export default App

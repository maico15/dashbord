import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// Apply saved theme before first render to avoid flash
document.documentElement.setAttribute(
  'data-theme',
  localStorage.getItem('theme') || 'dark'
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

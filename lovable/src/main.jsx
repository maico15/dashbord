import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import './tailwind.css'

// Apply the saved theme before the first render so the page never flashes light.
document.documentElement.setAttribute(
  'data-theme',
  localStorage.getItem('theme') || 'dark'
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

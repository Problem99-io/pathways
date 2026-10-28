import { useEffect, useState } from 'react'
import { Home } from './components/Home'
import { Toasts, Workspace } from './components/Workspace'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function App() {
  const hash = useHash()
  const m = hash.match(/^#\/p\/([^/?]+)/)
  return (
    <>
      {m ? <Workspace id={decodeURIComponent(m[1])} key={m[1]} /> : <Home />}
      <Toasts />
    </>
  )
}

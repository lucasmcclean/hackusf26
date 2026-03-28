import { useState } from 'react'
import { useNavigate } from 'react-router'
import { createActor } from '../services/api'

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported in this browser.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      () => {
        reject(new Error('Unable to get your location. Please allow location access and try again.'))
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000,
      },
    )
  })
}

function LandingPage() {
  const navigate = useNavigate()
  const [activeRole, setActiveRole] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleModeSelection(role) {
    setError('')
    setNotice('')
    setActiveRole(role)

    try {
      let location = null

      try {
        location = await getCurrentLocation()
        console.log("Fetched location")
      } catch {
        setNotice('Location is unavailable. Continuing in local demo mode.')
      }

      const actor = await createActor({ role, location })

      sessionStorage.setItem(
        'activeActor',
        JSON.stringify({
          id: actor?.id,
          class: actor?.class || role,
          location: actor?.location ?? location,
          source: actor?.source || 'dummy',
        }),
      )

      if (actor?.source === 'dummy') {
        setNotice('WebSocket backend unavailable. Using local demo actor.')
      }

      navigate(role === 'user' ? '/user' : '/responder')
    } catch (requestError) {
      setError(requestError.message || 'Unable to continue right now.')
      setActiveRole(null)
    }
  }

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10">
      <div className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Tampa Bay Emergency Response</h1>
        <p className="mt-2 text-sm text-slate-600">Choose a mode to continue. We will request your location.</p>

        <nav
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
          aria-label="Mode selection"
        >
          <button
            type="button"
            onClick={() => handleModeSelection('user')}
            disabled={Boolean(activeRole)}
            className="rounded-md border border-slate-300 px-4 py-3 text-center text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {activeRole === 'user' ? 'Setting up User...' : 'User'}
          </button>
          <button
            type="button"
            onClick={() => handleModeSelection('responder')}
            disabled={Boolean(activeRole)}
            className="rounded-md border border-slate-300 px-4 py-3 text-center text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {activeRole === 'responder' ? 'Setting up Responder...' : 'Responder'}
          </button>
        </nav>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="mt-2 text-sm text-amber-700">{notice}</p> : null}
      </div>
    </section>
  )
}

export default LandingPage

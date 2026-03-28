import { Link } from 'react-router'

function LandingPage() {
  return (
    <section className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10">
      <div className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Tampa Bay Emergency Response</h1>
        <p className="mt-2 text-sm text-slate-600">Choose a mode to continue.</p>

        <nav
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
          aria-label="Mode selection"
        >
          <Link
            to="/user"
            className="rounded-md border border-slate-300 px-4 py-3 text-center text-sm font-medium hover:bg-slate-50"
          >
            User
          </Link>
          <Link
            to="/responder"
            className="rounded-md border border-slate-300 px-4 py-3 text-center text-sm font-medium hover:bg-slate-50"
          >
            Responder
          </Link>
        </nav>
      </div>
    </section>
  )
}

export default LandingPage

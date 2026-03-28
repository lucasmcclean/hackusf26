import { Link } from 'react-router'

function UserPage() {
  return (
    <section className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10">
      <div className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">User Mode</h1>
        <p className="mt-2 text-sm text-slate-600">
          This is the frontend User page placeholder.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Back to mode selection
        </Link>
      </div>
    </section>
  )
}

export default UserPage

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import App from './App'
import RoleSelector from './components/RoleSelctor'
import UserView from './components/UserView'
import ResponderView from './components/ResponderView'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <RoleSelector />,
      },
      {
        path: 'user',
        element: <UserView />,
      },
      {
        path: 'responder',
        element: <ResponderView />,
      },
    ],
  },
])

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  import.meta.env.DEV
    ? <RouterProvider router={router} />
    : (
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    ),
)

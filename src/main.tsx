import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CartProvider } from './cart.tsx'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { queryClient } from './lib/query'
import { AuthProvider } from './auth/AuthProvider'
import RouteError from './components/RouteError'

const router = createBrowserRouter([{
  path: '*',
  element: <AuthProvider><CartProvider><App /></CartProvider></AuthProvider>,
  errorElement: <RouteError />,
}])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

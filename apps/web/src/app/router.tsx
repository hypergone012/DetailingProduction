import { createBrowserRouter } from 'react-router'
import { RootPage } from './RootPage'
import { RouteError } from './RouteError'
import { TenantRoute } from './TenantRoute'

/**
 * /s/:slug/*        client app (code-split)
 * /s/:slug/owner/*  owner cabinet (code-split, never loaded by clients)
 *
 * One route per studio: TenantRoute picks the app itself, so moving between the studio's
 * home and its other screens never remounts the app (a `*` child does not match the bare
 * /s/:slug/ path, and an extra index route would be a different element).
 */
export const router = createBrowserRouter([
  { path: '/', element: <RootPage />, errorElement: <RouteError /> },
  { path: '/s/:slug/*', element: <TenantRoute />, errorElement: <RouteError /> },
  { path: '*', element: <RootPage /> },
])

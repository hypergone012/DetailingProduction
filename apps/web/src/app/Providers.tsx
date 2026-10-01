import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import ruRU from '@astryxdesign/core/locales/ru-RU.json'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from './queryClient'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <InternationalizationProvider locale="ru-RU" messages={{ 'ru-RU': ruRU }}>
        {children}
      </InternationalizationProvider>
    </QueryClientProvider>
  )
}

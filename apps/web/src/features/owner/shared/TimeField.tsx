import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'

/** Native time / date inputs: the platform pickers are the most usable on phones. */
export function TimeInput(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  return <Input type="time" step={300} {...props} />
}

export function DateInput(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  return <Input type="date" {...props} />
}

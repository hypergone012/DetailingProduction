import { useId } from 'react'
import { Field } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ResourceRow } from '../api/types'

/** "Any free" or a specific bay/post suitable for the service. */
export function ResourcePicker({ resources, value, onChange }: { resources: ResourceRow[]; value: string; onChange: (v: string) => void }) {
  const id = useId()
  if (resources.length <= 1) return null
  return (
    <Field id={id} label="Бокс / пост">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Любой свободный</SelectItem>
          {resources.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { formatPhoneInput } from '@/lib/phone'

export function PhoneInput({ value, onValueChange, locale, ...rest }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: string; onValueChange: (v: string) => void; locale: string }) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+7 900 000-00-00"
      value={value}
      onChange={(e) => onValueChange(formatPhoneInput(e.target.value, locale))}
      onFocus={() => {
        if (!value) onValueChange('+7 ')
      }}
      {...rest}
    />
  )
}

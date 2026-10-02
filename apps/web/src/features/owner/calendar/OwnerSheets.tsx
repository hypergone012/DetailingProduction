import { BottomSheet, BottomSheetSwitcher } from '@astryxdesign/core/BottomSheet'
import { useSheets } from '../shared/sheets'
import { BlockDetailSheet, NewBlockSheet } from './BlockSheet'
import { BookingSheet } from './BookingSheet'
import { CreateBookingSheet } from './CreateBookingSheet'
import { MoveSheet } from './MoveSheet'

/** All cabinet sheets in one switcher, driven by the URL (see shared/sheets.ts). */
export function OwnerSheets() {
  const s = useSheets()
  const active = s.bookingId ? (s.move ? 'move' : 'booking') : s.blockId ? 'block' : s.create === 'booking' ? 'new-booking' : s.create === 'block' ? 'new-block' : null
  return (
    <BottomSheetSwitcher activeSheet={active} onActiveSheetChange={(next) => (next === null ? s.close() : undefined)}>
      <BottomSheet sheetId="booking" label="Запись" height="tall">
        {active === 'booking' && <BookingSheet id={s.bookingId!} />}
      </BottomSheet>
      <BottomSheet sheetId="move" label="Перенос записи" height="tall" purpose="form">
        {active === 'move' && <MoveSheet id={s.bookingId!} />}
      </BottomSheet>
      <BottomSheet sheetId="new-booking" label="Новая запись" height="tall" purpose="form">
        {active === 'new-booking' && <CreateBookingSheet />}
      </BottomSheet>
      <BottomSheet sheetId="new-block" label="Блокировка" height="tall" purpose="form">
        {active === 'new-block' && <NewBlockSheet />}
      </BottomSheet>
      <BottomSheet sheetId="block" label="Блокировка" height="tall">
        {active === 'block' && <BlockDetailSheet id={s.blockId!} />}
      </BottomSheet>
    </BottomSheetSwitcher>
  )
}

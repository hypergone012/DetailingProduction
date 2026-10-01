import { BottomSheet, BottomSheetSwitcher } from '@astryxdesign/core/BottomSheet'
import { useBookingFlow } from './flow'
import { ConfirmStep } from './steps/ConfirmStep'
import { DoneStep } from './steps/DoneStep'
import { ServiceStep } from './steps/ServiceStep'
import { SlotStep } from './steps/SlotStep'
import { VehicleStep } from './steps/VehicleStep'

/**
 * The booking workflow: one shared native dialog (Astryx BottomSheetSwitcher), one step
 * interactive at a time, steps hand off with a continuous motion instead of separate pages.
 * Steps with typed input use purpose="form" (no accidental dismissal by swipe/scrim).
 */
export function BookingSheets() {
  const flow = useBookingFlow()
  return (
    <BottomSheetSwitcher activeSheet={flow.step} onActiveSheetChange={(next) => (next === null ? flow.close() : undefined)}>
      <BottomSheet sheetId="service" label="Выбор услуги" height="tall">
        {flow.step === 'service' && <ServiceStep />}
      </BottomSheet>
      <BottomSheet sheetId="vehicle" label="Выбор автомобиля" height="tall" purpose="form">
        {flow.step === 'vehicle' && <VehicleStep />}
      </BottomSheet>
      <BottomSheet sheetId="slot" label="Выбор даты и времени" height="tall">
        {flow.step === 'slot' && <SlotStep />}
      </BottomSheet>
      <BottomSheet sheetId="confirm" label="Подтверждение записи" height="tall" purpose="form">
        {flow.step === 'confirm' && <ConfirmStep />}
      </BottomSheet>
      <BottomSheet sheetId="done" label="Запись создана" height="tall">
        {flow.step === 'done' && <DoneStep />}
      </BottomSheet>
    </BottomSheetSwitcher>
  )
}

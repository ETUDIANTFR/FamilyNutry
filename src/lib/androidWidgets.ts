import { Capacitor, registerPlugin } from '@capacitor/core'

export type ShoppingWidgetItem = {
  id: string
  name: string
  quantity: number
}

export type CalendarWidgetItem = {
  id: string
  title: string
  dateLabel: string
}

type WidgetSyncPlugin = {
  refresh(options: { shopping: string; calendar: string; darkMode: boolean }): Promise<void>
}

const WidgetSync = registerPlugin<WidgetSyncPlugin>('WidgetSync')

export async function refreshAndroidWidgets(
  shopping: ShoppingWidgetItem[],
  calendar: CalendarWidgetItem[],
  darkMode: boolean,
) {
  if (!Capacitor.isNativePlatform()) return

  await WidgetSync.refresh({
    shopping: JSON.stringify(shopping),
    calendar: JSON.stringify(calendar),
    darkMode,
  })
}

import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import frLocale from '@fullcalendar/core/locales/fr'
import type { CalendarEvent } from './lib/supabase'

export type CalendarEventMove = {
  id: string
  start: Date | null
  end: Date | null
  allDay: boolean
}

function eventTextColor(color: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
  return luminance > 0.179 ? '#20271f' : '#ffffff'
}

type SharedCalendarProps = {
  events: CalendarEvent[]
  onDateClick: (date: Date, allDay: boolean) => void
  onEventClick: (id: string) => void
  onMove: (event: CalendarEventMove, revert: () => void) => void
}

export default function SharedCalendar({
  events,
  onDateClick,
  onEventClick,
  onMove,
}: SharedCalendarProps) {
  return (
    <div className="meal-calendar shared-calendar">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale={frLocale}
        firstDay={1}
        height="auto"
        nowIndicator
        editable
        eventDurationEditable
        dayMaxEvents
        headerToolbar={{ start: 'title', center: '', end: 'today prev,next dayGridMonth,timeGridWeek,timeGridDay,listMonth' }}
        buttonText={{ today: 'Aujourd’hui', month: 'Mois', week: 'Semaine', day: 'Jour', list: 'Agenda' }}
        events={events.map((event) => ({
          id: event.id,
          title: event.title,
          start: event.all_day ? event.starts_at.slice(0, 10) : event.starts_at,
          end: event.all_day ? event.ends_at.slice(0, 10) : event.ends_at,
          allDay: event.all_day,
          backgroundColor: event.color,
          borderColor: event.color,
          textColor: eventTextColor(event.color),
          extendedProps: { description: event.description },
        }))}
        dateClick={(info) => onDateClick(info.date, info.allDay)}
        eventClick={(info) => onEventClick(info.event.id)}
        eventDrop={(info) => onMove(info.event, info.revert)}
        eventResize={(info) => onMove(info.event, info.revert)}
      />
    </div>
  )
}

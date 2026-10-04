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

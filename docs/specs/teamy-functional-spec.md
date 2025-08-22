## Teamy-style Team Sports App — Functional Specification

### Overview
Build a mobile-first, multi-platform application to organize amateur and semi-professional team sports. The app focuses on planning events (matches, trainings), collecting member availability, composing lineups, coordinating logistics (carpool, tasks), and facilitating communication via announcements and chat. It supports single teams and multi-team clubs.

### Goals
- **Simplify coordination**: Reduce back-and-forth for attendance, lineups, and logistics.
- **Reliable notifications**: Ensure the right people receive timely reminders.
- **Coach productivity**: Make lineup building and assignment management fast.
- **Member clarity**: Each member always knows where to be, when, and what to bring/do.
- **Low-friction onboarding**: Joining a team is simple for adults and guardians.

### Non-goals
- Full league management (standings, referees marketplace) beyond basic fixtures.
- Advanced scouting/analytics; minimal stats only for attendance and minutes.
- Payment processing beyond basic dues/fee tracking (Phase 2 may extend).

### Assumptions
- Platforms: iOS, Android, responsive Web.
- Primary markets: EU/US; GDPR compliance required; multi-language support.
- Identity via email + magic link and/or password; optional SSO (Apple/Google) later.
- Push notifications, email, and in-app inbox are available.

## Personas and Roles
- **Coach/Manager**: Creates events, requests availability, selects lineup, assigns tasks, manages communications.
- **Player**: Responds to availability, views schedule, receives assignments, participates in chat.
- **Guardian**: Manages availability for one or more minor players; receives communications relevant to dependents.
- **Club Admin** (optional/Phase 2): Oversees multiple teams, standardized settings.

## Roles & Permissions (RBAC)
- **Owner** (team creator): Full admin; can transfer ownership.
- **Coach/Manager**: Manage roster, events, lineups, assignments, announcements.
- **Captain** (optional): Limited management for lineups/assignments, no team settings.
- **Member** (player/guardian): Read schedule, respond to availability, read announcements, chat.

## Core User Journeys
1. **Join a team**: Receive invite → accept → select role (player/guardian) → complete profile.
2. **Plan a match/training**: Create event → define details → request availability → send notifications.
3. **Collect availability**: Members respond → reminders auto-send → coach views response dashboard.
4. **Compose lineup** (match): Select squad, positions, minutes → publish lineup → notify selected/non-selected.
5. **Coordinate logistics**: Create carpool and task assignments → members accept/decline → track fulfillment.
6. **Day-of-event**: Members see live status, directions, last-minute changes; attendance captured.
7. **Post-event**: Record attendance, minutes (optional), notes; share summary.

## Features

### Team & Season Management
- Create team with sport, age group, competition level, home venue, season dates.
- Support multiple teams per user; quick team switcher.
- Team settings: time zone, default reminder timings, RSVP deadlines, visibility (private by default).

### Member Management
- Invite via link, email, or QR; role assignment on join.
- Player profiles: name, number, positions, contact preferences; guardian linkages to dependents.
- Status flags: active, injured, suspended, trialist.
- Bulk import (CSV) and member tags (e.g., goalkeeper, defense) for filtering.

### Events
- Types: Match, Training, Tournament, Social, Other.
- Fields: title, date/time (start/end), arrival time, venue, opponent (for matches), kit, notes, RSVP deadline, visibility (team/selected subgroup).
- Recurrence for trainings (weekly patterns, end date, exceptions).
- Calendar export (ICS per team and per user), Google/Apple/Outlook sync.

### Availability (RSVP)
- Responses: Yes, No, Maybe (with optional note and reason codes, e.g., injury, travel).
- Guardian can respond for dependents; coach can set/unset on behalf (with audit trail).
- Deadlines and auto-reminders (configurable cadence before deadline and event).
- Availability dashboard: filter by role/tags; response rate and late responders.

### Lineup & Positions (Matches)
- Squad selection (available, tentative, unavailable pools).
- Assign starting lineup and bench; positions per sport (configurable taxonomy, e.g., 4-3-3 for football).
- Minutes tracking (optional), substitutions log, jersey numbers.
- Publish lineup (optionally hide until time); notify selected/non-selected with messaging presets.

### Attendance & Check-in
- On-site check-in by member or coach; late/absent marking with reasons.
- Attendance stats per member, event type, and season.

### Assignments & Carpool
- Task templates (bring balls, first-aid, snacks, linesman, water, kit washing).
- Assign to members/guardians; accept/decline; fallback auto-reassign rules.
- Carpool: drivers offer seats, riders request; match by location; share pickup points & ETAs.

### Communications
- Announcements: one-way posts from staff to team/subgroups; require read receipt.
- Event threads: comments scoped to an event.
- Direct messages (Phase 2): 1:1 and small groups with role-based restrictions for minors.
- Media attachments (images, PDFs); basic moderation (delete by staff; report content).

### Notifications
- Channels: Push, Email, In-app.
- Triggers: new invite, event created/updated/canceled, RSVP requested, RSVP reminder, lineup published, assignment created/changed, carpool updates, day-of reminders, last-minute changes, attendance not recorded.
- Quiet hours and per-user preferences.

### Venues & Opponents
- Venue library with address, maps deep-link, surface type, indoor/outdoor, travel time estimate.
- Opponents: name, logo, contact; season fixture import (CSV) (Phase 2).

### Documents & Media
- Team documents (code of conduct, playbook), event attachments (PDF, image), photo albums (Phase 2 light gallery).

### Payments & Dues (Phase 2 optional)
- Track dues/fees per season/event; mark as paid; export CSV. Payment processing integration optional later.

### Club / Multi-team (Phase 2)
- Club-level settings, shared member directory, cross-team calendar, and broadcast announcements.

## Cross-cutting Requirements

### Authentication & Accounts
- Email + magic link as primary; password optional; SSO (Apple/Google) later.
- Guardians manage accounts for dependents; consent flow for minors.

### Authorization
- RBAC enforcement on all actions; audit log for sensitive changes (lineup publish, cancellations, proxies for RSVP).

### Localization & Internationalization
- Multi-language UI; locale-aware formatting for dates, times, numbers; team time zone setting.

### Accessibility
- WCAG 2.1 AA target; dynamic type, screen reader labels, color contrast, focus management.

### Offline & Sync
- Read-only offline for calendars and event details; queue RSVP and chat messages for retry when online.

### Performance & Reliability
- P95 app cold start < 2.5s on mid-tier devices; push delivery within 5s of trigger.
- Event list loads < 600ms on average networks; chat send ack < 300ms.

### Security & Compliance
- GDPR compliant data processing; data export and deletion per user; parental consent capture and storage.
- Data minimization; encrypted in transit; at-rest encryption for PII; scoped access tokens.

### Observability
- Structured logging, tracing for critical user flows (onboarding, RSVP, lineup publish, notifications), and error reporting.
- Metrics: daily active teams, RSVP response rate, time-to-lineup publish, notification delivery success.

## Data Model (Conceptual)
- **User**: id, name, email, phone?, locale, roles per team, notification prefs.
- **GuardianLink**: guardian_user_id, dependent_user_id, consent_status.
- **Team**: id, name, sport, season, timezone, settings.
- **Membership**: user_id, team_id, role, status, jersey_number, tags.
- **Event**: id, team_id, type, title, start_at, end_at, arrival_at, venue_id, opponent_id, notes, rsvp_deadline, recurrence.
- **Availability**: event_id, user_id, status (yes/no/maybe), note, reason_code, updated_by.
- **Lineup**: event_id, published_at, created_by.
- **LineupAssignment**: event_id, user_id, role (starter/bench), position, expected_minutes.
- **Attendance**: event_id, user_id, status (present/late/absent), minutes_played, reason_code.
- **Assignment**: event_id, type, assignee_user_id, status (assigned/accepted/declined/reassigned), notes.
- **CarpoolOffer**: event_id, driver_user_id, seats, route, pickup_points.
- **CarpoolRequest**: event_id, rider_user_id, status, matched_driver_id.
- **Announcement**: team_id, title, body, audience, requires_read_receipt.
- **ReadReceipt**: announcement_id, user_id, read_at.
- **Venue**: id, name, address, geo, notes.
- **Opponent**: id, name, logo_url, contact.
- **Media**: owner_type (team/event), owner_id, url, type.

## Notification Matrix (Examples)
- **Invite accepted**: recipients = team staff; channels = in-app/email; timing = immediate.
- **Event created**: recipients = selected audience; channels = push/email; timing = immediate.
- **RSVP request**: recipients = audience; channels = push/email; timing = at creation and N days before deadline.
- **RSVP reminder**: recipients = non-responders; channels = push/email; timing = 48h and 12h before deadline.
- **Lineup published**: recipients = whole team or selected; channels = push; timing = on publish.
- **Assignment changed**: recipients = assignee; channels = push/email; timing = immediate.
- **Day-of reminder**: recipients = attendees; channels = push; timing = 3h before arrival and 30m before start.

## API Surface (High-level)
- `POST /teams`, `GET /teams/:id`, `PATCH /teams/:id`
- `POST /teams/:id/members`, `PATCH /members/:id`, `DELETE /members/:id`
- `POST /teams/:id/events`, `GET /events/:id`, `PATCH /events/:id`, `DELETE /events/:id`
- `POST /events/:id/availability`, `GET /events/:id/availability`
- `POST /events/:id/lineup`, `GET /events/:id/lineup`, `POST /events/:id/lineup/publish`
- `POST /events/:id/attendance`, `GET /events/:id/attendance`
- `POST /events/:id/assignments`, `PATCH /assignments/:id`
- `POST /events/:id/carpool/offers`, `POST /events/:id/carpool/requests`
- `POST /teams/:id/announcements`, `GET /announcements/:id/read-receipts`
- `GET /teams/:id/calendar.ics`

## Acceptance Criteria (Selected)

### Event Creation
- Staff can create an event with required fields: title, type, start/end, venue.
- When saved, RSVP requests are created if toggled on; notifications are sent per preferences.
- Recurring training creates a series with exceptions editable per occurrence.

### Availability
- Members can respond Yes/No/Maybe and add a note; guardians can respond for dependents.
- Reminders only go to non-responders; deadlines lock further changes unless overridden by staff.

### Lineup
- Coach can select starters and bench from available/unknown members and publish the lineup.
- Publishing sends a push to all members; lineup is visible in event detail with positions.

### Assignments & Carpool
- Coach can assign tasks; assignees can accept/decline; reassignment triggers notification.
- Drivers can post available seats; riders request and see assigned driver with pickup details.

### Notifications
- Users can opt-out of email or push per category; quiet hours respected.
- All notifications appear in an in-app inbox with read state.

## MVP Scope
- Teams, members, events (match/training), availability, lineup (basic), announcements, notifications, venues, calendar export, attendance check-in, carpool (basic), assignments (basic), guardian support, multilingual UI.

## Phase 2 Candidates
- Club-level management, fixture import, richer stats, direct messages, payment tracking + processors, advanced lineup analytics, photo galleries, SSO, offline write-back for RSVP and chat.

## Metrics & KPIs
- Team weekly active rate, RSVP completion rate before deadline, time from event creation to lineup publish, notification delivery success, assignment acceptance rate, carpool fulfillment rate.

## Open Questions
- Payment processing requirements and regions?
- Direct messaging scope with minors’ safety constraints?
- Sport-specific lineup templates needed at launch?
- Data retention policies per region?

## Risks
- Notification deliverability across platforms; dependency on email providers and APNs/FCM.
- Guardian consent flows and verification requirements by region.
- Complexity creep in carpool/assignments; keep MVP simple.

---
This document is a living specification. Add sport-specific appendices (e.g., football, basketball, hockey) for positions, formations, and assignment templates as needed.



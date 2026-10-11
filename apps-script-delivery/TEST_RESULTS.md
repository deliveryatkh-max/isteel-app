# Test results (11 Oct 2026)

Nothing here was run against the live Google Sheet: the live sheet is not connected yet. The tests run the real
`Logic.gs` and `Delivery.gs` against a fake sheet that has the real SSK-DELIVERY-DATA headers and Type Record rows
with made-up TEST trucks, DNs and customers. A read-only run on a copy of the real workbook (25 Sep 2026: 533 trips,
45 plan DNs, 400 customers) also loaded every screen's data and made a correct next Trip ID (26-09-25-533).

## Backend: `TZ=Asia/Phnom_Penh node --test apps-script-delivery/tests/` (19 of 19 pass)

Numbers refer to the test items in the brief.

- ✅ setup adds Trips and Audit Log without touching other tabs
- ✅ 1, 2, 14: Gate In makes a unique Trip ID; same truck twice a day gets round 2; Cambodia time
- ✅ Trip ID keeps counting through the month after old trips
- ✅ 3, 4, 5, 11: every event is its own row on the right trip; Gate Out fills Trips
- ✅ 6, 7, 8, 9: split DN over two trips (Kim example), customer stops, statuses
- ✅ Kim example: DN-002 still pending on trip 1, delivered on trip 2 by the same truck
- ✅ 12: repeated submissions do not create duplicates
- ✅ 13: wrong associations are refused or need confirmation
- ✅ roles: each role records only its own events; no role = view only
- ✅ sessions: the Google sign-in is swapped for a 30-day session that the other apps share
- ✅ driver link: signed per trip, only delivery steps, closes with the trip
- ✅ no plan weight: Delivered needs the "whole DN" tick, else Partially Delivered
- ✅ failed delivery stays open for a later trip; canceled trip
- ✅ time correction: Supervisor only, with an Audit Log row
- ✅ 16: Gate Ins in a row never share a Trip ID
- ✅ late phone sends use the phone time; fresh sends use the server time
- ✅ search, history and quality reports
- ✅ Users screen: Admin adds and changes roles, with audit
- ✅ plan weight known but no kg typed: the "whole DN" tick finishes the DN

## Screens: `node delivery-src/tests/ui.test.js` in Chromium, phone 390×844 (17 of 17 pass)

- ✅ Security sees only the steps Type Record allows (១.ចូលថ្លឹង, ៧.ចេញពីកន្លែងថ្លឹង)
- ✅ Gate In creates a Trip ID on screen (26-10-11-008)
- ✅ Second Gate In for the same truck within 3 min is refused
- ✅ Logistics adds DN-001 and DN-002 to trip 1 (typed + from plan)
- ✅ Warehouse cannot see Gate In
- ✅ Trip screen shows driver link + QR
- ✅ Driver link records DN-001 Delivered on trip 1 without sign-in
- ✅ Same truck returns: new Trip ID, round 2, after confirming the open-trip warning (26-10-11-009)
- ✅ DN-002 added to trip 2 after the "open on another trip" warning
- ✅ DN-002 delivered on trip 2 via the trip 2 driver link
- ✅ Kim's example: DN-002 is Delivered only on trip 2; trip 1 shows it as delivered on another trip and is Completed
- ✅ DN screen lists both trips for the split DN
- ✅ Supervisor/Admin time correction writes the Audit Log
- ✅ Security does not get the correct-time button
- ✅ No signal: Gate In kept on the phone, sent automatically when back online
- ✅ English switch and dark mode render
- ✅ No sideways scrolling at 360 px

Screenshots of each step (Khmer, English, dark mode, desktop) are in the Drive folder shared in the Transport thread.

## Still to test after deployment (needs the live sheet)

- Sign-in carried over from the home menu (same `SESSION_SECRET`).
- AppSheet and the app writing to the same converted Google Sheet at the same time.
- Photo upload to the Drive folder, and the barcode scanner on a real Delivery Note.
- Speed with the full Time Log.

# Data mapping (SSK-DELIVERY-DATA)

Existing tabs, columns, formulas and rows are kept as they are. The app only **appends** rows to Time Log, and
**adds** two tabs (Trips, Audit Log). The only edits to existing cells are a role change in User Manager ROLE (logged), and
the photo cell of a row the app has just written (photos are sent a moment after the step, so saving is fast).
Changing a recorded time is turned off (Kim, 12 Oct 2026). A Supervisor/Admin can **delete** a Time Log row with a reason:
the whole row is first copied to the **Deleted Records** tab (Deleted Time · Deleted By · Reason + all Time Log columns) and to the Audit Log, so it can be put back.

## Time Log: one row per event (per DN for DN steps); columns found by header name

| Column | Written by the app |
|---|---|
| Key No. | `TripID-NN`, e.g. `26-10-12-008-03` (new number per row) |
| អ្នកកត់ត្រា | Type Record group of the user: `១.សន្តិសុខ`, `២.ភស្តុភារ`, `៣.ឃ្លាំង`, `៤.ឡាន ISI`, `៥.ឡានជួល`, `៦.ឡានអតិថិជន` |
| ស្ថានភាពដឹកជញ្ជូន | the Khmer event name exactly as in Type Record (`១.ចូលថ្លឹង` … `៩.បានប្រគល់ទំនិញ`, `x.លុបចោលការដឹកជញ្ជូន`, `x.ការដឹកជញ្ជូនបរាជ័យ`) |
| រូបថតឡាន / រូបថតទំនិញ / រូបថតបុង | Drive link of the photo (Gate In / End Loading / Arrival, Delivered, Failed) |
| ផ្លាកលេខឡាន, ឈ្មោះតៃកុង, ជើងទីប៉ុន្មាន? | from the trip (round text `ជើងទី​ N`, same as AppSheet) |
| ឃ្លាំង, ប្រើ Websling?, ទំងន់ (Kg) | End Loading: warehouse, `ប្រើ`/`មិនប្រើ`, loaded kg. Delivered: delivered kg of that DN |
| លេខបញ្ជាទិញ (SO), លេខដឹកជញ្ជូន (DN#), អតិថិជន | DN steps; SO and customer from Delivery Plan, or typed for a DN not in the plan (`ID-Name`) |
| កំណត់សំគាល់ ឬ មតិ | remark (required for Cancel and Failed) |
| User | signed-in email, or `driver-link` |
| Date of Record, Date & Time of Record | server time, Asia/Phnom_Penh (phone time only for a step sent late after no signal, max 24 h back) |
| LatLong | phone location when allowed |
| Trip ID, Master Trip ID | the Trip ID (both, as agreed) |
| Form Mode | Delivered only: `Final` (whole DN or last part) or `Partial` |
| Status of Delivery, Is Current | left empty (calculated in the app) |

## New tabs

**Trips** (one row per Gate In): Trip ID · Trip Date · Truck No. · Driver's Name · Trip Round · Gate In Time · Gate Out Time · Trip Status (Khmer).

**Audit Log**: Time · User · Action · Key No. · Trip ID · Field · Old Value · New Value · Reason.

Feature tabs (12 Oct 2026), each with its own rows:

| Tab | Columns | Written when |
|---|---|---|
| Delivery Proof | Time · Key No. · Trip ID · DN · Receiver Name · Signature · Photos · User | Delivered (receiver name at once, signature and photos a moment later), or Gate In with 2+ truck photos (first photo also goes to Time Log) |
| Customer Ratings | Time · DN · Trip ID · Truck No. · 3PL · Overall · Driver Polite · On Time · Goods OK · Comment | customer submits the rating link (one per DN and trip) |
| Site Ratings | Time · DN · Trip ID · Truck No. · 3PL · Customer · Wait · Unload Help · Access · Customer Delay · Remark · Confirmed By · Confirmed Time | driver rates the customer site; Logistics/Supervisor confirms a customer delay |
| Complaints | Complaint ID · Time · DN · Trip ID · Truck No. · 3PL · Customer · Type · Detail · Source · Recorded By · Status · Resolved Time · Resolved By · Resolution | complaint added / resolved (ID `C` + yymmdd + `-NN`) |
| Customer Sites | Customer ID · Customer Name · LatLong · Set By · Set Time | first Delivered with a location sets it; Logistics can move it (Audit Log) |
| Truck Companies | Truck No. · 3PL Company · Set By · Set Time · Truck Type | Gate In of a new rented / customer truck ("Add new truck"); Truck Type = rented / customer; offered in the plate list next time. An older tab gets the Truck Type column by itself |
| Delivery Settings | Setting · Value · Note | edited by hand (targets, alert minutes, Telegram chat id) |

3PL of a truck: ISI plates = ISI; else Truck Companies; else the driver's company in Driver List (ក្រុមហ៊ុន).

**OTIF** (per DN with a plan DELIVERY DATE in the period): on time = last Delivered date ≤ plan date; in full = DN status Delivered;
a failed leg = not OTIF; canceled DNs and confirmed customer delays are left out; credited to the 3PL of the truck that delivered last.

## Read only

User Manager (EMAIL, NAME, ROLE), Type Record (Allowed Recorders), Plate Number, Driver List, Customer, Warehouse List
(WH_CODE only; the PASSWORD column is never read out), Delivery Plan (DN, plate, driver, round, customer, SO, weight, fleet).

## Trip ID and statuses

- Trip ID `yy-mm-dd-NNN`, NNN running through the month after the highest existing number (September already reached 532).
- **Trip status** (Khmer in the Trips tab): រង់ចាំដំណើរការបន្ទាប់ → នៅកន្លែងចែកបុង → ចេញពីកន្លែងចែកបុង → នៅកន្លែងឡើងទំនិញ → កំពុងឡើងទំនិញ →
  ឡើងទំនិញរួចរាល់ → កំពុងដឹកជញ្ជូន → នៅទីតាំងអតិថិជន → បានបញ្ចប់ / បានលុបចោល.
  A trip is complete after Gate Out when every DN on it is delivered, failed, canceled, or delivered on another trip.
- **DN status** (calculated over every trip): Not Started, In Progress, Partially Delivered, Delivered, Delivery Failed, Canceled.
  Delivered = delivered kg reach the plan weight, or a Delivered step without kg was marked "whole DN / last part".

## Data-quality findings in the copy I tested (25 Sep 2026; nothing was changed)

The app's *Data quality check* screen shows these live. They need your decision before anyone corrects them:

1. Trips 26-09-22-502, -510, -511: End Loading time is earlier than Gate In.
2. Trip ID2609-233950: Arrival-Loading Area recorded three times within 3 minutes.
3. Old AppSheet rows use the trip key as Key No. on every row, and many have no DN; those trips can never reach "Completed", so the app shows them only on their own day (they stay in History).
4. Some old rows have tonnes in *ទំងន់ (Kg)* (e.g. 4.4, 1).
5. Rented and customer plates are typed free text, so the same truck can appear in two spellings.

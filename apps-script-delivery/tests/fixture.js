// Test workbook: the real SSK-DELIVERY-DATA headers and Type Record rows, with made-up trucks, DNs and customers.
'use strict';
const LOG_HEAD = ['Key No.', 'អ្នកកត់ត្រា', 'ស្ថានភាពដឹកជញ្ជូន', 'រូបថតឡាន', 'ផ្លាកលេខឡាន', 'ឈ្មោះតៃកុង', 'ជើងទីប៉ុន្មាន?', 'ឃ្លាំង',
  'លេខបញ្ជាទិញ (SO)', 'លេខដឹកជញ្ជូន (DN#)', 'អតិថិជន', 'ប្រើ Websling?', 'ទំងន់ (Kg)', 'រូបថតបុង', 'រូបថតទំនិញ', 'កំណត់សំគាល់ ឬ មតិ',
  'User', 'Date of Record', 'Date & Time of Record', 'LatLong', 'Trip ID', 'Status of Delivery', 'Form Mode', 'Master Trip ID', 'Is Current'];
const ALL_DRIVERS = '៤.ឡាន ISI|៥.ឡានជួល|៦.ឡានអតិថិជន';
const TYPES = [
  ['Delivery Status in Khmer', 'Next Status', 'Next Recorder', 'Allowed Recorders'],
  ['១.ចូលថ្លឹង', '២.ដល់កន្លែងចែកបុង', '២.ភស្តុភារ', '១.សន្តិសុខ'],
  ['២.ដល់កន្លែងចែកបុង', '៣.ចេញពីកន្លែងចែកបុង', '២.ភស្តុភារ', '២.ភស្តុភារ'],
  ['៣.ចេញពីកន្លែងចែកបុង', '៤.ដល់់ឃ្លាំង', '៣.ឃ្លាំង', '២.ភស្តុភារ'],
  ['៤.ដល់់ឃ្លាំង', '៥.ចាប់ផ្តើម ឡើងទំនិញ', '៣.ឃ្លាំង', '៣.ឃ្លាំង'],
  ['៥.ចាប់ផ្តើម ឡើងទំនិញ', '៦.ឡើងទំនិញ រួចរាល់', '៣.ឃ្លាំង', '៣.ឃ្លាំង'],
  ['៦.ឡើងទំនិញ រួចរាល់', '៧.ចេញពីកន្លែងថ្លឹង', '', '៣.ឃ្លាំង'],
  ['៧.ចេញពីកន្លែងថ្លឹង', '៨.មកដល់ទីតាំងទំលាក់', '', '១.សន្តិសុខ|' + ALL_DRIVERS],
  ['៨.មកដល់ទីតាំងទំលាក់', '៩.បានប្រគល់ទំនិញ', '', ALL_DRIVERS],
  ['៩.បានប្រគល់ទំនិញ', '', '', ALL_DRIVERS],
  ['x.លុបចោលការដឹកជញ្ជូន', '', '', ALL_DRIVERS],
  ['x.ការដឹកជញ្ជូនបរាជ័យ', '', '', ALL_DRIVERS],
];
const d = s => new Date(s);
function fixture() {
  return {
    'User Manager': [['UID', 'NAME', 'EMAIL', 'ROLE'],
      [1, 'Admin', 'admin@test.kh', 'Admin'], [2, 'Guard', 'guard@test.kh', 'Security'], [3, 'Logi', 'logi@test.kh', 'LT'],
      [4, 'Store', 'wh@test.kh', 'Warehouse'], [5, 'Sup', 'sup@test.kh', 'Supervisor'], [6, 'NoRole', 'norole@test.kh', '']],
    'Customer': [['No', 'Customer ID', 'Customer Name'], [1, '6100000001', 'TEST Customer A'], [2, '6100000002', 'TEST Customer B']],
    'Plate Number': [['លរ', 'ឈ្មោះក្រុមហ៊ុន', 'ផ្លាកលេខឡាន (ឧ: 3AB-1234)', 'ប្រភេទឡាន'], [1, '', 'TEST-0001', 'មានដងស្ទូច'], [2, '', 'TEST-0002', 'គ្មានដងស្ទូច']],
    'Driver List': [['ID_DL', 'ឈ្មោះ', 'ឈ្មោះតៃកុង', 'រូបថត', 'ក្រុមហ៊ុន', 'ប័ណ្ណបើកបរ', 'CODE'], [1, 'Driver A', '01.Driver A', '', 'ISI Steel', '', 'TEST-0001']],
    'Delivery Plan': [['DELIVERY DATE', 'PLATE NUMBER', 'DRIVER', 'TRIP INDEX', 'SCHEDULE', 'CUSTOMER ID', 'CUSTOMER NAME', 'SO NUMBER', 'DN NUMBER', 'FLEET UNIT', 'TRUCK FLEET', 'G. WEIGHT KG', '# OF DOC.', 'REMARK / REASON', 'Date+Plate+Trip', 'STATUS'],
      [d('2026-10-12T00:00:00+07:00'), 'TEST-0001', 'Driver A 100001', 'ជើងទី​ 1', 'Early Morning', 6100000001, 'TEST Customer A', 1060000001, 9000000001, '', 'ឡាន ISI', 1000, '', '', '=TEXT(A2,"dd-mm-yy")', 'ចូលរៀប'],
      [d('2026-10-12T00:00:00+07:00'), 'TEST-0001', 'Driver A 100001', 'ជើងទី​ 1', 'Early Morning', 6100000002, 'TEST Customer B', 1060000002, 9000000002, '', 'ឡាន ISI', 2000, '', '', '=TEXT(A3,"dd-mm-yy")', 'ចូលរៀប']],
    'Time Log': [LOG_HEAD,
      // one old AppSheet-style trip: Key No. = trip key on every row
      ['26-09-01-001', '៤.ឡាន ISI', '១.ចូលថ្លឹង', '', 'TEST-0002', '', '', '', '', '', '', '', 4.4, '', '', '', '', d('2026-09-01T00:00:00+07:00'), d('2026-09-01T08:36:00+07:00'), '', '', '', '', '26-09-01-001', false],
      ['26-09-01-001', '៤.ឡាន ISI', '៧.ចេញពីកន្លែងថ្លឹង', '', 'TEST-0002', '', '', '', '', '', '', '', 4.4, '', '', '', '', d('2026-09-01T00:00:00+07:00'), d('2026-09-01T10:29:00+07:00'), '', '', '', '', '26-09-01-001', true],
      ['26-10-01-007', '៤.ឡាន ISI', '១.ចូលថ្លឹង', '', 'TEST-0002', '', '', '', '', '', '', '', 1, '', '', '', '', d('2026-10-01T00:00:00+07:00'), d('2026-10-01T08:00:00+07:00'), '', '', '', '', '26-10-01-007', true]],
    'Type Record': TYPES,
    'Warehouse List': [['PASSWORD', 'WH_CODE'], ['secret1', 'PNP1'], ['secret2', 'PNP2']],
  };
}
module.exports = { fixture, LOG_HEAD };

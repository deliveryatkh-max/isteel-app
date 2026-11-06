"""Builds web/scale/scale-ticket-template.docx: the A4 weighing ticket with {{tags}} the app fills in."""
import sys
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from PIL import Image, ImageDraw

out, logo, qrpng = sys.argv[1], sys.argv[2], sys.argv[3]
FONT = 'Kantumruy Pro'
NAVY, BLUE, GREY = RGBColor(0x01, 0x1E, 0x41), RGBColor(0x0B, 0x4E, 0xA2), RGBColor(0x55, 0x55, 0x55)

# placeholder QR picture: the app swaps this picture (alt text "QR") for the ticket's QR code
im = Image.new('RGB', (300, 300), 'white')
d = ImageDraw.Draw(im)
d.rectangle([4, 4, 295, 295], outline='black', width=6)
for (x, y) in [(20, 20), (200, 20), (20, 200)]:
    d.rectangle([x, y, x + 80, y + 80], fill='black'); d.rectangle([x + 14, y + 14, x + 66, y + 66], fill='white'); d.rectangle([x + 26, y + 26, x + 54, y + 54], fill='black')
d.text((128, 140), 'QR', fill='black')
im.save(qrpng)

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(1.6)
sec.top_margin, sec.bottom_margin = Cm(1.3), Cm(1.2)
sec.header_distance = sec.footer_distance = Cm(0.6)

st = doc.styles['Normal']
st.font.name = FONT; st.font.size = Pt(10.5)
rpr = st.element.get_or_add_rPr()
rf = rpr.find(qn('w:rFonts'))
if rf is None:
    rf = OxmlElement('w:rFonts'); rpr.append(rf)
for a in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
    rf.set(qn(a), FONT)
szcs = OxmlElement('w:szCs'); szcs.set(qn('w:val'), '21'); rpr.append(szcs)
st.paragraph_format.space_after = Pt(0); st.paragraph_format.space_before = Pt(0)
st.paragraph_format.line_spacing = 1.0


def run(p, text, size=None, bold=False, color=None):
    r = p.add_run(text)
    if size: r.font.size = Pt(size); r._element.get_or_add_rPr().append(_szcs(size))
    r.bold = bold
    if bold:
        b = OxmlElement('w:bCs'); r._element.get_or_add_rPr().append(b)
    if color is not None: r.font.color.rgb = color
    return r


def _szcs(size):
    e = OxmlElement('w:szCs'); e.set(qn('w:val'), str(int(size * 2))); return e


def borders(table, color='D0D7E2', inside=True, outer=True):
    tblPr = table._tbl.tblPr
    b = OxmlElement('w:tblBorders')
    for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement('w:' + side)
        on = (side.startswith('inside') and inside) or (not side.startswith('inside') and outer)
        if side in ('left', 'right', 'insideV'):
            on = False
        e.set(qn('w:val'), 'single' if on else 'nil'); e.set(qn('w:sz'), '8'); e.set(qn('w:color'), color)
        b.append(e)
    tblPr.append(b)


def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    s = OxmlElement('w:shd'); s.set(qn('w:val'), 'clear'); s.set(qn('w:color'), 'auto'); s.set(qn('w:fill'), fill); tcPr.append(s)


def widths(table, cms):
    table.autofit = False
    for row in table.rows:
        for c, w in zip(row.cells, cms):
            c.width = Cm(w)


def pad(cell, top=60, bottom=60):
    tcPr = cell._tc.get_or_add_tcPr()
    m = OxmlElement('w:tcMar')
    for side, v in (('top', top), ('bottom', bottom), ('left', 60), ('right', 60)):
        e = OxmlElement('w:' + side); e.set(qn('w:w'), str(v)); e.set(qn('w:type'), 'dxa'); m.append(e)
    tcPr.append(m)


def rule(color='0B4EA2', sz=18):
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    bd = OxmlElement('w:pBdr'); e = OxmlElement('w:bottom')
    e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), str(sz)); e.set(qn('w:space'), '1'); e.set(qn('w:color'), color)
    bd.append(e); pPr.append(bd)
    return p


# ---- header: logo left, title right
t = doc.add_table(rows=1, cols=2)
widths(t, [8.8, 9.0])
c0, c1 = t.rows[0].cells
c0.vertical_alignment = c1.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
c0.paragraphs[0].add_run().add_picture(logo, height=Cm(1.6))
p = c1.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run(p, 'WEIGHING TICKET', 22, True, NAVY)
p = c1.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run(p, 'សំបុត្រថ្លឹងទម្ងន់', 14, True, BLUE)
rule()
p = doc.add_paragraph()
run(p, '{{CompanyName}}', 10, False, GREY)
run(p, '\t', 10)
run(p, 'Printed {{Printed}}', 10, False, GREY)
p.paragraph_format.tab_stops.add_tab_stop(Cm(17.8), alignment=2)
doc.add_paragraph()

# ---- ticket no, date, QR
t = doc.add_table(rows=2, cols=3)
widths(t, [8.2, 5.8, 3.8])
for i, (lab, tag, size) in enumerate([('Ticket No / លេខប័ណ្ណ', '{{TicketNo}}', 19), ('Date / កាលបរិច្ឆេទ', '{{Date}}', 18)]):
    p = t.rows[0].cells[i].paragraphs[0]; run(p, lab, 9.5, False, GREY)
    p = t.rows[1].cells[i].paragraphs[0]; run(p, tag, size, True, NAVY)
q = t.cell(0, 2).merge(t.cell(1, 2))
q.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
q.paragraphs[0].add_run().add_picture(qrpng, width=Cm(2.6))
# alt text so the app can find the QR picture
for dp in doc.element.body.iter(qn('wp:docPr')):
    pass
dp.set('descr', 'QR'); dp.set('title', 'QR')
doc.add_paragraph()

# ---- details
rows = [
    [('Truck No', 'លេខឡាន', '{{TruckNo}}'), ('Truck company', 'ក្រុមហ៊ុនឡាន', '{{Company}}')],
    [('Item', 'ទំនិញ', '{{Item}}'), ('Destination', 'គោលដៅ', '{{Destination}}')],
    [('DN No ({{DNCount}})', 'លេខ DN', '{{DN}}'), None],
    [('Note', 'កំណត់ចំណាំ', '{{Note}}'), None],
]
t = doc.add_table(rows=len(rows), cols=4)
borders(t)
widths(t, [2.9, 6.0, 2.9, 6.0])
for r, pair in enumerate(rows):
    cells = t.rows[r].cells
    if pair[1] is None:
        cells[1].merge(cells[3])
    for j, it in enumerate(pair):
        if it is None:
            continue
        lab, km, tag = it
        lc, vc = cells[j * 2], cells[j * 2 + 1]
        pad(lc); pad(vc)
        lc.vertical_alignment = vc.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = lc.paragraphs[0]; run(p, lab, 9, False, GREY)
        p = lc.add_paragraph(); run(p, km, 8.5, False, GREY)
        run(vc.paragraphs[0], tag, 13, True, NAVY)
doc.add_paragraph()

# ---- weights
t = doc.add_table(rows=6, cols=3)
borders(t)
widths(t, [6.6, 6.0, 5.2])
hdr = t.rows[0].cells
run(hdr[1].paragraphs[0], 'Date / Time', 9.5, True, GREY)
hdr[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
run(hdr[2].paragraphs[0], 'Weight (kg)', 9.5, True, GREY)
lines = [('1st weigh', 'ថ្លឹងលើកទី១', '{{Time1}}', '{{Weight1}}', '{{Source1}}'),
         ('2nd weigh', 'ថ្លឹងលើកទី២', '{{Time2}}', '{{Weight2}}', '{{Source2}}'),
         ('Gross', 'ទម្ងន់សរុប', '', '{{Gross}}', ''),
         ('Tare', 'ទម្ងន់ឡានទទេ', '', '{{Tare}}', ''),
         ('NET', 'ទម្ងន់សុទ្ធ', '', '{{Net}} kg', '')]
for i, (a, km, tm, w, src) in enumerate(lines, start=1):
    cs = t.rows[i].cells
    for c in cs:
        pad(c, 80, 80); c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    net = a == 'NET'
    run(cs[0].paragraphs[0], a, 15 if net else 12, True, NAVY)
    p = cs[0].add_paragraph(); run(p, km, 10 if net else 9, net, NAVY if net else GREY)
    run(cs[1].paragraphs[0], tm, 11, False, NAVY)
    p = cs[2].paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run(p, w, 24 if net else 16, True, NAVY)
    if src:
        p = cs[2].add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        run(p, src, 8, True, RGBColor(0xB3, 0x26, 0x1E))
    if net:
        for c in cs:
            shade(c, 'E8EEF8')
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(6)
run(p, '{{Warning}}', 9.5, True, RGBColor(0x8A, 0x5A, 0x00))

# ---- signatures
for _ in range(4):
    doc.add_paragraph()
t = doc.add_table(rows=2, cols=5)
widths(t, [5.2, 1.1, 5.2, 1.1, 5.2])
for j, (en, km) in zip((0, 2, 4), [('Weigher', 'អ្នកថ្លឹង'), ('Driver', 'អ្នកបើកបរ'), ('Security', 'សន្តិសុខ')]):
    c = t.cell(0, j)
    tcPr = c._tc.get_or_add_tcPr()
    b = OxmlElement('w:tcBorders'); e = OxmlElement('w:bottom')
    e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), '8'); e.set(qn('w:color'), '777777'); b.append(e); tcPr.append(b)
    c.paragraphs[0].add_run(' ')
    p = t.cell(1, j).paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(p, en, 10, True, GREY)
    p = t.cell(1, j).add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(p, km, 9.5, False, GREY)

# ---- footer (plain text: Google turns Word text boxes into blurry pictures)
fp = sec.footer.paragraphs[0]
run(fp, 'Weighed by {{Operator}} · weight read from the scale indicator · {{Status}}', 8.5, False, GREY)
fp2 = sec.footer.add_paragraph()
run(fp2, 'iSteel · Truck Scale · ISI STEEL WAREHOUSE & LOGISTICS', 8.5, False, GREY)

doc.save(out)
print('saved', out)

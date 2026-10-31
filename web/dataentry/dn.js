// Debit Note (Kim, 31 Oct 2026): the tickets of one company and period → a Word file from the Debit Note template.
// The template is a normal Word file with {{...}} words (web/dataentry/dn-template.docx, or the one an admin uploads in Settings).
// The table row holding {{item.no}} ... is repeated once per trip. Works in the browser with JSZip (free).
(function (root) {
  'use strict';
  const escXml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  // Word often splits "{{customer}}" over several pieces of text; join the pieces of each paragraph that holds a {{.
  function joinRuns(doc) {
    const ps = doc.getElementsByTagNameNS(W, 'p');
    for (let i = 0; i < ps.length; i++) {
      const ts = Array.from(ps[i].getElementsByTagNameNS(W, 't'));
      if (ts.length < 2) continue;
      const all = ts.map(x => x.textContent).join('');
      if (all.indexOf('{{') < 0) continue;
      // join only the pieces from the first {{ to the last }}, so other formatting stays
      let start = -1, end = -1, pos = 0;
      const first = all.indexOf('{{'), last = all.lastIndexOf('}}') + 2;
      ts.forEach((x, j) => { const a = pos, b = pos + x.textContent.length; if (start < 0 && b > first) start = j; if (a < last) end = j; pos = b; });
      if (start < 0 || end <= start) continue;
      let text = ''; for (let j = start; j <= end; j++) text += ts[j].textContent;
      ts[start].textContent = text; ts[start].setAttribute('xml:space', 'preserve');
      for (let j = start + 1; j <= end; j++) ts[j].textContent = '';
    }
  }
  function fillText(node, map) {
    const ts = node.getElementsByTagNameNS(W, 't');
    for (let i = 0; i < ts.length; i++) {
      const s = ts[i].textContent;
      if (s.indexOf('{{') < 0) continue;
      const v = s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (k in map ? String(map[k]) : m));
      if (v !== s) {
        // line breaks inside a value become Word line breaks
        const parts = v.split('\n');
        ts[i].textContent = parts[0]; ts[i].setAttribute('xml:space', 'preserve');
        let after = ts[i];
        for (let j = 1; j < parts.length; j++) {
          const br = node.ownerDocument.createElementNS(W, 'w:br'); const t = node.ownerDocument.createElementNS(W, 'w:t');
          t.setAttribute('xml:space', 'preserve'); t.textContent = parts[j];
          after.parentNode.insertBefore(br, after.nextSibling); br.parentNode.insertBefore(t, br.nextSibling); after = t;
        }
      }
    }
  }

  /** template: ArrayBuffer of a .docx. data: { header: {key: value}, items: [{no, date, ...}] }. Returns a Blob. */
  async function fill(template, data) {
    const zip = await JSZip.loadAsync(template);
    const name = 'word/document.xml';
    const xml = await zip.file(name).async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    joinRuns(doc);
    // repeat the row with {{item.…}}
    const rows = Array.from(doc.getElementsByTagNameNS(W, 'tr')).filter(r => /\{\{\s*item\./.test(r.textContent));
    rows.forEach(tr => {
      (data.items || []).forEach(it => {
        const c = tr.cloneNode(true); const map = {}; Object.keys(it).forEach(k => { map['item.' + k] = it[k]; });
        fillText(c, map); tr.parentNode.insertBefore(c, tr);
      });
      tr.parentNode.removeChild(tr);
    });
    fillText(doc.documentElement, data.header || {});
    zip.file(name, new XMLSerializer().serializeToString(doc));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
  root.DebitNote = { fill, escXml };
})(window);

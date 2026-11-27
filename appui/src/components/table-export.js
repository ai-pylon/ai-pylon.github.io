/* Client-side CSV and XLSX export. No render callbacks or external services. */
const AppUITableExport = (() => {
  const encoder = new TextEncoder();
  const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const scalar = value => value instanceof Date ? value.toISOString() : value == null ? '' :
    typeof value === 'object' ? JSON.stringify(value) : typeof value === 'number' && !Number.isFinite(value) ? '' : value;
  function link(value) {
    try {const url = new URL(value);return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;}
    catch (_) {return null;}
  }
  function model(columns, items) {
    const cols = columns.filter(c => c.export !== false && (!c.actions && !c.checkbox || c.exportValue));
    const rows = items.map(row => cols.map(col => ({
      value: scalar(col.exportValue ? col.exportValue(row) : col.getValue ? col.getValue(row) : row[col.id]),
      hyperlink: col.exportLink ? link(col.exportLink(row)) : null,
    })));
    return {columns: cols, rows};
  }
  function csv(data) {
    const escape = value => {
      let text = String(value ?? '');
      if (typeof value !== 'number' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return new Blob(['\uFEFF' + [data.columns.map(c => c.exportLabel || c.label || c.id),
      ...data.rows.map(row => row.map(cell => cell.value))].map(row => row.map(escape).join(',')).join('\r\n')],
      {type: 'text/csv;charset=utf-8'});
  }
  function columnName(index) {
    let name = '';
    for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
    return name;
  }
  // ZIP's stored method keeps this small and dependency-free; Excel reads it normally.
  function zip(files) {
    const parts = [], directory = [];
    let offset = 0, directorySize = 0;
    const bytes = (size, fields) => {
      const result = new Uint8Array(size), view = new DataView(result.buffer);
      fields.forEach(([at, value, width]) => width === 2 ? view.setUint16(at, value, true) : view.setUint32(at, value, true));
      return result;
    };
    for (const [path, text] of Object.entries(files)) {
      const name = encoder.encode(path), content = encoder.encode(text);
      let crc = 0xFFFFFFFF;
      for (const byte of content) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
      }
      crc = (crc ^ 0xFFFFFFFF) >>> 0;
      const header = bytes(30, [[0,0x04034b50],[4,20,2],[12,33,2],[14,crc],[18,content.length],[22,content.length],[26,name.length,2]]);
      parts.push(header, name, content);
      directory.push(bytes(46, [[0,0x02014b50],[4,20,2],[6,20,2],[14,33,2],[16,crc],[20,content.length],[24,content.length],[28,name.length,2],[42,offset]]), name);
      directorySize += 46 + name.length;
      offset += 30 + name.length + content.length;
    }
    const count = Object.keys(files).length;
    const end = bytes(22, [[0,0x06054b50],[8,count,2],[10,count,2],[12,directorySize],[16,offset]]);
    return new Blob([...parts, ...directory, end], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function xlsx(data, options) {
    if (!data.columns.length || data.columns.length > 16384 || data.rows.length > 1048575) throw new Error('XLSX requires 1–16384 columns and at most 1048575 data rows');
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const relationships = [], hyperlinks = [];
    const all = [data.columns.map(c => ({value: c.exportLabel || c.label || c.id})), ...data.rows];
    const sheetRows = all.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((cell, c) => {
      const ref = columnName(c) + (r + 1), value = cell.value;
      const style = r === 0 ? 1 : cell.hyperlink ? 2 : 0;
      if (r && cell.hyperlink) {
        const id = 'rId' + (relationships.length + 1);
        relationships.push('<Relationship Id="' + id + '" Type="' + rel + '/hyperlink" Target="' + xml(cell.hyperlink) + '" TargetMode="External"/>');
        hyperlinks.push('<hyperlink ref="' + ref + '" r:id="' + id + '"/>');
      }
      const open = '<c r="' + ref + '" s="' + style + '"';
      if (typeof value === 'number') return open + '><v>' + value + '</v></c>';
      if (typeof value === 'boolean') return open + ' t="b"><v>' + (value ? 1 : 0) + '</v></c>';
      return open + ' t="inlineStr"><is><t xml:space="preserve">' + xml(String(value).slice(0,32767)) + '</t></is></c>';
    }).join('') + '</row>').join('');
    const last = columnName(data.columns.length - 1) + all.length;
    const widths = data.columns.map((c, i) => '<col min="' + (i+1) + '" max="' + (i+1) + '" width="' + Math.max(10, Math.min(70, Number(c.exportWidth) || parseFloat(c.width) / 7 || 22)) + '" customWidth="1"/>').join('');
    const name = String(options.sheetName || 'Table').replace(/[\\/*?:\[\]]/g, ' ').replace(/^'+|'+$/g, '').slice(0,31) || 'Table';
    const files = {
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels': '<Relationships xmlns="' + pkg + '"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<workbook xmlns="' + ns + '" xmlns:r="' + rel + '"><sheets><sheet name="' + xml(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + pkg + '"><Relationship Id="rId1" Type="' + rel + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + rel + '/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml': '<styleSheet xmlns="' + ns + '"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><color rgb="FF0563C1"/><u/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + ns + '" xmlns:r="' + rel + '"><dimension ref="A1:' + last + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + widths + '</cols><sheetData>' + sheetRows + '</sheetData><autoFilter ref="A1:' + last + '"/>' + (hyperlinks.length ? '<hyperlinks>' + hyperlinks.join('') + '</hyperlinks>' : '') + '</worksheet>',
    };
    if (relationships.length) files['xl/worksheets/_rels/sheet1.xml.rels'] = '<Relationships xmlns="' + pkg + '">' + relationships.join('') + '</Relationships>';
    return zip(files);
  }
  function create({columns, items, format = 'xlsx', ...options}) {
    if (!['csv','xlsx'].includes(format)) throw new Error('Export format must be csv or xlsx');
    const data = model(columns, items);
    const blob = format === 'csv' ? csv(data) : xlsx(data, options);
    const filename = String(options.filename || 'table').replace(/\.(csv|xlsx)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_') + '.' + format;
    if (options.download !== false) {
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return {blob, filename, rows: data.rows.length};
  }
  return {create};
})();
window.AppUITableExport = AppUITableExport;

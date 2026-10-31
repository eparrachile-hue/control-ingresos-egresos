const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { exec } = require('child_process');

const PORT = process.env.PORT || 4173;
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULT_DATA = {
  condominios: [],
  ingresos: [],
  gastosFijos: [],
  gastos: [],
  bolsillos: [],
  movimientosBolsillo: []
};

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8');
    return DEFAULT_DATA;
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('data.json está corrupto: ' + err.message);
  }
}

function writeData(data) {
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DATA_FILE);
}

const app = express();

// Si se define APP_PASSWORD (por ejemplo al hospedar en internet), pide clave con HTTP Basic Auth.
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    const provided = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf-8').split(':')[1] : '';
    const a = Buffer.from(provided || '');
    const b = Buffer.from(APP_PASSWORD);
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
      res.set('WWW-Authenticate', 'Basic realm="Mis Finanzas"');
      return res.status(401).send('Autenticación requerida');
    }
    next();
  });
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (req, res) => {
  try {
    res.json(readData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/data', (req, res) => {
  try {
    writeData(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sumBy(arr, fn) {
  return arr.reduce((acc, x) => acc + fn(x), 0);
}

function addTable(ws, columns, rows) {
  ws.columns = columns;
  rows.forEach(r => ws.addRow(r));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns.forEach(col => {
    if (col.numFmt) col.eachCell({ includeEmpty: false }, (cell, rowNumber) => { if (rowNumber > 1) cell.numFmt = col.numFmt; });
  });
}

function buildWorkbook(data) {
  const money = '#,##0';
  const condNombre = id => (data.condominios.find(c => c.id === id) || {}).nombre || '(eliminado)';
  const bolsilloNombre = id => (data.bolsillos.find(b => b.id === id) || {}).nombre || '(eliminado)';
  const byMes = (a, b) => a.mes.localeCompare(b.mes);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mis Finanzas';

  const meses = [...new Set([...data.ingresos.map(i => i.mes), ...data.gastos.map(g => g.mes)])].sort();
  addTable(wb.addWorksheet('Resumen mensual'), [
    { header: 'Mes', key: 'mes', width: 12 },
    { header: 'Ingresos', key: 'ing', width: 16, numFmt: money },
    { header: 'Ingresos cobrados', key: 'ingCob', width: 18, numFmt: money },
    { header: 'Por cobrar', key: 'porCobrar', width: 14, numFmt: money },
    { header: 'Gastos fijos', key: 'gf', width: 16, numFmt: money },
    { header: 'Gastos variables', key: 'gv', width: 16, numFmt: money },
    { header: 'Gastos pagados', key: 'gPag', width: 16, numFmt: money },
    { header: 'Por pagar', key: 'porPagar', width: 14, numFmt: money },
    { header: 'Balance provisorio (ing. − gastos fijos)', key: 'balProv', width: 24, numFmt: money },
    { header: 'Balance realizado (cobrado − pagado)', key: 'balReal', width: 24, numFmt: money }
  ], meses.map(mes => {
    const ing = data.ingresos.filter(i => i.mes === mes);
    const gas = data.gastos.filter(g => g.mes === mes);
    const ingTotal = sumBy(ing, i => i.monto);
    const ingCob = sumBy(ing.filter(i => i.estado === 'pagado'), i => i.monto);
    const gf = sumBy(gas.filter(g => g.tipo === 'fijo'), g => g.monto);
    const gv = sumBy(gas.filter(g => g.tipo !== 'fijo'), g => g.monto);
    const gPag = sumBy(gas.filter(g => g.estado === 'pagado'), g => g.monto);
    return {
      mes, ing: ingTotal, ingCob, porCobrar: ingTotal - ingCob,
      gf, gv, gPag, porPagar: gf + gv - gPag,
      balProv: ingTotal - gf, balReal: ingCob - gPag
    };
  }));

  addTable(wb.addWorksheet('Ingresos'), [
    { header: 'Mes', key: 'mes', width: 12 },
    { header: 'Condominio', key: 'cond', width: 32 },
    { header: 'Monto', key: 'monto', width: 16, numFmt: money },
    { header: 'Estado', key: 'estado', width: 14 },
    { header: 'Fecha de cobro', key: 'fecha', width: 16 }
  ], [...data.ingresos].sort(byMes).map(i => ({
    mes: i.mes, cond: condNombre(i.condominioId), monto: i.monto,
    estado: i.estado === 'pagado' ? 'Cobrado' : 'Pendiente', fecha: i.fecha || ''
  })));

  addTable(wb.addWorksheet('Gastos'), [
    { header: 'Mes', key: 'mes', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Nombre', key: 'nombre', width: 32 },
    { header: 'Categoría', key: 'cat', width: 18 },
    { header: 'Monto', key: 'monto', width: 16, numFmt: money },
    { header: 'Estado', key: 'estado', width: 14 },
    { header: 'Fecha', key: 'fecha', width: 14 }
  ], [...data.gastos].sort(byMes).map(g => ({
    mes: g.mes, tipo: g.tipo === 'fijo' ? 'Fijo' : 'Variable', nombre: g.nombre, cat: g.categoria || '',
    monto: g.monto, estado: g.estado === 'pagado' ? 'Pagado' : 'Pendiente', fecha: g.fecha || ''
  })));

  addTable(wb.addWorksheet('Bolsillos'), [
    { header: 'Bolsillo', key: 'nombre', width: 28 },
    { header: 'Saldo', key: 'saldo', width: 16, numFmt: money },
    { header: 'Meta', key: 'meta', width: 16, numFmt: money }
  ], data.bolsillos.map(b => ({ nombre: b.nombre, saldo: b.saldo, meta: b.meta || '' })));

  addTable(wb.addWorksheet('Movimientos bolsillos'), [
    { header: 'Fecha', key: 'fecha', width: 14 },
    { header: 'Bolsillo', key: 'bolsillo', width: 28 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Monto', key: 'monto', width: 16, numFmt: money },
    { header: 'Nota', key: 'nota', width: 30 }
  ], data.movimientosBolsillo.map(m => ({
    fecha: m.fecha, bolsillo: bolsilloNombre(m.bolsilloId),
    tipo: m.tipo === 'deposito' ? 'Depósito' : 'Retiro', monto: m.monto, nota: m.nota || ''
  })));

  return wb;
}

app.get('/api/export.xlsx', async (req, res) => {
  try {
    const wb = buildWorkbook(readData());
    const fecha = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="finanzas-${fecha}.xlsx"`
    });
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

function openBrowser(url) {
  const openCmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(openCmd, () => {});
}

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Control de Ingresos y Egresos corriendo en ${url}`);
  // Solo intenta abrir el navegador cuando corre localmente (no en un servidor hospedado).
  if (!process.env.PORT) openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // La app ya está corriendo: basta con abrirla en el navegador.
    const url = `http://localhost:${PORT}`;
    console.log(`La app ya estaba corriendo. Abriendo ${url} ...`);
    if (!process.env.PORT) openBrowser(url);
  } else {
    console.error('No se pudo iniciar el servidor:', err.message);
    process.exitCode = 1;
  }
});

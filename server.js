const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 4173;
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

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Control de Ingresos y Egresos corriendo en ${url}`);
  const openCmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(openCmd, () => {});
});

// ---------- Estado global ----------
let state = null;
let currentMonth = monthKey(new Date());
let activeView = 'dashboard';
let saveTimer = null;

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ---------- Utilidades ----------
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(mesStr, delta) {
  const [y, m] = mesStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

function formatMonthLabel(mesStr) {
  const [y, m] = mesStr.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}

function formatMoney(n) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function genId() {
  return crypto.randomUUID();
}

function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// ---------- Persistencia ----------
async function loadData() {
  const res = await fetch('/api/data');
  state = await res.json();
}

function scheduleSave() {
  const indicator = document.getElementById('saveIndicator');
  indicator.textContent = 'Guardando…';
  indicator.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    indicator.textContent = 'Guardado';
    setTimeout(() => indicator.classList.remove('show'), 1200);
  }, 350);
}

function mutate(fn) {
  fn();
  scheduleSave();
}

// ---------- Generación mensual automática ----------
function ensureMonthGenerated(mes) {
  let changed = false;
  for (const c of state.condominios) {
    if (!c.activo) continue;
    const existe = state.ingresos.some(i => i.condominioId === c.id && i.mes === mes);
    if (!existe) {
      state.ingresos.push({ id: genId(), condominioId: c.id, mes, monto: c.montoEsperado, estado: 'pendiente', fecha: null });
      changed = true;
    }
  }
  for (const gf of state.gastosFijos) {
    if (!gf.activo) continue;
    const existe = state.gastos.some(g => g.gastoFijoId === gf.id && g.mes === mes);
    if (!existe) {
      state.gastos.push({
        id: genId(), tipo: 'fijo', gastoFijoId: gf.id,
        nombre: gf.nombre, categoria: gf.categoria, monto: gf.monto,
        mes, estado: 'pendiente', fecha: null
      });
      changed = true;
    }
  }
  if (changed) scheduleSave();
}

// ---------- Cálculos ----------
function ingresosDelMes(mes) {
  return state.ingresos.filter(i => i.mes === mes);
}
function gastosDelMes(mes, tipo) {
  return state.gastos.filter(g => g.mes === mes && (!tipo || g.tipo === tipo));
}
function sum(arr, fn) {
  return arr.reduce((acc, x) => acc + fn(x), 0);
}

function computeDisponible() {
  const totalIngresosPagados = sum(state.ingresos.filter(i => i.estado === 'pagado'), i => i.monto);
  const totalGastosPagados = sum(state.gastos.filter(g => g.estado === 'pagado'), g => g.monto);
  const totalAsignado = sum(state.bolsillos, b => b.saldo);
  return totalIngresosPagados - totalGastosPagados - totalAsignado;
}

// ---------- Navegación / vistas ----------
function switchView(view) {
  activeView = view;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${view}`));
  renderActiveView();
}

function changeMonth(delta) {
  currentMonth = shiftMonth(currentMonth, delta);
  ensureMonthGenerated(currentMonth);
  renderAll();
}

function renderMonthLabels() {
  const label = formatMonthLabel(currentMonth);
  ['currentMonthLabel', 'currentMonthLabelIng', 'currentMonthLabelGF', 'currentMonthLabelGV'].forEach(id => {
    document.getElementById(id).textContent = label;
  });
}

function renderActiveView() {
  if (activeView === 'dashboard') renderDashboard();
  else if (activeView === 'ingresos') renderIngresos();
  else if (activeView === 'gastosFijos') renderGastosFijos();
  else if (activeView === 'gastosVariables') renderGastosVariables();
  else if (activeView === 'bolsillos') renderBolsillos();
}

function renderAll() {
  renderMonthLabels();
  renderActiveView();
}

// ---------- Dashboard ----------
function renderDashboard() {
  const ingresos = ingresosDelMes(currentMonth);
  const gastos = gastosDelMes(currentMonth);
  const totalIngresos = sum(ingresos, i => i.monto);
  const totalGastos = sum(gastos, g => g.monto);
  const ingresosPagados = sum(ingresos.filter(i => i.estado === 'pagado'), i => i.monto);
  const gastosPagados = sum(gastos.filter(g => g.estado === 'pagado'), g => g.monto);
  const balance = ingresosPagados - gastosPagados;
  const totalGastosFijos = sum(gastos.filter(g => g.tipo === 'fijo'), g => g.monto);
  const balanceProvisorio = totalIngresos - totalGastosFijos;
  const pendienteCobro = sum(ingresos.filter(i => i.estado === 'pendiente'), i => i.monto);
  const pendientePago = sum(gastos.filter(g => g.estado === 'pendiente'), g => g.monto);
  const totalBolsillos = sum(state.bolsillos, b => b.saldo);

  const cards = document.getElementById('dashboardCards');
  cards.innerHTML = '';
  const cardDefs = [
    ['income', 'Ingresos del mes', formatMoney(totalIngresos)],
    ['expense', 'Gastos del mes', formatMoney(totalGastos)],
    ['balance', 'Balance realizado', formatMoney(balance), balance >= 0 ? 'positive' : 'negative'],
    ['balance', 'Balance provisorio (fijos)', formatMoney(balanceProvisorio), balanceProvisorio >= 0 ? 'positive' : 'negative', 'Ingresos fijos − gastos fijos, sin contar variables ni pagos'],
    ['pending', 'Pendiente por cobrar', formatMoney(pendienteCobro)],
    ['pending', 'Pendiente por pagar', formatMoney(pendientePago)],
    ['pockets', 'Total en bolsillos', formatMoney(totalBolsillos)],
  ];
  for (const [cls, label, value, valueCls, desc] of cardDefs) {
    cards.appendChild(h('div', { class: `stat-card ${cls}` }, [
      h('div', { class: 'label', text: label }),
      h('div', { class: `value ${valueCls || ''}`, text: value }),
      desc ? h('div', { class: 'stat-desc', text: desc }) : null
    ]));
  }

  const maxVal = Math.max(totalIngresos, totalGastos, 1);
  const barCompare = document.getElementById('barCompare');
  barCompare.innerHTML = '';
  barCompare.appendChild(h('div', { class: 'bar-row' }, [
    h('span', { class: 'bar-label', text: 'Ingresos' }),
    h('div', { class: 'bar-track' }, [h('div', { class: 'bar-fill income', style: `width:${(totalIngresos / maxVal) * 100}%` })]),
    h('span', { class: 'bar-amount', text: formatMoney(totalIngresos) })
  ]));
  barCompare.appendChild(h('div', { class: 'bar-row' }, [
    h('span', { class: 'bar-label', text: 'Gastos' }),
    h('div', { class: 'bar-track' }, [h('div', { class: 'bar-fill expense', style: `width:${(totalGastos / maxVal) * 100}%` })]),
    h('span', { class: 'bar-amount', text: formatMoney(totalGastos) })
  ]));

  const pendientesList = document.getElementById('pendientesList');
  pendientesList.innerHTML = '';
  const pendItems = [];
  for (const i of ingresos.filter(x => x.estado === 'pendiente')) {
    const c = state.condominios.find(c => c.id === i.condominioId);
    pendItems.push({ nombre: c ? c.nombre : 'Condominio', monto: i.monto, tag: 'cobrar', tagText: 'Por cobrar' });
  }
  for (const g of gastos.filter(x => x.estado === 'pendiente')) {
    pendItems.push({ nombre: g.nombre, monto: g.monto, tag: 'pagar', tagText: 'Por pagar' });
  }
  if (pendItems.length === 0) {
    pendientesList.appendChild(h('div', { class: 'empty-state', text: 'No hay pendientes este mes 🎉' }));
  } else {
    for (const p of pendItems) {
      pendientesList.appendChild(h('div', { class: 'pendiente-item' }, [
        h('span', { text: p.nombre }),
        h('span', { class: `tag ${p.tag}`, text: `${p.tagText} · ${formatMoney(p.monto)}` })
      ]));
    }
  }
}

// ---------- Ingresos ----------
function renderIngresos() {
  const list = document.getElementById('ingresosList');
  list.innerHTML = '';
  const ingresos = ingresosDelMes(currentMonth);
  if (ingresos.length === 0) {
    list.appendChild(h('div', { class: 'empty-state', text: 'Aún no tienes condominios agregados. Usa "+ Nuevo condominio".' }));
    return;
  }
  for (const ingreso of ingresos) {
    const cond = state.condominios.find(c => c.id === ingreso.condominioId);
    if (!cond) continue;
    list.appendChild(h('div', { class: 'entry-card' }, [
      h('div', { class: 'entry-main' }, [
        h('span', { class: 'entry-name', text: cond.nombre }),
        h('span', { class: 'entry-sub', text: ingreso.estado === 'pagado' && ingreso.fecha ? `Cobrado el ${ingreso.fecha}` : 'Pendiente por cobrar' })
      ]),
      h('span', { class: 'entry-amount income', text: formatMoney(ingreso.monto) }),
      h('div', { class: 'entry-actions' }, [
        h('button', {
          class: `status-toggle ${ingreso.estado}`,
          text: ingreso.estado === 'pagado' ? '✓ Pagado' : 'Pendiente',
          onclick: () => toggleIngresoEstado(ingreso)
        }),
        h('button', { class: 'icon-btn', text: '✎', onclick: () => openEditarIngresoModal(ingreso, cond) }),
        h('button', { class: 'icon-btn', text: '🗑', onclick: () => desactivarCondominio(cond) })
      ])
    ]));
  }
}

function toggleIngresoEstado(ingreso) {
  mutate(() => {
    ingreso.estado = ingreso.estado === 'pagado' ? 'pendiente' : 'pagado';
    ingreso.fecha = ingreso.estado === 'pagado' ? todayISO() : null;
  });
  renderActiveView();
}

function desactivarCondominio(cond) {
  if (!confirm(`¿Eliminar "${cond.nombre}" desde ${formatMonthLabel(currentMonth)} en adelante? El historial de meses anteriores y ya pagados se conserva.`)) return;
  mutate(() => {
    cond.activo = false;
    state.ingresos = state.ingresos.filter(i => !(i.condominioId === cond.id && i.mes >= currentMonth && i.estado !== 'pagado'));
  });
  renderActiveView();
}

// ---------- Gastos Fijos ----------
function renderGastosFijos() {
  const list = document.getElementById('gastosFijosList');
  list.innerHTML = '';
  const gastos = gastosDelMes(currentMonth, 'fijo');
  if (gastos.length === 0) {
    list.appendChild(h('div', { class: 'empty-state', text: 'Aún no tienes gastos fijos. Usa "+ Nuevo gasto fijo".' }));
    return;
  }
  for (const gasto of gastos) {
    list.appendChild(h('div', { class: 'entry-card' }, [
      h('div', { class: 'entry-main' }, [
        h('span', { class: 'entry-name', text: gasto.nombre }),
        h('span', { class: 'entry-sub', text: gasto.categoria || 'Sin categoría' })
      ]),
      h('span', { class: 'entry-amount expense', text: formatMoney(gasto.monto) }),
      h('div', { class: 'entry-actions' }, [
        h('button', {
          class: `status-toggle ${gasto.estado}`,
          text: gasto.estado === 'pagado' ? '✓ Pagado' : 'Pendiente',
          onclick: () => toggleGastoEstado(gasto)
        }),
        h('button', { class: 'icon-btn', text: '✎', onclick: () => openEditarGastoModal(gasto) }),
        h('button', { class: 'icon-btn', text: '🗑', onclick: () => desactivarGastoFijo(gasto) })
      ])
    ]));
  }
}

function toggleGastoEstado(gasto) {
  mutate(() => {
    gasto.estado = gasto.estado === 'pagado' ? 'pendiente' : 'pagado';
    gasto.fecha = gasto.estado === 'pagado' ? todayISO() : null;
  });
  renderActiveView();
}

function desactivarGastoFijo(gasto) {
  const tpl = state.gastosFijos.find(t => t.id === gasto.gastoFijoId);
  if (!confirm(`¿Eliminar "${gasto.nombre}" desde ${formatMonthLabel(currentMonth)} en adelante? El historial de meses anteriores y ya pagados se conserva.`)) return;
  mutate(() => {
    if (tpl) tpl.activo = false;
    state.gastos = state.gastos.filter(g => !(g.gastoFijoId === gasto.gastoFijoId && g.mes >= currentMonth && g.estado !== 'pagado'));
  });
  renderActiveView();
}

// ---------- Gastos Variables ----------
function renderGastosVariables() {
  const list = document.getElementById('gastosVariablesList');
  list.innerHTML = '';
  const gastos = gastosDelMes(currentMonth, 'variable');
  if (gastos.length === 0) {
    list.appendChild(h('div', { class: 'empty-state', text: 'No hay gastos variables este mes. Usa "+ Nuevo gasto".' }));
    return;
  }
  for (const gasto of gastos) {
    list.appendChild(h('div', { class: 'entry-card' }, [
      h('div', { class: 'entry-main' }, [
        h('span', { class: 'entry-name', text: gasto.nombre }),
        h('span', { class: 'entry-sub', text: `${gasto.categoria || 'Sin categoría'}${gasto.fecha ? ' · ' + gasto.fecha : ''}` })
      ]),
      h('span', { class: 'entry-amount expense', text: formatMoney(gasto.monto) }),
      h('div', { class: 'entry-actions' }, [
        h('button', {
          class: `status-toggle ${gasto.estado}`,
          text: gasto.estado === 'pagado' ? '✓ Pagado' : 'Pendiente',
          onclick: () => toggleGastoEstado(gasto)
        }),
        h('button', { class: 'icon-btn', text: '✎', onclick: () => openEditarGastoModal(gasto) }),
        h('button', { class: 'icon-btn', text: '🗑', onclick: () => eliminarGastoVariable(gasto) })
      ])
    ]));
  }
}

function eliminarGastoVariable(gasto) {
  if (!confirm(`¿Eliminar el gasto "${gasto.nombre}"?`)) return;
  mutate(() => {
    state.gastos = state.gastos.filter(g => g.id !== gasto.id);
  });
  renderActiveView();
}

// ---------- Bolsillos ----------
function renderBolsillos() {
  const disponible = computeDisponible();
  const banner = document.getElementById('disponibleBanner');
  banner.innerHTML = '';
  banner.appendChild(h('span', { class: 'label', text: 'Disponible para asignar a bolsillos' }));
  banner.appendChild(h('span', { class: 'value', text: formatMoney(disponible) }));

  const grid = document.getElementById('bolsillosGrid');
  grid.innerHTML = '';
  if (state.bolsillos.length === 0) {
    grid.appendChild(h('div', { class: 'empty-state', text: 'Aún no tienes bolsillos. Usa "+ Nuevo bolsillo" para empezar a ahorrar.' }));
    return;
  }
  for (const b of state.bolsillos) {
    const card = h('div', { class: 'pocket-card' }, [
      h('div', { class: 'pocket-top' }, [
        h('span', { class: 'pocket-icon', text: b.icono || '🐷' }),
        h('span', { class: 'pocket-name', text: b.nombre }),
        h('button', { class: 'icon-btn', text: '🗑', onclick: () => eliminarBolsillo(b) })
      ]),
      h('div', { class: 'pocket-saldo', text: formatMoney(b.saldo) })
    ]);
    if (b.meta) {
      const pct = Math.min(100, (b.saldo / b.meta) * 100);
      card.appendChild(h('div', { class: 'pocket-progress-track' }, [h('div', { class: 'pocket-progress-fill', style: `width:${pct}%` })]));
      card.appendChild(h('div', { class: 'pocket-meta-label', text: `Meta: ${formatMoney(b.meta)} (${pct.toFixed(0)}%)` }));
    }
    card.appendChild(h('div', { class: 'pocket-actions' }, [
      h('button', { class: 'btn btn-secondary btn-sm', text: '↓ Depositar', onclick: () => openMovimientoModal(b, 'deposito') }),
      h('button', { class: 'btn btn-secondary btn-sm', text: '↑ Retirar', onclick: () => openMovimientoModal(b, 'retiro') }),
      h('button', { class: 'btn btn-secondary btn-sm', text: 'Historial', onclick: () => openHistorialModal(b) })
    ]));
    grid.appendChild(card);
  }
}

function eliminarBolsillo(b) {
  if (b.saldo > 0) {
    alert('Retira el saldo del bolsillo antes de eliminarlo.');
    return;
  }
  if (!confirm(`¿Eliminar el bolsillo "${b.nombre}"?`)) return;
  mutate(() => {
    state.bolsillos = state.bolsillos.filter(x => x.id !== b.id);
    state.movimientosBolsillo = state.movimientosBolsillo.filter(m => m.bolsilloId !== b.id);
  });
  renderActiveView();
}

// ---------- Modal genérico ----------
function showModal(title, bodyEl) {
  document.getElementById('modalTitle').textContent = title;
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

function field(labelText, inputEl) {
  return h('div', { class: 'field' }, [h('label', { text: labelText }), inputEl]);
}

function buildForm(fields, onSubmit, submitLabel) {
  const form = h('form', { class: 'modal-body-form' });
  fields.forEach(f => form.appendChild(f));
  const actions = h('div', { class: 'modal-actions' }, [
    h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancelar', onclick: closeModal }),
    h('button', { type: 'submit', class: 'btn btn-primary', text: submitLabel || 'Guardar' })
  ]);
  form.appendChild(actions);
  form.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(); });
  return form;
}

// ---------- Modales: Condominio / Ingreso ----------
function openNuevoCondominioModal() {
  const nombreInput = h('input', { type: 'text', required: 'true', placeholder: 'Ej: Edificio Las Torres' });
  const montoInput = h('input', { type: 'number', required: 'true', min: '0', step: '1', placeholder: '0' });
  const form = buildForm([
    field('Nombre del condominio', nombreInput),
    field('Monto mensual esperado', montoInput)
  ], () => {
    mutate(() => {
      state.condominios.push({ id: genId(), nombre: nombreInput.value.trim(), montoEsperado: Number(montoInput.value), activo: true });
      ensureMonthGenerated(currentMonth);
    });
    closeModal();
    renderActiveView();
  }, 'Crear condominio');
  showModal('Nuevo condominio', form);
  nombreInput.focus();
}

function openEditarIngresoModal(ingreso, cond) {
  const nombreInput = h('input', { type: 'text', required: 'true', value: cond.nombre });
  const montoInput = h('input', { type: 'number', required: 'true', min: '0', step: '1', value: ingreso.monto });
  const form = buildForm([
    field('Nombre del condominio', nombreInput),
    field(`Monto (${formatMonthLabel(ingreso.mes)})`, montoInput),
    h('div', { class: 'entry-sub', text: 'El nuevo monto se aplica desde este mes hacia adelante. Los meses anteriores no cambian.' })
  ], () => {
    mutate(() => {
      cond.nombre = nombreInput.value.trim();
      const nuevoMonto = Number(montoInput.value);
      cond.montoEsperado = nuevoMonto;
      for (const i of state.ingresos) {
        if (i.condominioId === cond.id && i.mes >= ingreso.mes && i.estado !== 'pagado') {
          i.monto = nuevoMonto;
        }
      }
      ingreso.monto = nuevoMonto;
    });
    closeModal();
    renderActiveView();
  });
  showModal('Editar ingreso', form);
  nombreInput.focus();
}

// ---------- Modales: Gasto Fijo ----------
function openNuevoGastoFijoModal() {
  const nombreInput = h('input', { type: 'text', required: 'true', placeholder: 'Ej: Arriendo oficina' });
  const categoriaInput = h('input', { type: 'text', list: 'categoriasList', placeholder: 'Ej: Servicios' });
  const montoInput = h('input', { type: 'number', required: 'true', min: '0', step: '1', placeholder: '0' });
  const diaInput = h('input', { type: 'number', min: '1', max: '31', placeholder: '5' });
  const form = buildForm([
    field('Nombre', nombreInput),
    field('Categoría', categoriaInput),
    field('Monto mensual', montoInput),
    field('Día de vencimiento (opcional)', diaInput)
  ], () => {
    mutate(() => {
      state.gastosFijos.push({
        id: genId(), nombre: nombreInput.value.trim(), categoria: categoriaInput.value.trim(),
        monto: Number(montoInput.value), diaVencimiento: diaInput.value ? Number(diaInput.value) : null, activo: true
      });
      ensureMonthGenerated(currentMonth);
    });
    closeModal();
    renderActiveView();
  }, 'Crear gasto fijo');
  showModal('Nuevo gasto fijo', form);
  nombreInput.focus();
}

function openNuevoGastoVariableModal() {
  const nombreInput = h('input', { type: 'text', required: 'true', placeholder: 'Ej: Reparación ascensor' });
  const categoriaInput = h('input', { type: 'text', list: 'categoriasList', placeholder: 'Ej: Mantención' });
  const montoInput = h('input', { type: 'number', required: 'true', min: '0', step: '1', placeholder: '0' });
  const fechaInput = h('input', { type: 'date', value: todayISO() });
  const form = buildForm([
    field('Nombre', nombreInput),
    field('Categoría', categoriaInput),
    field('Monto', montoInput),
    field('Fecha', fechaInput)
  ], () => {
    mutate(() => {
      state.gastos.push({
        id: genId(), tipo: 'variable', gastoFijoId: null,
        nombre: nombreInput.value.trim(), categoria: categoriaInput.value.trim(),
        monto: Number(montoInput.value), mes: currentMonth, estado: 'pendiente', fecha: fechaInput.value || null
      });
    });
    closeModal();
    renderActiveView();
  }, 'Agregar gasto');
  showModal('Nuevo gasto variable', form);
  nombreInput.focus();
}

function openEditarGastoModal(gasto) {
  const nombreInput = h('input', { type: 'text', required: 'true', value: gasto.nombre });
  const categoriaInput = h('input', { type: 'text', list: 'categoriasList', value: gasto.categoria || '' });
  const montoInput = h('input', { type: 'number', required: 'true', min: '0', step: '1', value: gasto.monto });
  const fields = [
    field('Nombre', nombreInput),
    field('Categoría', categoriaInput),
    field(`Monto (${formatMonthLabel(gasto.mes)})`, montoInput)
  ];
  if (gasto.tipo === 'fijo') {
    fields.push(h('div', { class: 'entry-sub', text: 'El nuevo monto se aplica desde este mes hacia adelante. Los meses anteriores no cambian.' }));
  }
  const form = buildForm(fields, () => {
    mutate(() => {
      gasto.nombre = nombreInput.value.trim();
      gasto.categoria = categoriaInput.value.trim();
      const nuevoMonto = Number(montoInput.value);
      if (gasto.tipo === 'fijo') {
        const tpl = state.gastosFijos.find(t => t.id === gasto.gastoFijoId);
        if (tpl) {
          tpl.nombre = gasto.nombre;
          tpl.categoria = gasto.categoria;
          tpl.monto = nuevoMonto;
        }
        for (const g of state.gastos) {
          if (g.gastoFijoId === gasto.gastoFijoId && g.mes >= gasto.mes && g.estado !== 'pagado') {
            g.monto = nuevoMonto;
            g.nombre = gasto.nombre;
            g.categoria = gasto.categoria;
          }
        }
      }
      gasto.monto = nuevoMonto;
    });
    closeModal();
    renderActiveView();
  });
  showModal('Editar gasto', form);
  nombreInput.focus();
}

// ---------- Modales: Bolsillos ----------
function openNuevoBolsilloModal() {
  const nombreInput = h('input', { type: 'text', required: 'true', placeholder: 'Ej: Reserva mantención' });
  const iconoInput = h('input', { type: 'text', maxlength: '2', placeholder: '🐷', value: '🐷' });
  const metaInput = h('input', { type: 'number', min: '0', step: '1', placeholder: 'Opcional' });
  const form = buildForm([
    field('Nombre del bolsillo', nombreInput),
    field('Ícono (emoji)', iconoInput),
    field('Meta de ahorro (opcional)', metaInput)
  ], () => {
    mutate(() => {
      state.bolsillos.push({
        id: genId(), nombre: nombreInput.value.trim(), icono: iconoInput.value.trim() || '🐷',
        saldo: 0, meta: metaInput.value ? Number(metaInput.value) : null
      });
    });
    closeModal();
    renderActiveView();
  }, 'Crear bolsillo');
  showModal('Nuevo bolsillo', form);
  nombreInput.focus();
}

function openMovimientoModal(bolsillo, tipo) {
  const disponible = computeDisponible();
  const montoInput = h('input', { type: 'number', required: 'true', min: '1', step: '1', placeholder: '0' });
  const notaInput = h('input', { type: 'text', placeholder: 'Opcional' });
  const infoText = tipo === 'deposito'
    ? `Disponible para asignar: ${formatMoney(disponible)}`
    : `Saldo actual del bolsillo: ${formatMoney(bolsillo.saldo)}`;
  const form = buildForm([
    h('div', { class: 'entry-sub', text: infoText }),
    field('Monto', montoInput),
    field('Nota (opcional)', notaInput)
  ], () => {
    const monto = Number(montoInput.value);
    if (tipo === 'deposito' && monto > disponible) {
      alert('No tienes suficiente disponible para depositar ese monto.');
      return;
    }
    if (tipo === 'retiro' && monto > bolsillo.saldo) {
      alert('No puedes retirar más del saldo del bolsillo.');
      return;
    }
    mutate(() => {
      bolsillo.saldo += tipo === 'deposito' ? monto : -monto;
      state.movimientosBolsillo.push({ id: genId(), bolsilloId: bolsillo.id, tipo, monto, fecha: todayISO(), nota: notaInput.value.trim() });
    });
    closeModal();
    renderActiveView();
  }, tipo === 'deposito' ? 'Depositar' : 'Retirar');
  showModal(`${tipo === 'deposito' ? 'Depositar en' : 'Retirar de'} "${bolsillo.nombre}"`, form);
  montoInput.focus();
}

function openHistorialModal(bolsillo) {
  const movimientos = state.movimientosBolsillo.filter(m => m.bolsilloId === bolsillo.id).slice().reverse();
  const list = h('div', { class: 'movements-list' });
  if (movimientos.length === 0) {
    list.appendChild(h('div', { class: 'empty-state', text: 'Sin movimientos aún.' }));
  } else {
    for (const m of movimientos) {
      list.appendChild(h('div', { class: `movement-item ${m.tipo}` }, [
        h('span', { text: `${m.fecha}${m.nota ? ' · ' + m.nota : ''}` }),
        h('span', { text: `${m.tipo === 'deposito' ? '+' : '-'}${formatMoney(m.monto)}` })
      ]));
    }
  }
  const wrapper = h('div', {}, [list]);
  showModal(`Historial de "${bolsillo.nombre}"`, wrapper);
}

// ---------- Inicialización ----------
function attachStaticEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  document.getElementById('prevMonth').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonth').addEventListener('click', () => changeMonth(1));
  document.getElementById('prevMonthIng').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonthIng').addEventListener('click', () => changeMonth(1));
  document.getElementById('prevMonthGF').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonthGF').addEventListener('click', () => changeMonth(1));
  document.getElementById('prevMonthGV').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonthGV').addEventListener('click', () => changeMonth(1));

  document.getElementById('btnNuevoCondominio').addEventListener('click', openNuevoCondominioModal);
  document.getElementById('btnNuevoGastoFijo').addEventListener('click', openNuevoGastoFijoModal);
  document.getElementById('btnNuevoGastoVariable').addEventListener('click', openNuevoGastoVariableModal);
  document.getElementById('btnNuevoBolsillo').addEventListener('click', openNuevoBolsilloModal);

  const datalist = h('datalist', { id: 'categoriasList' });
  ['Servicios', 'Mantención', 'Personal', 'Seguros', 'Arriendo', 'Otros'].forEach(cat => {
    datalist.appendChild(h('option', { value: cat }));
  });
  document.body.appendChild(datalist);
}

async function init() {
  await loadData();
  ensureMonthGenerated(currentMonth);
  attachStaticEvents();
  renderAll();
}

init();

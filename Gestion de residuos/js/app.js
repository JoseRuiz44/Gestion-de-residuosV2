/*
 * ═══════════════════════════════════════════════════════════
 *  ÍNDICE DE JAVASCRIPT
 * ───────────────────────────────────────────────────────────
 *  I    · CORE
 *    I.1  Configuración global
 *    I.2  Estado de la aplicación
 *    I.3  Persistencia (save / load)
 *    I.4  Helpers DOM y utilidades
 *    I.5  Navegación entre páginas
 *
 *  II   · PLAN E HISTORIAL
 *    II.1  Creación de plan (modales)
 *    II.2  Editar / Guardar / Archivar plan
 *    II.3  Ciclo de celda del plan
 *    II.4  Sincronización de registros pendientes
 *    II.5  Render del historial principal
 *    II.6  Construcción de tarjeta de plan
 *    II.7  Detalle de retirada (solo lectura)
 *    II.8  Edición de retirada realizada
 *
 *  III  · FORMULARIO
 *    III.1 Render del formulario y dropdowns
 *    III.2 Tabla dinámica de residuos
 *    III.3 Validación de tipo
 *    III.4 Canvas de firma
 *    III.5 Guardar / Cancelar formulario
 *
 *  IV   · RESIDUOS, QR E IMPRESIÓN
 *    IV.1  Lista de residuos
 *    IV.2  Detalle de residuo
 *    IV.3  Generación y popup de QR
 *    IV.4  Motor de impresión (triggerPrint)
 *    IV.5  Estilos CSS para impresión
 *    IV.6  Imprimir plan anual
 *    IV.7  Imprimir retirada individual
 *    IV.8  Imprimir ficha de residuo
 *
 *  V    · INICIALIZACIÓN
 * ═══════════════════════════════════════════════════════════
 */

/* ════════════════════════════════════════════════════════
   I · CORE
════════════════════════════════════════════════════════ */

/* ── I.1 · Configuración global ── */
var CONFIG = {
  PARTIAL_IDS:      [41, 37],     // IDActivos parciales: Plásticos (41) + Papel y Cartón (37)
  TITULAR_ID:       1,            // IDCuenta del titular en RGPD
  PRODUCTOR_COD:    'P297857',    // Código de productor fijo
  NIMA_COD:         '2900007671', // NIMA fijo
  HIST_PRINT_LIMIT: 20,           // Máximo de registros en impresión de ficha de residuo
  BASE_URL:         window.location.href.split('?')[0]
};

var titularData  = RGPD[CONFIG.TITULAR_ID] || {};
var gestoresData = Object.values(RGPD).filter(function(c) {
  return c.IDCuenta !== CONFIG.TITULAR_ID;
});

var MONTHS      = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
var MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
                   'Septiembre','Octubre','Noviembre','Diciembre'];

/* ── I.2 · Estado de la aplicación ──
   plans[]         → planes activos {year, startP, startC, months[12], done[]}
   archivedPlans[] → planes archivados (solo lectura)
   history[]       → registros de retiradas por año
   wasteRecords    → historial de retiradas por IDActivo
   firstDone       → flag: ¿ya se creó el primer plan?

   Cada registro del historial guarda wasteRefs: mapa IDActivo→ref con el
   que fue insertado en wasteRecords, para localizarlo de forma exacta al
   editar (un único número global no sirve: los contadores por residuo
   divergen al intercalar retiradas Parciales y Completas). */
var state = {
  plans: [], archivedPlans: [], history: [],
  wasteRecords: {}, firstDone: false
};

var currentDetailItem = null;
var currentHistRec    = null;
var currentQrItem     = null;
var currentEditKey    = null;
var editMode          = false;

/* ── I.3 · Persistencia ── */
function save() {
  try { localStorage.setItem('gr_v4', JSON.stringify(state)); } catch (e) {}
}
function load() {
  try { var s = localStorage.getItem('gr_v4'); if (s) state = JSON.parse(s); } catch (e) {}
}

/* ── I.4 · Helpers DOM y utilidades ── */

/* Atajos de querySelector */
function qs(sel, ctx)  { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

/* Listener corto sobre el primer match de una clase */
function on(sel, evt, fn) { var el = qs(sel); if (el) el.addEventListener(evt, fn); }

/* Mostrar/ocultar por clase .hidden */
function toggle(sel, show) {
  var el = qs(sel);
  if (el) el.classList[show ? 'remove' : 'add']('hidden');
}

/* Abrir/cerrar overlay o modal por clase .active */
function setActive(sel, active) {
  var el = qs(sel);
  if (el) el.classList[active ? 'add' : 'remove']('active');
}

/* Asigna textContent de forma segura */
function setText(sel, val) {
  var el = qs(sel);
  if (el) el.textContent = val || '—';
}

/* Escape HTML para datos de usuario inyectados vía innerHTML */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Busca un registro del historial por su clave "year_month" */
function findRecord(key) {
  var found = null;
  state.history.forEach(function(h) {
    h.records.forEach(function(r) { if (r.key === key) found = r; });
  });
  return found;
}

/* Filtra residuos según tipo: P=parciales fijos, C=todos */
function getItemsByTipo(tipo) {
  if (tipo === 'P') return items.filter(function(i) {
    return CONFIG.PARTIAL_IDS.indexOf(i.IDActivo) !== -1;
  });
  return items;
}

/* Peligrosidad y emoji según campo tcod */
function esPeligroso(item) { return item.tcod === 'PEL'; }
function hazardIco(item)   { return esPeligroso(item) ? '⚠️' : '♻️'; }

/* Etiqueta legible del tipo de recogida */
function tipoLabel(t) { return t === 'P' ? 'Parcial' : 'Completa'; }

/* Nombre limpio del residuo sin sufijo " - LER XXXX" */
function nombreResiduo(item) {
  return item.Nombre ? item.Nombre.split(' - ')[0] : '—';
}

/* Código de tratamiento desde Observaciones */
function tratResiduo(item) {
  return item.Observaciones
    ? item.Observaciones.replace(/C[oó]digo Tratamiento:/i, '').trim() || '—'
    : '—';
}

/* Gestor más reciente para un residuo, o el primero disponible */
function getGestorForItem(id) {
  var recs   = state.wasteRecords[id] || [];
  var lastGN = recs.length ? recs[recs.length - 1].gestor : null;
  return lastGN
    ? gestoresData.find(function(x) { return (x.NombreAbreviado || x.Nombre) === lastGN; }) || gestoresData[0] || {}
    : gestoresData[0] || {};
}

/* Extrae número de autorización del campo Notas del gestor */
function getAutorizacion(g) {
  var m = g.Notas ? g.Notas.match(/Gestor\s+([A-Z]+\s*[\w\/\-]+)/i) : null;
  return m ? m[1].replace(/_$/, '').trim() : '—';
}

/* Rellena un <select> de gestores, preseleccionando por nombre */
function fillGestorSelect(sel, selectedName) {
  sel.innerHTML = '';
  gestoresData.forEach(function(g) {
    var opt = document.createElement('option');
    opt.value = g.IDCuenta;
    opt.textContent = g.NombreAbreviado || g.Nombre;
    if ((g.NombreAbreviado || g.Nombre) === selectedName) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* Resuelve nombre del gestor a partir del IDCuenta seleccionado en un <select> */
function gestorNombreById(id) {
  var g = gestoresData.find(function(x) { return x.IDCuenta == id; }) || {};
  return g.NombreAbreviado || g.Nombre || '';
}

/* ── I.5 · Navegación entre páginas ── */
function showPage(pg) {
  qsa('.page').forEach(function(p) { p.classList.remove('active'); });
  var t = qs('.page[data-page="' + pg + '"]');
  if (t) t.classList.add('active');
}

function setNav(pg) {
  qsa('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var t = qs('.nav-item[data-page="' + pg + '"]');
  if (t) t.classList.add('active');
}

var PAGE_RENDER = {
  historial: renderHistorial,
  residuos:  renderWasteList,
  nueva:     renderForm
};

qsa('.nav-item').forEach(function(n) {
  n.addEventListener('click', function() {
    var pg = this.getAttribute('data-page');
    setNav(pg); showPage(pg);
    if (PAGE_RENDER[pg]) PAGE_RENDER[pg]();
  });
});

/* Apertura directa desde QR: detecta ?residuo=ID en la URL */
function checkUrlParam() {
  var match = window.location.search.match(/[?&]residuo=(\d+)/);
  if (!match) return;
  setNav('residuos'); showPage('residuos');
  renderWasteList();
  openWasteDetail(parseInt(match[1]));
}


/* ════════════════════════════════════════════════════════
   II · PLAN E HISTORIAL
════════════════════════════════════════════════════════ */

/* ── II.1 · Creación de plan (modales) ──
   Solo puede existir un plan activo a la vez */
on('.js-btn-new', 'click', function() {
  if (state.plans.length > 0) {
    alert('Ya existe un plan activo (Plan ' + state.plans[state.plans.length - 1].year +
          '). Archívalo antes de crear uno nuevo.');
    return;
  }
  if (!state.firstDone) {
    setActive('.js-modal-first', true);
  } else {
    var years = state.archivedPlans.map(function(p) { return p.year; });
    var maxY  = years.length ? Math.max.apply(null, years) : new Date().getFullYear();
    qs('.js-np-year').value = maxY + 1;
    setActive('.js-modal-new', true);
  }
});

on('.js-fp-confirm', 'click', function() {
  var year = parseInt(qs('.js-fp-year').value);
  var sp   = qs('.js-fp-startP').value;
  var sc   = qs('.js-fp-startC').value;
  if (!year || !sp || !sc) { alert('Completa todos los campos.'); return; }
  state.firstDone = true;
  addPlan(year, sp, sc);
  setActive('.js-modal-first', false);
  save(); renderHistorial();
});
on('.js-fp-cancel', 'click', function() { setActive('.js-modal-first', false); });

on('.js-np-confirm', 'click', function() {
  var year = parseInt(qs('.js-np-year').value);
  if (!year) { alert('Año inválido.'); return; }
  var allYears = state.plans.concat(state.archivedPlans).map(function(p) { return p.year; });
  if (allYears.indexOf(year) !== -1) { alert('Ya existe un plan para ese año.'); return; }
  addPlan(year, null, null);
  setActive('.js-modal-new', false);
  save(); renderHistorial();
});
on('.js-np-cancel', 'click', function() { setActive('.js-modal-new', false); });

/* Crea un plan activo y su entrada de historial asociada */
function addPlan(year, startP, startC) {
  state.plans.push({
    year: year, startP: startP, startC: startC,
    months: new Array(12).fill(0),
    done: []
  });
  state.history.push({ year: year, records: [] });
}

/* ── II.2 · Editar / Guardar / Archivar plan ── */
on('.js-btn-edit', 'click', function() {
  editMode = true;
  toggle('.js-btn-edit', false);
  toggle('.js-btn-save', true);
  renderHistorial();
});

on('.js-btn-save', 'click', function() {
  editMode = false;
  toggle('.js-btn-save', false);
  toggle('.js-btn-edit', true);
  save(); renderHistorial();
});

on('.js-btn-archive', 'click', function() {
  if (!state.plans.length) return;
  var plan    = state.plans[state.plans.length - 1];
  var hist    = state.history.find(function(h) { return h.year === plan.year; });
  var pending = hist ? hist.records.filter(function(r) { return !r.done; }).length : 0;
  if (pending > 0) {
    alert('No se puede archivar: quedan ' + pending + ' retirada(s) pendiente(s).');
    return;
  }
  if (!confirm('¿Archivar el Plan ' + plan.year + '? No podrá editarse.')) return;
  plan.archived = true;
  state.archivedPlans.push(plan);
  state.plans.splice(state.plans.length - 1, 1);
  editMode = false;
  save(); renderHistorial();
});

/* ── II.3 · Ciclo de celda del plan ──
   Alterna: vacío → Parcial → Completa → vacío
   Solo en modo edición y sobre celdas no completadas */
window.cycleCell = function(year, month) {
  var plan = state.plans.find(function(p) { return p.year === year; });
  if (!plan || plan.done.find(function(d) { return d.plannedMonth === month; })) return;
  plan.months[month] = (plan.months[month] + 1) % 3;
  syncPending(year);
  save(); renderHistorial();
};

/* ── II.4 · Sincronización de registros pendientes ──
   Reconstruye los pendientes del historial a partir del estado del plan.
   Los registros completados se conservan intactos. */
function syncPending(year) {
  var plan = state.plans.find(function(p) { return p.year === year; });
  var hist = state.history.find(function(h) { return h.year === year; });
  if (!plan || !hist) return;
  var doneRecs = hist.records.filter(function(r) { return r.done; });
  var doneKeys = doneRecs.map(function(r) { return r.key; });
  var pending  = [];
  for (var m = 0; m < 12; m++) {
    var st = plan.months[m];
    if (!st) continue;
    var key = year + '_' + m;
    if (doneKeys.indexOf(key) === -1) {
      pending.push({ key: key, tipo: st === 1 ? 'P' : 'C', plannedMonth: m, year: year, done: false });
    }
  }
  hist.records = doneRecs.concat(pending);
}

/* ── II.5 · Render del historial principal ── */
function renderHistorial() {
  var c         = qs('.js-hist-container');
  var hasActive = state.plans.length > 0;

  toggle('.js-btn-edit',    hasActive && !editMode);
  toggle('.js-btn-save',    hasActive &&  editMode);
  toggle('.js-btn-archive', hasActive);

  if (!hasActive && !state.archivedPlans.length) {
    c.innerHTML = '<div class="empty-state">No hay ningún plan anual. Pulsa <strong>&#10133; Nuevo Plan</strong> para crear el primero.</div>';
    return;
  }

  var html = '';
  if (hasActive) {
    html += buildPlanCard(state.plans[state.plans.length - 1], true, editMode, true);
  }
  state.archivedPlans.slice().sort(function(a, b) { return b.year - a.year; }).forEach(function(plan) {
    html += buildPlanCard(plan, false, false, false);
  });
  c.innerHTML = html;
}

/* ── II.6 · Construcción de tarjeta de plan ──
   Genera: cabecera colapsable + tabla 3 filas + tabla de registros */
function buildPlanCard(plan, open, editable, isActive) {
  var hist    = state.history.find(function(h) { return h.year === plan.year; }) || { records: [] };
  var done    = hist.records.filter(function(r) { return r.done; }).length;
  var pending = hist.records.length - done;
  var archTag = plan.archived ? ' <span class="tag tag-arch">Archivado</span>' : '';

  var html = '<div class="plan-card">';

  html += '<div class="plan-card-header" onclick="togglePlanCard(this)">';
  html += '<span class="plan-card-title">Plan Anual ' + plan.year + archTag + '</span>';
  html += '<span class="plan-card-meta">Realizadas: ' + done + ' · Pendientes: ' + pending + '</span>';
  html += '<span class="plan-card-arrow">' + (open ? '&#9650;' : '&#9660;') + '</span>';
  html += '</div>';
  html += '<div class="plan-card-body' + (open ? ' open' : '') + '">';

  html += '<div class="plan-card-actions">';
  html += '<button class="btn-pdf" title="Imprimir plan" onclick="printPlan(' + plan.year + ')">&#128438;</button>';
  html += '</div>';

  /* Tabla 3 filas */
  html += '<div class="plan-wrap"><table class="plan-tbl"><thead><tr>';
  html += '<th class="col-label">Tipo</th>';
  MONTHS.forEach(function(m) { html += '<th>' + m + '</th>'; });
  html += '</tr></thead><tbody>';

  /* Fila — estimada: "Parcial" / "Completa", celda completa coloreada */
  html += '<tr><td class="col-label">Fecha estimada</td>';
  for (var m = 0; m < 12; m++) {
    var st        = plan.months[m];
    var doneEntry = plan.done.find(function(d) { return d.plannedMonth === m; });
    var stClass   = ['st-empty', 'st-P', 'st-C'][st];
    var label     = st === 1 ? 'Parcial' : st === 2 ? 'Completa' : '';
    var canClick  = editable && !doneEntry;
    var onclick   = canClick ? ' onclick="cycleCell(' + plan.year + ',' + m + ')"' : '';
    html += '<td><div class="mcell ' + stClass + (canClick ? ' clickable' : '') + '"' + onclick + '>' + label + '</div></td>';
  }
  html += '</tr>';

  /* Fila — real: ✓ en el mes ejecutado */
  html += '<tr><td class="col-label">Fecha Real</td>';
  for (var m = 0; m < 12; m++) {
    var rd = plan.done.find(function(d) { return d.realMonth === m; });
    html += '<td><div class="rcell ' + (rd ? 'done' : 'empty') + '">' + (rd ? '&#10004;' : '') + '</div></td>';
  }
  html += '</tr></tbody></table></div>';

  /* Tabla de registros de retiradas */
  if (hist.records.length) {
    html += '<div class="records-table"><table>';
    html += '<thead><tr><th>Estado<th>F. Prevista<th>F. Efectiva<th>Tipo<th>Gestora<th></tr></thead><tbody>';

    hist.records.slice().sort(function(a, b) { return a.plannedMonth - b.plannedMonth; }).forEach(function(r) {
      if (r.done) {
        html += '<tr class="row-done">';
        html += '<td><span class="status-done">&#10004; Realizada</span>';
        html += '<td>' + MONTHS[r.plannedMonth] + ' ' + plan.year;
        html += '<td>' + esc(r.fecha);
        html += '<td><span class="tag tag-' + r.tipo + '">' + tipoLabel(r.tipo) + '</span>';
        html += '<td>' + esc(r.gestor);
        html += '<td class="no-wrap">';
        html += '<button class="btn-act" title="Ver detalle" onclick="event.stopPropagation();openHistRecord(\'' + r.key + '\',' + plan.year + ')">&#128065;</button> ';
        if (isActive) {
          html += '<button class="btn-act" title="Editar retirada" onclick="event.stopPropagation();openEditRecord(\'' + r.key + '\')">&#9998;</button> ';
        }
        html += '<button class="btn-act" title="Imprimir retirada" onclick="event.stopPropagation();printRecord(\'' + r.key + '\',' + plan.year + ')">&#128438;</button>';
      } else {
        html += '<tr class="row-pending">';
        html += '<td><span class="status-pending">— Pendiente</span>';
        html += '<td>' + MONTHS[r.plannedMonth] + ' ' + plan.year;
        html += '<td>—';
        html += '<td><span class="tag tag-' + r.tipo + '">' + tipoLabel(r.tipo) + '</span>';
        html += '<td>—<td>';
      }
    });
    html += '</tbody></table></div>';
  }

  html += '</div></div>';
  return html;
}

/* Despliega o pliega una tarjeta al pulsar su cabecera */
window.togglePlanCard = function(header) {
  var body   = header.nextElementSibling;
  var arrow  = qs('.plan-card-arrow', header);
  var isOpen = body.classList.contains('open');
  body.classList[isOpen ? 'remove' : 'add']('open');
  arrow.innerHTML = isOpen ? '&#9660;' : '&#9650;';
};

/* ── II.7 · Detalle de retirada (solo lectura) ── */
window.openHistRecord = function(key, year) {
  var hist = state.history.find(function(h) { return h.year === year; });
  if (!hist) return;
  var r = hist.records.find(function(rec) { return rec.key === key; });
  if (!r || !r.done) return;
  currentHistRec = { record: r, year: year };

  setText('.js-hr-title',  MONTHS[r.plannedMonth] + ' ' + year + ' — ' + tipoLabel(r.tipo));
  setText('.js-hr-resp',   r.responsable);
  setText('.js-hr-fecha',  r.fecha);
  setText('.js-hr-tipo',   tipoLabel(r.tipo));
  setText('.js-hr-gestor', r.gestor);
  qs('.js-hr-inc').textContent = r.incidencias || '—';

  qs('.js-hr-waste-body').innerHTML = getItemsByTipo(r.tipo).map(function(item) {
    var w = r.weights ? r.weights[item.IDActivo] || 0 : 0;
    var p = r.photoNames ? r.photoNames[item.IDActivo] || '—' : '—';
    return '<tr><td>' + nombreResiduo(item) + '<td>' + item.Referencia +
           '<td>' + item.Serie + '<td>' + w + ' Kg<td>' + esc(p);
  }).join('');

  var hrCanvas = qs('.js-hr-sig-canvas');
  clearCanvas(hrCanvas);
  drawSignature(hrCanvas, r.sigData);
  showPage('hist-rec');
};

on('.js-back-hist-rec', 'click', function() {
  showPage('historial'); setNav('historial');
});
on('.js-hr-print', 'click', function() {
  if (currentHistRec) printRecord(currentHistRec.record.key, currentHistRec.year);
});

/* ── II.8 · Edición de retirada realizada ──
   Editable: responsable, fecha, tipo, gestor, incidencias, pesos.
   No editable: firma del gestor.
   La localización del wasteRecord exacto se hace por wasteRefs[IDActivo]
   (ref único por residuo); fallback a wasteRef global y a recs[0]
   para registros creados antes de esta corrección. */
window.openEditRecord = function(key) {
  var r = findRecord(key);
  if (!r || !r.done) return;
  currentEditKey = key;

  qs('.js-edit-title').textContent = 'Editar — ' + MONTHS[r.plannedMonth] + ' ' + r.year;
  qs('.js-edit-resp').value        = r.responsable || '';
  qs('.js-edit-fecha').value       = r.fecha       || '';
  qs('.js-edit-tipo').value        = r.tipo        || 'P';
  qs('.js-edit-incidencias').value = r.incidencias || '';

  fillGestorSelect(qs('.js-edit-gestor'), r.gestor);

  qs('.js-edit-weights-body').innerHTML = getItemsByTipo(r.tipo).map(function(item) {
    var peso = r.weights ? r.weights[item.IDActivo] || 0 : 0;
    return '<div class="form-row">' +
      '<label class="text-xs">' + nombreResiduo(item) + '</label>' +
      '<input type="number" class="edit-w-inp" data-id="' + item.IDActivo + '" value="' + peso + '" min="0" step="0.1">' +
      '</div>';
  }).join('');

  setActive('.js-modal-edit', true);
};

on('.js-edit-cancel', 'click', function() {
  setActive('.js-modal-edit', false);
  currentEditKey = null;
});

on('.js-edit-confirm', 'click', function() {
  if (!currentEditKey) return;
  var r = findRecord(currentEditKey);
  if (!r) return;

  var gestorVal  = gestorNombreById(qs('.js-edit-gestor').value);
  var nuevaFecha = qs('.js-edit-fecha').value;
  var nuevoTipo  = qs('.js-edit-tipo').value;

  var weights = {};
  qsa('.edit-w-inp').forEach(function(inp) {
    weights[inp.getAttribute('data-id')] = parseFloat(inp.value) || 0;
  });

  /* Si cambia la fecha, actualizar el mes real en plan.done */
  if (nuevaFecha && nuevaFecha !== r.fecha) {
    var plan = state.plans.find(function(p) { return p.year === r.year; });
    var rm   = new Date(nuevaFecha).getMonth();
    if (plan) {
      var d = plan.done.find(function(x) { return x.plannedMonth === r.plannedMonth; });
      if (d) d.realMonth = rm;
    }
    r.realMonth = rm;
  }

  r.responsable = qs('.js-edit-resp').value.trim();
  r.fecha       = nuevaFecha;
  r.tipo        = nuevoTipo;
  r.gestor      = gestorVal;
  r.incidencias = qs('.js-edit-incidencias').value.trim();
  r.weights     = weights;

  /* Actualizar wasteRecords localizando el registro exacto por residuo */
  r.wasteRefs = r.wasteRefs || {};
  getItemsByTipo(nuevoTipo).forEach(function(item) {
    var id   = item.IDActivo;
    var recs = state.wasteRecords[id] || [];
    var ref  = r.wasteRefs[id];
    var wr   = ref != null ? recs.find(function(x) { return x.ref === ref; }) : null;
    /* Fallbacks para registros previos a la corrección */
    if (!wr && r.wasteRef != null) wr = recs.find(function(x) { return x.ref === r.wasteRef; });
    if (!wr && recs.length === 1)  wr = recs[0];
    if (wr) {
      wr.responsable   = r.responsable;
      wr.fechaRetirada = nuevaFecha;
      wr.peso          = weights[id] || 0;
      wr.gestor        = gestorVal;
    }
  });

  save();
  setActive('.js-modal-edit', false);
  currentEditKey = null;
  renderHistorial();
});


/* ════════════════════════════════════════════════════════
   III · FORMULARIO
════════════════════════════════════════════════════════ */

/* ── III.1 · Render del formulario y dropdowns ── */
function renderForm() {
  var selG = qs('.js-f-gestor');
  selG.innerHTML = '<option value="">— Seleccionar gestor —</option>';
  gestoresData.forEach(function(g) {
    var opt = document.createElement('option');
    opt.value = g.IDCuenta;
    opt.textContent = g.NombreAbreviado || g.Nombre;
    selG.appendChild(opt);
  });

  var selP = qs('.js-f-pickup');
  selP.innerHTML = '<option value="">— Seleccionar retirada prevista —</option>';
  state.history.forEach(function(h) {
    h.records.filter(function(r) { return !r.done; }).forEach(function(r) {
      var opt = document.createElement('option');
      opt.value = r.key;
      opt.textContent = h.year + ' — ' + MONTHS[r.plannedMonth] + ' (' + tipoLabel(r.tipo) + ')';
      selP.appendChild(opt);
    });
  });

  renderFormTable();
}

/* ── III.2 · Tabla dinámica de residuos ── */
function renderFormTable() {
  var tipo = qs('.js-f-tipo').value;
  var list = tipo ? getItemsByTipo(tipo) : items;
  qs('.js-f-waste-body').innerHTML = list.map(function(item) {
    return '<tr><td>' + nombreResiduo(item) +
      '<td>' + item.Referencia +
      '<td>' + item.Serie +
      '<td><input type="number" class="w-inp" data-id="' + item.IDActivo + '" min="0" step="0.1" placeholder="0">' +
      '<td><input type="file" accept="image/*" capture="environment" class="p-inp" data-id="' + item.IDActivo + '">';
  }).join('');
}

/* ── III.3 · Validación de tipo ── */
function checkTypeMatch() {
  var key  = qs('.js-f-pickup').value;
  var tipo = qs('.js-f-tipo').value;
  if (!key || !tipo) { toggle('.js-f-type-err', false); return true; }
  var rec = findRecord(key);
  if (!rec) { toggle('.js-f-type-err', false); return true; }
  var match = rec.tipo === tipo;
  toggle('.js-f-type-err', !match);
  return match;
}

on('.js-f-tipo', 'change',   function() { renderFormTable(); checkTypeMatch(); });
on('.js-f-pickup', 'change', checkTypeMatch);

/* ── III.4 · Canvas de firma ── */
function initSignatureCanvas(canvas) {
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var drawing = false;

  function getXY(e) {
    var r   = canvas.getBoundingClientRect();
    var src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }
  function start(e) { drawing = true; ctx.beginPath(); var p = getXY(e); ctx.moveTo(p.x, p.y); }
  function move(e)  {
    if (!drawing) return;
    var p = getXY(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#2C3E50';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }
  function end() { drawing = false; }

  canvas.addEventListener('mousedown',  start);
  canvas.addEventListener('mousemove',  move);
  canvas.addEventListener('mouseup',    end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', function(e) { e.preventDefault(); start(e); });
  canvas.addEventListener('touchmove',  function(e) { e.preventDefault(); move(e); });
  canvas.addEventListener('touchend',   end);
}

function clearCanvas(c) {
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
}
function drawSignature(canvas, url) {
  if (!canvas || !url) return;
  var img = new Image();
  img.onload = function() { canvas.getContext('2d').drawImage(img, 0, 0); };
  img.src = url;
}

initSignatureCanvas(qs('.js-sig-canvas'));
on('.js-btn-clear-sig', 'click', function() { clearCanvas(qs('.js-sig-canvas')); });

/* ── III.5 · Guardar / Cancelar formulario ── */
function resetForm() {
  ['.js-f-pickup','.js-f-resp','.js-f-fecha','.js-f-tipo','.js-f-gestor','.js-f-incidencias'].forEach(function(s) {
    var el = qs(s); if (el) el.value = '';
  });
  toggle('.js-f-type-err', false);
  clearCanvas(qs('.js-sig-canvas'));
  renderFormTable();
}
on('.js-btn-cancel-form', 'click', resetForm);

on('.js-btn-save-form', 'click', function() {
  var pickupKey   = qs('.js-f-pickup').value;
  var responsable = qs('.js-f-resp').value.trim();
  var fecha       = qs('.js-f-fecha').value;
  var tipo        = qs('.js-f-tipo').value;
  var gestorId    = qs('.js-f-gestor').value;
  var incidencias = qs('.js-f-incidencias').value.trim();

  if (!pickupKey || !responsable || !fecha || !tipo || !gestorId) {
    alert('Completa todos los campos obligatorios.'); return;
  }
  if (!checkTypeMatch()) {
    alert('El tipo de recogida no coincide con la retirada del plan.'); return;
  }

  var rec = findRecord(pickupKey);
  if (!rec) { alert('Retirada no encontrada.'); return; }

  var gestorVal = gestorNombreById(gestorId);
  var realMonth = new Date(fecha).getMonth();
  var sigData   = qs('.js-sig-canvas').toDataURL();

  var weights = {}, photoNames = {};
  qsa('.w-inp').forEach(function(inp) { weights[inp.getAttribute('data-id')]    = parseFloat(inp.value) || 0; });
  qsa('.p-inp').forEach(function(inp) { photoNames[inp.getAttribute('data-id')] = inp.files && inp.files[0] ? inp.files[0].name : ''; });

  var plan = state.plans.find(function(p) { return p.year === rec.year; });
  if (plan) plan.done.push({ plannedMonth: rec.plannedMonth, realMonth: realMonth });

  Object.assign(rec, {
    done: true, responsable: responsable, fecha: fecha, tipo: tipo,
    gestor: gestorVal, incidencias: incidencias, sigData: sigData,
    weights: weights, photoNames: photoNames, realMonth: realMonth
  });

  /* Actualizar tabla de retiradas de cada residuo involucrado.
     Se guarda el ref por residuo en rec.wasteRefs para localizarlo
     de forma exacta al editar (un único número global divergía). */
  var wasteRefs = {};
  getItemsByTipo(tipo).forEach(function(item) {
    var id = item.IDActivo;
    if (!state.wasteRecords[id]) state.wasteRecords[id] = [];
    var recs = state.wasteRecords[id];

    var fechaInicio = '—';
    if (recs.length === 0 && plan) {
      fechaInicio = tipo === 'P' ? (plan.startP || '—') : (plan.startC || '—');
    } else if (recs.length > 0) {
      fechaInicio = recs[recs.length - 1].fechaRetirada;
    }

    var newRef = recs.length + 1;
    wasteRefs[id] = newRef;

    recs.push({
      ref: newRef, fechaInicio: fechaInicio,
      fechaRetirada: fecha, responsable: responsable,
      peso: weights[id] || 0, gestor: gestorVal, fotoName: photoNames[id] || '—'
    });
  });

  rec.wasteRefs = wasteRefs;
  /* Compat: primer ref insertado (registros antiguos esperaban este campo) */
  var firstId = getItemsByTipo(tipo)[0];
  rec.wasteRef = firstId ? wasteRefs[firstId.IDActivo] : null;

  save();
  alert('Recogida registrada correctamente.');
  resetForm(); renderForm(); renderHistorial();
});


/* ════════════════════════════════════════════════════════
   IV · RESIDUOS, QR E IMPRESIÓN
════════════════════════════════════════════════════════ */

/* ── IV.1 · Lista de residuos ── */
function renderWasteList(filter) {
  var grid = qs('.js-waste-grid');
  var list = items.slice().sort(function(a, b) {
    return (a.Nombre || '').localeCompare(b.Nombre || '', 'es');
  });
  if (filter) {
    var f = filter.toLowerCase();
    list = list.filter(function(i) { return i.Nombre && i.Nombre.toLowerCase().indexOf(f) !== -1; });
  }
  if (!list.length) { grid.innerHTML = '<div class="empty-state">No se encontraron residuos.</div>'; return; }
  grid.innerHTML = list.map(function(item) {
    var p = esPeligroso(item);
    return '<div class="waste-card" onclick="openWasteDetail(' + item.IDActivo + ')">' +
      '<span class="badge ' + (p ? 'badge-danger' : 'badge-primary') + '">' + (p ? 'Peligroso' : 'No peligroso') + '</span>' +
      '<span class="hazard-ico">' + hazardIco(item) + '</span>' +
      '<div class="waste-name">' + nombreResiduo(item) + '</div>' +
      '<div class="waste-ler">' + (item.Serie || '') + '</div>' +
      '</div>';
  }).join('');
}
on('.js-search-input', 'input', function() { renderWasteList(this.value); });

/* ── IV.2 · Detalle de residuo ── */
window.openWasteDetail = function(id) {
  var item = items.find(function(i) { return i.IDActivo === id; });
  if (!item) return;
  currentDetailItem = item;

  var g = getGestorForItem(id);

  setText('.js-det-title',     nombreResiduo(item));
  setText('.js-det-trat',      tratResiduo(item));
  setText('.js-det-ler',       item.Serie);
  setText('.js-det-act',       item.Referencia);
  setText('.js-det-tipo',      item.tdescr);
  qs('.js-det-hazard').textContent = hazardIco(item);

  setText('.js-det-tit-nom',   titularData.Nombre);
  setText('.js-productor-cod', CONFIG.PRODUCTOR_COD);
  setText('.js-nima-cod',      CONFIG.NIMA_COD);
  setText('.js-det-tit-dir',   (titularData.Direccion || '') + (titularData.Poblacion ? ', ' + titularData.Poblacion : ''));
  setText('.js-det-tit-tel',   titularData.Telefono);

  setText('.js-det-gest-nom',  g.Nombre);
  setText('.js-det-gest-aut',  getAutorizacion(g));
  setText('.js-det-gest-dir',  (g.Direccion || '') + (g.Poblacion ? ', ' + g.Poblacion : ''));
  setText('.js-det-gest-tel',  g.Telefono);

  var recs  = state.wasteRecords[id] || [];
  var tbody = qs('.js-det-hist-body');
  tbody.innerHTML = recs.length
    ? recs.map(function(r) {
        return '<tr><td>' + r.ref + '<td>' + r.fechaInicio + '<td>' + r.fechaRetirada +
               '<td>' + esc(r.responsable) + '<td>' + r.peso + ' Kg<td>' + esc(r.gestor) + '<td>' + esc(r.fotoName);
      }).join('')
    : '<tr><td colspan="7" class="text-center text-muted">Sin retiradas registradas.';

  showPage('residuo-det');
};

on('.js-back-residuo', 'click',  function() { showPage('residuos'); });
on('.js-det-qr-btn', 'click',    function() { if (currentDetailItem) openQrPopup(currentDetailItem); });
on('.js-det-print-btn', 'click', function() { if (currentDetailItem) printWasteDetail(currentDetailItem); });

/* ── IV.3 · Generación y popup de QR ── */
function openQrPopup(item) {
  currentQrItem = item;
  qs('.js-qr-name').textContent = nombreResiduo(item);
  var container = qs('.js-qr-container');
  container.innerHTML = '';
  new QRCode(container, {
    text: CONFIG.BASE_URL + '?residuo=' + item.IDActivo,
    width: 200, height: 200,
    correctLevel: QRCode.CorrectLevel.H
  });
  setActive('.js-qr-overlay', true);
}

on('.js-qr-close', 'click', function() { setActive('.js-qr-overlay', false); });
on('.js-qr-overlay', 'click', function(e) { if (e.target === this) this.classList.remove('active'); });

on('.js-qr-print', 'click', function() {
  if (!currentQrItem) return;
  var nom       = nombreResiduo(currentQrItem);
  var peligroso = esPeligroso(currentQrItem);
  var qrEl      = qs('.js-qr-container canvas') || qs('.js-qr-container img');
  var qrSrc     = (qrEl && qrEl.tagName === 'CANVAS') ? qrEl.toDataURL() : (qrEl ? qrEl.src : '');

  triggerPrint(
    '<div style="text-align:center;padding:2.5rem 1.25rem;">' +
    '<h2 style="font-size:1rem;margin-bottom:0.5rem;">' + nom + '</h2>' +
    '<div style="font-size:0.75rem;margin-bottom:1.25rem;">' + (peligroso ? '⚠️ Peligroso' : '♻️ No peligroso') + '</div>' +
    (qrSrc ? '<img src="' + qrSrc + '" style="width:12.5rem;height:12.5rem;display:block;margin:0 auto;">' : '') +
    '</div>'
  );
});

/* ── IV.4 · Motor de impresión ──
   Abre ventana nueva, inyecta HTML + CSS y lanza el diálogo de impresión.
   Robusto frente a: popups bloqueados, race de window.onload e imágenes
   base64 (firma/QR) aún sin decodificar. La página principal nunca se
   altera visualmente. */
function triggerPrint(html) {
  var win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    alert('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes para este sitio.');
    return;
  }

  var doc = win.document;
  doc.open();
  doc.write(
    '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
    '<title>Imprimir</title><style>' + getPrintStyles() + '</style></head>' +
    '<body>' + html + '</body></html>'
  );
  doc.close();

  function doPrint() {
    try { win.focus(); win.print(); } catch (e) {}
    /* Cierre diferido: cerrar de inmediato aborta el render del diálogo */
    setTimeout(function() { try { win.close(); } catch (e) {} }, 300);
  }

  /* Espera a que TODAS las imágenes (firma, QR base64) estén
     decodificadas; sin esto salen recortadas o en blanco. */
  function whenImagesReady(cb) {
    var imgs    = Array.prototype.slice.call(doc.images || []);
    var pending = imgs.filter(function(im) { return !im.complete; });
    if (!pending.length) { cb(); return; }
    var left = pending.length;
    var done = function() { if (--left <= 0) cb(); };
    pending.forEach(function(im) {
      im.addEventListener('load',  done);
      im.addEventListener('error', done);
    });
    setTimeout(cb, 2000); // salvaguarda si una imagen falla
  }

  /* document queda "complete" tras write+close, así que no se confía
     en win.onload (puede no dispararse). Se espera render + imágenes. */
  if (win.requestAnimationFrame) {
    win.requestAnimationFrame(function() { whenImagesReady(doPrint); });
  } else {
    setTimeout(function() { whenImagesReady(doPrint); }, 50);
  }
}

/* ── IV.5 · Estilos CSS para impresión ──
   Reglas clave anti-corte: thead se repite en cada página
   (table-header-group) y las filas/bloques no se parten entre
   páginas (break-inside:avoid). Resuelve el "faltan líneas". */
function getPrintStyles() {
  return [
    '*{box-sizing:border-box;}',
    'html,body{margin:0;padding:0;width:100%;max-width:99.9%;overflow-x:hidden;}',
    'body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}',
    /* table-layout:fixed obliga a la tabla a respetar el ancho de página;
       sin esto, los textos largos ensanchan las columnas y desbordan A4 */
    'table{border-collapse:collapse;table-layout:fixed;width:100%;max-width:100%;margin-bottom:8px;border:1px solid #666;}',
    'thead{display:table-header-group;}',
    'tfoot{display:table-footer-group;}',
    'tr{break-inside:avoid;page-break-inside:avoid;}',
    /* No se parten palabras: overflow-wrap solo actúa si una palabra
       es físicamente más larga que la celda (caso muy raro). El ancho
       lo controla table-layout:fixed + colgroup, no el corte de texto */
    'th,td{border:1px solid #666;padding:3px 5px;vertical-align:top;overflow-wrap:break-word;}',
    'th{background:#dce8f0;font-weight:bold;font-size:8pt;}',
    'td{font-size:8.5pt;}',
    '.ph{margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #1A5A8A;break-after:avoid;}',
    '.ph h1{font-size:14pt;font-weight:bold;margin-bottom:2px;}',
    '.pm{font-size:8pt;color:#555;}',
    '.ps{margin-bottom:8px;break-inside:avoid;max-width:100%;}',
    '.pst{font-size:8pt;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#1A5A8A;border-bottom:1px solid #1A5A8A;margin-bottom:4px;padding-bottom:2px;break-after:avoid;}',
    '.cP{background:#A8CFEA;color:#1A5A8A;font-weight:bold;text-align:center;}',
    '.cC{background:#1A5A8A;color:#fff;font-weight:bold;text-align:center;}',
    '.cOk{background:#C8E6C9;color:#4A8A5A;font-weight:bold;text-align:center;}',
    '.cE{background:#fff;text-align:center;}',
    /* Tabla del plan: 13 columnas. La 1ª (Tipo) estrecha, las 12 de
       meses al 7.41%. Las celdas muestran solo P o C (una letra),
       así que no hay riesgo de desbordar y se lee a 8pt */
    '.plan-print{table-layout:fixed;}',
    '.plan-print th,.plan-print td{font-size:8pt;padding:3px 2px;text-align:center;white-space:nowrap;}',
    '.plan-print col.c-lbl{width:14%;}',
    '.plan-print col.c-mon{width:7.16%;}',
    '.plan-print td.cP,.plan-print td.cC,.plan-print td.cOk,.plan-print td.cE{font-size:9pt;font-weight:bold;}',
    '.plan-leg{font-size:7.5pt;color:#555;margin:4px 0 0;font-style:italic;}',
    '.ht{table-layout:fixed;}',
    '.ht th,.ht td{font-size:7.5pt;padding:2px 4px;}',
    '.p3{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:8px;border:1px solid #666;}',
    '.p3 td{border:1px solid #aaa;padding:5px 7px;vertical-align:top;width:33.333%;font-size:9pt;overflow-wrap:break-word;}',
    '.ct{font-size:7.5pt;font-weight:bold;text-transform:uppercase;color:#1A5A8A;border-bottom:1px solid #ccc;margin-bottom:4px;padding-bottom:2px;display:block;}',
    '.cr{margin-bottom:3px;font-size:9pt;line-height:1.4;}',
    '.cl{font-weight:bold;color:#444;font-size:8pt;}',
    '.pwh{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:8px;border:none;}',
    '.pwh td{border:none;padding:0;vertical-align:middle;}',
    '.pwt{font-size:15pt;font-weight:bold;color:#1A5A8A;text-align:center;display:block;}',
    '.pwq{text-align:right;width:80px;}',
    '.pwq img{max-width:75px;height:auto;}',
    '.pf{font-size:7.5pt;color:#888;margin-top:6px;text-align:right;}',
    'img{max-width:100%;height:auto;}',
    '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}',
    '@page{size:A4 portrait;margin:10mm;}'
  ].join('');
}

/* ── IV.6 · Imprimir plan anual ── */
window.printPlan = function(year) {
  var plan = state.plans.concat(state.archivedPlans).find(function(p) { return p.year === year; });
  var hist = state.history.find(function(h) { return h.year === year; });
  if (!plan) return;

  var html = '<div class="ph"><h1>Plan de Gestión de Residuos — ' + year + '</h1>' +
    '<div class="pm">Empresa: ' + (titularData.Nombre || '—') + ' · NIMA: ' + CONFIG.NIMA_COD + '</div></div>';

  html += '<div class="ps"><div class="pst">Planificación anual</div>';
  html += '<table class="plan-print"><colgroup><col class="c-lbl">';
  for (var ci = 0; ci < 12; ci++) html += '<col class="c-mon">';
  html += '</colgroup><thead><tr><th>Tipo';
  MONTHS.forEach(function(m) { html += '<th>' + m; });
  html += '</tr></thead><tbody>';

  html += '<tr><td>Fecha estimada';
  for (var m = 0; m < 12; m++) {
    var st = plan.months[m];
    html += '<td class="' + (st === 1 ? 'cP' : st === 2 ? 'cC' : 'cE') + '">' +
            (st === 1 ? 'P' : st === 2 ? 'C' : '');
  }
  html += '<tr><td>Fecha Real';
  for (var m = 0; m < 12; m++) {
    var rd = plan.done.find(function(d) { return d.realMonth === m; });
    html += '<td class="' + (rd ? 'cOk' : 'cE') + '">' + (rd ? '✓' : '');
  }
  html += '</tbody></table>';
  html += '<div class="plan-leg">P = Recogida parcial · C = Recogida completa · ✓ = Realizada</div></div>';

  if (hist && hist.records.length) {
    html += '<div class="ps"><div class="pst">Retiradas configuradas</div>';
    html += '<table><thead><tr><th>Estado<th>F. Prevista<th>F. Efectiva<th>Tipo<th>Gestora<th>Responsable</tr></thead><tbody>';
    hist.records.slice().sort(function(a, b) { return a.plannedMonth - b.plannedMonth; }).forEach(function(r) {
      html += '<tr><td>' + (r.done ? '✓ Realizada' : '— Pendiente') +
              '<td>' + MONTHS_FULL[r.plannedMonth] + ' ' + year +
              '<td>' + (r.fecha || '—') +
              '<td>' + tipoLabel(r.tipo) +
              '<td>' + (r.gestor || '—') +
              '<td>' + (r.responsable || '—');
    });
    html += '</tbody></table></div>';
  }

  triggerPrint(html);
};

/* ── IV.7 · Imprimir retirada individual ── */
window.printRecord = function(key, year) {
  var hist = state.history.find(function(h) { return h.year === year; });
  if (!hist) return;
  var r = hist.records.find(function(rec) { return rec.key === key; });
  if (!r || !r.done) return;

  var html = '<div class="ph"><h1>Retirada de Residuos — ' + MONTHS_FULL[r.plannedMonth] + ' ' + year + '</h1>' +
    '<div class="pm">Empresa: ' + (titularData.Nombre || '—') + ' · NIMA: ' + CONFIG.NIMA_COD + '</div></div>';

  html += '<div class="ps"><table><colgroup><col style="width:32%"><col style="width:68%"></colgroup>' +
          '<thead><tr><th>Campo<th>Valor</tr></thead><tbody>';
  html += '<tr><td>Responsable<td>' + (r.responsable || '—');
  html += '<tr><td>Fecha de retirada<td>' + (r.fecha || '—');
  html += '<tr><td>Tipo de recogida<td>' + tipoLabel(r.tipo);
  html += '<tr><td>Empresa gestora<td>' + (r.gestor || '—');
  if (r.incidencias) html += '<tr><td>Incidencias<td>' + r.incidencias;
  html += '</tbody></table></div>';

  html += '<div class="ps"><div class="pst">Residuos retirados</div>';
  html += '<table><colgroup><col style="width:46%"><col style="width:20%"><col style="width:18%"><col style="width:16%"></colgroup>' +
          '<thead><tr><th>Residuo<th>Cod. Act.<th>Cod. LER<th>Peso (Kg)</tr></thead><tbody>';
  getItemsByTipo(r.tipo).forEach(function(item) {
    html += '<tr><td>' + nombreResiduo(item) + '<td>' + item.Referencia + '<td>' + item.Serie +
            '<td>' + (r.weights ? r.weights[item.IDActivo] || 0 : 0) + ' Kg';
  });
  html += '</tbody></table></div>';

  if (r.sigData) {
    html += '<div class="ps"><div class="pst">Firma empresa recogida</div>';
    html += '<img src="' + r.sigData + '" style="border:1px solid #ccc;height:80px;max-width:280px;"></div>';
  }

  triggerPrint(html);
};

/* ── IV.8 · Imprimir ficha de residuo (layout C+D) ──
   Título centrado + QR arriba derecha · bloque 3 columnas
   (Identificación | Titular | Gestor) · historial (últimos
   HIST_PRINT_LIMIT registros) · pie de aviso si se truncó. */
function printWasteDetail(item) {
  var nom  = nombreResiduo(item);
  var trat = tratResiduo(item);
  var recs = state.wasteRecords[item.IDActivo] || [];
  var g    = getGestorForItem(item.IDActivo);
  var aut  = getAutorizacion(g);

  var tempDiv = document.createElement('div');
  tempDiv.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
  document.body.appendChild(tempDiv);
  new QRCode(tempDiv, {
    text: CONFIG.BASE_URL + '?residuo=' + item.IDActivo,
    width: 80, height: 80, correctLevel: QRCode.CorrectLevel.H
  });

  setTimeout(function() {
    var qrCanvas = tempDiv.querySelector('canvas');
    var qrSrc    = qrCanvas ? qrCanvas.toDataURL() : '';
    document.body.removeChild(tempDiv);

    var html = '<table class="pwh"><tr>' +
      '<td><span class="pwt">' + nom + '</span>' +
      '<td class="pwq">' + (qrSrc ? '<img src="' + qrSrc + '" width="75" height="75">' : '') +
      '</tr></table>' +
      '<hr style="border:none;border-top:2px solid #1A5A8A;margin-bottom:8px;">';

    html += '<table class="p3"><tr>';

    html += '<td><span class="ct">Identificación</span>';
    html += '<div class="cr"><span class="cl">Trat.:</span> '     + trat                       + '</div>';
    html += '<div class="cr"><span class="cl">Tipo:</span> '      + (item.tdescr || '—')       + '</div>';
    html += '<div class="cr"><span class="cl">LER:</span> '       + (item.Serie || '—')        + '</div>';
    html += '<div class="cr"><span class="cl">Cód. Act.:</span> ' + (item.Referencia || '—')   + '</div>';

    html += '<td><span class="ct">Titular</span>';
    html += '<div class="cr"><span class="cl">Nombre:</span> '    + (titularData.Nombre || '—')   + '</div>';
    html += '<div class="cr"><span class="cl">Productor:</span> ' + CONFIG.PRODUCTOR_COD           + '</div>';
    html += '<div class="cr"><span class="cl">NIMA:</span> '      + CONFIG.NIMA_COD                + '</div>';
    html += '<div class="cr"><span class="cl">Dir.:</span> '      + (titularData.Direccion || '—') +
            (titularData.Poblacion ? ', ' + titularData.Poblacion : '') + '</div>';
    html += '<div class="cr"><span class="cl">Tel.:</span> '      + (titularData.Telefono || '—') + '</div>';

    html += '<td><span class="ct">Gestor autorizado</span>';
    html += '<div class="cr"><span class="cl">Nombre:</span> '  + (g.Nombre || '—')   + '</div>';
    html += '<div class="cr"><span class="cl">Nº Aut.:</span> ' + aut                  + '</div>';
    html += '<div class="cr"><span class="cl">Dir.:</span> '    + (g.Direccion || '—') +
            (g.Poblacion ? ', ' + g.Poblacion : '') + '</div>';
    html += '<div class="cr"><span class="cl">Tel.:</span> '    + (g.Telefono || '—') + '</div>';

    html += '</tr></table>';

    html += '<div class="pst" style="margin-top:8px;">Historial de retiradas</div>';
    if (!recs.length) {
      html += '<p style="font-size:8pt;color:#888;">Sin retiradas registradas.</p>';
    } else {
      var toShow    = recs.slice(-CONFIG.HIST_PRINT_LIMIT);
      var truncated = recs.length > CONFIG.HIST_PRINT_LIMIT;
      html += '<table class="ht"><colgroup>' +
              '<col style="width:7%"><col style="width:16%"><col style="width:16%">' +
              '<col style="width:25%"><col style="width:12%"><col style="width:24%">' +
              '</colgroup><thead><tr>' +
              '<th>Ref.<th>Fecha Inicio<th>Fecha Retirada<th>Responsable<th>Peso (Kg)<th>Gestor' +
              '</tr></thead><tbody>';
      toShow.forEach(function(r) {
        html += '<tr><td>' + r.ref + '<td>' + r.fechaInicio + '<td>' + r.fechaRetirada +
                '<td>' + esc(r.responsable) + '<td>' + r.peso + '<td>' + esc(r.gestor);
      });
      html += '</tbody></table>';
      if (truncated) {
        html += '<div class="pf">Se muestran los ' + CONFIG.HIST_PRINT_LIMIT +
                ' registros más recientes de ' + recs.length + ' totales. Historial completo disponible en la aplicación.</div>';
      }
    }

    triggerPrint(html);
  }, 150);
}


/* ════════════════════════════════════════════════════════
   V · INICIALIZACIÓN
════════════════════════════════════════════════════════ */
load();
renderHistorial();
renderWasteList();
renderForm();
checkUrlParam();

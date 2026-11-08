const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

function task(overrides = {}) {
  const state = C.empty();
  const item = C.createTask(state, Object.assign({
    name: 'Test', category: 'Maison', mode: 'countdown',
    configured: true, anchor: '2026-01-31', due: '2026-01-31',
    interval: { unit: 'month', every: 1 }
  }, overrides), '2026-01-01');
  return { state, item };
}

test('les mois gardent le jour d’ancrage, y compris les années bissextiles', () => {
  const interval = { unit: 'month', every: 1 };
  assert.equal(C.occurrence('2024-01-31', interval, 1), '2024-02-29');
  assert.equal(C.occurrence('2024-01-31', interval, 2), '2024-03-31');
  assert.equal(C.occurrence('2025-01-31', interval, 1), '2025-02-28');
});

test('quatre occurrences par semaine sont réparties sans dérive', () => {
  const interval = { unit: 'week', every: 1, times: 4 };
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => C.occurrence('2026-01-01', interval, i)),
    ['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-06', '2026-01-08']);
});

test('chaque cycle masque les fréquences plus rapides que son niveau de lecture', () => {
  const taskWith = interval => ({ configured: true, archived: false, interval });
  const year = taskWith({ unit: 'month', every: 1 });
  const fortnight = taskWith({ unit: 'day', every: 14 });
  const monthlyBoundary = taskWith({ unit: 'day', every: 31 });
  const twiceMonthly = taskWith({ unit: 'day', every: 15 });
  const weekly = taskWith({ unit: 'week', every: 1, times: 1 });
  const twiceWeekly = taskWith({ unit: 'week', every: 1, times: 2 });
  const fourWeekly = taskWith({ unit: 'week', every: 1, times: 4 });
  const daily = taskWith({ unit: 'perday', every: 1, times: 1 });
  assert.equal(C.visibleInCycle(year, 'year'), true);
  assert.equal(C.visibleInCycle(fortnight, 'year'), false);
  assert.equal(C.visibleInCycle(monthlyBoundary, 'year'), true);
  assert.equal(C.visibleInCycle(twiceMonthly, 'year'), false);
  assert.equal(C.visibleInCycle(weekly, 'month'), true);
  assert.equal(C.visibleInCycle(fortnight, 'month'), true);
  assert.equal(C.visibleInCycle(twiceWeekly, 'month'), false);
  assert.equal(C.visibleInCycle(fourWeekly, 'month'), false);
  assert.equal(C.visibleInCycle(daily, 'month'), false);
  assert.equal(C.visibleInCycle(daily, 'day'), true);
  assert.equal(C.visibleInCycle(Object.assign({}, year, { archived: true }), 'year'), false);
  assert.throws(() => C.visibleInCycle(year, 'invalid'));
});

test('plusieurs réalisations quotidiennes restent dues le même jour jusqu’au quota', () => {
  for (const mode of ['fixed', 'countdown']) {
    const { state, item } = task({ mode, anchor: '2026-01-01', due: '2026-01-01', interval: { unit: 'perday', every: 1, times: 3 } });
    C.complete(state, item, '2026-01-01');
    assert.equal(item.due, '2026-01-01');
    C.complete(state, item, '2026-01-01');
    assert.equal(item.due, '2026-01-01');
    C.complete(state, item, '2026-01-01');
    assert.equal(item.due, '2026-01-02');
    C.validate(state);
  }
});

test('un décompte quotidien remis à zéro repart le lendemain', () => {
  const { state, item } = task({ anchor: '2026-01-01', due: '2026-01-01', interval: { unit: 'perday', every: 1, times: 3 } });
  C.postpone(state, item, '2026-01-01', null, 'okay');
  assert.equal(item.due, '2026-01-02');
  C.complete(state, item, '2026-01-02');
  assert.equal(item.due, '2026-01-02');
});

test('le décompte repart de la réalisation, y compris en avance', () => {
  const { state, item } = task();
  C.complete(state, item, '2026-01-20');
  assert.equal(item.due, '2026-02-20');
  assert.equal(state.events.at(-1).difference, -11);
  assert.equal(C.dailyAuto(state, '2026-01-20').early, 1);
});

test('le rythme fixe reste ancré et saute les échéances déjà passées', () => {
  const { state, item } = task({ mode: 'fixed' });
  C.complete(state, item, '2026-04-04');
  assert.equal(item.due, '2026-04-30');
  assert.equal(item.anchor, '2026-01-31');
  assert.equal(C.dailyAuto(state, '2026-04-04').late, 1);
});

test('un report en retard ne relance pas le décompte, c’est ok le relance', () => {
  const { state, item } = task();
  C.postpone(state, item, '2026-02-01', '2026-02-05', 'late');
  assert.equal(item.anchor, '2026-01-31');
  assert.equal(item.due, '2026-02-05');
  C.postpone(state, item, '2026-02-02', null, 'okay');
  assert.equal(item.anchor, '2026-02-02');
  assert.equal(item.due, '2026-03-02');
  assert.equal(C.dailyAuto(state, '2026-02-01').late, 1);
});

test('un report fixe ne modifie pas le calendrier et saute les créneaux dépassés', () => {
  const { state, item } = task({ mode: 'fixed' });
  C.postpone(state, item, '2026-01-31', '2026-03-10', 'okay');
  C.complete(state, item, '2026-03-10');
  assert.equal(item.due, '2026-03-31');
});

test('les modifications et l’archivage préservent les événements et les configurations', () => {
  const { state, item } = task();
  C.complete(state, item, '2026-01-31');
  C.updateTask(state, item, { name: 'Renommée', category: 'Soin', due: '2026-04-01', mode: 'fixed', interval: { unit: 'day', every: 2 } }, '2026-02-01');
  C.archive(state, item, '2026-02-01', true);
  assert.equal(state.events[1].taskName, 'Test');
  assert.equal(state.events[2].previous.name, 'Test');
  assert.equal(state.events[2].config.name, 'Renommée');
  assert.equal(state.events.length, 4);
  assert.throws(() => C.complete(state, item, '2026-02-01'));
  C.archive(state, item, '2026-02-02', false);
  assert.equal(item.archived, false);
  C.validate(JSON.parse(JSON.stringify(state)));
});

test('modifier seulement le nom conserve le calendrier fixe et son ancre', () => {
  const { state, item } = task({ mode: 'fixed' });
  C.complete(state, item, '2026-01-31');
  const input = { name: 'Renommée', category: 'Soin', due: item.due, mode: item.mode, interval: { ...item.interval } };
  C.updateTask(state, item, input, '2026-02-01');
  assert.equal(item.anchor, '2026-01-31');
  assert.equal(item.index, 1);
  assert.equal(state.events.at(-1).config.anchor, '2026-01-31');
  C.complete(state, item, '2026-02-28');
  assert.equal(item.due, '2026-03-31');
  C.validate(state);
});

test('modifier une tâche trimestrielle conserve son repère et son échéance reportée', () => {
  const { state, item } = task({ mode: 'fixed', interval: { unit: 'month', every: 3 }, annualDate: '01-31' });
  C.postpone(state, item, '2026-01-31', '2026-02-05', 'late');
  C.updateTask(state, item, { name: 'Renommée', category: item.category, due: item.due,
    mode: item.mode, interval: { ...item.interval }, annualDate: item.annualDate }, '2026-02-01');
  assert.equal(item.anchor, '2026-01-31');
  assert.equal(item.due, '2026-02-05');
  C.complete(state, item, '2026-02-05');
  assert.equal(item.due, '2026-04-30');
  C.validate(state);
});

test('journaux et événements calculent les indicateurs sans stocker de doublon', () => {
  const { state, item } = task();
  state.journals['2026-01-31'] = { evening: 'Bonsoir', eveningTitle: 'Une belle journée', dream: '  ', dreamTitle: 'Un rêve' };
  C.complete(state, item, '2026-01-31');
  assert.deepEqual(C.dailyAuto(state, '2026-01-31'), { late: 0, early: 0, evening: 1, dream: 0 });
  C.validate(state);
  state.journals['2026-01-31'].dreamTitle = 42;
  assert.throws(() => C.validate(state), /Journal invalide/);
});

test('les sauvegardes invalides, dates invalides et fréquences impossibles sont refusées', () => {
  assert.throws(() => C.validate({ version: 99 }));
  assert.throws(() => C.parseDate('2026-02-30'));
  assert.throws(() => C.occurrence('2026-01-01', { unit: 'week', every: 1, times: 8 }, 1));
  const { state } = task();
  state.events[0].taskId = 'inconnu';
  assert.throws(() => C.validate(state));
});

test('les sauvegardes v1 sont migrées sans perdre les données', () => {
  const { state } = task();
  state.daily['2026-01-31'] = { water: 3 };
  state.journals['2026-01-31'] = { evening: 'Bonsoir' };
  const backup = JSON.parse(JSON.stringify(state));
  backup.version = 1;
  delete backup.model;

  const restored = C.validate(backup);

  assert.equal(restored.version, 2);
  assert.deepEqual(restored.model, { version: C.MODEL_VERSION, questions: [] });
  assert.deepEqual(restored.tasks, backup.tasks);
  assert.deepEqual(restored.events, backup.events);
  assert.deepEqual(restored.daily, backup.daily);
  assert.deepEqual(restored.journals, backup.journals);
  assert.equal(backup.version, 1);
  assert.equal(Object.hasOwn(backup, 'model'), false);
});

test('une nouvelle installation commence sans configuration personnelle', () => {
  const state = C.empty();
  C.validate(state);
  assert.equal(state.tasks.length, 0);
  assert.deepEqual(state.model.questions, []);
});

test('les dates annuelles fixes d’un modèle gardent le jour et le mois', () => {
  const definition = {
    id: 'taxes-annuelles', name: 'Déclaration', category: 'Administratif',
    mode: 'fixed', configured: true, interval: { unit: 'month', every: 12 }, annualDate: '05-21'
  };
  const model = { type: 'elk-model', version: C.MODEL_VERSION, tasks: [definition], questions: [] };
  C.validateModel(model);
  const state = C.empty();
  C.applyModel(state, model, '2026-11-08');
  const item = state.tasks[0];
  assert.equal(item.anchor, '2027-05-21');
  assert.equal(item.due, '2027-05-21');
  assert.equal(C.createModel(state).tasks[0].annualDate, '05-21');
  C.complete(state, item, '2027-05-21');
  assert.equal(item.due, '2028-05-21');
  assert.equal(C.nextAnnualDate('2027-05-22', '05-21'), '2028-05-21');
  assert.equal(C.nextAnnualDate('2026-03-01', '02-29'), '2027-02-28');
  assert.equal(C.nextAnnualDate('2027-02-28', '02-29'), '2027-02-28');
});

test('une date annuelle fixe invalide ou incompatible avec la récurrence est refusée', () => {
  const model = {
    type: 'elk-model', version: C.MODEL_VERSION,
    tasks: [{
      id: 'bad-date', name: 'Tâche', category: 'Administratif', mode: 'fixed',
      configured: true, interval: { unit: 'month', every: 12 }, annualDate: '02-30'
    }],
    questions: []
  };
  assert.throws(() => C.validateModel(model));
  model.tasks[0].annualDate = '05-21';
  model.tasks[0].interval.every = 5;
  assert.throws(() => C.validateModel(model));
  model.tasks[0].interval.every = 6;
  assert.equal(C.validateModel(model).tasks[0].annualDate, '05-21');
  model.version = 1;
  delete model.tasks[0].annualDate;
  assert.equal(C.validateModel(model).version, 1);
  const legacyState = C.empty();
  legacyState.model.version = 1;
  assert.equal(C.validate(legacyState).model.version, 1);
});

test('une date annuelle avec rythme trimestriel reste calée sur le calendrier', () => {
  const model = {
    type: 'elk-model', version: C.MODEL_VERSION, questions: [],
    tasks: [{ id: 'urssaf', name: 'Urssaf', category: 'Administratif', mode: 'fixed', configured: true, interval: { unit: 'month', every: 3 }, annualDate: '01-31' }]
  };
  const state = C.empty();
  C.applyModel(state, model, '2026-11-08');
  const task = state.tasks[0];
  assert.equal(task.due, '2027-01-31');
  C.complete(state, task, '2027-01-31');
  assert.equal(task.due, '2027-04-30');
  C.complete(state, task, '2027-04-30');
  assert.equal(task.due, '2027-07-31');
  const later = C.empty();
  C.applyModel(later, model, '2027-03-15');
  assert.equal(later.tasks[0].due, '2027-04-30');
  C.complete(later, later.tasks[0], '2027-04-30');
  assert.equal(later.tasks[0].due, '2027-07-31');
  C.validate(later);
});

test('un repère du 29 février retrouve le 29 en année bissextile', () => {
  const model = { type: 'elk-model', version: C.MODEL_VERSION, questions: [], tasks: [{
    id: 'leap', name: 'Date', category: 'Test', mode: 'fixed', configured: true,
    interval: { unit: 'month', every: 12 }, annualDate: '02-29'
  }] };
  const state = C.empty();
  C.applyModel(state, model, '2027-01-01');
  const item = state.tasks[0];
  assert.equal(item.due, '2027-02-28');
  C.complete(state, item, '2027-02-28');
  assert.equal(item.due, '2028-02-29');
  C.complete(state, item, '2028-02-29');
  assert.equal(item.due, '2029-02-28');
  C.validate(state);
});

test('un repère trimestriel garde ses dates après modification, report et import', () => {
  const model = { type: 'elk-model', version: C.MODEL_VERSION, questions: [], tasks: [{
    id: 'quarterly', name: 'Date', category: 'Test', mode: 'fixed', configured: true,
    interval: { unit: 'month', every: 3 }, annualDate: '01-31'
  }] };
  const state = C.empty();
  C.applyModel(state, model, '2027-03-15');
  const item = state.tasks[0];
  assert.equal(item.due, '2027-04-30');
  assert.equal(state.events[0].config.due, item.due);
  assert.equal(state.events[0].config.anchor, item.anchor);
  C.updateTask(state, item, { name: item.name, category: item.category, due: '2027-04-29',
    mode: item.mode, interval: item.interval, annualDate: item.annualDate }, '2027-03-16');
  C.complete(state, item, '2027-04-29');
  assert.equal(item.due, '2027-07-31');
  assert.deepEqual(C.projectedDates(item, '2027-07-01', '2027-12-01', '2027-04-29'), [
    { date: '2027-07-31', projected: false },
    { date: '2027-10-31', projected: true }
  ]);
  C.postpone(state, item, '2027-07-31', '2027-08-04', 'late');
  C.complete(state, item, '2027-08-04');
  assert.equal(item.due, '2027-10-31');
  C.validate(state);
});

test('la projection respecte les échéances fixes et ne modifie pas la tâche', () => {
  const { item } = task({ mode: 'fixed' });
  const before = JSON.stringify(item);
  assert.deepEqual(C.projectedDates(item, '2026-01-01', '2026-05-01', '2026-01-01'), [
    { date: '2026-01-31', projected: false },
    { date: '2026-02-28', projected: true },
    { date: '2026-03-31', projected: true },
    { date: '2026-04-30', projected: true }
  ]);
  assert.equal(JSON.stringify(item), before);
});

test('la projection décompte suit les réalisations supposées et les reports', () => {
  const { state, item } = task();
  C.postpone(state, item, '2026-01-20', '2026-02-02', 'late');
  assert.deepEqual(C.projectedDates(item, '2026-02-01', '2026-05-01', '2026-02-01'), [
    { date: '2026-02-02', projected: false },
    { date: '2026-03-02', projected: true },
    { date: '2026-04-02', projected: true }
  ]);
});

test('la projection suppose la réalisation aujourd’hui pour une tâche en retard', () => {
  const { item } = task();
  assert.deepEqual(C.projectedDates(item, '2026-01-01', '2026-05-01', '2026-02-01'), [
    { date: '2026-01-31', projected: false },
    { date: '2026-03-01', projected: true },
    { date: '2026-04-01', projected: true }
  ]);
});

test('les quotas quotidiens projettent une date par jour et pas une par occurrence', () => {
  const { item } = task({ anchor: '2026-01-01', due: '2026-01-01', interval: { unit: 'perday', every: 1, times: 3 } });
  assert.deepEqual(C.projectedDates(item, '2026-01-01', '2026-01-04', '2026-01-01').map(value => value.date), ['2026-01-01', '2026-01-02', '2026-01-03']);
});

test('un modèle ne contient que les tâches actives et les définitions du Daily', () => {
  const { state, item } = task();
  state.model.questions = [{ label: 'Humeur', fields: [{ key: 'mood', label: 'Humeur', type: 'number', min: -1, max: 1, step: 0.1 }] }];
  state.daily['2026-01-31'] = { mood: 0.5 };
  state.journals['2026-01-31'] = { evening: 'Privé' };
  C.archive(state, item, '2026-02-01', true);
  const model = C.createModel(state);
  assert.equal(model.tasks.length, 0);
  assert.deepEqual(model.questions, state.model.questions);
  assert.equal(JSON.stringify(model).includes('Privé'), false);
  assert.equal(JSON.stringify(model).includes('mood":0.5'), false);
});

test('l’aperçu et l’application du modèle préservent les réponses, journaux et historiques', () => {
  const { state, item } = task();
  const removed = C.createTask(state, {
    name: 'À archiver', category: 'Maison', mode: 'countdown', configured: true,
    anchor: '2026-01-01', due: '2026-01-01', interval: { unit: 'day', every: 1 }
  }, '2026-01-01');
  C.complete(state, item, '2026-01-31');
  state.daily['2026-01-31'] = { mood: 0.5 };
  state.journals['2026-01-31'] = { evening: 'Bonsoir' };
  const model = C.createModel(state);
  model.tasks = model.tasks.filter(task => task.id !== removed.id);
  model.tasks[0].name = 'Renommée';
  model.tasks.push({
    id: 'modele-nouvelle-tache', name: 'Nouvelle', category: 'Maison', mode: 'fixed',
    configured: true, interval: { unit: 'month', every: 1 }
  });
  model.questions = [{ label: 'Humeur', fields: [{ key: 'mood', label: 'Humeur', type: 'number', min: -1, max: 1, step: 0.1 }] }];
  const preview = C.previewModel(state, model);
  assert.deepEqual(preview.added, ['Nouvelle']);
  assert.deepEqual(preview.updated.map(change => change.name), ['Renommée']);
  assert.ok(preview.updated[0].changes.some(change => change.startsWith('Nom : Test → Renommée')));
  assert.deepEqual(preview.removed, ['À archiver']);
  assert.equal(preview.questionsChanged, true);
  C.applyModel(state, model, '2026-02-01');
  assert.equal(item.name, 'Renommée');
  assert.equal(item.due, '2026-02-01');
  assert.equal(state.tasks.find(task => task.id === removed.id).archived, true);
  assert.equal(state.tasks.find(task => task.id === 'modele-nouvelle-tache').due, '2026-02-01');
  assert.deepEqual(state.daily['2026-01-31'], { mood: 0.5 });
  assert.deepEqual(state.journals['2026-01-31'], { evening: 'Bonsoir' });
  assert.ok(state.events.some(event => event.taskId === item.id && event.type === 'completed'));
  C.validate(state);
});

test('réimporter le même modèle ne crée pas de nouveaux événements', () => {
  const { state } = task();
  const model = C.createModel(state);
  const before = state.events.length;
  assert.equal(C.previewModel(state, model).unchanged, true);
  C.applyModel(state, model, '2026-02-01');
  assert.equal(state.events.length, before);
});

test('les modèles invalides ou dupliqués sont refusés', () => {
  assert.throws(() => C.validateModel({ type: 'elk-model', version: 99, tasks: [], questions: [] }));
  const { state } = task();
  const model = C.createModel(state);
  model.tasks[0].responses = { mood: 1 };
  assert.throws(() => C.validateModel(model));
  delete model.tasks[0].responses;
  model.tasks.push(Object.assign({}, model.tasks[0]));
  assert.throws(() => C.validateModel(model));
});

test('les retards sont cumulés par semaine, semaines vides incluses', () => {
  const state = C.empty();
  state.events.push({ type: 'completed', date: '2026-01-05', difference: 2 }, { type: 'postponed', date: '2026-01-07', reason: 'late' }, { type: 'completed', date: '2026-01-06', difference: 0 }, { type: 'completed', date: '2026-01-20', difference: 1 });
  assert.deepEqual(C.lateWeekly(state, '2026-01-21'), [
    { week: '2026-01-05', count: 2, total: 2 }, { week: '2026-01-12', count: 0, total: 2 }, { week: '2026-01-19', count: 1, total: 3 }
  ]);
  assert.deepEqual(C.lateWeekly(C.empty(), '2026-01-21'), []);
});

test('un report « c’est ok » accepte une échéance choisie', () => {
  const { state, item } = task();
  C.postpone(state, item, '2026-02-02', '2026-02-20', 'okay');
  assert.equal(item.due, '2026-02-20');
  assert.throws(() => C.postpone(state, item, '2026-02-02', '2026-02-02', 'okay'));
  C.validate(state);
});

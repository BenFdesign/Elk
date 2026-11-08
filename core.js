(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ElkCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 2;
  const MODEL_VERSION = 2;
  const DAY = 86400000;
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  function parseDate(value) {
    if (!isoPattern.test(value || '')) throw new Error('Date invalide.');
    const time = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Date invalide.');
    return time;
  }
  function today() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }
  function addDays(date, days) {
    return new Date(parseDate(date) + Math.round(days) * DAY).toISOString().slice(0, 10);
  }
  function diffDays(a, b) { return Math.round((parseDate(a) - parseDate(b)) / DAY); }
  function addMonths(date, months) {
    const d = new Date(parseDate(date));
    const day = d.getUTCDate();
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, last));
    return first.toISOString().slice(0, 10);
  }
  function parseAnnualDate(value) {
    if (!/^\d{2}-\d{2}$/.test(value || '')) throw new Error('Date annuelle invalide.');
    parseDate('2000-' + value);
    return value;
  }
  function annualDateInYear(year, monthDay) {
    const [month, day] = parseAnnualDate(monthDay).split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  }
  function nextAnnualDate(from, monthDay) {
    parseDate(from);
    const value = parseAnnualDate(monthDay);
    const year = Number(from.slice(0, 4));
    let candidate = annualDateInYear(year, value);
    if (candidate < from) candidate = annualDateInYear(year + 1, value);
    return candidate;
  }
  function nextFixedDate(from, monthDay, every, inclusive) {
    parseDate(from);
    const anchor = '2000-' + parseAnnualDate(monthDay);
    const months = (Number(from.slice(0, 4)) - 2000) * 12 + Number(from.slice(5, 7)) - Number(monthDay.slice(0, 2));
    let index = Math.floor(months / every);
    let candidate = addMonths(anchor, index * every);
    if (candidate < from || (!inclusive && candidate === from)) {
      candidate = addMonths(anchor, ++index * every);
    }
    return candidate;
  }
  function occurrence(anchor, interval, index) {
    if (!Number.isInteger(index) || index < 0) throw new Error('Indice de récurrence invalide.');
    if (!interval || !Number.isInteger(interval.every) || interval.every < 1 || interval.every > 1000) throw new Error('Récurrence invalide.');
    if (interval.unit === 'perday') {
      if (!Number.isInteger(interval.times) || interval.times < 1 || interval.times > 24 || interval.every !== 1) throw new Error('Fréquence quotidienne invalide.');
      return addDays(anchor, Math.floor(index / interval.times));
    }
    if (interval.unit === 'day') return addDays(anchor, interval.every * index);
    if (interval.unit === 'week') {
      if (!Number.isInteger(interval.times) || interval.times < 1 || interval.times > 7 || interval.every !== 1) throw new Error('Fréquence hebdomadaire invalide.');
      return addDays(anchor, index * 7 / interval.times);
    }
    if (interval.unit === 'month') return addMonths(anchor, interval.every * index);
    throw new Error('Unité de récurrence invalide.');
  }
  function visibleInCycle(task, cycle) {
    if (!task || !task.configured || task.archived) return false;
    if (cycle === 'day') return true;
    const interval = task.interval;
    let daysPerOccurrence;
    if (interval.unit === 'perday') daysPerOccurrence = 1 / interval.times;
    else if (interval.unit === 'day') daysPerOccurrence = interval.every;
    else if (interval.unit === 'week') daysPerOccurrence = 7 / interval.times;
    else if (interval.unit === 'month') daysPerOccurrence = (365.2425 / 12) * interval.every;
    else throw new Error('Unité de récurrence invalide.');
    if (cycle === 'year') return daysPerOccurrence >= 365.2425 / 12;
    if (cycle === 'month') return daysPerOccurrence >= 7;
    throw new Error('Cycle invalide.');
  }
  function id() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function validTask(task) {
    if (!task || typeof task.id !== 'string' || !task.id || typeof task.name !== 'string' || !task.name.trim() ||
        typeof task.category !== 'string' || !task.category.trim() || !['fixed', 'countdown'].includes(task.mode) ||
        typeof task.archived !== 'boolean' || typeof task.configured !== 'boolean') throw new Error('Tâche invalide.');
    if (task.configured) {
      parseDate(task.anchor);
      parseDate(task.due);
      occurrence(task.anchor, task.interval, task.index);
    }
    if (task.annualDate !== undefined && task.annualDate !== null) {
      parseAnnualDate(task.annualDate);
      if (!task.configured || task.mode !== 'fixed' || task.interval.unit !== 'month' || 12 % task.interval.every !== 0) {
        throw new Error('Une date annuelle fixe exige une tâche fixe configurée avec un rythme en mois qui divise 12 (1, 2, 3, 4, 6 ou 12).');
      }
    }
    return task;
  }
  function exactKeys(value, allowed) {
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Donnée non prise en charge dans le modèle.');
  }
  function validateQuestions(questions) {
    if (!Array.isArray(questions)) throw new Error('Modèle invalide : questions manquantes.');
    const keys = new Set();
    questions.forEach(question => {
      if (!question || typeof question.label !== 'string' || !question.label.trim() ||
          (question.hint !== undefined && typeof question.hint !== 'string') ||
          !Array.isArray(question.fields) || !question.fields.length) throw new Error('Question de modèle invalide.');
      exactKeys(question, ['label', 'hint', 'fields']);
      question.fields.forEach(field => {
        if (!field || typeof field.key !== 'string' || !field.key || keys.has(field.key) ||
            typeof field.label !== 'string' || !field.label.trim() ||
            !['number', 'select'].includes(field.type) ||
            (field.hint !== undefined && typeof field.hint !== 'string')) throw new Error('Champ Daily invalide.');
        exactKeys(field, ['key', 'label', 'hint', 'type', 'min', 'max', 'step', 'options', 'numeric', 'group', 'skipAsZero']);
        keys.add(field.key);
        if (field.type === 'number') {
          if (!Number.isFinite(field.min) || !Number.isFinite(field.step) || field.step <= 0 ||
              (field.max !== undefined && (!Number.isFinite(field.max) || field.max < field.min))) throw new Error('Bornes de champ Daily invalides.');
        } else if (!Array.isArray(field.options) || !field.options.length ||
            field.options.some(option => typeof option !== 'string') ||
            (field.numeric !== undefined && typeof field.numeric !== 'boolean')) throw new Error('Options de champ Daily invalides.');
        if (field.group !== undefined && typeof field.group !== 'string') throw new Error('Groupe de champ Daily invalide.');
        if (field.skipAsZero !== undefined && typeof field.skipAsZero !== 'boolean') throw new Error('Option de saut de champ Daily invalide.');
      });
    });
    return questions;
  }
  function templateTask(task) {
    return {
      id: task.id, name: task.name, category: task.category, mode: task.mode,
      configured: task.configured, interval: task.configured
        ? { unit: task.interval.unit, every: task.interval.every, ...(task.interval.times === undefined ? {} : { times: task.interval.times }) }
        : null,
      ...(task.annualDate ? { annualDate: task.annualDate } : {})
    };
  }
  function taskConfigurationLabel(task) {
    if (!task.configured) return 'à configurer';
    const interval = task.interval;
    let cadence;
    if (interval.unit === 'perday') cadence = interval.times + ' fois par jour';
    else if (interval.unit === 'week') cadence = interval.times + ' fois par semaine';
    else if (interval.unit === 'day') cadence = interval.every === 1 ? 'chaque jour' : 'tous les ' + interval.every + ' jours';
    else cadence = interval.every === 1 ? 'chaque mois' : 'tous les ' + interval.every + ' mois';
    return (task.mode === 'fixed' ? 'Fixe' : 'Décompte') + ' · ' + cadence;
  }
  function taskDifferences(current, next) {
    const changes = [];
    if (current.name !== next.name) changes.push('Nom : ' + current.name + ' → ' + next.name);
    if (current.category !== next.category) changes.push('Catégorie : ' + current.category + ' → ' + next.category);
    if (!same(templateTask(current), templateTask(next)) &&
        (current.mode !== next.mode || current.configured !== next.configured || !same(current.interval, next.interval))) {
      changes.push('Rythme : ' + taskConfigurationLabel(current) + ' → ' + taskConfigurationLabel(next));
    }
    if (current.annualDate !== next.annualDate) {
      const label = value => value ? value.slice(3) + '/' + value.slice(0, 2) : 'aucune';
      changes.push('Date annuelle : ' + label(current.annualDate) + ' → ' + label(next.annualDate));
    }
    return changes;
  }
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  }
  function same(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
  function validateModel(model) {
    if (!model || model.type !== 'elk-model' || ![1, MODEL_VERSION].includes(model.version) ||
        !Array.isArray(model.tasks)) throw new Error('Modèle invalide ou version non prise en charge.');
    exactKeys(model, ['type', 'version', 'tasks', 'questions']);
    const ids = new Set();
    model.tasks.forEach(task => {
      if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id) ||
          typeof task.name !== 'string' || !task.name.trim() ||
          typeof task.category !== 'string' || !task.category.trim() ||
          !['fixed', 'countdown'].includes(task.mode) || typeof task.configured !== 'boolean') throw new Error('Tâche de modèle invalide.');
      exactKeys(task, ['id', 'name', 'category', 'mode', 'configured', 'interval', 'annualDate']);
      ids.add(task.id);
      if (task.configured) {
        if (!task.interval || typeof task.interval !== 'object' || Array.isArray(task.interval)) throw new Error('Récurrence de modèle invalide.');
        exactKeys(task.interval, ['unit', 'every', 'times']);
        occurrence('2000-01-01', task.interval, 0);
      }
      else if (task.interval !== null) throw new Error('Une tâche à configurer ne peut pas avoir de récurrence.');
      if (task.annualDate !== undefined) {
        parseAnnualDate(task.annualDate);
        if (!task.configured || task.mode !== 'fixed' || task.interval.unit !== 'month' || 12 % task.interval.every !== 0) {
          throw new Error('Une date annuelle fixe exige une tâche fixe configurée avec un rythme en mois qui divise 12 (1, 2, 3, 4, 6 ou 12).');
        }
      }
    });
    validateQuestions(model.questions);
    return model;
  }
  function migrateBackup(state) {
    if (!state || state.version !== 1) return state;
    return Object.assign({}, state, {
      version: VERSION,
      model: { version: MODEL_VERSION, questions: [] }
    });
  }
  function validate(state) {
    state = migrateBackup(state);
    if (!state || state.version !== VERSION || !Array.isArray(state.tasks) || !Array.isArray(state.events) ||
        !state.model || ![1, MODEL_VERSION].includes(state.model.version) ||
        !state.daily || typeof state.daily !== 'object' || Array.isArray(state.daily) ||
        !state.journals || typeof state.journals !== 'object' || Array.isArray(state.journals)) throw new Error('Sauvegarde invalide ou version non prise en charge.');
    validateQuestions(state.model.questions);
    const ids = new Set();
    state.tasks.forEach(task => {
      validTask(task);
      if (ids.has(task.id)) throw new Error('Identifiant de tâche dupliqué.');
      ids.add(task.id);
    });
    state.events.forEach(event => {
      if (!event || !ids.has(event.taskId) || !['created', 'updated', 'completed', 'postponed', 'archived', 'restored'].includes(event.type)) throw new Error('Historique invalide.');
      parseDate(event.date);
      if (event.due !== undefined && event.due !== null) parseDate(event.due);
    });
    Object.entries(state.daily).forEach(([date, values]) => {
      parseDate(date);
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Daily invalide.');
      Object.values(values).forEach(value => {
        if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Valeur daily invalide.');
      });
    });
    Object.entries(state.journals).forEach(([date, value]) => {
      parseDate(date);
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          (value.evening !== undefined && typeof value.evening !== 'string') ||
          (value.dream !== undefined && typeof value.dream !== 'string') ||
          (value.eveningTitle !== undefined && typeof value.eveningTitle !== 'string') ||
          (value.dreamTitle !== undefined && typeof value.dreamTitle !== 'string')) throw new Error('Journal invalide.');
    });
    return state;
  }
  function empty() { return { version: VERSION, model: { version: MODEL_VERSION, questions: [] }, tasks: [], events: [], daily: {}, journals: {} }; }
  function event(state, task, type, date, details) {
    parseDate(date);
    state.events.push(Object.assign({ id: id(), taskId: task.id, taskName: task.name, type, date, due: task.configured ? task.due : null }, details || {}));
  }
  function createTask(state, input, date) {
    const task = Object.assign({ id: id(), archived: false, configured: true, index: 0 }, input);
    validTask(task);
    if (state.tasks.some(item => item.id === task.id)) throw new Error('Identifiant de tâche déjà utilisé.');
    state.tasks.push(task);
    event(state, task, 'created', date, { config: snapshot(task) });
    return task;
  }
  function snapshot(task) {
    return { name: task.name, category: task.category, mode: task.mode, configured: task.configured,
      anchor: task.anchor, due: task.due, interval: task.interval ? Object.assign({}, task.interval) : null, index: task.index,
      annualDate: task.annualDate };
  }
  function updateTask(state, task, input, date) {
    const previous = snapshot(task);
    const configured = input.configured !== false;
    const preserveSchedule = task.configured && configured && task.due === input.due &&
      task.mode === input.mode && (task.annualDate || undefined) === (input.annualDate || undefined) &&
      same(task.interval, input.interval);
    const preserveFixedAnchor = task.configured && configured && task.mode === 'fixed' && input.mode === 'fixed' &&
      task.annualDate && task.annualDate === input.annualDate && same(task.interval, input.interval);
    const updated = Object.assign({}, task, input, {
      configured, index: preserveSchedule || preserveFixedAnchor ? task.index : 0,
      anchor: configured ? (preserveSchedule || preserveFixedAnchor ? task.anchor : input.due) : null,
      due: configured ? input.due : null, interval: configured ? input.interval : null
    });
    validTask(updated);
    Object.assign(task, updated);
    event(state, task, 'updated', date, { previous, config: snapshot(task) });
  }
  function createModel(state) {
    validate(state);
    return validateModel({
      type: 'elk-model', version: MODEL_VERSION,
      tasks: state.tasks.filter(task => !task.archived).map(templateTask),
      questions: JSON.parse(JSON.stringify(state.model.questions))
    });
  }
  function previewModel(state, model) {
    validate(state);
    validateModel(model);
    const active = state.tasks.filter(task => !task.archived);
    const incoming = new Map(model.tasks.map(task => [task.id, task]));
    const current = new Map(active.map(task => [task.id, task]));
    const added = model.tasks.filter(task => !current.has(task.id) || state.tasks.find(item => item.id === task.id).archived).map(task => task.name);
    const updated = model.tasks.flatMap(task => {
      const existing = current.get(task.id);
      return existing && !same(templateTask(existing), templateTask(task))
        ? [{ name: task.name, changes: taskDifferences(existing, task) }]
        : [];
    });
    const removed = active.filter(task => !incoming.has(task.id)).map(task => task.name);
    return {
      added, updated, removed,
      questionsChanged: !same(state.model.questions, model.questions),
      unchanged: !added.length && !updated.length && !removed.length &&
        same(state.model.questions, model.questions)
    };
  }
  function applyModel(state, model, date) {
    validate(state);
    validateModel(model);
    parseDate(date);
    const incoming = new Set(model.tasks.map(task => task.id));
    model.tasks.forEach(definition => {
      let task = state.tasks.find(item => item.id === definition.id);
      const due = definition.configured && definition.annualDate
        ? nextFixedDate(date, definition.annualDate, definition.interval.every, true) : date;
      const input = {
        id: definition.id, name: definition.name, category: definition.category,
        mode: definition.mode, configured: definition.configured,
        interval: definition.configured ? templateTask(definition).interval : null,
        annualDate: definition.annualDate,
        due: definition.configured ? due : null,
        anchor: definition.configured ? due : null
      };
      if (!task) {
        task = createTask(state, input, date);
      } else {
        const changed = !same(templateTask(task), templateTask(definition));
        if (changed) updateTask(state, task, input, date);
        if (task.archived) archive(state, task, date, false);
      }
    });
    state.tasks.filter(task => !task.archived && !incoming.has(task.id))
      .forEach(task => archive(state, task, date, true));
    state.model = { version: MODEL_VERSION, questions: JSON.parse(JSON.stringify(model.questions)) };
    validate(state);
    return state;
  }
  function complete(state, task, date) {
    if (!task.configured || task.archived) throw new Error('Cette tâche ne peut pas être effectuée.');
    parseDate(date);
    const due = task.due;
    let nextIndex = task.index;
    let nextAnchor = task.anchor;
    if (task.mode === 'countdown' && task.interval.unit === 'perday') {
      nextIndex = task.anchor === date && task.due === date ? task.index + 1 : 1;
      nextAnchor = date;
    } else if (task.mode === 'countdown') {
      nextAnchor = date;
      nextIndex = 1;
    } else if (task.annualDate) {
      const currentSlot = occurrence(task.anchor, task.interval, task.index);
      const afterDue = date > due ? date : due;
      const after = currentSlot > afterDue ? currentSlot : afterDue;
      const nextDue = nextFixedDate(after, task.annualDate, task.interval.every, false);
      event(state, task, 'completed', date, { difference: diffDays(date, due), nextDue });
      task.anchor = nextDue;
      task.index = 0;
      task.due = nextDue;
      return;
    } else if (task.interval.unit === 'perday') {
      do { nextIndex++; } while (occurrence(nextAnchor, task.interval, nextIndex) < date || occurrence(nextAnchor, task.interval, nextIndex) < due);
    } else {
      // Skip slots already elapsed; a completion never produces a second overdue card.
      do { nextIndex++; } while (occurrence(nextAnchor, task.interval, nextIndex) <= date || occurrence(nextAnchor, task.interval, nextIndex) <= due);
    }
    const nextDue = occurrence(nextAnchor, task.interval, nextIndex);
    event(state, task, 'completed', date, { difference: diffDays(date, due), nextDue });
    task.anchor = nextAnchor;
    task.index = nextIndex;
    task.due = nextDue;
  }
  function postpone(state, task, date, newDue, reason) {
    if (!task.configured || task.archived) throw new Error('Cette tâche ne peut pas être reportée.');
    parseDate(date);
    if (!['late', 'okay'].includes(reason)) throw new Error('Choisissez une raison de report.');
    const reset = task.mode === 'countdown' && reason === 'okay';
    if (reset && !newDue) newDue = task.interval.unit === 'perday' ? addDays(date, 1) : occurrence(date, task.interval, 1);
    else {
      parseDate(newDue);
      if (reset ? newDue <= date : (newDue <= date || newDue <= task.due)) throw new Error(reset ? 'La nouvelle date doit être après aujourd’hui.' : 'La nouvelle date doit être après aujourd’hui et après l’échéance actuelle.');
    }
    event(state, task, 'postponed', date, { reason, newDue });
    if (reset) {
      task.anchor = task.interval.unit === 'perday' ? newDue : date;
      task.index = task.interval.unit === 'perday' ? 0 : 1;
    }
    task.due = newDue;
  }
  function archive(state, task, date, archived) {
    if (task.archived === archived) return;
    event(state, task, archived ? 'archived' : 'restored', date);
    task.archived = archived;
  }
  function dailyAuto(state, date) {
    const events = state.events.filter(e => e.date === date);
    const journal = state.journals[date] || {};
    return {
      late: events.filter(e => (e.type === 'completed' && e.difference > 0) || (e.type === 'postponed' && e.reason === 'late')).length,
      early: events.filter(e => e.type === 'completed' && e.difference < 0).length,
      evening: journal.evening && journal.evening.trim() ? 1 : 0,
      dream: journal.dream && journal.dream.trim() ? 1 : 0
    };
  }
  function isLateEvent(e) { return (e.type === 'completed' && e.difference > 0) || (e.type === 'postponed' && e.reason === 'late'); }
  // Retards cumulés par semaine (lundi), calculés depuis l'historique : aucune donnée supplémentaire à sauvegarder.
  function lateWeekly(state, todayDate) {
    const monday = date => addDays(date, -((new Date(parseDate(date)).getUTCDay() + 6) % 7));
    const late = state.events.filter(isLateEvent);
    if (!late.length) return [];
    const counts = {};
    late.forEach(e => { const week = monday(e.date); counts[week] = (counts[week] || 0) + 1; });
    const latest = late.reduce((m, e) => e.date > m ? e.date : m, todayDate);
    const last = monday(latest);
    let week = Object.keys(counts).sort()[0], total = 0;
    const result = [];
    while (week <= last) {
      const count = counts[week] || 0;
      total += count;
      result.push({ week, count, total });
      week = addDays(week, 7);
    }
    return result;
  }
  function projectedDates(task, start, end, todayDate) {
    parseDate(start); parseDate(end); parseDate(todayDate);
    if (start >= end) throw new Error('Période de projection invalide.');
    if (!task.configured || task.archived) return [];
    validTask(task);
    const dates = [];
    let due = task.due;
    if (due >= start && due < end) dates.push({ date: due, projected: false });
    if (due >= end) return dates;
    const forecast = Object.assign({}, task);
    const scratch = { events: [] };
    if (due < todayDate) {
      complete(scratch, forecast, todayDate);
      due = forecast.due;
      if (due >= start && due < end) dates.push({ date: due, projected: true });
    }
    while (due < end) {
      if (forecast.interval.unit === 'perday') {
        due = addDays(due, 1);
        forecast.anchor = due;
        forecast.index = 0;
        forecast.due = due;
      } else {
        scratch.events.length = 0;
        complete(scratch, forecast, due);
        due = forecast.due;
      }
      if (due >= start && due < end) dates.push({ date: due, projected: true });
    }
    return dates;
  }
  return { VERSION, MODEL_VERSION, today, parseDate, parseAnnualDate, nextAnnualDate, addDays, addMonths, diffDays, occurrence, visibleInCycle, empty, validate, validateModel, createModel, previewModel, applyModel, createTask, updateTask, complete, postpone, archive, dailyAuto, lateWeekly, projectedDates };
});

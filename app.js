(function () {
  'use strict';
  const C = window.ElkCore;
  const KEY = 'elk.personal.v2';
  const main = document.getElementById('main');
  const dialog = document.getElementById('dialog');
  const dialogContent = document.getElementById('dialog-content');
  let state;
  // 6h–12h59 : journal de rêve ; 20h30–5h59 : Daily ; sinon vue d’ensemble.
  const startPage = () => {
    const now = new Date(), minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes >= 360 && minutes < 780) return 'dream';
    if (minutes >= 1230 || minutes < 360) return 'daily';
    return 'home';
  };
  let page = startPage();
  let cycle = 'calendar';
  let homeCategories = null;
  let taskCategories = null;
  let dailyDate = C.today();
  let journalDate = C.today();
  let questionIndex = 0;
  let chartGroups = [];
  let storageProblem = '';
  let pendingModel = null;

  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const questions = () => state.model.questions;
  const fields = () => questions().flatMap(question => question.fields);
  const dateLabel = value => {
    const [year, month, day] = value.split('-');
    return day + '/' + month + '/' + year;
  };
  const niceDate = value => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(C.parseDate(value)));
  const findTask = id => state.tasks.find(task => task.id === id);
  const notice = message => {
    document.getElementById('notice').textContent = message;
    const dialogNotice = dialogContent.querySelector('.dialog-notice');
    if (dialogNotice) dialogNotice.textContent = message;
  };
  function persist(next) {
    C.validate(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); storageProblem = ''; }
    catch (error) { throw new Error('Enregistrement impossible sur cet appareil : ' + error.message + '. Vos modifications n’ont pas été appliquées.'); }
    state = next;
  }
  function transaction(action) {
    try {
      const next = JSON.parse(JSON.stringify(state));
      action(next);
      persist(next);
      return true;
    } catch (error) { notice(error.message); return false; }
  }
  function button(label, action, attrs) {
    return `<button type="button" class="${attrs && attrs.className || 'secondary'}" data-action="${action}"${attrs && attrs.id ? ` data-id="${escape(attrs.id)}"` : ''}>${escape(label)}</button>`;
  }
  function openDialog(content) {
    dialogContent.innerHTML = content + '<div class="dialog-notice" role="status" aria-live="polite"></div>';
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog() { if (dialog.open) dialog.close(); }
  function heading(kicker, title, copy) {
    return `<div class="page-heading"><span class="eyebrow">${escape(kicker)}</span><h2>${escape(title)}</h2>${copy ? `<p>${escape(copy)}</p>` : ''}</div>`;
  }
  function afterComplete(task) {
    const copy = structuredClone(state);
    const item = copy.tasks.find(t => t.id === task.id);
    C.complete(copy, item, C.today());
    return item.due;
  }
  function countdownInfo(task) {
    if (task.mode !== 'countdown' || !task.configured || task.archived) return '';
    return `<div class="info-box countdown-info"><strong>Décompte</strong><br>Prochaine alerte : ${escape(relative(task.due).toLowerCase())} · ${dateLabel(task.due)}<br>Si c’est fait aujourd’hui, il redémarre et la prochaine alerte sera le ${dateLabel(afterComplete(task))}.</div>`;
  }
  function relative(date) {
    const n = C.diffDays(date, C.today());
    if (n === 0) return 'Aujourd’hui';
    if (n === 1) return 'Demain';
    if (n === -1) return 'Hier';
    return n < 0 ? `En retard de ${-n} j` : `Dans ${n} j`;
  }
  function intervalLabel(task) {
    if (!task.configured) return 'À configurer';
    const i = task.interval;
    let label;
    if (i.unit === 'perday') label = `${i.times} fois / jour`;
    else if (i.unit === 'week') label = `${i.times} fois / semaine`;
    else if (i.unit === 'day') label = i.every === 1 ? 'Chaque jour' : `Tous les ${i.every} jours`;
    else if (i.every % 12 === 0) label = i.every === 12 ? 'Chaque année' : `Tous les ${i.every / 12} ans`;
    else label = i.every === 1 ? 'Chaque mois' : `Tous les ${i.every} mois`;
    return task.annualDate ? `${label} · date fixe ${task.annualDate.slice(3)}/${task.annualDate.slice(0, 2)}` : label;
  }
  function categoryView(items, selected) {
    const categories = [...new Set(items.map(task => task.category))].sort((a, b) => a.localeCompare(b, 'fr'));
    const enabled = new Set(categories.filter(category => selected === null || selected.has(category)));
    return { categories, enabled, items: items.filter(task => enabled.has(task.category)) };
  }
  function categoryEmoji(category) {
    return ({ Administratif: '📋', Maison: '🏠', Soin: '🧴' })[category] || '🏷️';
  }
  function categoryFilter(view, scope) {
    return `<div class="category-filter category-filter-${scope}"><div class="category-toggles" role="group" aria-label="Filtrer par catégorie">
      ${view.categories.map(category => `<button type="button" class="category-toggle ${view.enabled.has(category) ? 'selected' : ''}" data-action="category-toggle" data-scope="${scope}" data-category="${escape(category)}" aria-pressed="${view.enabled.has(category)}"><span aria-hidden="true">${categoryEmoji(category)}</span>${escape(category)}</button>`).join('')}
    </div></div>`;
  }
  function card(task) {
    const diff = C.diffDays(task.due, C.today());
    return `<button class="task-card" data-action="task-detail" data-id="${escape(task.id)}" style="--solid:${Math.max(0, Math.min(1, 1 - diff / 365)).toFixed(3)}">
      <span class="task-icon ${diff < 0 ? 'late' : ''}" role="img" aria-label="${escape(task.category)}" title="${escape(task.category)}">${categoryEmoji(task.category)}</span><span class="task-copy"><strong>${escape(task.name)}</strong>
      <small>${escape(task.category)} · ${escape(intervalLabel(task))}</small></span><span class="task-date ${diff < 0 ? 'late-text' : ''}">${escape(relative(task.due))}<small>${dateLabel(task.due)}</small></span><span class="chevron">›</span></button>`;
  }
  function chart(tasks) {
    const now = C.today();
    const date = new Date(C.parseDate(now));
    let yearStart, yearEnd, monthStart, monthEnd;
    if (cycle === 'rolling') {
      yearStart = now; yearEnd = C.addMonths(now, 12);
      monthStart = now; monthEnd = C.addDays(now, 30);
    } else {
      const year = date.getUTCFullYear() - (date.getUTCMonth() < 8 ? 1 : 0);
      yearStart = `${year}-09-01`; yearEnd = `${year + 1}-09-01`;
      monthStart = now.slice(0, 7) + '-01'; monthEnd = C.addMonths(monthStart, 1);
    }
    const rings = [
      { radius: 132, start: yearStart, end: yearEnd, label: 'Année' },
      { radius: 96, start: monthStart, end: monthEnd, label: 'Mois' },
      { radius: 60, start: now, end: C.addDays(now, 1), label: 'Jour' }
    ];
    let dots = '';
    let positionMarkers = '';
    chartGroups = [];
    rings.forEach((ring, ri) => {
      const total = C.diffDays(ring.end, ring.start);
      const cycleName = ri === 0 ? 'year' : ri === 1 ? 'month' : 'day';
      if (ri < 2) {
        const progress = Math.max(0, Math.min(1, C.diffDays(now, ring.start) / total));
        const angle = progress * Math.PI * 2 - Math.PI / 2;
        const inner = ring.radius - 5;
        const outer = ring.radius + 5;
        const x1 = 170 + Math.cos(angle) * inner;
        const y1 = 170 + Math.sin(angle) * inner;
        const x2 = 170 + Math.cos(angle) * outer;
        const y2 = 170 + Math.sin(angle) * outer;
        positionMarkers += `<line class="cycle-position" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"><title>Aujourd’hui dans le cycle ${ring.label.toLowerCase()} · ${dateLabel(now)}</title></line>`;
      }
      const eligibleTasks = tasks.filter(task => C.visibleInCycle(task, cycleName));
      const entries = ri === 2
        ? eligibleTasks.filter(task => task.due === now).map(task => ({ task, date: now, projected: false }))
        : eligibleTasks.flatMap(task => C.projectedDates(task, ring.start, ring.end, now).map(item => ({ task, ...item })));
      const groups = ri === 2 ? entries.map((entry, index) => ({ entries: [entry], fraction: index / entries.length })) : [];
      if (ri !== 2) {
        const buckets = new Map();
        entries.forEach(entry => {
          const bucket = Math.floor(C.diffDays(entry.date, ring.start) * (ri === 0 ? 52 : 30) / total);
          if (!buckets.has(bucket)) buckets.set(bucket, []);
          buckets.get(bucket).push(entry);
        });
        groups.push(...[...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, group]) => ({
          entries: group.sort((a, b) => a.date.localeCompare(b.date)),
          fraction: (bucket + 0.5) / (ri === 0 ? 52 : 30)
        })));
      }
      groups.forEach(({ entries: group, fraction }) => {
        const angle = fraction * Math.PI * 2 - Math.PI / 2;
        const r = ring.radius;
        const x = 170 + Math.cos(angle) * r;
        const y = 170 + Math.sin(angle) * r;
        const last = group[group.length - 1];
        const label = group.length === 1 ? group[0].task.name + ' · ' + dateLabel(group[0].date) : `${group.length} échéances · ${dateLabel(group[0].date)}${last.date !== group[0].date ? ' – ' + dateLabel(last.date) : ''}`;
        const groupIndex = chartGroups.push(group) - 1;
        const radius = ri === 2 ? Math.min(6, Math.max(2.5, 150 / groups.length)) : 5;
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" class="chart-dot ${group.every(entry => entry.projected) ? 'projected-dot' : ''}" tabindex="0" role="button" aria-label="${escape(label)}" data-action="chart-group" data-group="${groupIndex}"><title>${escape(label)}</title></circle>`;
      });
    });
    return `<svg class="cycles" viewBox="0 0 340 340" aria-label="Cycles de tâches : année, mois et jour">
      <circle cx="170" cy="170" r="132" class="ring ring-year"/><circle cx="170" cy="170" r="96" class="ring ring-month"/><circle cx="170" cy="170" r="60" class="ring ring-day"/>
      <text x="170" y="160" class="cycle-day">${date.getUTCDate()}</text><text x="170" y="182" class="cycle-month">${escape(new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(date).toUpperCase())}</text>
      ${dots}${positionMarkers}</svg>`;
  }
  function home() {
    const allTasks = state.tasks.filter(t => t.configured && !t.archived).sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name, 'fr'));
    const view = categoryView(allTasks, homeCategories);
    const tasks = view.items;
    return `${categoryFilter(view, 'home')}
      <section class="cycle-panel"><div class="section-top cycle-controls"><div class="segmented"><button data-action="cycle" data-value="rolling" class="${cycle === 'rolling' ? 'selected' : ''}">Glissant</button><button data-action="cycle" data-value="calendar" class="${cycle === 'calendar' ? 'selected' : ''}">Année</button></div></div>
      ${chart(tasks)}<div class="legend"><span><i></i> Année</span><span><i></i> Mois</span><span><i></i> Jour</span></div></section>
      <section class="list-section"><div class="section-top"><div><h3>Vos tâches</h3></div><button class="text-button" data-page="tasks">Tout gérer ↗</button></div>
      ${tasks.length ? tasks.map(card).join('') : '<p class="empty">Aucune tâche active. Ajoutez-en depuis « Modifier les tâches ».</p>'}</section>`;
  }
  function tasksPage() {
    const view = categoryView(state.tasks, taskCategories);
    const active = view.items.filter(t => !t.archived);
    const archived = view.items.filter(t => t.archived);
    const list = (items, isArchived) => items.map(task => `<div class="manage-row"><div><strong>${escape(task.name)}</strong><small>${escape(task.category)} · ${escape(intervalLabel(task))}${task.configured ? ' · ' + dateLabel(task.due) : ''}</small></div><div class="row-actions">${button('Historique', 'task-detail', { id: task.id })}${button('Modifier', 'edit-task', { id: task.id })}${button(isArchived ? 'Restaurer' : 'Archiver', isArchived ? 'restore-task' : 'archive-task', { id: task.id })}</div></div>`).join('');
    return `<button class="primary wide" data-action="new-task">+ Ajouter une tâche</button>
      ${categoryFilter(view, 'tasks')}
      <section class="panel"><h3>En suivi <span class="count">${active.length}</span></h3>${list(active, false) || '<p class="empty">Aucune tâche.</p>'}</section>
      <section class="panel"><h3>Archivées <span class="count">${archived.length}</span></h3>${list(archived, true) || '<p class="empty">Aucune tâche archivée.</p>'}</section>`;
  }
  function detail(task) {
    const history = state.events.filter(e => e.taskId === task.id).reverse().map(e => {
      const labels = { created: 'Création', updated: 'Modification', completed: 'Effectuée', postponed: e.reason === 'late' ? 'Report · en retard' : 'Report · c’est ok', archived: 'Archivage', restored: 'Restauration' };
      return `<li><span>${escape(labels[e.type])}</span><small>${dateLabel(e.date)}${e.due ? ' · échéance ' + dateLabel(e.due) : ''}</small></li>`;
    }).join('');
    const available = task.configured && !task.archived;
    openDialog(`<div class="dialog-header"><div><span class="eyebrow">${escape(task.category)}</span><h2>${escape(task.name)}</h2></div><button class="icon-button" data-action="close" aria-label="Fermer">×</button></div>
      <p class="detail-date">${task.configured ? `${escape(relative(task.due))} · ${dateLabel(task.due)}` : 'À configurer'}${task.archived ? ' · Archivée' : ''}</p><p class="muted">${escape(intervalLabel(task))} · ${task.mode === 'fixed' ? 'calendrier fixe' : 'décompte après réalisation'}</p>${countdownInfo(task)}
      <div class="dialog-actions">${available ? `<button class="primary" data-action="complete" data-id="${escape(task.id)}">✓ C’est fait !</button><button class="secondary" data-action="postpone" data-id="${escape(task.id)}">Repousser</button>` : ''}<button class="secondary" data-action="edit-task" data-id="${escape(task.id)}">⚙ Paramètres</button></div>
      <h3>Historique</h3><ul class="history">${history}</ul>`);
  }
  function taskForm(task) {
    const t = task || { name: '', category: '', mode: 'countdown', due: C.today(), interval: { unit: 'week', every: 1, times: 1 } };
    const i = t.interval || { unit: 'week', every: 1, times: 1 };
    const categories = [...new Set(state.tasks.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    openDialog(`<div class="dialog-header"><div><h2>${task ? 'Modifier la tâche' : 'Nouvelle tâche'}</h2></div><button class="icon-button" data-action="close" aria-label="Fermer">×</button></div>
      <form id="task-form" class="task-form" data-id="${escape(task ? task.id : '')}">
      <fieldset><legend>La tâche</legend>
      <label>Nom<input name="name" required maxlength="120" value="${escape(t.name)}"></label>
      <label>Catégorie<input name="category" list="task-categories" required maxlength="80" value="${escape(t.category)}" placeholder="Maison, Soin…"></label>
      <datalist id="task-categories">${categories.map(category => `<option value="${escape(category)}"></option>`).join('')}</datalist></fieldset>
      <fieldset><legend>Rythme</legend>
      <label>Répétition<select name="unit"><option value="day" ${i.unit === 'day' ? 'selected' : ''}>Tous les … jours</option><option value="perday" ${i.unit === 'perday' ? 'selected' : ''}>… fois par jour</option><option value="week" ${i.unit === 'week' ? 'selected' : ''}>… fois par semaine</option><option value="month" ${i.unit === 'month' ? 'selected' : ''}>Tous les … mois</option></select></label>
      <label><span id="task-amount-label">Nombre</span><input name="amount" type="number" min="1" max="${i.unit === 'week' ? 7 : i.unit === 'perday' ? 24 : 1000}" step="1" required value="${i.unit === 'week' || i.unit === 'perday' ? i.times : i.every}"></label>
      <label>Fonctionnement<select name="mode" aria-describedby="task-mode-help"><option value="countdown" ${t.mode === 'countdown' ? 'selected' : ''}>Décompte après réalisation</option><option value="fixed" ${t.mode === 'fixed' ? 'selected' : ''}>Dates fixes</option></select></label>
      <p class="form-help" id="task-mode-help"></p></fieldset>
      <fieldset><legend>Prochaine échéance</legend>
      <label>Date<input name="due" type="date" required value="${escape(t.due || C.today())}"></label>
      <p class="form-help">${task ? 'Modifier le rythme, le fonctionnement ou cette date démarre une nouvelle série. Avec un repère annuel, la date choisie ne modifie que l’échéance en cours. L’historique est conservé.' : 'La première échéance à afficher pour cette tâche.'}</p>
      <details class="task-advanced" ${t.annualDate ? 'open' : ''}><summary>Repère annuel pour le modèle (facultatif)</summary>
      <label>Jour et mois de référence<input name="annualDate" type="date" aria-describedby="task-annual-help" value="${escape(t.annualDate ? `2000-${t.annualDate}` : '')}"></label>
      <p class="form-help" id="task-annual-help">Pour une tâche à dates fixes répétée tous les 1, 2, 3, 4, 6 ou 12 mois. Ce repère fixe les échéances suivantes et le calendrier lors d’un import du modèle. La date ci-dessus reste l’échéance en cours.</p></details></fieldset>
      <button class="primary wide" type="submit">Enregistrer</button></form>`);
    const form = document.getElementById('task-form');
    const update = () => {
      const unit = form.unit.value;
      form.amount.max = unit === 'week' ? 7 : unit === 'perday' ? 24 : 1000;
      document.getElementById('task-amount-label').textContent = { day: 'Nombre de jours entre deux échéances', perday: 'Nombre de fois par jour', week: 'Nombre de fois par semaine', month: 'Nombre de mois entre deux échéances' }[unit];
      document.getElementById('task-mode-help').textContent = form.mode.value === 'countdown'
        ? 'Le rythme repart après « C’est fait » ou un report « C’est ok ».'
        : 'Les échéances suivent le calendrier ; les dates déjà passées sont sautées après réalisation.';
      const incompatible = form.annualDate.value && (form.mode.value !== 'fixed' || unit !== 'month' || ![1, 2, 3, 4, 6, 12].includes(Number(form.amount.value)));
      form.annualDate.setCustomValidity(incompatible ? 'Le repère annuel nécessite des dates fixes et un rythme de 1, 2, 3, 4, 6 ou 12 mois. Effacez le repère ou modifiez le rythme.' : '');
      if (incompatible) form.querySelector('.task-advanced').open = true;
    };
    ['unit', 'amount', 'mode', 'annualDate'].forEach(name => form.elements[name].addEventListener('input', update));
    update();
  }
  function postponeForm(task) {
    openDialog(`<div class="dialog-header"><div><span class="eyebrow">PRENDRE SON TEMPS</span><h2>Repousser</h2></div><button class="icon-button" data-action="close" aria-label="Fermer">×</button></div>
      <p>${escape(task.name)}</p><form id="postpone-form" data-id="${escape(task.id)}">
      <label>Pourquoi ?<select name="reason"><option value="late">Je suis en retard</option><option value="okay">C’est ok</option></select></label>
      <label>Nouvelle échéance<input type="date" name="due" required value="${C.addDays(task.due > C.today() ? task.due : C.today(), 1)}"></label>
      <p class="form-help" id="postpone-help"></p><div class="info-box countdown-info" id="postpone-preview" aria-live="polite"></div><button class="primary wide" type="submit">Confirmer le report</button></form>`);
    const form = document.getElementById('postpone-form');
    const resetDue = () => task.interval.unit === 'perday' ? C.addDays(C.today(), 1) : C.occurrence(C.today(), task.interval, 1);
    const lateDue = () => C.addDays(task.due > C.today() ? task.due : C.today(), 1);
    let edited = false;
    form.due.addEventListener('input', () => { edited = true; preview(); });
    const preview = () => {
      const countdown = task.mode === 'countdown';
      const reset = countdown && form.reason.value === 'okay';
      const due = form.due.value;
      const lines = [`Échéance actuelle : ${dateLabel(task.due)}`];
      if (due) lines.push(`Prochaine alerte : ${dateLabel(due)}`);
      if (reset) lines.push(`Le décompte redémarre aujourd’hui (${dateLabel(C.today())}).`);
      else if (countdown) lines.push('Le décompte ne redémarre pas : il repartira à la réalisation de la tâche.');
      else lines.push('Le calendrier fixe reste inchangé après ce report.');
      document.getElementById('postpone-preview').innerHTML = lines.map(escape).join('<br>');
    };
    const update = () => {
      const reset = task.mode === 'countdown' && form.reason.value === 'okay';
      form.due.min = C.addDays(C.today(), 1);
      if (!edited) form.due.value = reset ? resetDue() : lateDue();
      document.getElementById('postpone-help').textContent = reset
        ? 'Le décompte repart aujourd’hui ; la date proposée suit le rythme, mais vous pouvez en choisir une autre.'
        : 'Choisissez une date après aujourd’hui et après l’échéance actuelle. Le rythme fixe reste ancré au calendrier.';
      preview();
    };
    form.reason.addEventListener('change', update);
    update();
  }
  function dailyControl(field, value, showLabel) {
    const id = 'daily-' + field.key;
    const labelClass = showLabel ? '' : ' class="sr-only"';
    if (field.type === 'select' || field.max !== undefined) {
      const options = field.options;
      const min = options ? 0 : field.min;
      const max = options ? options.length - 1 : field.max;
      const found = options ? options.indexOf(String(value)) : -1;
      const current = options ? (found >= 0 ? found : 0) : (value == null ? (min + max) / 2 : value);
      const display = options ? options[current] : current;
      return `<div class="slider-control"><label${labelClass} for="${id}">${escape(field.label)}</label><output for="${id}">${escape(display)}</output>
        <input id="${id}" name="${escape(field.key)}" type="range" min="${min}" max="${max}" step="${options ? 1 : field.step}" value="${current}" aria-valuetext="${escape(display)}">
        <div class="range-ends"><span>${escape(options ? options[0] : min)}</span><span>${escape(options ? options[options.length - 1] : max)}</span></div>${field.hint ? `<small class="field-unit">${escape(field.hint)}</small>` : ''}</div>`;
    }
    return `<div class="stepper-control"><label${labelClass} for="${id}">${escape(field.label)}</label><div class="stepper">
      <button type="button" data-action="daily-step" data-key="${escape(field.key)}" data-direction="-1" aria-label="Diminuer ${escape(field.label)}">−</button>
      <input id="${id}" name="${escape(field.key)}" type="number" inputmode="decimal" min="0" step="${field.step}" required value="${escape(value == null ? 0 : value)}">
      <button type="button" data-action="daily-step" data-key="${escape(field.key)}" data-direction="1" aria-label="Augmenter ${escape(field.label)}">+</button></div>${field.hint ? `<small class="field-unit">${escape(field.hint)}</small>` : ''}</div>`;
  }
  function dailyQuestion() {
    if (!questions().length) return;
    const question = questions()[questionIndex];
    const values = state.daily[dailyDate] || {};
    openDialog(`<div class="dialog-header"><div><h2 tabindex="-1">${escape(question.label)}</h2></div><button class="icon-button" data-action="close" aria-label="Fermer">×</button></div>
      <div class="progress" role="progressbar" aria-label="Progression du Daily" aria-valuemin="0" aria-valuemax="${questions().length}" aria-valuenow="${questionIndex + 1}"><div style="width:${(questionIndex + 1) / questions().length * 100}%"></div></div>
      <form id="daily-form">
      ${question.fields.map(field => dailyControl(field, values[field.key], question.fields.length !== 1 || field.label !== question.label)).join('')}
      <div class="question-actions"><button class="secondary" type="button" data-action="daily-prev" ${questionIndex === 0 ? 'disabled' : ''}>← Précédent</button><button class="secondary" type="button" data-action="daily-skip">Passer</button><button class="primary" type="submit">${questionIndex === questions().length - 1 ? 'Terminer' : 'Enregistrer & suivant →'}</button></div></form>`);
    dialogContent.querySelector('h2').focus();
  }
  function dailyPage() {
    const values = state.daily[dailyDate] || {};
    const count = fields().filter(field => Object.prototype.hasOwnProperty.call(values, field.key)).length;
    return `<label class="date-picker sr-only" for="daily-date">Date</label><input class="date-picker" type="date" id="daily-date" aria-label="Date du Daily" value="${dailyDate}">
      <section class="panel"><h3>Auto-évaluation</h3><p>${count} valeur${count > 1 ? 's' : ''} renseignée${count > 1 ? 's' : ''} pour cette date.</p>${questions().length ? '<button class="primary" data-action="daily-open">Ouvrir l’auto-évaluation</button>' : '<p class="empty">Aucun modèle Daily chargé. Importez votre modèle dans « Sauvegarde & données ».</p>'}</section>
      ${journalEditor('evening', dailyDate)}`;
  }
  function journalEditor(kind, date) {
    const journal = state.journals[date] || {};
    const title = journal[`${kind}Title`] || '';
    const text = journal[kind] || '';
    return `<section class="panel"><h3>${kind === 'dream' ? 'Journal de rêve' : 'Journal du soir'}</h3>
      <form class="journal-form" data-kind="${kind}" data-date="${date}">
        <label for="${kind}-title">Titre<input id="${kind}-title" name="title" maxlength="120" value="${escape(title)}"></label>
        <label for="${kind}-text">Texte<textarea id="${kind}-text" name="text" rows="6" aria-label="${kind === 'dream' ? 'Texte du rêve' : 'Texte du journal du soir'}" placeholder="${kind === 'dream' ? 'Un rêve, une image, une sensation…' : 'Comment s’est passée cette journée ?'}">${escape(text)}</textarea></label>
        <button type="submit" class="primary">Enregistrer le journal</button>
      </form></section>${journalArchive(kind)}`;
  }
  function journalArchive(kind) {
    const entries = Object.entries(state.journals)
      .filter(([, journal]) => journal[kind]?.trim() || journal[`${kind}Title`]?.trim())
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
    const label = kind === 'dream' ? 'Rêves enregistrés' : 'Journaux du soir';
    return `<section class="journal-archive"><h2>${label}</h2>
      <div class="journal-lock locked" data-lock="${kind}"><div class="journal-lock-body" inert aria-hidden="true">
      ${entries.length ? entries.map(([date, journal]) => `<article class="journal-entry">
        <time datetime="${date}">${dateLabel(date)}</time>
        <h3>${escape(journal[`${kind}Title`] || 'Sans titre')}</h3>
        ${journal[kind] ? `<p>${escape(journal[kind])}</p>` : ''}
      </article>`).join('') : '<p class="empty">Aucun journal enregistré.</p>'}
            </div><button type="button" class="journal-lock-button" data-action="journal-unlock" aria-label="Journaux masqués : activer 4 fois de suite pour afficher"></button></div>
          </section>`;
  }
  function dreamPage() {
    return `<label class="date-picker sr-only" for="journal-date">Date</label><input class="date-picker" type="date" id="journal-date" aria-label="Date du journal de rêve" value="${journalDate}">${journalEditor('dream', journalDate)}`;
  }
  const autoFields = [
    { key: 'auto_late', label: 'Retards (événements)' }, { key: 'auto_early', label: 'Avances (événements)' },
    { key: 'auto_evening', label: 'Journal du soir (0 ou 1)' }, { key: 'auto_dream', label: 'Journal de rêve (0 ou 1)' }
  ];
  function lateChart() {
    const weeks = C.lateWeekly(state, C.today());
    if (!weeks.length) return '<p class="empty">Aucun retard enregistré pour le moment.</p>';
    const max = weeks[weeks.length - 1].total;
    const x = i => 52 + (weeks.length === 1 ? 0.5 : i / (weeks.length - 1)) * 220;
    const y = v => 270 - v / max * 220;
    const line = weeks.map((w, i) => `${x(i)},${y(w.total)}`).join(' ');
    const dots = weeks.map((w, i) => `<circle cx="${x(i)}" cy="${y(w.total)}" r="3.5" class="plot-dot"><title>Semaine du ${dateLabel(w.week)} : ${w.count} retard${w.count > 1 ? 's' : ''}, ${w.total} cumulé${w.total > 1 ? 's' : ''}</title></circle>`).join('');
    return `<svg class="plot" viewBox="0 0 310 310" role="img" aria-label="Courbe des retards cumulés : ${max} retard${max > 1 ? 's' : ''} sur ${weeks.length} semaine${weeks.length > 1 ? 's' : ''}"><path d="M52 30V270H280" fill="none" stroke="#79918a"/><polyline points="${line}" fill="none" stroke="#6f9b7a" stroke-width="2.5" stroke-linejoin="round"/>${dots}<text x="52" y="293">${escape(dateLabel(weeks[0].week))}</text><text x="272" y="293" text-anchor="end">${escape(dateLabel(weeks[weeks.length - 1].week))}</text><text x="4" y="270">0</text><text x="4" y="54">${max}</text></svg>
      <p class="form-help">Chaque point est une semaine (du lundi au dimanche). La courbe additionne les tâches terminées en retard et les reports pour retard.</p>`;
  }
  function analysisPage() {
    const numeric = fields().filter(f => f.type === 'number' || f.numeric).map(f => ({ key: f.key, label: f.label })).concat(autoFields);
    const options = numeric.map(f => `<option value="${escape(f.key)}">${escape(f.label)}</option>`).join('');
    return `<section class="panel"><h3>Retards cumulés par semaine</h3>${lateChart()}</section><section class="panel"><div class="axis-fields">
      <label>Axe horizontal<select id="axis-x">${options}</select></label><label>Axe vertical<select id="axis-y">${options}</select></label></div><div id="plot"></div>
      <p class="form-help">Un point représente un jour. Seuls les jours où les deux valeurs sont disponibles sont affichés. Les indicateurs automatiques valent 0 en l’absence d’événement pour une journée enregistrée.</p></section>`;
  }
  function plot() {
    const x = document.getElementById('axis-x').value;
    const y = document.getElementById('axis-y').value;
    const dates = new Set([...Object.keys(state.daily), ...Object.keys(state.journals), ...state.events.map(e => e.date)]);
    const value = (date, key) => {
      if (key.startsWith('auto_')) return C.dailyAuto(state, date)[key.slice(5)];
      const v = (state.daily[date] || {})[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const points = [...dates].sort().map(date => ({ date, x: value(date, x), y: value(date, y) })).filter(p => p.x !== null && p.y !== null);
    if (!points.length) { document.getElementById('plot').innerHTML = '<p class="empty">Pas encore de données communes pour ces variables.</p>'; return; }
    const bounds = (key, values) => {
      const low = Math.min(...values), high = Math.max(...values);
      const field = fields().find(f => f.key === key);
      let min = 0, max = high;
      if (key === 'auto_evening' || key === 'auto_dream') max = 1;
      else if (field && field.numeric && field.options) {
        const numbers = field.options.map(Number).filter(Number.isFinite);
        min = Math.min(...numbers); max = Math.max(...numbers);
      } else if (field) { min = field.min; if (field.max !== undefined) max = field.max; }
      min = Math.min(min, low); max = Math.max(max, high);
      return max === min ? [min, min + 1] : [min, max];
    };
    const [minX, maxX] = bounds(x, points.map(p => p.x));
    const [minY, maxY] = bounds(y, points.map(p => p.y));
    const position = (v, min, max, start, span) => start + (v - min) / (max - min) * span;
    const dots = points.map(p => `<circle cx="${position(p.x, minX, maxX, 52, 220)}" cy="${270 - position(p.y, minY, maxY, 0, 220)}" r="5" class="plot-dot"><title>${dateLabel(p.date)} : ${p.x} ; ${p.y}</title></circle>`).join('');
    document.getElementById('plot').innerHTML = `<p>${points.length} jour${points.length > 1 ? 's' : ''} en commun</p><svg class="plot" viewBox="0 0 310 310" role="img" aria-label="Nuage de points : ${points.length} jours"><path d="M52 30V270H280" fill="none" stroke="#79918a"/>${dots}<text x="52" y="293">${escape(minX)}</text><text x="260" y="293">${escape(maxX)}</text><text x="4" y="270">${escape(minY)}</text><text x="4" y="54">${escape(maxY)}</text></svg>`;
  }
  function dataPage() {
    return `<div class="page-heading"><h2>Sauvegarde & confidentialité</h2></div>
      <section class="panel"><h3>Modèle personnel</h3><p>Le modèle contient les définitions de vos tâches et les questions du Daily, mais jamais vos réponses, journaux ni historique. Transférez-le séparément et ne le publiez pas avec le code public.</p><button class="primary" data-action="export-model">Exporter le modèle actif</button>
      <label class="file-label">Importer un modèle JSON<input type="file" id="model-file" accept=".json,application/json"></label>
      <div class="info-box">L’import affiche les ajouts, modifications et retraits avant application. Les réponses, journaux et historiques existants sont conservés.</div></section>
      <section class="panel"><h3>Sauvegarde complète</h3><p>Exportez régulièrement toutes vos données, notamment avant un changement de téléphone ou l’effacement du stockage du navigateur.</p><button class="primary" data-action="export">Exporter mes données complètes</button>
      <div class="info-box">Cette sauvegarde inclut aussi vos journaux, réponses et historique. Elle n’est pas chiffrée : conservez-la dans un endroit privé.</div></section>
      <section class="panel"><h3>Restaurer une sauvegarde complète</h3><p>La restauration remplace toutes les données actuelles. Exportez-les d’abord si vous souhaitez les conserver.</p><label class="file-label">Choisir une sauvegarde JSON<input type="file" id="import-file" accept=".json,application/json"></label></section>
      <section class="panel tutorial"><h3>Installation & stockage</h3>
      <p>Petit guide pas à pas, sans prérequis technique. Touchez un titre pour déplier l’étape.</p>
      <details open><summary>Comment ça marche, en bref</summary>
        <p>Elk est un <strong>site web installable</strong> : une fois ajouté à l’écran d’accueil, il se comporte comme une application et fonctionne sans connexion.</p>
        <p>Il y a deux choses distinctes : <strong>l’application</strong> (le programme, identique pour tout le monde, hébergé sur une adresse web) et <strong>vos données</strong> (tâches, réponses, journaux), qui restent <strong>uniquement dans le navigateur de votre téléphone</strong>. L’hébergement ne reçoit jamais vos données.</p></details>
      <details><summary>Étape 1 · Mettre l’application en ligne (une seule fois, sur ordinateur)</summary>
        <p>Android n’installe une application web que depuis une adresse <strong>https://</strong>. Il faut donc déposer les fichiers de l’application chez un hébergeur gratuit, par exemple Netlify (« Netlify Drop » : glisser-déposer un dossier), GitHub Pages ou Cloudflare Pages. Vous obtiendrez une adresse du type <em>https://mon-elk.netlify.app</em>.</p>
        <p><strong>Créez d’abord un dossier de copie</strong> contenant seulement : <em>index.html, manifest.webmanifest, sw.js, styles.css, icon.svg, icon-192.png, icon-512.png</em> et le dossier <em>src</em>. Déposez ce dossier-là.</p>
        <div class="info-box"><strong>Ne déposez jamais</strong> vos fichiers personnels (modèle <em>elk-modele-….json</em>, sauvegardes <em>elk-sauvegarde-….json</em>, fichiers .txt) : l’adresse est publique, ces fichiers seraient lisibles par n’importe qui.</div></details>
      <details><summary>Étape 2 · Installer sur le téléphone</summary>
        <ol><li>Ouvrez l’adresse https dans <strong>Chrome</strong> et attendez le chargement complet.</li>
        <li>Menu <strong>⋮</strong> de Chrome → <strong>Installer l’application</strong> (ou « Ajouter à l’écran d’accueil »).</li>
        <li>Ouvrez Elk depuis la nouvelle icône. Il est vide : c’est normal, vos définitions arrivent à l’étape suivante.</li></ol>
        <p>Ouvrez l’application au moins une fois avec du réseau : elle se met alors en mémoire pour fonctionner hors ligne.</p></details>
      <details><summary>Étape 3 · Charger votre modèle personnel</summary>
        <p>Le modèle contient la liste de vos tâches et les questions du Daily, mais aucune donnée vécue.</p>
        <ol><li>Envoyez le fichier modèle sur le téléphone (câble USB, e-mail à vous-même, cloud privé).</li>
        <li>Dans Elk, ouvrez 💾 → <strong>Importer un modèle JSON</strong> et choisissez le fichier.</li>
        <li>Vérifiez l’aperçu des changements, puis confirmez. Vos tâches et questions apparaissent.</li></ol></details>
      <details><summary>Étape 4 · Faire des sauvegardes (indispensable)</summary>
        <p>Dans 💾, touchez <strong>Exporter mes données complètes</strong> : un fichier est enregistré dans le dossier Téléchargements. <strong>Copiez-le ailleurs</strong> (ordinateur, cloud privé) : s’il reste seulement sur le téléphone, il peut disparaître avec lui.</p>
        <p>Rythme conseillé : une fois par semaine, et toujours avant de changer de téléphone, de vider le navigateur ou de désinstaller Elk.</p></details>
      <details><summary>Changer de téléphone ou récupérer ses données</summary>
        <ol><li>Refaites l’étape 2 (installation) avec <strong>la même adresse</strong>.</li>
        <li>Dans 💾, section <strong>Restaurer une sauvegarde complète</strong>, choisissez votre fichier de sauvegarde.</li></ol>
        <p>La restauration remplace tout ce qui est dans l’application : elle ramène tâches, historique, réponses et journaux. Une ancienne sauvegarde (version 1) est acceptée, mais il faudra alors réimporter le modèle pour retrouver les questions du Daily.</p></details>
      <details><summary>Où sont mes données, et que risque-t-on ?</summary>
        <ul><li><strong>Stockage :</strong> dans la mémoire locale du navigateur, propre à <em>cet appareil</em> et à <em>cette adresse</em>. Si l’adresse change, l’application repart vide ; il suffit alors de restaurer une sauvegarde.</li>
        <li><strong>Pas de synchronisation :</strong> deux appareils ne partagent rien automatiquement. Passez par une sauvegarde.</li>
        <li><strong>Risque d’effacement :</strong> vider les données de Chrome, désinstaller l’application ou manquer d’espace peut tout supprimer.</li>
        <li><strong>Pas de chiffrement :</strong> protégez votre téléphone et gardez vos fichiers de sauvegarde dans un endroit privé.</li></ul></details>
      <details><summary>Mettre à jour l’application</summary>
        <p>Redéposez les fichiers modifiés chez l’hébergeur (mêmes noms). Sur le téléphone, fermez complètement Elk puis rouvrez-le, parfois deux fois : la nouvelle version s’active alors. Vos données ne sont pas touchées.</p></details>
      <details><summary>Ça ne marche pas ?</summary>
        <ul><li><strong>« Installer l’application » n’apparaît pas :</strong> vérifiez que l’adresse commence par https:// et ouvrez-la dans Chrome.</li>
        <li><strong>L’application est vide :</strong> normal après une installation ou un changement d’adresse. Importez le modèle puis restaurez votre sauvegarde.</li>
        <li><strong>« Restauration impossible » :</strong> le fichier n’est pas une sauvegarde complète d’Elk (un modèle ne se restaure pas ici, il s’importe dans « Modèle personnel »).</li>
        <li><strong>Test sur ordinateur :</strong> avec Node.js, lancez <em>node tests\serve.js</em> et ouvrez <em>http://127.0.0.1:8765</em> (accessible seulement depuis cet ordinateur).</li></ul></details></section>`;
  }
  function modelPreview(model) {
    pendingModel = model;
    const changes = C.previewModel(state, model);
    const lines = [
      ...changes.added.map(name => `Ajout : ${name}`),
      ...changes.updated.map(item => `Modification : ${item.name} (${item.changes.join(' ; ')})`),
      ...changes.removed.map(name => `Retrait (archivage) : ${name}`)
    ];
    if (changes.questionsChanged) lines.push('Les questions du Daily seront remplacées.');
    openDialog(`<div class="dialog-header"><div><span class="eyebrow">MODÈLE PERSONNEL</span><h2>Aperçu des changements</h2></div><button class="icon-button" data-action="close" aria-label="Fermer">×</button></div>
      <p class="form-help">${changes.unchanged ? 'Ce modèle correspond déjà à la configuration active.' : 'Vérifiez ces changements avant de les appliquer. Les tâches retirées seront archivées et leur historique conservé.'}</p>
      ${lines.length ? `<ul class="history">${lines.map(line => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}
      <p class="form-help">${model.tasks.length} tâche${model.tasks.length > 1 ? 's' : ''} et ${model.questions.length} étape${model.questions.length > 1 ? 's' : ''} Daily dans ce modèle.</p>
      <div class="dialog-actions"><button class="primary" data-action="model-apply">Appliquer le modèle</button><button class="secondary" data-action="close">Annuler</button></div>`);
  }
  function render() {
    const pages = { home, tasks: tasksPage, daily: dailyPage, dream: dreamPage, analysis: analysisPage, data: dataPage };
    main.innerHTML = pages[page]();
    document.querySelectorAll('.topbar [data-page]').forEach(item => {
      if (item.dataset.page === page) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (page === 'analysis') {
      document.getElementById('axis-y').selectedIndex = 1;
      document.getElementById('axis-x').addEventListener('change', plot);
      document.getElementById('axis-y').addEventListener('change', plot);
      plot();
    }
    if (page === 'daily') document.getElementById('daily-date').addEventListener('change', e => { try { C.parseDate(e.target.value); dailyDate = e.target.value; questionIndex = 0; render(); } catch (error) { notice(error.message); } });
    if (page === 'dream') document.getElementById('journal-date').addEventListener('change', e => { try { C.parseDate(e.target.value); journalDate = e.target.value; render(); } catch (error) { notice(error.message); } });
    if (page === 'data') {
      document.getElementById('import-file').addEventListener('change', importFile);
      document.getElementById('model-file').addEventListener('change', importModelFile);
    }
    window.scrollTo(0, 0);
  }
  function exportFile() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `elk-sauvegarde-${C.today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('Sauvegarde préparée. Vérifiez que le téléchargement est terminé.');
  }
  async function importFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const migrated = backup.version === 1;
      const imported = C.validate(backup);
      if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ? Cette opération ne peut pas être annulée.')) return;
      persist(imported);
      notice(migrated
        ? 'Sauvegarde restaurée. Réimportez votre modèle personnel pour retrouver les questions Daily.'
        : 'Sauvegarde restaurée.');
      render();
    } catch (error) { notice('Restauration impossible : ' + error.message); }
    finally { e.target.value = ''; }
  }
  async function importModelFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try { modelPreview(C.validateModel(JSON.parse(await file.text()))); }
    catch (error) { notice('Import du modèle impossible : ' + error.message); }
    finally { e.target.value = ''; }
  }
  function exportModel() {
    const blob = new Blob([JSON.stringify(C.createModel(state), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `elk-modele-${C.today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('Modèle préparé. Il ne contient pas vos réponses, journaux ni historique.');
  }
  function canLeaveDaily() {
    if (!dialog.open) return true;
    const form = document.getElementById('daily-form');
    return !form || form.dataset.dirty !== 'true' || confirm('Quitter cette étape sans enregistrer ses modifications ?');
  }
  dialog.addEventListener('cancel', e => { if (!canLeaveDaily()) e.preventDefault(); });
  dialog.addEventListener('close', () => { if (page === 'daily') render(); });
  document.addEventListener('input', e => {
    const form = e.target.closest('#daily-form');
    if (!form) return;
    form.dataset.dirty = 'true';
    if (e.target.type === 'range') {
      const field = fields().find(item => item.key === e.target.name);
      const text = field.options ? field.options[Number(e.target.value)] : e.target.value;
      e.target.setAttribute('aria-valuetext', text);
      form.querySelector(`output[for="${e.target.id}"]`).textContent = text;
    }
  });
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-action], [data-page]');
    if (!target) return;
    if (target.dataset.page) {
      if (!canLeaveDaily()) return;
      page = target.dataset.page; closeDialog(); notice(''); render();
      if (page === 'daily' && questions().length) { questionIndex = 0; dailyQuestion(); }
      return;
    }
    const action = target.dataset.action;
    const task = target.dataset.id ? findTask(target.dataset.id) : null;
    if (action === 'close') { if (canLeaveDaily()) closeDialog(); }
    else if (action === 'category-toggle') {
      const isHome = target.dataset.scope === 'home';
      const items = isHome
        ? state.tasks.filter(item => item.configured && !item.archived)
        : state.tasks;
      const categories = [...new Set(items.map(item => item.category))];
      const current = isHome ? homeCategories : taskCategories;
      const selected = new Set(categories.filter(category => current === null || current.has(category)));
      if (selected.has(target.dataset.category)) selected.delete(target.dataset.category);
      else selected.add(target.dataset.category);
      const next = categories.every(category => selected.has(category)) ? null : selected;
      if (isHome) homeCategories = next; else taskCategories = next;
      render();
    }
    else if (action === 'journal-unlock') {
      // Sécurité cosmétique : 4 clics consécutifs (pause max 1,5 s entre deux) pour afficher.
      clearTimeout(Number(target.dataset.timer));
      const count = Number(target.dataset.count || 0) + 1;
      if (count >= 4) {
        const lock = target.closest('.journal-lock');
        const body = lock.querySelector('.journal-lock-body');
        lock.classList.remove('locked');
        body.removeAttribute('inert');
        body.removeAttribute('aria-hidden');
        target.remove();
        return;
      }
      target.dataset.count = String(count);
      target.dataset.timer = String(setTimeout(() => { target.dataset.count = '0'; }, 1500));
    }
    else if (action === 'cycle') { cycle = target.dataset.value; render(); }
    else if (action === 'chart-group') {
      const group = chartGroups[Number(target.dataset.group)];
      if (!group || !group.length) return;
      if (group.length === 1 && !group[0].projected) detail(group[0].task);
      else openDialog(`<div class="dialog-header"><div><span class="eyebrow">CYCLES</span><h2>Échéances</h2></div><button class="icon-button" data-action="close" aria-label="Fermer">×</button></div>
        <p class="form-help">Les projections supposent une réalisation à chaque échéance, ou aujourd’hui pour les tâches en retard ; elles peuvent changer. Ouvrir une tâche affiche son échéance actuelle.</p>
        ${group.map(entry => `<button class="task-card" data-action="task-detail" data-id="${escape(entry.task.id)}"><span class="task-icon" role="img" aria-label="${escape(entry.task.category)}" title="${escape(entry.task.category)}">${categoryEmoji(entry.task.category)}</span><span class="task-copy"><strong>${escape(entry.task.name)}</strong><small>${escape(entry.task.category)} · ${entry.projected ? 'Projection' : 'Échéance actuelle'}</small></span><span class="task-date">${dateLabel(entry.date)}</span><span class="chevron">›</span></button>`).join('')}`);
    }
    else if (action === 'task-detail' && task) detail(task);
    else if (action === 'new-task') taskForm();
    else if (action === 'edit-task' && task) taskForm(task);
    else if (action === 'postpone' && task) postponeForm(task);
    else if (action === 'complete' && task) {
      if (transaction(next => C.complete(next, next.tasks.find(t => t.id === task.id), C.today()))) { closeDialog(); notice(`Tâche enregistrée.${task.mode === 'countdown' ? ` Décompte redémarré, prochaine alerte le ${dateLabel(state.tasks.find(t => t.id === task.id).due)}.` : ''}`); render(); }
    } else if ((action === 'archive-task' || action === 'restore-task') && task) {
      if (transaction(next => C.archive(next, next.tasks.find(t => t.id === task.id), C.today(), action === 'archive-task'))) { notice(action === 'archive-task' ? 'Tâche archivée, historique conservé.' : 'Tâche restaurée.'); render(); }
    } else if (action === 'daily-open') { questionIndex = 0; dailyQuestion(); }
    else if (action === 'daily-prev') {
      if (canLeaveDaily()) { questionIndex = Math.max(0, questionIndex - 1); dailyQuestion(); }
    } else if (action === 'daily-skip') {
      const question = questions()[questionIndex];
      if (question.fields.some(field => field.skipAsZero) && !transaction(next => {
        const values = next.daily[dailyDate] || {};
        question.fields.forEach(field => { if (!Object.prototype.hasOwnProperty.call(values, field.key)) values[field.key] = 0; });
        next.daily[dailyDate] = values;
      })) return;
      if (questionIndex === questions().length - 1) { closeDialog(); render(); notice('Auto-évaluation terminée.'); }
      else { questionIndex++; dailyQuestion(); }
    } else if (action === 'daily-step') {
      const field = fields().find(item => item.key === target.dataset.key);
      const input = document.getElementById('daily-' + field.key);
      if (!input.validity.valid) { input.reportValidity(); return; }
      input.value = String(Math.max(0, Math.round((Number(input.value) + Number(target.dataset.direction) * field.step) * 1000000) / 1000000));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    else if (action === 'export') exportFile();
    else if (action === 'export-model') exportModel();
    else if (action === 'model-apply' && pendingModel) {
      const model = pendingModel;
      if (transaction(next => C.applyModel(next, model, C.today()))) {
        pendingModel = null; closeDialog(); render(); notice('Modèle appliqué. Réponses, journaux et historique conservés.');
      }
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('circle[data-action]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  document.addEventListener('submit', e => {
    const form = e.target;
    e.preventDefault();
    if (form.id === 'task-form') {
      const data = new FormData(form);
      const amount = Number(data.get('amount')), unit = data.get('unit');
      const interval = unit === 'week' || unit === 'perday' ? { unit, every: 1, times: amount } : { unit, every: amount };
      const annualDate = data.get('annualDate');
      const annualMonthDay = annualDate ? annualDate.slice(5) : undefined;
      const input = {
        name: data.get('name').trim(), category: data.get('category').trim(),
        due: data.get('due'),
        mode: data.get('mode'), interval, annualDate: annualMonthDay
      };
      if (transaction(next => {
        const task = next.tasks.find(t => t.id === form.dataset.id);
        if (task) C.updateTask(next, task, input, C.today());
        else C.createTask(next, Object.assign({ anchor: input.due }, input), C.today());
      })) { closeDialog(); notice('Tâche enregistrée.'); render(); }
    } else if (form.id === 'postpone-form') {
      const data = new FormData(form);
      if (transaction(next => C.postpone(next, next.tasks.find(t => t.id === form.dataset.id), C.today(), data.get('due'), data.get('reason')))) { closeDialog(); notice('Report enregistré.'); render(); }
    } else if (form.id === 'daily-form') {
      const question = questions()[questionIndex];
      const data = new FormData(form);
      if (transaction(next => {
        const values = next.daily[dailyDate] || {};
        question.fields.forEach(field => {
          const raw = data.get(field.key);
          if (field.type === 'select') {
            const option = field.options[Number(raw)];
            values[field.key] = field.numeric ? Number(option) : option;
          } else {
            const value = Number(raw);
            if (!Number.isFinite(value) || value < field.min || (field.max !== undefined && value > field.max)) throw new Error('Valeur invalide pour ' + field.label + '.');
            values[field.key] = value;
          }
        });
        next.daily[dailyDate] = values;
      })) {
        if (questionIndex === questions().length - 1) { closeDialog(); render(); notice('Auto-évaluation terminée.'); }
        else { questionIndex++; dailyQuestion(); }
      }
    } else if (form.classList.contains('journal-form')) {
      const data = new FormData(form);
      const title = data.get('title').trim();
      const text = data.get('text').trim();
      if (transaction(next => {
        const journal = next.journals[form.dataset.date] || {};
        const titleKey = `${form.dataset.kind}Title`;
        if (text) journal[form.dataset.kind] = text; else delete journal[form.dataset.kind];
        if (title) journal[titleKey] = title; else delete journal[titleKey];
        if (Object.keys(journal).length) next.journals[form.dataset.date] = journal; else delete next.journals[form.dataset.date];
      })) { notice('Journal enregistré.'); render(); }
    }
  });
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) state = C.validate(JSON.parse(stored));
    else { state = C.empty(); persist(state); }
    render();
  } catch (error) {
    storageProblem = error.message;
    main.innerHTML = `<section class="panel"><h2>Impossible d’ouvrir les données</h2><p>${escape(storageProblem)}</p><p>Les données existantes n’ont pas été remplacées. Vérifiez le stockage du navigateur et conservez toute sauvegarde disponible.</p></section>`;
    document.querySelectorAll('.topbar [data-page]').forEach(item => { item.disabled = true; });
  }
  if ('serviceWorker' in navigator && window.isSecureContext && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(error => notice('Le mode hors ligne n’a pas pu être activé : ' + error.message));
  }
})();

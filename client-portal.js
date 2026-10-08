const clientSiteLog = document.querySelector('#client-site-log');
const stageGrid = document.querySelector('#client-stage-grid');
const decisionList = document.querySelector('#client-decision-list');
const toast = document.querySelector('.toast');
const messageDialog = document.querySelector('#message-dialog');
const statusLabels = { progress: 'In progress', finishing: 'In finishing stages', completed: 'Completed' };
const notificationLink = document.querySelector('#client-notification-link');
let toastTimer;
let projectChannel;
let refreshTimer;
let subscribedProjectId;
let currentClientProjectId;
let currentClientUserId;
let latestTeamMessageAt = '';
let messageStorageWarningShown = false;
let previousSnapshot;
let initialProjectLoadComplete = false;
let notificationCount = 0;
let refreshInProgress = false;
let refreshRequested = false;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function clientMessageReadKey() {
  return `portal-message-read:client:${currentClientUserId}:${currentClientProjectId}`;
}

function clientMessageReadAt() {
  try {
    return window.localStorage.getItem(clientMessageReadKey()) || '';
  } catch (error) {
    console.error('Could not read the saved message notification state.', error);
    if (!messageStorageWarningShown) {
      messageStorageWarningShown = true;
      showToast('Unread message notifications could not be loaded in this browser.');
    }
    return '';
  }
}

function messageTimeIsNewer(timestamp, previousTimestamp) {
  if (!timestamp) return false;
  if (!previousTimestamp) return true;
  const time = Date.parse(timestamp);
  const previousTime = Date.parse(previousTimestamp);
  return time > previousTime || (time === previousTime && timestamp > previousTimestamp);
}

function updateClientMessageIndicator(messages = null) {
  if (messages) {
    latestTeamMessageAt = messages.reduce((latest, message) => (
      message.sender_role === 'staff' && messageTimeIsNewer(message.created_at, latest)
        ? message.created_at
        : latest
    ), latestTeamMessageAt);
  }

  let readAt = clientMessageReadAt();
  if (messageDialog.open && messageTimeIsNewer(latestTeamMessageAt, readAt)) {
    try {
      window.localStorage.setItem(clientMessageReadKey(), latestTeamMessageAt);
      readAt = latestTeamMessageAt;
    } catch (error) {
      console.error('Could not save the customer message notification state.', error);
      if (!messageStorageWarningShown) {
        messageStorageWarningShown = true;
        showToast('Unread message notifications could not be saved in this browser.');
      }
    }
  }

  const hasUnreadMessage = messageTimeIsNewer(latestTeamMessageAt, readAt);
  document.querySelectorAll('.message-trigger').forEach((button) => {
    const baseLabel = button.dataset.messageBaseLabel
      || button.getAttribute('aria-label')
      || button.textContent.replace(/\s+/g, ' ').trim();
    const baseTitle = button.dataset.messageBaseTitle || button.getAttribute('title') || '';
    button.dataset.messageBaseLabel = baseLabel;
    if (baseTitle) button.dataset.messageBaseTitle = baseTitle;
    button.classList.toggle('has-unread-message', hasUnreadMessage);
    button.setAttribute('aria-label', `${baseLabel}${hasUnreadMessage ? ' (new message)' : ''}`);
    if (hasUnreadMessage) button.title = 'New message from your project team';
    else if (baseTitle) button.title = baseTitle;
    else button.removeAttribute('title');
  });
}

function dateLabel(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function visibleProjectSnapshot(project, updates, decisions, clientUpdates, files) {
  const keyedRecords = (records, key, fields) => Object.fromEntries(records.map((record) => [
    record[key],
    JSON.stringify(fields.map((field) => record[field]))
  ]));
  return {
    project: JSON.stringify([project.title, project.reference, project.kind, project.status, project.project_note, project.start_date, project.duration]),
    stages: keyedRecords(updates, 'stage_number', ['stage_name', 'status', 'note', 'planned_date', 'updated_at']),
    decisions: keyedRecords(decisions, 'id', ['title', 'proposed_option', 'cost_impact', 'schedule_impact', 'client_note', 'status', 'updated_at']),
    updates: keyedRecords(clientUpdates, 'id', ['title', 'message', 'created_at']),
    files: keyedRecords(files, 'id', ['file_name', 'category', 'stage_number', 'created_at'])
  };
}

function changedRecords(previous, current) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...keys].some((key) => previous[key] !== current[key]);
}

function announceProjectChanges(snapshot) {
  if (!previousSnapshot) {
    previousSnapshot = snapshot;
    return;
  }

  const messages = [];
  if (previousSnapshot.project !== snapshot.project) messages.push('Your project details have been updated.');
  if (changedRecords(previousSnapshot.stages, snapshot.stages)) messages.push('Your project progress has been updated.');
  if (changedRecords(previousSnapshot.updates, snapshot.updates)) messages.push('Your project team shared a new update.');
  if (changedRecords(previousSnapshot.decisions, snapshot.decisions)) messages.push('Your project decisions have been updated.');
  if (changedRecords(previousSnapshot.files, snapshot.files)) messages.push('Your team shared new project files or photos.');
  previousSnapshot = snapshot;

  if (!messages.length) return;
  notificationCount += messages.length;
  notificationLink.hidden = false;
  notificationLink.setAttribute('aria-label', `${notificationCount} new project ${notificationCount === 1 ? 'update' : 'updates'}. View updates.`);
  notificationLink.title = `${notificationCount} new project ${notificationCount === 1 ? 'update' : 'updates'}`;
  showToast(messages.join(' '));
}

function setStatus(status) {
  const pill = document.querySelector('.status-pill');
  pill.className = `status-pill ${status}`;
  document.querySelector('#project-status-label').textContent = statusLabels[status] || 'In progress';
}

function renderProject(project, user) {
  const name = project.client_name || user.email || 'Customer';
  const initials = name.split(/\s+/).filter(Boolean);
  const projectType = project.kind === 'kitchen' ? 'Kitchen' : 'Bathroom';
  document.querySelector('#page-title').textContent = `Your ${projectType.toLocaleLowerCase()} renovation`;
  document.querySelector('#welcome-title').textContent = project.title;
  document.querySelector('#project-reference').textContent = project.reference ? `Project ref: ${project.reference}` : '';
  document.querySelector('#sidebar-project-title').textContent = project.title;
  document.querySelector('#sidebar-client-name').textContent = name;
  document.querySelector('#header-client-name').textContent = name;
  document.querySelector('#client-avatar').textContent = initials.length > 1
    ? `${initials[0][0]}${initials[initials.length - 1][0]}`.toUpperCase()
    : initials[0].slice(0, 2).toUpperCase();
  document.querySelector('#detail-project-title').textContent = project.title;
  document.querySelector('#project-type-subtitle').textContent = `${projectType} renovation`;
  const heroImage = document.querySelector('#project-hero-image');
  heroImage.src = `assets/login-${project.kind === 'kitchen' ? 'kitchen' : 'bathroom'}.png`;
  heroImage.alt = `Example ${projectType.toLocaleLowerCase()} renovation interior`;
  document.querySelector('#dialog-client-project').textContent = `${name} · ${project.title}`;
  document.querySelector('#project-start-row').hidden = !project.start_date;
  if (project.start_date) {
    document.querySelector('#project-start').textContent = `Started ${dateLabel(project.start_date)}`;
  }
  document.querySelector('#project-duration-row').hidden = !project.duration;
  if (project.duration) {
    document.querySelector('#project-duration').textContent = `Scheduled window · ${project.duration}`;
  }
  setStatus(project.status);
  document.title = `${project.title} | K&B (Kitchens & Bathrooms) London Limited`;
}

async function signedUrl(client, path, download = false) {
  const { data, error } = await client.storage.from('project-files').createSignedUrl(
    path,
    300,
    download ? { download: true } : undefined
  );
  if (error) throw error;
  return data.signedUrl;
}

function renderStageGrid(project, updates, files, client) {
  const stageNames = window.portalStages[project.kind];
  const completeCount = updates.filter((item) => item.status === 'complete').length;
  const activeCount = updates.filter((item) => item.status === 'in-progress').length;
  const progress = Math.round((completeCount / stageNames.length) * 100);
  document.querySelector('#progress-percent').textContent = `${progress}%`;
  document.querySelector('#progress-track').setAttribute('aria-valuenow', String(progress));
  document.querySelector('#progress-fill').style.width = `${progress}%`;
  document.querySelector('#progress-summary').textContent = `${completeCount} of ${stageNames.length} stages complete${activeCount ? ` · ${activeCount} in progress` : ''}.`;
  document.querySelector('#stage-summary').textContent = `${completeCount} of ${stageNames.length} stages complete`;
  const finalStage = updates.find((item) => item.stage_number === stageNames.length);
  if (finalStage?.planned_date) {
    document.querySelector('#project-duration-row').hidden = false;
    document.querySelector('#project-duration').textContent = `Estimated completion ${dateLabel(finalStage.planned_date)}`;
  }
  stageGrid.replaceChildren();

  stageNames.forEach((stageName, index) => {
    const stageNumber = index + 1;
    const update = updates.find((item) => item.stage_number === stageNumber);
    const stageFiles = files.filter((file) => file.stage_number === stageNumber && file.category === 'stage-photo');
    const status = update?.status || 'not-started';
    const card = document.createElement('article');
    card.className = `client-stage${status === 'complete' ? ' complete' : status === 'in-progress' ? ' in-progress' : ''}`;
    const toggle = document.createElement('button');
    toggle.className = 'client-stage-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const details = document.createElement('div');
    details.className = 'client-stage-details';
    details.id = `stage-details-${stageNumber}`;
    details.hidden = true;

    const heading = document.createElement('span');
    heading.className = 'client-stage-heading';
    const stageHeading = document.createElement('span');
    const number = document.createElement('span');
    number.className = 'client-stage-number';
    number.textContent = `Stage ${String(stageNumber).padStart(2, '0')}`;
    const title = document.createElement('strong');
    title.className = 'client-stage-title';
    title.textContent = stageName;
    stageHeading.append(number, title);
    const state = document.createElement('span');
    state.className = `client-stage-state${status === 'complete' ? ' complete' : status === 'in-progress' ? ' active' : ''}`;
    state.textContent = status === 'complete' ? 'Complete' : status === 'in-progress' ? 'In progress' : 'Not updated';
    heading.append(stageHeading, state);
    const meta = document.createElement('span');
    meta.className = 'client-stage-meta';
    const photoCount = document.createElement('span');
    photoCount.className = 'client-stage-photos';
    photoCount.textContent = `${stageFiles.length} ${stageFiles.length === 1 ? 'photo' : 'photos'}`;
    const chevron = document.createElement('span');
    chevron.className = 'client-stage-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '⌄';
    meta.append(photoCount, chevron);
    toggle.append(heading, meta);
    toggle.setAttribute('aria-controls', details.id);
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      details.hidden = !expanded;
      card.classList.toggle('expanded', expanded);
    });

    if (update?.note) {
      const note = document.createElement('p');
      note.className = 'client-stage-note';
      note.textContent = update.note;
      details.append(note);
    }
    const photos = document.createElement('div');
    photos.className = 'client-stage-photo-gallery';
    stageFiles.forEach((file) => {
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.alt = file.file_name;
      signedUrl(client, file.storage_path).then((url) => { image.src = url; }).catch((error) => {
        image.alt = `${file.file_name} (temporarily unavailable)`;
        showToast(`Could not load a private project photo: ${error.message}`);
      });
      const caption = document.createElement('figcaption');
      caption.textContent = file.file_name;
      figure.append(image, caption);
      photos.append(figure);
    });
    if (stageFiles.length) details.append(photos);
    card.append(toggle, details);
    stageGrid.append(card);
  });

  renderProjectJourney(stageNames, updates);
  renderUpcomingStages(stageNames, updates);

  const currentUpdate = updates.find((item) => item.status === 'in-progress');
  const nextIndex = currentUpdate
    ? currentUpdate.stage_number - 1
    : stageNames.findIndex((_, index) => updates.find((item) => item.stage_number === index + 1)?.status !== 'complete');
  const next = nextIndex === -1
    ? null
    : { name: stageNames[nextIndex], update: updates.find((item) => item.stage_number === nextIndex + 1) };
  if (next) {
    document.querySelector('#journey-current-title').textContent = next.update?.status === 'in-progress'
      ? `${next.name} is underway`
      : `${next.name} is coming up`;
    document.querySelector('#journey-current-copy').textContent = next.update?.note || 'Your project team will keep this stage up to date.';
    document.querySelector('#journey-next-update').textContent = next.update?.planned_date
      ? `Next update expected: ${dateLabel(next.update.planned_date)}`
      : '';
  } else {
    document.querySelector('#journey-current-title').textContent = 'All project stages complete';
    document.querySelector('#journey-current-copy').textContent = 'Your project team will be in touch about the next steps.';
    document.querySelector('#journey-next-update').textContent = '';
  }
  document.querySelector('#photo-count').textContent = `${files.filter((file) => file.category === 'stage-photo').length} project photos`;
}

function renderProjectJourney(stageNames, updates) {
  const groups = [
    { label: 'Preparation', first: 1, last: 2 },
    { label: 'First fix', first: 3, last: 3 },
    { label: 'Installation', first: 4, last: 5 },
    { label: 'Second fix', first: 6, last: 7 },
    { label: 'Final touches', first: 8, last: 8 }
  ];
  const stageByNumber = new Map(updates.map((update) => [update.stage_number, update]));
  const phases = groups.map((group) => {
    const stageStatuses = Array.from({ length: group.last - group.first + 1 }, (_, index) => {
      const stageNumber = group.first + index;
      return stageByNumber.get(stageNumber)?.status || 'not-started';
    });
    return {
      ...group,
      label: group.last <= stageNames.length ? group.label : null,
      statuses: stageStatuses,
      complete: stageStatuses.every((status) => status === 'complete')
    };
  }).filter((phase) => phase.label);
  const currentIndex = phases.findIndex((phase) => !phase.complete);
  const journey = document.querySelector('#project-journey');
  journey.replaceChildren();
  phases.forEach((phase, index) => {
    const item = document.createElement('li');
    item.className = 'journey-step';
    if (phase.complete) item.classList.add('complete');
    else if (index === currentIndex) item.classList.add('current');
    else item.classList.add('upcoming');
    const marker = document.createElement('span');
    marker.className = 'journey-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = phase.complete ? '✓' : '';
    const title = document.createElement('strong');
    title.textContent = phase.label;
    const state = document.createElement('small');
    state.textContent = phase.complete ? 'Completed' : index === currentIndex
      ? phase.statuses.includes('in-progress') ? 'Current stage' : 'Next'
      : 'Upcoming';
    item.append(marker, title, state);
    journey.append(item);
  });
}

function renderUpcomingStages(stageNames, updates) {
  const list = document.querySelector('#upcoming-stages');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = updates
    .filter((update) => update.planned_date && update.status !== 'complete'
      && new Date(`${update.planned_date}T00:00:00`) >= today)
    .sort((first, second) => first.planned_date.localeCompare(second.planned_date))
    .slice(0, 3);
  list.replaceChildren();
  if (!upcoming.length) {
    const empty = document.createElement('p');
    empty.className = 'side-empty';
    empty.textContent = 'Your project team will share upcoming dates here.';
    list.append(empty);
    return;
  }
  upcoming.forEach((update) => {
    const item = document.createElement('div');
    item.className = 'upcoming-stage';
    const date = document.createElement('span');
    date.className = 'upcoming-stage-date';
    date.textContent = new Date(`${update.planned_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const title = document.createElement('strong');
    title.textContent = stageNames[update.stage_number - 1] || update.stage_name;
    item.append(date, title);
    list.append(item);
  });
}

function renderDecisions(decisions, responses, client) {
  decisionList.replaceChildren();
  const responseByDecision = new Map(responses.map((row) => [row.decision_id, row]));
  const visible = decisions.filter((item) => item.client_visible).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const needsResponse = visible.filter((item) => item.status === 'awaiting-response' && !responseByDecision.has(item.id)).length;
  document.querySelector('#decisions-heading-label').textContent = needsResponse ? 'Action needed' : 'Your decisions';
  document.querySelector('#decision-count').textContent = needsResponse
    ? `${needsResponse} ${needsResponse === 1 ? 'decision' : 'decisions'} awaiting you`
    : 'No decisions awaiting you';
  if (!visible.length) {
    decisionList.append(Object.assign(document.createElement('p'), { className: 'decision-empty', textContent: 'You’re all caught up. There are no decisions waiting for you right now.' }));
    return;
  }
  visible.forEach((decision) => {
    const card = document.createElement('article');
    card.className = 'decision-card';
    const copy = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = decision.title;
    copy.append(title);
    [
      ['Proposed choice', decision.proposed_option],
      ['Cost impact', decision.cost_impact],
      ['Schedule impact', decision.schedule_impact],
      ['', decision.client_note]
    ].filter(([, text]) => text).forEach(([label, text]) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = label ? `${label}: ${text}` : text;
      copy.append(paragraph);
    });
    const response = responseByDecision.get(decision.id);
    const meta = document.createElement('div');
    meta.className = 'decision-meta';
    const state = document.createElement('span');
    state.className = `decision-state${response?.response === 'approved' ? ' approved' : ''}`;
    state.textContent = response
      ? (response.response === 'approved' ? 'Choice approved' : 'Discussion requested')
      : decisionStatusLabel(decision.status);
    meta.append(state);
    card.append(copy, meta);
    if (!response && decision.status === 'awaiting-response') {
      const actions = document.createElement('div');
      actions.className = 'decision-actions';
      [['discussion-requested', 'Ask to discuss', false], ['approved', 'Approve this choice', true]].forEach(([answer, label, primary]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.toggle('primary', primary);
        button.textContent = label;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const { error } = await client.rpc('respond_to_decision', {
              p_decision_id: decision.id,
              p_response: answer
            });
            if (error) throw error;
            showToast(answer === 'approved' ? 'Your approval has been recorded.' : 'Your request to discuss has been recorded.');
            await loadPortal();
          } catch (error) {
            button.disabled = false;
            showToast(`Could not save your response: ${error.message}`);
          }
        });
        actions.append(button);
      });
      card.append(actions);
    }
    decisionList.append(card);
  });
}

function decisionStatusLabel(status) {
  return { 'awaiting-response': 'Your response needed', approved: 'Choice confirmed', 'discussion-requested': 'Discussion requested' }[status] || 'Your response needed';
}

async function renderFiles(files, client) {
  const section = document.querySelector('#client-files');
  const list = document.querySelector('#client-file-list');
  const shared = files.filter((file) => file.client_visible && file.category !== 'internal-attachment');
  const documents = shared.filter((file) => file.category !== 'stage-photo');
  section.hidden = !documents.length;
  document.querySelector('#documents-empty').hidden = Boolean(documents.length);
  document.querySelector('#document-count').textContent = `${documents.length} ${documents.length === 1 ? 'file' : 'files'}`;
  list.replaceChildren();
  documents.forEach((file) => {
    const documentMenu = document.createElement('details');
    documentMenu.className = 'design-document';
    const summary = document.createElement('summary');
    summary.textContent = file.file_name;
    const options = document.createElement('div');
    options.className = 'design-document-preview';
    const actions = document.createElement('div');
    actions.className = 'design-document-actions';

    const openLink = document.createElement('a');
    openLink.className = 'design-document-link primary';
    openLink.textContent = 'Open document';
    openLink.href = '#';
    openLink.addEventListener('click', async (event) => {
      event.preventDefault();
      const popup = window.open('about:blank', '_blank');
      if (!popup) {
        showToast('Allow a new tab to open this private file.');
        return;
      }
      popup.opener = null;
      try {
        popup.location.href = await signedUrl(client, file.storage_path);
      } catch (error) {
        popup.close();
        showToast(`Could not open this file: ${error.message}`);
      }
    });

    const downloadLink = document.createElement('a');
    downloadLink.className = 'design-document-link';
    downloadLink.textContent = 'Download';
    downloadLink.href = '#';
    downloadLink.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        const url = await signedUrl(client, file.storage_path, true);
        const download = document.createElement('a');
        download.href = url;
        download.download = file.file_name;
        document.body.append(download);
        download.click();
        download.remove();
      } catch (error) {
        showToast(`Could not download this file: ${error.message}`);
      }
    });

    actions.append(openLink, downloadLink);
    options.append(actions);
    documentMenu.append(summary, options);
    list.append(documentMenu);
  });
}

function renderSiteLog(updates, clientUpdates, files, client) {
  const entries = [
    ...updates.map((row) => ({
      title: row.stage_name,
      note: row.note,
      timestamp: row.updated_at,
      stageNumber: row.stage_number,
      photos: files.filter((file) => file.stage_number === row.stage_number && file.category === 'stage-photo')
    })),
    ...clientUpdates.map((row) => ({
      title: row.title,
      note: row.message,
      timestamp: row.created_at,
      photos: []
    }))
  ].filter((entry) => entry.note || entry.photos.length)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const topLink = document.querySelector('#top-update-link');
  clientSiteLog.replaceChildren();
  if (!entries.length) {
    topLink.hidden = true;
    clientSiteLog.classList.remove('client-log-list');
    const empty = document.createElement('div');
    empty.className = 'empty-log';
    const mark = document.createElement('span');
    mark.className = 'empty-log-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '◷';
    const title = document.createElement('strong');
    title.textContent = 'No updates yet';
    const note = document.createElement('p');
    note.textContent = 'Your project team can add site notes and photos here as work progresses.';
    empty.append(mark, title, note);
    clientSiteLog.append(empty);
    return;
  }
  topLink.hidden = false;
  entries.forEach((entry, index) => {
    const article = document.createElement('article');
    article.className = 'client-log-entry';
    article.id = `client-update-${entry.stageNumber || index}`;
    const header = document.createElement('div');
    header.className = 'client-log-head';
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const date = document.createElement('span');
    date.textContent = new Date(entry.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    header.append(title, date);
    article.append(header);
    if (entry.note) {
      const note = document.createElement('p');
      note.textContent = entry.note;
      article.append(note);
    }
    if (entry.photos.length) {
      const photoGallery = document.createElement('div');
      photoGallery.className = 'client-log-photos';
      entry.photos.forEach((file) => {
        const image = document.createElement('img');
        image.className = 'update-photo';
        image.alt = file.file_name;
        image.loading = 'lazy';
        signedUrl(client, file.storage_path).then((url) => { image.src = url; }).catch((error) => {
          image.alt = `${file.file_name} (temporarily unavailable)`;
          showToast(`Could not load a private project photo: ${error.message}`);
        });
        photoGallery.append(image);
      });
      article.append(photoGallery);
    }
    clientSiteLog.append(article);
  });
}

async function loadPortal({ notifyChanges = false } = {}) {
  const context = await window.portalAuth.requireRole('client');
  if (!context) return;
  const { client, profile, user } = context;
  currentClientProjectId = profile.project_id;
  currentClientUserId = user.id;
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id,title,client_name,reference,kind,status,project_note,start_date,duration')
    .eq('id', profile.project_id)
    .single();
  if (projectError) throw projectError;

  const [updatesResult, decisionsResult, responsesResult, clientUpdatesResult, filesResult, messagesResult] = await Promise.all([
    client.from('stage_updates').select('stage_number,stage_name,status,note,planned_date,updated_at').eq('project_id', project.id).eq('client_visible', true).order('stage_number'),
    client.from('project_decisions').select('id,title,proposed_option,cost_impact,schedule_impact,client_note,status,client_visible,updated_at').eq('project_id', project.id).eq('client_visible', true).order('updated_at', { ascending: false }),
    client.from('decision_responses').select('decision_id,response,responded_at').eq('project_id', project.id),
    client.from('client_updates').select('id,title,message,created_at').eq('project_id', project.id).order('created_at', { ascending: false }),
    client.from('project_files').select('id,storage_path,file_name,content_type,category,stage_number,client_visible,created_at').eq('project_id', project.id).eq('client_visible', true),
    client.from('project_messages').select('id,sender_role,body,created_at').eq('project_id', project.id).order('created_at', { ascending: false })
  ]);
  for (const result of [updatesResult, decisionsResult, responsesResult, clientUpdatesResult, filesResult, messagesResult]) {
    if (result.error) throw result.error;
  }
  renderProject(project, user);
  renderStageGrid(project, updatesResult.data, filesResult.data, client);
  renderDecisions(decisionsResult.data, responsesResult.data, client);
  renderFiles(filesResult.data, client);
  renderSiteLog(updatesResult.data, clientUpdatesResult.data, filesResult.data, client);
  renderMessages(messagesResult.data.reverse());
  const snapshot = visibleProjectSnapshot(project, updatesResult.data, decisionsResult.data, clientUpdatesResult.data, filesResult.data);
  if (notifyChanges && initialProjectLoadComplete) announceProjectChanges(snapshot);
  else previousSnapshot = snapshot;
  document.body.style.visibility = 'visible';
  initialProjectLoadComplete = true;
  subscribeToProjectChanges(client, project.id);
}

function renderMessages(messages) {
  const list = document.querySelector('#message-list');
  const status = document.querySelector('#message-status');
  list.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('li');
    empty.className = 'message-empty';
    empty.textContent = 'No messages yet. Send a message below to start the conversation.';
    list.append(empty);
  } else {
    messages.forEach((message) => {
      const entry = document.createElement('li');
      entry.className = `message-entry${message.sender_role === 'client' ? ' client-message' : ''}`;
      const header = document.createElement('div');
      header.className = 'message-entry-head';
      const sender = document.createElement('strong');
      sender.textContent = message.sender_role === 'client' ? 'You' : 'Project team';
      const date = document.createElement('time');
      date.dateTime = message.created_at;
      date.textContent = new Date(message.created_at).toLocaleString('en-GB');
      const body = document.createElement('p');
      body.textContent = message.body;
      header.append(sender, date);
      entry.append(header, body);
      list.append(entry);
    });
  }
  status.textContent = 'Messages are saved to your project and visible to the project team.';
  list.scrollTop = list.scrollHeight;
  updateClientMessageIndicator(messages);
}

async function refreshClientMessages() {
  if (!currentClientProjectId) return;
  const { data, error } = await window.portalAuth.client
    .from('project_messages')
    .select('id,sender_role,body,created_at')
    .eq('project_id', currentClientProjectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  renderMessages(data.reverse());
}

function scheduleProjectRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (refreshInProgress) {
      refreshRequested = true;
      return;
    }
    refreshInProgress = true;
    loadPortal({ notifyChanges: true })
      .catch((error) => {
        console.error('Could not refresh live customer project updates.', error);
        showToast('A project update arrived, but could not be loaded. Please refresh the page.');
      })
      .finally(() => {
        refreshInProgress = false;
        if (refreshRequested) {
          refreshRequested = false;
          scheduleProjectRefresh();
        }
      });
  }, 250);
}

function subscribeToProjectChanges(client, projectId) {
  if (projectChannel && subscribedProjectId === projectId) return;
  if (projectChannel) client.removeChannel(projectChannel);
  subscribedProjectId = projectId;
  projectChannel = client
    .channel(`client-project-updates-${projectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, scheduleProjectRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_updates', filter: `project_id=eq.${projectId}` }, scheduleProjectRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_decisions', filter: `project_id=eq.${projectId}` }, scheduleProjectRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_updates', filter: `project_id=eq.${projectId}` }, scheduleProjectRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_files', filter: `project_id=eq.${projectId}` }, scheduleProjectRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_messages', filter: `project_id=eq.${projectId}` }, () => {
      refreshClientMessages().catch((error) => {
        console.error('Could not refresh project messages.', error);
        showToast(`Could not refresh messages: ${error.message}`);
      });
    })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        scheduleProjectRefresh();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`Customer project realtime subscription ${status.toLocaleLowerCase()}.`, error);
        showToast('Live updates are unavailable. Ask your portal administrator to enable Realtime, then refresh.');
      }
    });
}

document.querySelectorAll('.message-trigger').forEach((button) => {
  button.addEventListener('click', () => {
    messageDialog.showModal();
    document.querySelector('#message-text').focus();
    refreshClientMessages().catch((error) => {
      console.error('Could not load project messages.', error);
      document.querySelector('#message-status').textContent = `Could not load messages: ${error.message}`;
    });
  });
});
document.querySelector('.close-button').addEventListener('click', () => messageDialog.close());
document.querySelector('.close-action').addEventListener('click', () => messageDialog.close());
messageDialog.addEventListener('click', (event) => {
  if (event.target === messageDialog) messageDialog.close();
});
document.querySelector('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const text = document.querySelector('#message-text').value.trim();
  if (!text) {
    showToast('Write a message before sending.');
    return;
  }
  if (!currentClientProjectId || !currentClientUserId) {
    showToast('Your project is still loading. Please try again.');
    return;
  }
  const button = document.querySelector('#send-message-button');
  button.disabled = true;
  let saved = false;
  try {
    const { error } = await window.portalAuth.client.from('project_messages').insert({
      project_id: currentClientProjectId,
      sender_id: currentClientUserId,
      sender_role: 'client',
      body: text
    });
    if (error) throw error;
    saved = true;
    form.reset();
    await refreshClientMessages();
    showToast('Your message was sent and saved to this project.');
  } catch (error) {
    console.error('Could not send project message.', error);
    showToast(saved
      ? `Your message was saved, but the conversation could not refresh: ${error.message}`
      : `Could not send your message: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#portal-sign-out').addEventListener('click', () => {
  window.portalAuth.signOut().catch((error) => showToast(`Could not sign out: ${error.message}`));
});
document.querySelector('#mobile-sign-out').addEventListener('click', () => {
  window.portalAuth.signOut().catch((error) => showToast(`Could not sign out: ${error.message}`));
});
notificationLink.addEventListener('click', () => {
  notificationCount = 0;
  notificationLink.hidden = true;
  notificationLink.setAttribute('aria-label', 'Project updates');
  notificationLink.title = 'Project updates';
});
window.addEventListener('storage', (event) => {
  if (event.key === clientMessageReadKey()) updateClientMessageIndicator();
});
function updateClientNavigation() {
  const activeHash = window.location.hash || '#overview';
  if (activeHash === '#progress-details') document.querySelector('#progress-details').open = true;
  document.querySelectorAll('.nav a, .mobile-nav a').forEach((link) => {
    const active = link.getAttribute('href') === activeHash;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', updateClientNavigation);
updateClientNavigation();
loadPortal().catch((error) => {
  console.error('Customer portal initialization failed.', error);
  const alert = document.querySelector('#portal-error');
  alert.hidden = false;
  alert.textContent = 'Your project information could not be loaded. Please contact the project team.';
  document.body.style.visibility = 'visible';
});

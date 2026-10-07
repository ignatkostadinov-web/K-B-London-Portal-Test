const clientSiteLog = document.querySelector('#client-site-log');
const stageGrid = document.querySelector('#client-stage-grid');
const decisionList = document.querySelector('#client-decision-list');
const toast = document.querySelector('.toast');
const messageDialog = document.querySelector('#message-dialog');
const statusLabels = { progress: 'In progress', finishing: 'In finishing stages', completed: 'Completed' };
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function dateLabel(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function setStatus(status) {
  const pill = document.querySelector('.status-pill');
  const indicator = pill.querySelector('i');
  pill.textContent = statusLabels[status] || 'In progress';
  pill.prepend(indicator);
}

function renderProject(project, user) {
  const name = project.client_name || user.email || 'Customer';
  const initials = name.split(/\s+/).filter(Boolean);
  document.querySelector('#page-title').textContent = project.title;
  document.querySelector('#project-reference').textContent = project.reference || '';
  document.querySelector('#sidebar-project-title').textContent = project.title;
  document.querySelector('#sidebar-client-name').textContent = name;
  document.querySelector('#welcome-title').textContent = `Welcome, ${initials[0]} — your project starts here`;
  document.querySelector('#client-avatar').textContent = initials.length > 1
    ? `${initials[0][0]}${initials[initials.length - 1][0]}`.toUpperCase()
    : initials[0].slice(0, 2).toUpperCase();
  document.querySelector('#detail-project-title').textContent = project.title;
  document.querySelector('#project-type-subtitle').textContent = project.title;
  document.querySelector('#detail-client-name').textContent = name;
  document.querySelector('#detail-project-note').textContent = project.project_note || 'Your project team will share updates here.';
  document.querySelector('#dialog-client-project').textContent = `${name} · ${project.title}`;
  document.querySelector('#project-start-row').hidden = !project.start_date;
  document.querySelector('#detail-start-row').hidden = !project.start_date;
  if (project.start_date) {
    document.querySelector('#project-start').textContent = dateLabel(project.start_date);
    document.querySelector('#detail-start').textContent = dateLabel(project.start_date);
  }
  document.querySelector('#project-duration-row').hidden = !project.duration;
  document.querySelector('#detail-duration-row').hidden = !project.duration;
  if (project.duration) {
    document.querySelector('#project-duration').textContent = project.duration;
    document.querySelector('#detail-duration').textContent = project.duration;
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

  const next = updates
    .filter((item) => item.status !== 'complete')
    .sort((first, second) => first.stage_number - second.stage_number)[0];
  if (next) {
    const index = next.stage_number - 1;
    document.querySelector('#next-step-title').textContent = stageNames[index];
    document.querySelector('#next-step-copy').textContent = next.note || 'Your project team will keep this plan up to date.';
    document.querySelector('#next-step-date').textContent = next.planned_date ? dateLabel(next.planned_date) : 'To be confirmed';
  } else {
    document.querySelector('#next-step-title').textContent = 'All stages complete';
    document.querySelector('#next-step-copy').textContent = 'Your project team will share the handover details here.';
    document.querySelector('#next-step-date').textContent = '';
  }
}

function renderDecisions(decisions, responses, client) {
  decisionList.replaceChildren();
  const responseByDecision = new Map(responses.map((row) => [row.decision_id, row]));
  const visible = decisions.filter((item) => item.client_visible).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (!visible.length) {
    decisionList.append(Object.assign(document.createElement('p'), { className: 'decision-empty', textContent: 'There are no decisions waiting for you right now.' }));
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
  section.hidden = !shared.length;
  list.replaceChildren();
  shared.filter((file) => file.category !== 'stage-photo').forEach((file) => {
    const link = document.createElement('a');
    link.className = 'design-document-link';
    link.textContent = `Download ${file.file_name}`;
    link.href = '#';
    link.target = '_blank';
    link.rel = 'noopener';
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const popup = window.open('about:blank', '_blank');
      if (!popup) {
        showToast('Allow a new tab to open this private file.');
        return;
      }
      popup.opener = null;
      try {
        popup.location.href = await signedUrl(client, file.storage_path, true);
      } catch (error) {
        popup.close();
        showToast(`Could not open this file: ${error.message}`);
      }
    });
    list.append(link);
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
  const latestCard = document.querySelector('#latest-update-card');
  const topLink = document.querySelector('#top-update-link');
  clientSiteLog.replaceChildren();
  if (!entries.length) {
    latestCard.hidden = true;
    topLink.hidden = true;
    clientSiteLog.classList.remove('client-log-list');
    clientSiteLog.innerHTML = '<div class="empty-log"><span class="empty-log-mark" aria-hidden="true">◷</span><strong>No daily entries yet</strong><p>Your project team can add site notes and photos here as work progresses.</p></div>';
    return;
  }
  latestCard.hidden = false;
  topLink.hidden = false;
  document.querySelector('#latest-update-title').textContent = entries[0].title;
  document.querySelector('#latest-update-note').textContent = entries[0].note || 'A project photo has been shared.';
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
    entry.photos.forEach((file) => {
      const image = document.createElement('img');
      image.className = 'update-photo';
      image.alt = file.file_name;
      image.loading = 'lazy';
      signedUrl(client, file.storage_path).then((url) => { image.src = url; }).catch((error) => {
        image.alt = `${file.file_name} (temporarily unavailable)`;
        showToast(`Could not load a private project photo: ${error.message}`);
      });
      article.append(image);
    });
    clientSiteLog.append(article);
  });
}

async function loadPortal() {
  const context = await window.portalAuth.requireRole('client');
  if (!context) return;
  const { client, profile, user } = context;
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id,title,client_name,reference,kind,status,project_note,start_date,duration')
    .eq('id', profile.project_id)
    .single();
  if (projectError) throw projectError;

  const [updatesResult, decisionsResult, responsesResult, clientUpdatesResult, filesResult] = await Promise.all([
    client.from('stage_updates').select('stage_number,stage_name,status,note,planned_date,updated_at').eq('project_id', project.id).eq('client_visible', true).order('stage_number'),
    client.from('project_decisions').select('id,title,proposed_option,cost_impact,schedule_impact,client_note,status,client_visible,updated_at').eq('project_id', project.id).eq('client_visible', true).order('updated_at', { ascending: false }),
    client.from('decision_responses').select('decision_id,response,responded_at').eq('project_id', project.id),
    client.from('client_updates').select('id,title,message,created_at').eq('project_id', project.id).order('created_at', { ascending: false }),
    client.from('project_files').select('id,storage_path,file_name,content_type,category,stage_number,client_visible,created_at').eq('project_id', project.id).eq('client_visible', true)
  ]);
  for (const result of [updatesResult, decisionsResult, responsesResult, clientUpdatesResult, filesResult]) {
    if (result.error) throw result.error;
  }
  renderProject(project, user);
  renderStageGrid(project, updatesResult.data, filesResult.data, client);
  renderDecisions(decisionsResult.data, responsesResult.data, client);
  renderFiles(filesResult.data, client);
  renderSiteLog(updatesResult.data, clientUpdatesResult.data, filesResult.data, client);
  document.body.style.visibility = 'visible';
}

document.querySelectorAll('.message-trigger').forEach((button) => {
  button.addEventListener('click', () => messageDialog.showModal());
});
document.querySelector('.close-button').addEventListener('click', () => messageDialog.close());
document.querySelector('.close-action').addEventListener('click', () => messageDialog.close());
messageDialog.addEventListener('click', (event) => {
  if (event.target === messageDialog) messageDialog.close();
});
document.querySelector('#message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  messageDialog.close();
  showToast('Messaging is not connected yet. Please contact your project coordinator directly.');
});
document.querySelector('#portal-sign-out').addEventListener('click', () => {
  window.portalAuth.signOut().catch((error) => showToast(`Could not sign out: ${error.message}`));
});
loadPortal().catch((error) => {
  console.error('Customer portal initialization failed.', error);
  const alert = document.querySelector('#portal-error');
  alert.hidden = false;
  alert.textContent = 'Your project information could not be loaded. Please contact the project team.';
  document.body.style.visibility = 'visible';
});

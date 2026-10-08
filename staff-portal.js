const portalClient = window.portalAuth.client;
const projectTable = document.querySelector('#project-rows');
const projectDialog = document.querySelector('#project-dialog');
const createProjectDialog = document.querySelector('#create-project-dialog');
const createProjectForm = document.querySelector('#create-project-form');
const createProjectMessage = document.querySelector('#create-project-message');
const stageList = document.querySelector('#stage-list');
const issueList = document.querySelector('#issue-list');
const issueForm = document.querySelector('#issue-form');
const decisionList = document.querySelector('#decision-list-staff');
const decisionForm = document.querySelector('#decision-form');
const projectMessageList = document.querySelector('#project-message-list');
const projectMessageStatus = document.querySelector('#project-message-status');
const staffMessageForm = document.querySelector('#staff-message-form');
const projectStatusSelect = document.querySelector('#project-status-select');
const toast = document.querySelector('#dialog-toast');
const filters = [...document.querySelectorAll('.filter')];
const searchInput = document.querySelector('#project-search');
const recordCount = document.querySelector('#record-count');
const emptyState = document.querySelector('#empty-state');
const navigationLinks = [...document.querySelectorAll('.rail-nav .rail-link')];
const dashboardProjects = document.querySelector('#dashboard-projects');
const dashboardMilestones = document.querySelector('#dashboard-milestones');
const projectRows = new Map();
let stageUpdates = [];
let activeFilter = 'all';
let activeProject = null;
let editingIssueId = null;
let editingDecisionId = null;
let toastTimer;
let staffMessageChannel;
let incomingStaffMessageChannel;
let latestIncomingMessageTimes = new Map();
let messageStorageWarningShown = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3500);
}

function staffMessageReadKey(projectId) {
  return `portal-message-read:staff:${window.staffContext.user.id}:${projectId}`;
}

function staffMessageReadAt(projectId) {
  try {
    return window.localStorage.getItem(staffMessageReadKey(projectId)) || '';
  } catch (error) {
    console.error('Could not read the saved message notification state.', error);
    if (!messageStorageWarningShown) {
      messageStorageWarningShown = true;
      notify('Unread message notifications could not be loaded in this browser.');
    }
    return '';
  }
}

function isMessageTimeNewer(timestamp, previousTimestamp) {
  if (!timestamp) return false;
  if (!previousTimestamp) return true;
  const time = Date.parse(timestamp);
  const previousTime = Date.parse(previousTimestamp);
  return time > previousTime || (time === previousTime && timestamp > previousTimestamp);
}

function staffHasUnreadMessage(projectId) {
  const latestIncomingAt = latestIncomingMessageTimes.get(String(projectId));
  return Boolean(latestIncomingAt && isMessageTimeNewer(latestIncomingAt, staffMessageReadAt(projectId)));
}

function updateStaffMessageIndicators() {
  document.querySelectorAll('.staff-project-message-trigger').forEach((button) => {
    const hasUnreadMessage = staffHasUnreadMessage(button.dataset.messageProjectId);
    button.classList.toggle('has-unread-message', hasUnreadMessage);
    button.setAttribute('aria-label', `Open ${button.dataset.projectLabel}${hasUnreadMessage ? ' (unread customer message)' : ''}`);
    button.title = hasUnreadMessage ? 'Unread customer message' : '';
  });
}

function configureStaffMessageIndicator(button, project) {
  button.classList.add('staff-project-message-trigger');
  button.dataset.messageProjectId = String(project.id);
  button.dataset.projectLabel = `${project.client_name || 'customer'} project`;
  updateStaffMessageIndicators();
}

function markStaffMessagesRead(projectId) {
  const latestIncomingAt = latestIncomingMessageTimes.get(String(projectId));
  if (!latestIncomingAt) return;
  const readAt = staffMessageReadAt(projectId);
  if (isMessageTimeNewer(latestIncomingAt, readAt)) {
    try {
      window.localStorage.setItem(staffMessageReadKey(projectId), latestIncomingAt);
    } catch (error) {
      console.error('Could not save the staff message notification state.', error);
      if (!messageStorageWarningShown) {
        messageStorageWarningShown = true;
        notify('Unread message notifications could not be saved in this browser.');
      }
    }
  }
  updateStaffMessageIndicators();
}

function subscribeToIncomingStaffMessages() {
  if (incomingStaffMessageChannel) portalClient.removeChannel(incomingStaffMessageChannel);
  incomingStaffMessageChannel = portalClient
    .channel('staff-incoming-project-messages')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'project_messages',
      filter: 'sender_role=eq.client'
    }, ({ new: message }) => {
      const projectId = String(message.project_id);
      if (!projectRows.has(projectId)) return;
      if (isMessageTimeNewer(message.created_at, latestIncomingMessageTimes.get(projectId))) {
        latestIncomingMessageTimes.set(projectId, message.created_at);
        updateStaffMessageIndicators();
      }
    })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        refreshStaffIncomingMessages().catch((refreshError) => {
          console.error('Could not refresh unread customer messages.', refreshError);
          notify(`Could not refresh unread message notifications: ${refreshError.message}`);
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`Staff incoming-message subscription ${status.toLocaleLowerCase()}.`, error);
        notify('Live message notifications are unavailable. Refresh the page to check for new messages.');
      }
    });
}

async function refreshStaffIncomingMessages() {
  const { data, error } = await portalClient.from('project_messages')
    .select('project_id,created_at')
    .eq('sender_role', 'client')
    .order('created_at');
  if (error) throw error;
  data.forEach(({ project_id: projectId, created_at: createdAt }) => {
    const id = String(projectId);
    if (projectRows.has(id) && isMessageTimeNewer(createdAt, latestIncomingMessageTimes.get(id))) {
      latestIncomingMessageTimes.set(id, createdAt);
    }
  });
  updateStaffMessageIndicators();
}

window.addEventListener('storage', (event) => {
  const userId = window.staffContext?.user.id;
  if (userId && event.key?.startsWith(`portal-message-read:staff:${userId}:`)) {
    updateStaffMessageIndicators();
  }
});

async function createProjectAndInviteCustomer(event) {
  event.preventDefault();
  if (!window.staffContext) {
    notify('A signed-in staff account is required to create a project.');
    return;
  }

  const submitButton = createProjectForm.querySelector('button[type="submit"]');
  const cancelButton = document.querySelector('#cancel-create-project');
  const closeButton = document.querySelector('#close-create-project');
  const formData = new FormData(createProjectForm);
  const project = {
    clientName: formData.get('clientName').trim(),
    email: formData.get('email').trim(),
    title: formData.get('title').trim(),
    reference: formData.get('reference').trim(),
    kind: formData.get('kind'),
    status: formData.get('status'),
    startDate: formData.get('startDate'),
    duration: formData.get('duration').trim(),
    projectNote: formData.get('projectNote').trim()
  };

  submitButton.disabled = true;
  cancelButton.disabled = true;
  closeButton.disabled = true;
  submitButton.textContent = 'Creating project…';
  createProjectMessage.textContent = '';
  try {
    const { data, error } = await portalClient.functions.invoke('create-project-invitation', { body: project });
    if (error) {
      let message = error.message;
      if (error.context instanceof Response) {
        const responseBody = await error.context.clone().json();
        if (typeof responseBody?.error === 'string') message = responseBody.error;
      }
      throw new Error(message);
    }
    if (data?.ok !== true) throw new Error('The invitation service returned an unexpected response.');

    createProjectForm.reset();
    createProjectDialog.close();
    try {
      await loadProjects();
      notify('Project created and customer invitation sent.');
    } catch (error) {
      notify(`Project created and invitation sent, but the register could not refresh: ${error.message}`);
    }
  } catch (error) {
    createProjectMessage.textContent = `Could not create the project and invite the customer: ${error.message}`;
  } finally {
    submitButton.disabled = false;
    cancelButton.disabled = false;
    closeButton.disabled = false;
    submitButton.textContent = 'Create project & send invitation';
  }
}

function statusLabel(status) {
  return { progress: 'In Progress', finishing: 'In Finishing Stages', completed: 'Completed' }[status] || status;
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabel(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function upcomingMilestones() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDay = new Date(today);
  lastDay.setDate(lastDay.getDate() + 6);
  const todayValue = localDateString(today);
  const lastDayValue = localDateString(lastDay);

  return stageUpdates
    .filter((update) => update.planned_date && update.status !== 'complete'
      && update.planned_date >= todayValue && update.planned_date <= lastDayValue)
    .map((update) => {
      const project = projectRows.get(update.project_id);
      if (!project) return null;
      const stageName = window.portalStages[project.kind]?.[update.stage_number - 1] || update.stage_name;
      return { ...update, project, stageName };
    })
    .filter(Boolean)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date));
}

function issueStatusLabel(status) {
  return { open: 'Open', 'awaiting-supplier': 'Awaiting supplier', 'in-progress': 'Action in progress', resolved: 'Resolved' }[status] || 'Open';
}

function updateNavigation() {
  const activeHref = window.location.hash === '#projects' ? '#projects' : '#dashboard';
  navigationLinks.forEach((link) => {
    const active = link.getAttribute('href') === activeHref;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateSummary() {
  const projects = [...projectRows.values()];
  const counts = Object.fromEntries(['progress', 'finishing', 'completed'].map((status) => [status, projects.filter((item) => item.status === status).length]));
  document.querySelector('#metric-active').textContent = counts.progress + counts.finishing;
  document.querySelector('#metric-finishing').textContent = counts.finishing;
  document.querySelector('#metric-milestones').textContent = upcomingMilestones().length;
  document.querySelector('#metric-completed').textContent = counts.completed;
  filters.forEach((button) => {
    button.querySelector('.filter-count').textContent = button.dataset.filter === 'all' ? projects.length : counts[button.dataset.filter];
  });
  document.querySelector('#register-summary').textContent = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} in register`;
}

function renderDashboard() {
  const activeProjects = [...projectRows.values()].filter((project) => project.status !== 'completed');
  dashboardProjects.replaceChildren();

  if (!activeProjects.length) {
    const empty = element('p', 'dashboard-empty', projectRows.size
      ? 'There are no active projects at the moment.'
      : 'Your projects will appear here once they have been added.');
    dashboardProjects.append(empty);
  }

  activeProjects.slice(0, 5).forEach((project) => {
    const card = element('article', 'dashboard-project');
    const details = element('div', 'dashboard-project-details');
    const type = element('span', 'project-kind', project.kind === 'kitchen' ? 'Kitchen renovation' : 'Bathroom renovation');
    const title = element('h3', '', project.client_name || 'Client not named');
    const subtitle = element('p', 'dashboard-project-subtitle', project.title);
    const meta = element('div', 'dashboard-project-meta');
    const updates = stageUpdates.filter((update) => update.project_id === project.id);
    const stageCount = window.portalStages[project.kind]?.length || 0;
    const completedStages = updates.filter((update) => update.status === 'complete').length;
    const percent = stageCount ? Math.round((completedStages / stageCount) * 100) : 0;
    const progressLabel = element('div', 'progress-label');
    progressLabel.append(
      element('span', '', `${completedStages} of ${stageCount} stages complete`),
      element('strong', '', `${percent}%`)
    );
    const progress = element('div', 'progress-track');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', `${project.client_name || 'Project'} stage completion`);
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', String(percent));
    const fill = element('span', 'progress-fill');
    fill.style.width = `${percent}%`;
    progress.append(fill);
    const status = element('span', `status ${project.status}`, statusLabel(project.status));
    const open = element('button', 'dashboard-open', 'Open project');
    open.type = 'button';
    configureStaffMessageIndicator(open, project);
    open.addEventListener('click', () => {
      openProject(project).catch((error) => notify(`Could not open this project: ${error.message}`));
    });
    details.append(type, title, subtitle);
    meta.append(progressLabel, progress);
    card.append(details, status, meta, open);
    dashboardProjects.append(card);
  });

  const milestones = upcomingMilestones();
  dashboardMilestones.replaceChildren();
  if (!milestones.length) {
    dashboardMilestones.append(element('p', 'dashboard-empty', 'No stage milestones are scheduled for the next 7 days.'));
  }
  milestones.slice(0, 6).forEach((milestone) => {
    const item = element('button', 'milestone-item');
    item.type = 'button';
    item.setAttribute('aria-label', `Open ${milestone.project.client_name || 'project'}: ${milestone.stageName}, ${dateLabel(milestone.planned_date)}`);
    const date = element('span', 'milestone-date', dateLabel(milestone.planned_date));
    const copy = element('span', 'milestone-copy');
    copy.append(
      element('strong', '', milestone.stageName),
      element('small', '', `${milestone.project.client_name || 'Client not named'} · ${milestone.project.title}`)
    );
    item.append(date, copy);
    item.addEventListener('click', () => {
      openProject(milestone.project).catch((error) => notify(`Could not open this project: ${error.message}`));
    });
    dashboardMilestones.append(item);
  });
}

function updateProjects() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  let visibleCount = 0;
  projectRows.forEach((project, id) => {
    const row = projectTable.querySelector(`[data-project-id="${CSS.escape(id)}"]`);
    const visible = (activeFilter === 'all' || project.status === activeFilter)
      && `${project.client_name} ${project.title} ${project.reference} ${id}`.toLocaleLowerCase().includes(query);
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  recordCount.textContent = `Showing ${visibleCount} of ${projectRows.size} projects`;
  emptyState.style.display = visibleCount ? 'none' : 'block';
  if (!projectRows.size) emptyState.textContent = 'No projects are set up yet. Add the project record and customer profile in Supabase before inviting the customer.';
}

function buildProjectRow(project) {
  const row = element('tr');
  row.dataset.projectId = project.id;
  const clientCell = element('td');
  clientCell.append(element('span', 'client-name', project.client_name || 'Client not named'));
  clientCell.append(element('span', 'ref-number', `Project ${project.id}`));
  const projectCell = element('td', 'project-type', project.title);
  const referenceCell = element('td', 'identifiers', project.reference || '');
  const statusCell = element('td');
  statusCell.append(element('span', `status ${project.status}`, statusLabel(project.status)));
  const noteCell = element('td', 'notes', project.project_note || project.duration || '');
  const actionsCell = element('td');
  const actions = element('div', 'project-actions');
  const open = element('button', 'project-open', 'Open project');
  open.type = 'button';
  configureStaffMessageIndicator(open, project);
  open.addEventListener('click', () => {
    openProject(project).catch((error) => notify(`Could not open this project: ${error.message}`));
  });
  const clientView = element('a', 'project-open client-preview', 'Client portal');
  clientView.href = `index.html?project=${encodeURIComponent(project.id)}`;
  clientView.target = '_blank';
  clientView.rel = 'noopener';
  actions.append(open, clientView);
  actionsCell.append(actions);
  row.append(clientCell, projectCell, referenceCell, statusCell, noteCell, actionsCell);
  projectTable.append(row);
  projectRows.set(project.id, project);
}

async function queryProject(table, projectId, columns = '*') {
  const { data, error } = await portalClient.from(table).select(columns).eq('project_id', projectId);
  if (error) throw error;
  return data;
}

async function loadProjectMessages(projectId) {
  const { data, error } = await portalClient.from('project_messages')
    .select('id,sender_role,body,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  renderProjectMessages(data.reverse());
  if (projectDialog.open && activeProject?.id === projectId) markStaffMessagesRead(projectId);
}

function renderProjectMessages(messages) {
  projectMessageList.replaceChildren();
  if (!messages.length) {
    projectMessageList.append(element('p', 'project-message-empty', 'No messages yet. Customer messages from the client portal will appear here.'));
  } else {
    messages.forEach((message) => {
      const entry = element('article', `project-message${message.sender_role === 'client' ? ' customer-message' : ''}`);
      const header = element('div', 'project-message-head');
      const sender = element('strong', '', message.sender_role === 'client' ? 'Customer' : 'K&B project team');
      const date = element('time', '', new Date(message.created_at).toLocaleString('en-GB'));
      date.dateTime = message.created_at;
      const body = element('p', '', message.body);
      header.append(sender, date);
      entry.append(header, body);
      projectMessageList.append(entry);
    });
  }
  projectMessageStatus.textContent = 'This conversation is saved to the project and visible in both portals.';
  projectMessageList.scrollTop = projectMessageList.scrollHeight;
}

function subscribeToStaffMessages(projectId) {
  if (staffMessageChannel) portalClient.removeChannel(staffMessageChannel);
  staffMessageChannel = portalClient
    .channel(`staff-project-messages-${projectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_messages', filter: `project_id=eq.${projectId}` }, () => {
      loadProjectMessages(projectId).catch((error) => {
        console.error('Could not refresh project messages.', error);
        projectMessageStatus.textContent = `Could not refresh messages: ${error.message}`;
      });
    })
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`Staff project message subscription ${status.toLocaleLowerCase()}.`, error);
        notify('Live message updates are unavailable. Refresh the project to see new messages.');
      }
    });
}

function stageStatusControl(stageNumber, update) {
  const card = element('article', 'stage-card');
  const header = element('div', 'stage-card-head');
  const stageName = window.portalStages[activeProject.kind][stageNumber - 1];
  header.append(element('h3', '', stageName));
  const statusLabelNode = element('label', 'stage-status', 'Stage status');
  const status = document.createElement('select');
  status.setAttribute('aria-label', `${stageName} status`);
  [['not-started', 'Not updated'], ['in-progress', 'In progress'], ['complete', 'Complete']].forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    status.append(option);
  });
  status.value = update?.status || 'not-started';
  statusLabelNode.append(status);
  header.append(statusLabelNode);

  const dateLabel = element('label', 'stage-target-date', 'Target date');
  const plannedDate = document.createElement('input');
  plannedDate.type = 'date';
  plannedDate.value = update?.planned_date || '';
  dateLabel.append(plannedDate);
  const noteLabel = element('label', 'stage-note-label', 'Client update');
  const note = document.createElement('textarea');
  note.className = 'stage-note';
  note.setAttribute('aria-label', `${stageName} client update`);
  note.placeholder = 'Add a short update for the customer';
  note.value = update?.note || '';
  noteLabel.append(note);

  const actions = element('div', 'stage-actions');
  const uploadLabel = element('label', 'upload-button', '＋ Add photos');
  const upload = document.createElement('input');
  upload.type = 'file';
  upload.accept = 'image/*';
  upload.multiple = true;
  upload.setAttribute('aria-label', `Add photos for ${stageName}`);
  uploadLabel.append(upload);
  const save = element('button', 'save-stage', 'Submit');
  save.type = 'button';
  const photoList = element('div', 'stage-photos');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const { error } = await portalClient.from('stage_updates').upsert({
        project_id: activeProject.id,
        stage_number: stageNumber,
        stage_name: stageName,
        status: status.value,
        note: note.value.trim(),
        planned_date: plannedDate.value || null,
        client_visible: true,
        updated_by: window.staffContext.user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'project_id,stage_number' });
      if (error) throw error;
      const savedUpdate = {
        project_id: activeProject.id,
        stage_number: stageNumber,
        stage_name: stageName,
        status: status.value,
        planned_date: plannedDate.value || null
      };
      const existingUpdateIndex = stageUpdates.findIndex((item) => item.project_id === activeProject.id && item.stage_number === stageNumber);
      if (existingUpdateIndex === -1) stageUpdates.push(savedUpdate);
      else stageUpdates[existingUpdateIndex] = { ...stageUpdates[existingUpdateIndex], ...savedUpdate };
      updateSummary();
      renderDashboard();
      notify(`${stageName} update saved.`);
    } catch (error) {
      notify(`Could not save the stage update: ${error.message}`);
    } finally {
      save.disabled = false;
    }
  });
  upload.addEventListener('change', async () => {
    const files = [...upload.files];
    upload.disabled = true;
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) {
          throw new Error('Choose images no larger than 12 MB each.');
        }
        await uploadProjectFile(file, {
          category: 'stage-photo',
          stageNumber,
          clientVisible: true
        });
      }
      await renderStageFiles(photoList, stageNumber);
      if (files.length) notify('Photos uploaded and visible to the customer.');
    } catch (error) {
      notify(`Could not upload photos: ${error.message}`);
    } finally {
      upload.disabled = false;
      upload.value = '';
    }
  });
  actions.append(uploadLabel, save);
  card.append(header, dateLabel, noteLabel, actions, photoList);
  renderStageFiles(photoList, stageNumber).catch((error) => notify(`Could not load private photos: ${error.message}`));
  return card;
}

async function uploadProjectFile(file, details) {
  const id = crypto.randomUUID();
  const storagePath = `${activeProject.id}/${details.category}/${id}-${window.portalAuth.safeFileName(file.name)}`;
  const { error: uploadError } = await portalClient.storage.from('project-files').upload(storagePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false
  });
  if (uploadError) throw uploadError;
  const { data, error } = await portalClient.from('project_files').insert({
    project_id: activeProject.id,
    storage_path: storagePath,
    file_name: file.name,
    content_type: file.type || 'application/octet-stream',
    category: details.category,
    stage_number: details.stageNumber || null,
    client_visible: details.clientVisible,
    created_by: window.staffContext.user.id
  }).select('id,storage_path,file_name,content_type,category,stage_number,client_visible').single();
  if (error) {
    const { error: cleanupError } = await portalClient.storage.from('project-files').remove([storagePath]);
    if (cleanupError) throw new Error(`${error.message}. Uploaded object cleanup failed: ${cleanupError.message}`);
    throw error;
  }
  return data;
}

async function renderStageFiles(container, stageNumber) {
  const { data: files, error } = await portalClient
    .from('project_files')
    .select('id,storage_path,file_name,client_visible')
    .eq('project_id', activeProject.id)
    .eq('stage_number', stageNumber)
    .eq('category', 'stage-photo')
    .order('created_at');
  if (error) throw error;
  container.replaceChildren();
  for (const file of files) {
    const item = element('div', 'photo-item');
    const image = document.createElement('img');
    image.alt = file.file_name;
    const { data, error: urlError } = await portalClient.storage.from('project-files').createSignedUrl(file.storage_path, 60);
    if (urlError) throw urlError;
    image.src = data.signedUrl;
    const remove = element('button', 'photo-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${file.file_name}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        const { error: removeError } = await portalClient.storage.from('project-files').remove([file.storage_path]);
        if (removeError) throw removeError;
        const { error: metadataError } = await portalClient.from('project_files').delete().eq('id', file.id);
        if (metadataError) throw metadataError;
        await renderStageFiles(container, stageNumber);
        notify('Photo removed.');
      } catch (error) {
        remove.disabled = false;
        notify(`Could not remove photo: ${error.message}`);
      }
    });
    item.append(image, remove);
    container.append(item);
  }
}

async function renderDocuments() {
  const list = document.querySelector('#project-document-list');
  const { data: files, error } = await portalClient
    .from('project_files')
    .select('id,storage_path,file_name,category,client_visible')
    .eq('project_id', activeProject.id)
    .in('category', ['design-document', 'project-document'])
    .order('created_at');
  if (error) throw error;
  list.replaceChildren();
  for (const file of files) {
    const row = document.createElement('details');
    row.className = 'project-document-row';
    const summary = element('summary', '', file.file_name);
    const options = element('div', 'project-document-options');
    const open = element('a', 'project-document-link', 'Open document');
    const download = element('a', 'project-document-link', 'Download');
    const removeErrorMessage = element('span', 'project-document-error');
    const { data: signed, error: signedError } = await portalClient.storage.from('project-files').createSignedUrl(file.storage_path, 60);
    if (signedError) throw signedError;
    const { data: downloadable, error: downloadError } = await portalClient.storage.from('project-files').createSignedUrl(file.storage_path, 60, { download: true });
    if (downloadError) throw downloadError;
    open.href = signed.signedUrl;
    open.target = '_blank';
    open.rel = 'noopener';
    download.href = downloadable.signedUrl;
    download.target = '_blank';
    download.rel = 'noopener';
    const visibility = element('label', 'project-document-share');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = file.client_visible;
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      try {
        const { error: updateError } = await portalClient.from('project_files').update({ client_visible: checkbox.checked }).eq('id', file.id);
        if (updateError) throw updateError;
        notify(checkbox.checked ? 'Document shared with this customer.' : 'Document is now staff-only.');
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        notify(`Could not change document visibility: ${error.message}`);
      } finally {
        checkbox.disabled = false;
      }
    });
    visibility.append(checkbox, document.createTextNode('Visible to customer'));
    const remove = element('button', 'project-document-remove', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        const { error: removeError } = await portalClient.storage.from('project-files').remove([file.storage_path]);
        if (removeError) throw removeError;
        const { data: deletedFiles, error: metadataError } = await portalClient.from('project_files')
          .delete()
          .eq('id', file.id)
          .select('id');
        if (metadataError) throw metadataError;
        if (!deletedFiles?.length) {
          throw new Error('The file was removed from storage, but its project record could not be deleted. Run the latest Supabase portal upgrade SQL, then try Remove again.');
        }
        await renderDocuments();
        notify('Document removed.');
      } catch (error) {
        remove.disabled = false;
        removeErrorMessage.textContent = `Could not remove document: ${error.message}`;
        notify(`Could not remove document: ${error.message}`);
      }
    });
    options.append(open, download, visibility, remove, removeErrorMessage);
    row.append(summary, options);
    list.append(row);
  }
}

async function openProject(project) {
  activeProject = project;
  document.querySelector('#project-file-share').checked = false;
  document.querySelector('#project-dialog-title').textContent = project.client_name || 'Client project';
  document.querySelector('#project-dialog-reference').textContent = `${project.title} · ${project.reference || `Project ${project.id}`}`;
  projectStatusSelect.value = project.status;
  stageList.replaceChildren();
  issueList.replaceChildren();
  decisionList.replaceChildren();
  projectMessageList.replaceChildren();
  projectMessageStatus.textContent = 'Loading project messages…';
  projectDialog.showModal();
  const [updates, issues, decisions, messages] = await Promise.all([
    queryProject('stage_updates', project.id),
    queryProject('internal_issues', project.id),
    queryProject('project_decisions', project.id),
    portalClient.from('project_messages')
      .select('id,sender_role,body,created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
  ]);
  if (messages.error) throw messages.error;
  window.currentProjectIssues = issues;
  window.currentProjectDecisions = decisions;
  window.portalStages[project.kind].forEach((_, index) => {
    stageList.append(stageStatusControl(index + 1, updates.find((row) => row.stage_number === index + 1)));
  });
  await renderIssues(issues);
  await renderDecisions(decisions);
  await renderDocuments();
  renderProjectMessages(messages.data.reverse());
  markStaffMessagesRead(project.id);
  subscribeToStaffMessages(project.id);
}

async function renderIssues(issues) {
  issueList.replaceChildren();
  if (!issues.length) {
    issueList.append(element('p', 'issue-private-note', 'No internal issues or changes have been recorded.'));
    return;
  }
  for (const issue of issues.sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const card = element('article', 'issue-card');
    const summary = element('div');
    summary.append(element('h4', '', issue.title), element('p', '', issue.plan || issue.problem));
    const meta = element('div', 'issue-card-meta');
    meta.append(element('span', `issue-status${issue.status === 'resolved' ? ' resolved' : ''}`, issueStatusLabel(issue.status)));
    const edit = element('button', 'issue-edit-button', 'Edit record');
    edit.type = 'button';
    edit.addEventListener('click', () => editIssue(issue));
    meta.append(edit);
    card.append(summary, meta);
    if (issue.share_with_client && issue.client_update) card.append(element('p', 'issue-shared', 'Client-safe update is shared in the portal.'));
    if (issue.correspondence) {
      const details = document.createElement('details');
      details.className = 'issue-communication';
      details.append(element('summary', '', 'View correspondence record'), element('p', '', issue.correspondence));
      card.append(details);
    }
    if (issue.attachment_file_id) {
      const { data: file, error } = await portalClient.from('project_files')
        .select('storage_path,file_name')
        .eq('id', issue.attachment_file_id)
        .single();
      if (error) throw error;
      const { data: urlData, error: urlError } = await portalClient.storage.from('project-files').createSignedUrl(file.storage_path, 60, { download: true });
      if (urlError) throw urlError;
      const link = element('a', 'issue-edit-button', `Download ${file.file_name}`);
      link.href = urlData.signedUrl;
      link.download = file.file_name;
      card.append(link);
    }
    issueList.append(card);
  }
}

function clearIssueForm() {
  editingIssueId = null;
  issueForm.reset();
  document.querySelector('#issue-form-title').textContent = 'Record project issue or change';
  document.querySelector('#issue-attachment-name').textContent = 'Optional attachment · EML, TXT, PDF, or MSG · up to 15 MB';
  document.querySelector('#issue-attachment-download').hidden = true;
  issueForm.hidden = true;
}

function editIssue(issue) {
  editingIssueId = issue.id;
  document.querySelector('#issue-form-title').textContent = 'Update issue / change record';
  document.querySelector('#issue-title').value = issue.title;
  document.querySelector('#issue-status').value = issue.status;
  document.querySelector('#issue-problem').value = issue.problem;
  document.querySelector('#issue-plan').value = issue.plan;
  document.querySelector('#issue-communication').value = issue.correspondence;
  document.querySelector('#issue-client-update').value = issue.client_update;
  document.querySelector('#issue-share-with-client').checked = issue.share_with_client;
  issueForm.hidden = false;
}

async function renderDecisions(decisions) {
  decisionList.replaceChildren();
  if (!decisions.length) {
    decisionList.append(element('p', 'issue-private-note', 'No client decisions have been recorded.'));
    return;
  }
  for (const decision of decisions.sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const card = element('article', 'decision-card-staff');
    const details = element('div');
    details.append(element('h4', '', decision.title));
    details.append(element('p', '', `${decisionStatusLabel(decision.status)}${decision.client_visible ? ' · Visible to customer' : ' · Internal draft'}`));
    const edit = element('button', 'issue-edit-button', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => editDecision(decision));
    details.append(edit);
    const { data: responses, error } = await portalClient.from('decision_responses')
      .select('response,responded_at')
      .eq('decision_id', decision.id);
    if (error) throw error;
    if (responses[0]) details.append(element('p', '', `Customer response: ${responses[0].response} · ${new Date(responses[0].responded_at).toLocaleString('en-GB')}`));
    card.append(details);
    decisionList.append(card);
  }
}

function decisionStatusLabel(status) {
  return { 'awaiting-response': 'Awaiting customer', approved: 'Approved / confirmed', 'discussion-requested': 'Discussion requested' }[status] || status;
}

function editDecision(decision) {
  editingDecisionId = decision.id;
  document.querySelector('#decision-form-title').textContent = 'Edit client decision';
  document.querySelector('#decision-title').value = decision.title;
  document.querySelector('#decision-option').value = decision.proposed_option;
  document.querySelector('#decision-cost').value = decision.cost_impact;
  document.querySelector('#decision-schedule').value = decision.schedule_impact;
  document.querySelector('#decision-client-note').value = decision.client_note;
  document.querySelector('#decision-status').value = decision.status;
  document.querySelector('#decision-share').checked = decision.client_visible;
  decisionForm.hidden = false;
}

function clearDecisionForm() {
  editingDecisionId = null;
  decisionForm.reset();
  decisionForm.hidden = true;
  document.querySelector('#decision-form-title').textContent = 'Create client decision';
}

async function saveIssue(event) {
  event.preventDefault();
  if (!activeProject) return;
  const existing = window.currentProjectIssues.find((issue) => issue.id === editingIssueId);
  const shareWithClient = document.querySelector('#issue-share-with-client').checked;
  const clientUpdate = document.querySelector('#issue-client-update').value.trim();
  if (shareWithClient && !clientUpdate) {
    notify('Add a customer-safe update before sharing it.');
    return;
  }
  let attachmentFileId = existing?.attachment_file_id || null;
  let uploadedAttachment = null;
  const attachment = document.querySelector('#issue-attachment').files[0];
  if (attachment) {
    if (attachment.size > 15 * 1024 * 1024) {
      notify('Choose a communication file smaller than 15 MB.');
      return;
    }
    uploadedAttachment = await uploadProjectFile(attachment, { category: 'internal-attachment', clientVisible: false });
    attachmentFileId = uploadedAttachment.id;
  }
  const issue = {
    ...(editingIssueId ? { id: editingIssueId } : {}),
    project_id: activeProject.id,
    title: document.querySelector('#issue-title').value.trim(),
    status: document.querySelector('#issue-status').value,
    problem: document.querySelector('#issue-problem').value.trim(),
    plan: document.querySelector('#issue-plan').value.trim(),
    correspondence: document.querySelector('#issue-communication').value.trim(),
    client_update: clientUpdate,
    share_with_client: shareWithClient,
    attachment_file_id: attachmentFileId,
    updated_by: window.staffContext.user.id,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await portalClient.from('internal_issues').upsert(issue).select().single();
  if (error) {
    if (uploadedAttachment) {
      const { error: removeError } = await portalClient.storage.from('project-files').remove([uploadedAttachment.storage_path]);
      const { error: metadataError } = await portalClient.from('project_files').delete().eq('id', uploadedAttachment.id);
      if (removeError || metadataError) {
        throw new Error(`${error.message}. Attachment cleanup failed: ${removeError?.message || metadataError?.message}`);
      }
    }
    throw error;
  }
  const clientUpdateMutation = shareWithClient
    ? portalClient.from('client_updates').upsert({
      project_id: activeProject.id,
      source_issue_id: data.id,
      title: data.title,
      message: clientUpdate,
      created_by: window.staffContext.user.id
    }, { onConflict: 'source_issue_id' })
    : portalClient.from('client_updates').delete().eq('source_issue_id', data.id);
  const { error: updateError } = await clientUpdateMutation;
  if (updateError) throw updateError;
  if (existing?.attachment_file_id && uploadedAttachment) {
    const { data: oldFile, error: oldFileError } = await portalClient.from('project_files')
      .select('id,storage_path')
      .eq('id', existing.attachment_file_id)
      .maybeSingle();
    if (oldFileError) throw oldFileError;
    if (oldFile) {
      const { error: removeError } = await portalClient.storage.from('project-files').remove([oldFile.storage_path]);
      if (removeError) throw removeError;
      const { error: metadataError } = await portalClient.from('project_files').delete().eq('id', oldFile.id);
      if (metadataError) throw metadataError;
    }
  }
  window.currentProjectIssues = await queryProject('internal_issues', activeProject.id);
  await renderIssues(window.currentProjectIssues);
  clearIssueForm();
  notify(shareWithClient ? 'Issue saved and customer update shared.' : 'Issue saved internally.');
}

async function saveDecision(event) {
  event.preventDefault();
  const record = {
    ...(editingDecisionId ? { id: editingDecisionId } : {}),
    project_id: activeProject.id,
    title: document.querySelector('#decision-title').value.trim(),
    proposed_option: document.querySelector('#decision-option').value.trim(),
    cost_impact: document.querySelector('#decision-cost').value.trim(),
    schedule_impact: document.querySelector('#decision-schedule').value.trim(),
    client_note: document.querySelector('#decision-client-note').value.trim(),
    status: document.querySelector('#decision-status').value,
    client_visible: document.querySelector('#decision-share').checked,
    updated_by: window.staffContext.user.id,
    updated_at: new Date().toISOString()
  };
  const { error } = await portalClient.from('project_decisions').upsert(record);
  if (error) throw error;
  window.currentProjectDecisions = await queryProject('project_decisions', activeProject.id);
  await renderDecisions(window.currentProjectDecisions);
  clearDecisionForm();
  notify(record.client_visible ? 'Decision saved for the customer portal.' : 'Decision saved as an internal draft.');
}

async function loadProjects() {
  const [projectsResult, updatesResult, messagesResult] = await Promise.all([
    portalClient
      .from('projects')
      .select('id,title,client_name,reference,kind,status,project_note,start_date,duration')
      .order('created_at', { ascending: false }),
    portalClient.from('stage_updates').select('project_id,stage_number,stage_name,status,planned_date'),
    portalClient.from('project_messages').select('project_id,created_at').eq('sender_role', 'client').order('created_at')
  ]);
  if (projectsResult.error) throw projectsResult.error;
  if (updatesResult.error) throw updatesResult.error;
  if (messagesResult.error) throw messagesResult.error;
  projectTable.replaceChildren();
  projectRows.clear();
  latestIncomingMessageTimes = new Map();
  messagesResult.data.forEach(({ project_id: projectId, created_at: createdAt }) => {
    const id = String(projectId);
    if (isMessageTimeNewer(createdAt, latestIncomingMessageTimes.get(id))) {
      latestIncomingMessageTimes.set(id, createdAt);
    }
  });
  stageUpdates = updatesResult.data;
  projectsResult.data.forEach(buildProjectRow);
  updateSummary();
  updateProjects();
  renderDashboard();
  updateStaffMessageIndicators();
}

async function startStaffPortal() {
  window.staffContext = await window.portalAuth.requireRole('staff');
  if (!window.staffContext) return;
  await loadProjects();
  subscribeToIncomingStaffMessages();
  document.body.style.visibility = 'visible';
}

filters.forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  filters.forEach((filter) => filter.setAttribute('aria-pressed', String(filter === button)));
  updateProjects();
}));
window.addEventListener('hashchange', updateNavigation);
updateNavigation();
searchInput.addEventListener('input', updateProjects);
document.querySelector('#open-create-project').addEventListener('click', () => {
  createProjectMessage.textContent = '';
  createProjectDialog.showModal();
  document.querySelector('#new-client-name').focus();
});
document.querySelector('#close-create-project').addEventListener('click', () => createProjectDialog.close());
document.querySelector('#cancel-create-project').addEventListener('click', () => createProjectDialog.close());
createProjectDialog.addEventListener('click', (event) => {
  if (event.target === createProjectDialog && !createProjectForm.querySelector('button[type="submit"]').disabled) {
    createProjectDialog.close();
  }
});
createProjectDialog.addEventListener('cancel', (event) => {
  if (createProjectForm.querySelector('button[type="submit"]').disabled) event.preventDefault();
});
createProjectForm.addEventListener('submit', (event) => {
  createProjectAndInviteCustomer(event).catch((error) => {
    createProjectMessage.textContent = `Could not create the project and invite the customer: ${error.message}`;
  });
});
document.querySelector('.dialog-close').addEventListener('click', () => projectDialog.close());
projectDialog.addEventListener('close', () => {
  if (staffMessageChannel) portalClient.removeChannel(staffMessageChannel);
  staffMessageChannel = null;
});
projectDialog.addEventListener('click', (event) => {
  if (event.target === projectDialog) projectDialog.close();
});
document.querySelector('#new-decision-button').addEventListener('click', () => {
  clearDecisionForm();
  decisionForm.hidden = false;
  document.querySelector('#decision-title').focus();
});
document.querySelector('#cancel-decision-button').addEventListener('click', clearDecisionForm);
decisionForm.addEventListener('submit', (event) => {
  saveDecision(event).catch((error) => notify(`Could not save the decision: ${error.message}`));
});
document.querySelector('#new-issue-button').addEventListener('click', () => {
  clearIssueForm();
  issueForm.hidden = false;
  document.querySelector('#issue-title').focus();
});
document.querySelector('#cancel-issue-button').addEventListener('click', clearIssueForm);
document.querySelector('#issue-attachment').addEventListener('change', async (event) => {
  const [file] = event.currentTarget.files;
  if (!file) return;
  document.querySelector('#issue-attachment-name').textContent = `Selected: ${file.name}`;
  if (/\.(eml|txt)$/i.test(file.name)) {
    try {
      document.querySelector('#issue-communication').value = await file.text();
    } catch (error) {
      notify(`Could not read the communication file: ${error.message}`);
    }
  }
});
document.querySelector('#project-file-upload').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const files = [...input.files];
  input.disabled = true;
  try {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose documents no larger than 20 MB each.');
      await uploadProjectFile(file, {
        category: document.querySelector('#project-file-category').value,
        clientVisible: document.querySelector('#project-file-share').checked
      });
    }
    await renderDocuments();
    if (files.length) notify('Documents uploaded to private storage.');
  } catch (error) {
    notify(`Could not upload documents: ${error.message}`);
  } finally {
    input.value = '';
    input.disabled = false;
  }
});
issueForm.addEventListener('submit', (event) => {
  saveIssue(event).catch((error) => notify(`Could not save the issue: ${error.message}`));
});
staffMessageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeProject) {
    notify('Open a project before sending a reply.');
    return;
  }
  const message = document.querySelector('#staff-message-text').value.trim();
  if (!message) {
    notify('Write a reply before sending.');
    return;
  }
  const projectId = activeProject.id;
  const button = document.querySelector('#send-staff-message');
  button.disabled = true;
  let saved = false;
  try {
    const { error } = await portalClient.from('project_messages').insert({
      project_id: projectId,
      sender_id: window.staffContext.user.id,
      sender_role: 'staff',
      body: message
    });
    if (error) throw error;
    saved = true;
    staffMessageForm.reset();
    notify('Reply sent and recorded in the project conversation.');
    try {
      await loadProjectMessages(projectId);
    } catch (error) {
      projectMessageStatus.textContent = `Reply was saved, but messages could not be refreshed: ${error.message}`;
      console.error('Could not refresh messages after sending a reply.', error);
      notify(`Reply was saved, but the conversation could not refresh: ${error.message}`);
    }
  } catch (error) {
    console.error('Could not send project reply.', error);
    notify(saved
      ? `Reply was saved, but the conversation could not refresh: ${error.message}`
      : `Could not send the reply: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#save-project-status').addEventListener('click', async () => {
  if (!activeProject) return;
  const status = projectStatusSelect.value;
  const { error } = await portalClient.from('projects').update({ status }).eq('id', activeProject.id);
  if (error) {
    notify(`Could not update project status: ${error.message}`);
    return;
  }
  activeProject.status = status;
  projectRows.set(activeProject.id, activeProject);
  const row = projectTable.querySelector(`[data-project-id="${CSS.escape(activeProject.id)}"]`);
  const badge = row.querySelector('.status');
  badge.className = `status ${status}`;
  badge.textContent = statusLabel(status);
  updateSummary();
  updateProjects();
  renderDashboard();
  notify('Project status saved.');
});
document.querySelector('#portal-sign-out').addEventListener('click', () => {
  window.portalAuth.signOut().catch((error) => notify(`Could not sign out: ${error.message}`));
});
startStaffPortal().catch((error) => {
  document.body.style.visibility = 'visible';
  notify(`The staff portal could not load: ${error.message}`);
});

const portalClient = window.portalAuth.client;
const projectTable = document.querySelector('#project-rows');
const projectDialog = document.querySelector('#project-dialog');
const stageList = document.querySelector('#stage-list');
const issueList = document.querySelector('#issue-list');
const issueForm = document.querySelector('#issue-form');
const decisionList = document.querySelector('#decision-list-staff');
const decisionForm = document.querySelector('#decision-form');
const projectStatusSelect = document.querySelector('#project-status-select');
const toast = document.querySelector('#dialog-toast');
const filters = [...document.querySelectorAll('.filter')];
const searchInput = document.querySelector('#project-search');
const recordCount = document.querySelector('#record-count');
const emptyState = document.querySelector('#empty-state');
const projectRows = new Map();
let activeFilter = 'all';
let activeProject = null;
let editingIssueId = null;
let editingDecisionId = null;
let toastTimer;

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

function statusLabel(status) {
  return { progress: 'In Progress', finishing: 'In Finishing Stages', completed: 'Completed' }[status] || status;
}

function issueStatusLabel(status) {
  return { open: 'Open', 'awaiting-supplier': 'Awaiting supplier', 'in-progress': 'Action in progress', resolved: 'Resolved' }[status] || 'Open';
}

function updateSummary() {
  const projects = [...projectRows.values()];
  const counts = Object.fromEntries(['progress', 'finishing', 'completed'].map((status) => [status, projects.filter((item) => item.status === status).length]));
  document.querySelectorAll('.metric-value').forEach((metric, index) => {
    metric.textContent = [projects.length, counts.completed, counts.finishing, counts.progress][index];
  });
  filters.forEach((button) => {
    button.querySelector('.filter-count').textContent = button.dataset.filter === 'all' ? projects.length : counts[button.dataset.filter];
  });
  document.querySelector('#register-summary').textContent = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} in register`;
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
  const shareWrap = element('label', 'issue-share-row');
  const share = document.createElement('input');
  share.type = 'checkbox';
  share.checked = Boolean(update?.client_visible);
  shareWrap.append(share, element('span', '', 'Share this stage update with the customer'));

  const actions = element('div', 'stage-actions');
  const uploadLabel = element('label', 'upload-button', '＋ Add photos');
  const upload = document.createElement('input');
  upload.type = 'file';
  upload.accept = 'image/*';
  upload.multiple = true;
  upload.setAttribute('aria-label', `Add photos for ${stageName}`);
  uploadLabel.append(upload);
  const save = element('button', 'save-stage', 'Save stage update');
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
        client_visible: share.checked,
        updated_by: window.staffContext.user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'project_id,stage_number' });
      if (error) throw error;
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
          clientVisible: false
        });
      }
      await renderStageFiles(photoList, stageNumber);
      if (files.length) notify('Photos uploaded privately. Mark each one shared only when approved.');
    } catch (error) {
      notify(`Could not upload photos: ${error.message}`);
    } finally {
      upload.disabled = false;
      upload.value = '';
    }
  });
  actions.append(uploadLabel, save);
  card.append(header, dateLabel, noteLabel, shareWrap, actions, photoList);
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
    const shareLabel = element('label', 'photo-share');
    const share = document.createElement('input');
    share.type = 'checkbox';
    share.checked = file.client_visible;
    share.setAttribute('aria-label', `Share ${file.file_name} with customer`);
    share.addEventListener('change', async () => {
      share.disabled = true;
      try {
        const { error: updateError } = await portalClient.from('project_files')
          .update({ client_visible: share.checked })
          .eq('id', file.id);
        if (updateError) throw updateError;
        notify(share.checked ? 'Photo shared with the customer.' : 'Photo is now staff-only.');
      } catch (error) {
        share.checked = !share.checked;
        notify(`Could not change photo visibility: ${error.message}`);
      } finally {
        share.disabled = false;
      }
    });
    shareLabel.append(share, document.createTextNode('Visible to customer'));
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
    item.append(image, shareLabel, remove);
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
    const row = element('div', 'photo-item');
    const link = element('a', 'issue-edit-button', file.file_name);
    const { data: signed, error: signedError } = await portalClient.storage.from('project-files').createSignedUrl(file.storage_path, 60, { download: true });
    if (signedError) throw signedError;
    link.href = signed.signedUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    const visibility = element('label', 'photo-share');
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
    const remove = element('button', 'photo-remove', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        const { error: removeError } = await portalClient.storage.from('project-files').remove([file.storage_path]);
        if (removeError) throw removeError;
        const { error: metadataError } = await portalClient.from('project_files').delete().eq('id', file.id);
        if (metadataError) throw metadataError;
        await renderDocuments();
        notify('Document removed.');
      } catch (error) {
        remove.disabled = false;
        notify(`Could not remove document: ${error.message}`);
      }
    });
    row.append(link, visibility, remove);
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
  projectDialog.showModal();
  const [updates, issues, decisions] = await Promise.all([
    queryProject('stage_updates', project.id),
    queryProject('internal_issues', project.id),
    queryProject('project_decisions', project.id)
  ]);
  window.currentProjectIssues = issues;
  window.currentProjectDecisions = decisions;
  window.portalStages[project.kind].forEach((_, index) => {
    stageList.append(stageStatusControl(index + 1, updates.find((row) => row.stage_number === index + 1)));
  });
  await renderIssues(issues);
  await renderDecisions(decisions);
  await renderDocuments();
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
    if (issue.communication) {
      const details = document.createElement('details');
      details.className = 'issue-communication';
      details.append(element('summary', '', 'View correspondence record'), element('p', '', issue.communication));
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
  document.querySelector('#issue-communication').value = issue.communication;
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
    communication: document.querySelector('#issue-communication').value.trim(),
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
  const { data, error } = await portalClient
    .from('projects')
    .select('id,title,client_name,reference,kind,status,project_note,start_date,duration')
    .order('created_at', { ascending: false });
  if (error) throw error;
  projectTable.replaceChildren();
  projectRows.clear();
  data.forEach(buildProjectRow);
  updateSummary();
  updateProjects();
}

async function startStaffPortal() {
  window.staffContext = await window.portalAuth.requireRole('staff');
  if (!window.staffContext) return;
  await loadProjects();
  document.body.style.visibility = 'visible';
}

filters.forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  filters.forEach((filter) => filter.setAttribute('aria-pressed', String(filter === button)));
  updateProjects();
}));
searchInput.addEventListener('input', updateProjects);
document.querySelector('.dialog-close').addEventListener('click', () => projectDialog.close());
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
  notify('Project status saved.');
});
document.querySelector('#portal-sign-out').addEventListener('click', () => {
  window.portalAuth.signOut().catch((error) => notify(`Could not sign out: ${error.message}`));
});
startStaffPortal().catch((error) => {
  document.body.style.visibility = 'visible';
  notify(`The staff portal could not load: ${error.message}`);
});

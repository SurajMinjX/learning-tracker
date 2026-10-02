const state = {
  dashboard: null,
  privateDashboard: null,
  draft: null,
  setupRequired: false,
  isAdmin: false,
  activeTab: 'profile',
  dirty: false,
  authReturnFocus: null,
  toastTimer: null,
};

const tabInfo = {
  profile: { eyebrow: 'PROFILE', title: 'Your introduction', step: '01 / 04' },
  learningPath: { eyebrow: 'LEARNING PATH', title: 'Milestones & progress', step: '02 / 04' },
  skills: { eyebrow: 'LANGUAGES & SKILLS', title: 'Your toolkit', step: '03 / 04' },
  projects: { eyebrow: 'GITHUB PROJECTS', title: 'What you’ve built', step: '04 / 04' },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID().replaceAll('-', '');
  }
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json' };
  const fetchOptions = {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'fetch';
    fetchOptions.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, fetchOptions);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

function setHeaderMode(adminMode) {
  $('#publicNav').hidden = adminMode;
  $('#adminButton').hidden = adminMode;
  $('#headerAdminActions').hidden = !adminMode;
  $('#siteFooter').hidden = adminMode;
}

function renderPublic(data) {
  state.dashboard = data;
  const profile = data.profile || {};
  const headlineLines = String(profile.headline || 'Learning in public.').split(String.fromCharCode(10)).slice(0, 3);
  $('#heroTitle').innerHTML = headlineLines.map((line, index) => index === 1 ? `<span>${escapeHtml(line)}</span>` : escapeHtml(line)).join('<br>');
  $('#heroBio').textContent = profile.bio || '';
  $('#displayNameEyebrow').textContent = (profile.displayName || 'Developer').toLocaleUpperCase();
  $('#footerDisplayName').textContent = profile.displayName || 'Developer';
  $('#currentYear').textContent = String(new Date().getFullYear());
  $('#sampleNotice').hidden = !data.sampleData;

  const skills = Array.isArray(data.skills) ? data.skills : [];
  const milestones = Array.isArray(data.learningPath) ? data.learningPath : [];
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const completedCount = milestones.filter((item) => item.status === 'completed').length;

  $('#statSkills').textContent = String(skills.length).padStart(2, '0');
  $('#statMilestones').textContent = String(completedCount).padStart(2, '0');
  $('#statProjects').textContent = String(projects.length).padStart(2, '0');
  $('#roadmapCount').textContent = `${String(milestones.length).padStart(2, '0')} MILESTONES`;

  renderMilestones(milestones);
  renderSkills(skills);
  renderProjects(projects);
  renderCurrentFocus(milestones);
}

function renderMilestones(milestones) {
  const list = $('#milestoneList');
  if (!milestones.length) {
    list.innerHTML = '<div class="milestone-empty">Your learning path is ready for its first milestone.<br>Use Admin to add one when you’re ready.</div>';
    return;
  }

  const statusNames = { completed: 'Completed', 'in-progress': 'In progress', planned: 'Coming up' };
  list.innerHTML = milestones.map((item, index) => {
    const status = statusNames[item.status] ? item.status : 'planned';
    const marker = status === 'completed' ? '✓' : String(index + 1).padStart(2, '0');
    const percent = Number(item.progress) || 0;
    return `<article class="milestone">
      <div class="milestone-marker ${status === 'completed' ? 'completed' : status === 'in-progress' ? 'current' : ''}" aria-hidden="true">${marker}</div>
      <div class="milestone-content">
        <div class="milestone-title-row"><h3 class="milestone-title">${escapeHtml(item.title)}</h3><span class="milestone-state ${status === 'completed' ? 'completed' : status === 'in-progress' ? 'current' : ''}">${statusNames[status]}</span></div>
        ${item.description ? `<p class="milestone-description">${escapeHtml(item.description)}</p>` : ''}
      </div>
      <div class="milestone-progress"><strong>${percent}%</strong><br><span>${status === 'completed' ? 'DONE' : status === 'planned' ? 'NEXT' : 'IN IT'}</span></div>
    </article>`;
  }).join('');
}

function renderCurrentFocus(milestones) {
  const focus = milestones.find((item) => item.status === 'in-progress')
    || milestones.find((item) => item.status === 'planned')
    || milestones[milestones.length - 1];
  const title = focus?.title || 'Choose your next milestone';
  const description = focus?.description || 'Add a learning milestone in your private admin panel and it will show up here.';
  const percent = focus ? Math.max(0, Math.min(100, Number(focus.progress) || 0)) : 0;

  const focusLabel = focus?.status === 'planned' ? 'NEXT UP' : focus?.status === 'completed' ? 'LATEST MILESTONE' : focus ? 'CURRENT FOCUS' : 'SET A FOCUS';
  $('#heroFocusLabel').textContent = focusLabel;
  $('#heroFocusTitle').textContent = title;
  $('#heroFocusDescription').textContent = description;
  $('#heroFocusPercent').textContent = `${percent}%`;
  $('#heroFocusBar').style.width = `${percent}%`;
  $('#focusCardTitle').textContent = title;
  $('#focusCardDescription').textContent = description;
  $('#focusRingNumber').textContent = `${percent}%`;
  const circumference = 2 * Math.PI * 47;
  $('#focusRing').style.strokeDashoffset = String(circumference * (1 - percent / 100));
  $('#focusCardOverline').textContent = focus?.status === 'planned' ? 'UP NEXT' : focus?.status === 'completed' ? 'LATEST MILESTONE' : focus ? 'CURRENT MILESTONE' : 'LEARNING PATH';
}

function renderSkills(skills) {
  const grid = $('#skillGrid');
  if (!skills.length) {
    grid.innerHTML = '<div class="milestone-empty">No languages or skills added yet. Add a few in Admin to show your progress here.</div>';
    return;
  }
  grid.innerHTML = skills.map((skill) => {
    const level = Math.max(0, Math.min(100, Number(skill.level) || 0));
    const short = skill.name.length > 5 ? skill.name.split(/[\s/]+/).map((part) => part[0]).join('').slice(0, 3).toUpperCase() : skill.name.slice(0, 3).toUpperCase();
    return `<article class="skill-card">
      <div class="skill-card-head"><div class="skill-mark" aria-hidden="true">${escapeHtml(short)}</div><div><h3 class="skill-name">${escapeHtml(skill.name)}</h3><span class="skill-subtitle">Personal proficiency</span></div></div>
      <div class="skill-level"><span class="skill-level-label">Progress level</span><strong>${level}%</strong></div>
      <div class="skill-track" role="progressbar" aria-label="${escapeHtml(skill.name)} proficiency" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${level}"><span style="width:${level}%"></span></div>
    </article>`;
  }).join('');
}

function renderProjects(projects) {
  const grid = $('#projectGrid');
  if (!projects.length) {
    grid.innerHTML = `<div class="projects-empty">
      <div class="empty-copy"><p class="empty-overline">THE PROJECT SHELF IS READY</p><h3>Your repositories, right here.</h3><p>Projects you add in Admin will appear here with a short description and a direct link to the GitHub repository.</p><button type="button" class="button button-dark" data-open-admin="true">Add a GitHub project <span aria-hidden="true">↗</span></button></div>
      <div class="empty-illustration" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m17 15-9 9 9 9M31 15l9 9-9 9M28 9l-8 30" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    </div>`;
    return;
  }
  grid.innerHTML = projects.map((project) => `<article class="project-card">
    <div class="project-card-top"><span class="project-glyph" aria-hidden="true">&lt;/&gt;</span><span class="project-tag">${escapeHtml(project.tag || 'GitHub repo')}</span></div>
    <h3>${escapeHtml(project.title)}</h3>
    <p>${escapeHtml(project.description || 'Open the repository to explore this project.')}</p>
    <a class="project-link" href="${escapeHtml(project.repoUrl)}" target="_blank" rel="noopener noreferrer">View repository <span aria-hidden="true">↗</span></a>
  </article>`).join('');
}

function adminMarkup() {
  const data = state.draft;
  if (state.activeTab === 'profile') {
    return `<div class="editor-form"><div class="form-grid">
      <label class="form-field"><span>Display name</span><input id="editDisplayName" maxlength="60" value="${escapeHtml(data.profile.displayName)}" autocomplete="name"><small>Shown in the small label at the top of your public dashboard.</small></label>
      <label class="form-field"><span>Headline</span><textarea id="editHeadline" maxlength="120" rows="2">${escapeHtml(data.profile.headline)}</textarea><small>The main line visitors see first. Use a line break to add emphasis.</small></label>
      <label class="form-field full"><span>About</span><textarea id="editBio" maxlength="320">${escapeHtml(data.profile.bio)}</textarea><small>A short intro for your public dashboard. Up to 320 characters.</small></label>
      <label class="check-row full"><input type="checkbox" id="editSampleData" ${data.sampleData ? 'checked' : ''}><span>Keep the “Starter content” notice visible on the public dashboard.<small>Leave this on until you’ve replaced the example milestone and skill values with your own.</small></span></label>
    </div></div>`;
  }

  if (state.activeTab === 'skills') {
    const cards = data.skills.map((skill, index) => `<article class="admin-item skill-editor-item" data-id="${escapeHtml(skill.id)}">
      <div class="admin-item-top"><div class="admin-item-title"><span class="admin-item-index">${String(index + 1).padStart(2, '0')}</span>Language / skill ${index + 1}</div><button class="text-button" type="button" data-action="remove-entry" data-kind="skills" data-id="${escapeHtml(skill.id)}">Remove <span aria-hidden="true">×</span></button></div>
      <div class="admin-fields"><label class="form-field"><span>Name</span><input data-field="name" maxlength="40" value="${escapeHtml(skill.name)}" placeholder="e.g. Python"></label>
      <label class="form-field"><span>Proficiency</span><div class="range-field"><input data-field="level" type="range" min="0" max="100" step="1" value="${Number(skill.level) || 0}" aria-label="${escapeHtml(skill.name)} proficiency"><output class="range-value" data-range-value>${Number(skill.level) || 0}%</output></div></label></div>
    </article>`).join('');
    return `<div class="editor-form"><div class="admin-list">${cards || '<div class="admin-empty">No languages or skills yet. Add the first one to start building your toolkit.</div>'}<button class="add-entry" type="button" data-action="add-entry" data-kind="skills"><span>＋</span> Add a language or skill</button></div></div>`;
  }

  if (state.activeTab === 'learningPath') {
    const cards = data.learningPath.map((item, index) => `<article class="admin-item learning-editor-item" data-id="${escapeHtml(item.id)}">
      <div class="admin-item-top"><div class="admin-item-title"><span class="admin-item-index">${String(index + 1).padStart(2, '0')}</span>Milestone ${index + 1}</div><button class="text-button" type="button" data-action="remove-entry" data-kind="learningPath" data-id="${escapeHtml(item.id)}">Remove <span aria-hidden="true">×</span></button></div>
      <div class="admin-fields"><label class="form-field full"><span>Title</span><input data-field="title" maxlength="90" value="${escapeHtml(item.title)}" placeholder="What are you learning?"></label>
      <label class="form-field full"><span>Description</span><textarea data-field="description" maxlength="240" placeholder="A short note about this milestone">${escapeHtml(item.description)}</textarea></label>
      <label class="form-field"><span>Status</span><select data-field="status"><option value="completed" ${item.status === 'completed' ? 'selected' : ''}>Completed</option><option value="in-progress" ${item.status === 'in-progress' ? 'selected' : ''}>In progress</option><option value="planned" ${item.status === 'planned' ? 'selected' : ''}>Coming up</option></select></label>
      <label class="form-field"><span>Progress</span><div class="range-field"><input data-field="progress" type="range" min="0" max="100" step="1" value="${Number(item.progress) || 0}" aria-label="${escapeHtml(item.title)} progress"><output class="range-value" data-range-value>${Number(item.progress) || 0}%</output></div></label></div>
    </article>`).join('');
    return `<div class="editor-form"><div class="admin-list">${cards || '<div class="admin-empty">Your roadmap is empty. Add a milestone to make your learning path visible.</div>'}<button class="add-entry" type="button" data-action="add-entry" data-kind="learningPath"><span>＋</span> Add a learning milestone</button></div></div>`;
  }

  const cards = data.projects.map((project, index) => `<article class="admin-item project-editor-item" data-id="${escapeHtml(project.id)}">
    <div class="admin-item-top"><div class="admin-item-title"><span class="admin-item-index">${String(index + 1).padStart(2, '0')}</span>GitHub project ${index + 1}</div><button class="text-button" type="button" data-action="remove-entry" data-kind="projects" data-id="${escapeHtml(project.id)}">Remove <span aria-hidden="true">×</span></button></div>
    <div class="admin-fields"><label class="form-field"><span>Project title</span><input data-field="title" maxlength="80" value="${escapeHtml(project.title)}" placeholder="e.g. Personal portfolio"></label>
    <label class="form-field"><span>Short tag <small>(optional)</small></span><input data-field="tag" maxlength="32" value="${escapeHtml(project.tag || '')}" placeholder="e.g. Web app"></label>
    <label class="form-field full"><span>Description</span><textarea data-field="description" maxlength="260" placeholder="What does this project do?">${escapeHtml(project.description)}</textarea></label>
    <label class="form-field full"><span>GitHub repository URL</span><input data-field="repoUrl" type="url" maxlength="300" value="${escapeHtml(project.repoUrl)}" placeholder="https://github.com/owner/repository"><small>Use a direct repository link on github.com.</small></label></div>
  </article>`).join('');
  return `<div class="editor-form"><div class="admin-list">${cards || '<div class="admin-empty">No projects listed yet. Add a GitHub repository to feature your work on the public page.</div>'}<button class="add-entry" type="button" data-action="add-entry" data-kind="projects"><span>＋</span> Add a GitHub project</button></div></div>`;
}

function renderAdminEditor() {
  const info = tabInfo[state.activeTab];
  $('#editorEyebrow').textContent = info.eyebrow;
  $('#editorTitle').textContent = info.title;
  $('#editorStep').textContent = info.step;
  $('#adminEditor').innerHTML = adminMarkup();
  $$('.editor-tab').forEach((button) => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function renderSaveState() {
  const indicator = $('#saveIndicator');
  const message = $('#saveMessage');
  const button = $('#saveChanges');
  indicator.classList.toggle('is-dirty', state.dirty);
  message.textContent = state.dirty ? 'You have unsaved changes.' : 'Your edits are private until you save.';
  button.innerHTML = state.dirty ? '<span>Save changes</span><span aria-hidden="true">↗</span>' : '<span>Save changes</span><span aria-hidden="true">↗</span>';
}

function markDirty() {
  state.dirty = true;
  renderSaveState();
}

function collectActiveTab() {
  if (!state.draft) return;
  const editor = $('#adminEditor');
  if (state.activeTab === 'profile') {
    const displayName = $('#editDisplayName', editor);
    if (!displayName) return;
    state.draft.profile = {
      displayName: displayName.value,
      headline: $('#editHeadline', editor).value,
      bio: $('#editBio', editor).value,
    };
    state.draft.sampleData = $('#editSampleData', editor).checked;
    return;
  }

  if (state.activeTab === 'skills') {
    state.draft.skills = $$('.skill-editor-item', editor).map((card) => ({
      id: card.dataset.id,
      name: $('[data-field="name"]', card).value,
      level: Number($('[data-field="level"]', card).value),
    }));
    return;
  }

  if (state.activeTab === 'learningPath') {
    state.draft.learningPath = $$('.learning-editor-item', editor).map((card) => ({
      id: card.dataset.id,
      title: $('[data-field="title"]', card).value,
      description: $('[data-field="description"]', card).value,
      status: $('[data-field="status"]', card).value,
      progress: Number($('[data-field="progress"]', card).value),
    }));
    return;
  }

  state.draft.projects = $$('.project-editor-item', editor).map((card) => ({
    id: card.dataset.id,
    title: $('[data-field="title"]', card).value,
    description: $('[data-field="description"]', card).value,
    repoUrl: $('[data-field="repoUrl"]', card).value,
    tag: $('[data-field="tag"]', card).value,
  }));
}

function showAdmin() {
  if (!state.privateDashboard) return;
  state.draft = cloneData(state.privateDashboard);
  state.activeTab = 'profile';
  state.dirty = false;
  $('#publicView').hidden = true;
  $('#adminView').hidden = false;
  setHeaderMode(true);
  renderSaveState();
  renderAdminEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showPublic() {
  $('#adminView').hidden = true;
  $('#publicView').hidden = false;
  setHeaderMode(false);
  renderPublic(state.dashboard);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openAuthDialog(setupRequired) {
  state.setupRequired = setupRequired;
  state.authReturnFocus = document.activeElement;
  const overlay = $('#authOverlay');
  const title = $('#authTitle');
  const description = $('#authDescription');
  const host = $('#authFormHost');
  const kicker = $('#authKicker');
  if (setupRequired) {
    kicker.textContent = 'FIRST-TIME OWNER SETUP';
    title.textContent = 'Secure your workspace';
    description.textContent = 'Use the one-time setup key from the server, then choose a strong owner password.';
    host.innerHTML = `<form class="auth-form" id="authForm">
      <label>One-time setup key<input name="setupKey" type="password" autocomplete="off" required placeholder="Paste the setup key"></label>
      <label>New owner password<input name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required placeholder="At least 12 characters"></label>
      <label>Confirm password<input name="confirmPassword" type="password" minlength="12" maxlength="200" autocomplete="new-password" required placeholder="Enter it again"></label>
      <p class="auth-help">The key is single-use. Your password is stored as a salted hash, not plain text.</p>
      <p class="auth-message" id="authMessage" aria-live="polite"></p>
      <button class="button button-dark" type="submit">Create private admin <span aria-hidden="true">↗</span></button>
    </form>`;
  } else {
    kicker.textContent = 'PRIVATE WORKSPACE';
    title.textContent = 'Admin sign in';
    description.textContent = 'Use your owner password to manage the public dashboard.';
    host.innerHTML = `<form class="auth-form" id="authForm">
      <label>Owner password<input name="password" type="password" maxlength="200" autocomplete="current-password" required placeholder="Enter your password"></label>
      <p class="auth-message" id="authMessage" aria-live="polite"></p>
      <button class="button button-dark" type="submit">Unlock admin panel <span aria-hidden="true">↗</span></button>
    </form>`;
  }
  overlay.hidden = false;
  const firstInput = $('input', host);
  window.setTimeout(() => firstInput?.focus(), 40);
  $('#authForm').addEventListener('submit', handleAuthSubmit);
}

function closeAuthDialog() {
  $('#authOverlay').hidden = true;
  const target = state.authReturnFocus;
  if (target && typeof target.focus === 'function') target.focus();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const message = $('#authMessage');
  const formData = new FormData(form);
  button.disabled = true;
  message.textContent = '';
  try {
    if (state.setupRequired) {
      const setupKey = String(formData.get('setupKey') || '').trim();
      const password = String(formData.get('password') || '');
      const confirmPassword = String(formData.get('confirmPassword') || '');
      if (password.length < 12) throw new Error('Choose a password with at least 12 characters.');
      if (password !== confirmPassword) throw new Error('The passwords do not match.');
      const result = await api('/api/setup', { method: 'POST', body: { setupKey, password, confirmPassword } });
      state.privateDashboard = result.data;
      state.dashboard = result.data;
      state.isAdmin = true;
      closeAuthDialog();
      renderPublic(state.dashboard);
      showAdmin();
      showToast('Private admin is ready.');
      return;
    }

    const password = String(formData.get('password') || '');
    await api('/api/login', { method: 'POST', body: { password } });
    const result = await api('/api/admin/data');
    state.privateDashboard = result.data;
    state.dashboard = result.data;
    state.isAdmin = true;
    closeAuthDialog();
    renderPublic(state.dashboard);
    showAdmin();
    showToast('Signed in to your private admin.');
  } catch (error) {
    message.textContent = error.message || 'Could not sign in. Please try again.';
    button.disabled = false;
    if (error.status === 429) message.textContent = 'Too many attempts. Please wait before trying again.';
  }
}

async function openAdmin() {
  if (state.isAdmin && state.privateDashboard) {
    showAdmin();
    return;
  }
  try {
    const status = await api('/api/status');
    openAuthDialog(Boolean(status.setupRequired));
  } catch (error) {
    showToast(error.message || 'The admin panel could not be opened.', true);
  }
}

async function saveChanges() {
  if (!state.draft) return;
  collectActiveTab();
  const button = $('#saveChanges');
  button.disabled = true;
  $('#saveMessage').textContent = 'Saving your dashboard…';
  try {
    const result = await api('/api/admin/data', { method: 'PUT', body: state.draft });
    state.privateDashboard = result.data;
    state.dashboard = result.data;
    state.draft = cloneData(result.data);
    state.dirty = false;
    renderSaveState();
    renderPublic(state.dashboard);
    showToast('Dashboard updated. Your public page is live.');
  } catch (error) {
    if (error.status === 401) {
      state.isAdmin = false;
      showPublic();
      showToast('Your session expired. Sign in again to save.', true);
    } else {
      $('#saveMessage').textContent = error.message || 'Could not save. Check the fields and try again.';
      showToast(error.message || 'Could not save your changes.', true);
    }
  } finally {
    button.disabled = false;
  }
}

function switchTab(tab) {
  if (!tabInfo[tab] || tab === state.activeTab) return;
  collectActiveTab();
  state.activeTab = tab;
  renderAdminEditor();
}

function addEntry(kind) {
  collectActiveTab();
  if (kind === 'skills') {
    state.draft.skills.push({ id: makeId(), name: 'New language', level: 0 });
    state.activeTab = 'skills';
  } else if (kind === 'learningPath') {
    state.draft.learningPath.push({ id: makeId(), title: 'New milestone', description: '', status: 'planned', progress: 0 });
    state.activeTab = 'learningPath';
  } else if (kind === 'projects') {
    state.draft.projects.push({ id: makeId(), title: 'New project', description: '', repoUrl: '', tag: '' });
    state.activeTab = 'projects';
  } else {
    return;
  }
  markDirty();
  renderAdminEditor();
  const lastField = $('#adminEditor input:not([type="range"]):last-of-type');
  lastField?.focus();
}

function removeEntry(kind, id) {
  collectActiveTab();
  if (!['skills', 'learningPath', 'projects'].includes(kind)) return;
  state.draft[kind] = state.draft[kind].filter((item) => item.id !== id);
  markDirty();
  renderAdminEditor();
}

async function signOut() {
  try {
    await api('/api/logout', { method: 'POST', body: {} });
  } catch {
    // Clear the local view even if the server session has already expired.
  }
  state.isAdmin = false;
  state.privateDashboard = null;
  state.draft = null;
  state.dirty = false;
  showPublic();
  showToast('You’ve signed out.');
}

async function initialize() {
  $('#adminEditor').addEventListener('input', (event) => {
    if (event.target.matches('input[type="range"]')) {
      const output = event.target.closest('.range-field')?.querySelector('[data-range-value]');
      if (output) output.textContent = `${event.target.value}%`;
    }
    markDirty();
  });
  $('#adminEditor').addEventListener('change', () => markDirty());

  $('#adminButton').addEventListener('click', openAdmin);
  $('#noticeAdmin').addEventListener('click', openAdmin);
  $('#previewButton').addEventListener('click', showPublic);
  $('#headerSignOut').addEventListener('click', signOut);
  $('#closeAuth').addEventListener('click', closeAuthDialog);
  $('#authOverlay').addEventListener('click', (event) => {
    if (event.target.matches('[data-close-auth="true"]')) closeAuthDialog();
  });
  $('#saveChanges').addEventListener('click', saveChanges);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#authOverlay').hidden) closeAuthDialog();
  });
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      switchTab(tab.dataset.tab);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'add-entry') addEntry(action.dataset.kind);
      if (action.dataset.action === 'remove-entry') removeEntry(action.dataset.kind, action.dataset.id);
      return;
    }
    if (event.target.closest('[data-open-admin="true"]')) openAdmin();
  });

  try {
    const data = await api('/api/dashboard');
    renderPublic(data);
  } catch (error) {
    $('#heroBio').textContent = 'The dashboard could not load its content. Please refresh the page and try again.';
    showToast(error.message || 'Could not load the dashboard.', true);
    return;
  }

  // Restore access quietly if this browser still has a valid owner session.
  try {
    const result = await api('/api/admin/data');
    state.privateDashboard = result.data;
    state.dashboard = result.data;
    state.isAdmin = true;
  } catch {
    state.isAdmin = false;
  }
}

void initialize();

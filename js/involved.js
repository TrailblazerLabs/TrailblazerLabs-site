(function () {
  if (window.location.hash === '#pitch') {
    window.location.replace('./pitch.html#pitch');
    return;
  }

  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const EXTERNAL_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 2h8v8h-2V5.4L5.4 12 4 10.6 10.6 4H6z"/><path d="M2 4h4v2H4v6h6v-2h2v4H2z"/></svg>';

  function setupList(options) {
    const grid = document.getElementById(options.gridId);
    const loadMore = document.getElementById(options.loadMoreId);
    const empty = document.getElementById(options.emptyId);
    const search = document.getElementById(options.searchId);
    const filters = document.getElementById(options.filtersId);
    if (!grid || !loadMore) return;

    const pageSize = parseInt(grid.dataset.pageSize, 10) || 10;
    let items = [];
    let filtered = [];
    let shown = 0;
    let query = '';
    let filter = '';

    function renderNext() {
      const nextItems = filtered.slice(shown, shown + pageSize);
      grid.insertAdjacentHTML('beforeend', nextItems.map(options.rowHTML).join(''));
      shown += nextItems.length;
      loadMore.hidden = shown >= filtered.length;
    }

    function applyFilter() {
      const normalizedQuery = query.trim().toLowerCase();
      filtered = items.filter((item) => options.matches(item, normalizedQuery, filter));
      grid.innerHTML = '';
      shown = 0;
      renderNext();
      if (empty) empty.hidden = filtered.length > 0;
    }

    loadMore.addEventListener('click', renderNext);
    if (search) search.addEventListener('input', () => {
      query = search.value;
      applyFilter();
    });
    if (filters) filters.addEventListener('click', (event) => {
      const button = event.target.closest('.sf-pitch-chip');
      if (!button) return;
      filter = button.dataset[options.filterKey] || '';
      filters.querySelectorAll('.sf-pitch-chip').forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      applyFilter();
    });

    fetch(options.dataUrl)
      .then((response) => {
        if (!response.ok) throw new Error(response.status);
        return response.json();
      })
      .then((data) => {
        items = (Array.isArray(data) ? data : []).filter((item) => item && item.title);
        applyFilter();
      })
      .catch((error) => {
        grid.innerHTML = `<li class="sf-pitch-row tds2-card"><span class="sf-pitch-row__meta" style="padding:16px 20px">${options.errorMessage}</span></li>`;
        loadMore.hidden = true;
        console.error(options.logLabel, error);
      });
  }

  const upIcon = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2l6 7h-4v5H6V9H2z"/></svg>';
  const chevronIcon = '<svg class="sf-pitch-row__chev" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 6l4 4 4-4z"/></svg>';
  let pitchId = 0;

  function trackBadge(track) {
    const normalized = (track || '').toLowerCase();
    let key = '';
    let label = '';
    if (normalized.startsWith('the strategist')) { key = 'strat'; label = 'Strategist'; }
    else if (normalized.startsWith('the builder')) { key = 'build'; label = 'Builder'; }
    else if (normalized.startsWith('the engineer')) { key = 'eng'; label = 'Engineer'; }
    return label ? `<span class="sf-disc-badge sf-disc-badge--${key} tds2-badge">${label}</span>` : '';
  }

  function pitchDetail(label, value) {
    return value ? `<div class="sf-pitch-detail__row"><span class="sf-pitch-detail__label">${escapeHTML(label)}</span><span class="sf-pitch-detail__value">${escapeHTML(value)}</span></div>` : '';
  }

  setupList({
    gridId: 'pitches-grid',
    loadMoreId: 'pitches-load-more',
    emptyId: 'pitches-empty',
    searchId: 'pitches-search',
    filtersId: 'pitches-tracks',
    filterKey: 'track',
    dataUrl: './data/pitches.json',
    logLabel: 'pitches:',
    errorMessage: 'No pitches to show yet. Be the first to pitch your idea.',
    matches: (pitch, query, track) => {
      if (track && !(pitch.track || '').toLowerCase().startsWith(track.toLowerCase())) return false;
      return !query || (pitch.title || '').toLowerCase().includes(query) || (pitch.author || '').toLowerCase().includes(query);
    },
    rowHTML: (pitch) => {
      const badge = trackBadge(pitch.track);
      const author = pitch.author ? escapeHTML('@' + pitch.author) : '';
      const details = pitchDetail('Elevator Pitch', pitch.elevator || pitch.excerpt) + pitchDetail('Problem', pitch.problem);
      const id = `pitch-detail-${pitchId++}`;
      return `<li class="sf-pitch-row tds2-card">
        <span class="sf-pitch-row__votes">${upIcon}<span>${escapeHTML(String(pitch.upvotes ?? 0))}</span></span>
        <span class="sf-pitch-row__body">
          <button type="button" class="sf-pitch-row__title tds2-button" aria-expanded="false" aria-controls="${id}"${details ? '' : ' disabled'}><span>${escapeHTML(pitch.title)}</span>${details ? chevronIcon : ''}</button>
          <span class="sf-pitch-row__meta">${badge}${badge && author ? ' &middot; ' : ''}${author}</span>
          <div class="sf-pitch-detail" id="${id}" hidden>${details}</div>
        </span>
        <a class="sf-pitch-row__upvote tds2-button" href="${escapeHTML(pitch.url)}" rel="noopener" target="_blank">${EXTERNAL_ICON}<span>Upvote on GitHub</span></a>
      </li>`;
    },
  });

  const pitchGrid = document.getElementById('pitches-grid');
  if (pitchGrid) pitchGrid.addEventListener('click', (event) => {
    const button = event.target.closest('.sf-pitch-row__title');
    if (!button || button.disabled) return;
    const detail = document.getElementById(button.getAttribute('aria-controls'));
    if (!detail) return;
    const expanded = detail.hidden;
    detail.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
  });

  const categoryKeys = { announcements: 'ann', general: 'gen', ideas: 'idea', 'q&a': 'qa', 'show and tell': 'show' };
  setupList({
    gridId: 'community-grid',
    loadMoreId: 'community-load-more',
    emptyId: 'community-empty',
    searchId: 'community-search',
    filtersId: 'community-cats',
    filterKey: 'cat',
    dataUrl: './data/discussions.json',
    logLabel: 'discussions:',
    errorMessage: 'No discussions yet. Start the first one on GitHub.',
    matches: (discussion, query, category) => {
      if (category && (discussion.category || '').toLowerCase() !== category.toLowerCase()) return false;
      return !query || (discussion.title || '').toLowerCase().includes(query) || (discussion.author || '').toLowerCase().includes(query);
    },
    rowHTML: (discussion) => {
      const key = categoryKeys[(discussion.category || '').toLowerCase()] || 'gen';
      const badge = discussion.category ? `<span class="sf-disc-badge sf-disc-badge--${key} tds2-badge">${escapeHTML(discussion.category)}</span>` : '';
      const metadata = [discussion.author ? '@' + discussion.author : '', discussion.comments ? `${discussion.comments} ${discussion.comments === 1 ? 'reply' : 'replies'}` : ''].filter(Boolean).map(escapeHTML).join(' &middot; ');
      const url = escapeHTML(discussion.url);
      return `<li class="sf-pitch-row sf-disc-row tds2-card">
        <span class="sf-disc-dot sf-disc-dot--${key}" aria-hidden="true"></span>
        <span class="sf-pitch-row__body">
          <a class="sf-pitch-row__title sf-disc-title" href="${url}" rel="noopener" target="_blank"><span>${escapeHTML(discussion.title)}</span></a>
          <span class="sf-pitch-row__meta">${badge}${badge && metadata ? ' &middot; ' : ''}${metadata}</span>
          ${discussion.excerpt ? `<span class="sf-disc-excerpt">${escapeHTML(discussion.excerpt)}</span>` : ''}
        </span>
        <a class="sf-pitch-row__upvote tds2-button" href="${url}" rel="noopener" target="_blank">${EXTERNAL_ICON}<span>View on GitHub</span></a>
      </li>`;
    },
  });

  const tablist = document.querySelector('.sf-tabs');
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const hashToTab = {
    '#builders': 'tab-builders',
    '#explore': 'tab-explore',
    '#pitches': 'tab-explore',
    '#community': 'tab-community',
  };

  function activate(tab, updateHash) {
    tabs.forEach((candidate) => {
      const active = candidate === tab;
      // TDS2 tabs key their active styling off data-state, not a class.
      candidate.dataset.state = active ? 'active' : 'inactive';
      candidate.setAttribute('aria-selected', String(active));
      candidate.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    });
    if (updateHash) history.replaceState(null, '', updateHash);
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    const hash = tab.id === 'tab-builders' ? '#builders' : tab.id === 'tab-explore' ? '#explore' : '#community';
    activate(tab, hash);
  }));
  tablist.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    let index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    tabs[index].focus();
    tabs[index].click();
    event.preventDefault();
  });

  function activateFromHash() {
    const tab = document.getElementById(hashToTab[window.location.hash] || 'tab-builders');
    if (tab) activate(tab);
  }
  window.addEventListener('hashchange', activateFromHash);
  activateFromHash();
})();

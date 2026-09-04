(function () {
  const track = document.getElementById('builders-grid');
  const prev = document.getElementById('builders-prev');
  const next = document.getElementById('builders-next');
  const dots = document.getElementById('builders-dots');
  if (!track) return;

  const PIN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C5.24 0 3 2.24 3 5c0 3.75 5 11 5 11s5-7.25 5-11c0-2.76-2.24-5-5-5zm0 7a2 2 0 110-4 2 2 0 010 4z"/></svg>';
  const ARROW_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 8h11.17l-3.58-3.59L10 3l6 6-6 6-1.41-1.41L12.17 10H1z"/></svg>';
  const TRACK_KEY = { Strategist: 'strat', Builder: 'build', Engineer: 'eng' };
  const TRACK_ORDER = ['Strategist', 'Builder', 'Engineer'];

  const esc = (value) => String(value).replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function trackBadges(repos) {
    const set = new Set(repos.map((repo) => repo.track).filter(Boolean));
    const ordered = TRACK_ORDER.filter((name) => set.has(name));
    if (!ordered.length) return '';
    return `<div class="sf-builder-card__tracks">${ordered.map((name) =>
      `<span class="sf-disc-badge sf-disc-badge--${TRACK_KEY[name]} tds2-badge">${esc(name)}</span>`).join('')}</div>`;
  }

  function reposBlock(builder, repos) {
    if (!repos.length) {
      const project = builder.project || {};
      if (!project.title) return '';
      return `<div class="sf-builder-card__repos">
        <a class="sf-builder-card__repo" href="${esc(project.url)}" rel="noopener" target="_blank">
          <span>${esc(project.title)}</span>${ARROW_ICON}
        </a>
      </div>`;
    }

    const items = repos.slice(0, 3).map((repo) => {
      const key = TRACK_KEY[repo.track];
      const dot = key ? `<span class="sf-builder-card__repo-dot is-${key}" aria-hidden="true"></span>` : '';
      return `<a class="sf-builder-card__repo" href="${esc(repo.repo)}" rel="noopener" target="_blank">
        ${dot}<span>${esc(repo.title)}</span>${ARROW_ICON}
      </a>`;
    }).join('');
    const more = repos.length > 3
      ? `<a class="sf-builder-card__repos-all" href="./assets.html?author=${encodeURIComponent(builder.github)}">View All ${repos.length} &rarr;</a>`
      : '';
    return `<div class="sf-builder-card__repos">${items}${more}</div>`;
  }

  function cardHTML(builder, repos) {
    const country = builder.country
      ? `<span class="sf-builder-card__country">${PIN_ICON}${esc(builder.country)}</span>`
      : '';
    const bio = builder.bio ? `<p class="sf-builder-card__bio">${esc(builder.bio)}</p>` : '';
    return `<article class="sf-builder-card tds2-card">
      <img class="sf-builder-card__avatar" src="${esc(builder.avatar)}" alt="" width="96" height="96" loading="lazy" />
      <h3 class="sf-builder-card__name">${esc(builder.name)}</h3>
      ${country}
      ${trackBadges(repos)}
      ${bio}
      <div class="sf-builder-card__project">
        <span class="sf-builder-card__project-label">Residency Builds</span>
        ${reposBlock(builder, repos)}
      </div>
    </article>`;
  }

  function pageWidth() {
    return track.clientWidth;
  }

  function pageCount() {
    const overflow = track.scrollWidth - track.clientWidth;
    return overflow <= 2 ? 1 : Math.ceil(overflow / pageWidth()) + 1;
  }

  function currentPage() {
    return Math.round(track.scrollLeft / pageWidth());
  }

  function buildDots() {
    if (!dots) return;
    const count = pageCount();
    if (count <= 1) {
      dots.innerHTML = '';
      return;
    }
    dots.innerHTML = Array.from({ length: count }, (_, index) =>
      `<button type="button" class="sf-carousel__dot tds2-button${index === 0 ? ' is-active' : ''}" data-i="${index}" aria-label="Go to builder page ${index + 1}" aria-pressed="${index === 0}"></button>`).join('');
  }

  function syncControls() {
    const max = track.scrollWidth - track.clientWidth - 2;
    const single = max <= 2;
    if (prev) prev.disabled = single || track.scrollLeft <= 2;
    if (next) next.disabled = single || track.scrollLeft >= max;
    if (dots) {
      const page = currentPage();
      [...dots.children].forEach((dot, index) => {
        const active = index === page;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-pressed', String(active));
      });
    }
  }

  if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -pageWidth(), behavior: 'smooth' }));
  if (next) next.addEventListener('click', () => track.scrollBy({ left: pageWidth(), behavior: 'smooth' }));
  if (dots) {
    dots.addEventListener('click', (event) => {
      const button = event.target.closest('.sf-carousel__dot');
      if (!button) return;
      track.scrollTo({ left: pageWidth() * Number(button.dataset.i), behavior: 'smooth' });
    });
  }
  track.addEventListener('scroll', () => {
    clearTimeout(track._buildersScrollTimer);
    track._buildersScrollTimer = setTimeout(syncControls, 60);
  });
  window.addEventListener('resize', () => {
    buildDots();
    syncControls();
  });

  Promise.all([
    fetch('./data/builders.json').then((response) => {
      if (!response.ok) throw new Error(response.status);
      return response.json();
    }),
    fetch('./data/community-assets.json')
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => []),
  ])
    .then(([builderData, assetData]) => {
      const builders = Array.isArray(builderData) ? builderData : [];
      const assets = Array.isArray(assetData) ? assetData : [];
      const assetsByLogin = new Map();
      assets.forEach((asset) => {
        const key = String(asset.authorName || '').toLowerCase();
        if (!key) return;
        if (!assetsByLogin.has(key)) assetsByLogin.set(key, []);
        assetsByLogin.get(key).push(asset);
      });
      assetsByLogin.forEach((list) => list.sort((left, right) => (right.stars || 0) - (left.stars || 0)));

      builders.sort((left, right) =>
        String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }));
      track.innerHTML = builders.map((builder) =>
        cardHTML(builder, assetsByLogin.get(String(builder.github || '').toLowerCase()) || [])).join('');
      requestAnimationFrame(() => {
        buildDots();
        syncControls();
      });
    })
    .catch((error) => {
      track.innerHTML = '<p class="sf-builder-card__bio">Unable to load builder profiles right now.</p>';
      console.error('builders:', error);
    });
})();

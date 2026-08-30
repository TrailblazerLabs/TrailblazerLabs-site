// Injects the shared header + footer partials, then wires the nav behaviors.
//
// Each page has <div data-include="header"></div> / <div data-include="footer"></div>
// mount points. We fetch the partial HTML and drop it in. Handlers (hamburger,
// theme toggle, nav-fade) are attached AFTER injection, since the header markup
// doesn't exist until the fetch resolves.
//
// Note: fetch() of a local file needs http(s) origin. On GitHub Pages this works;
// for local preview run a static server (e.g. `python3 -m http.server`) rather
// than opening the file with file://.

(function () {
  const mounts = document.querySelectorAll('[data-include]');

  const loads = Array.from(mounts).map((el) => {
    const name = el.dataset.include; // "header" | "footer"
    return fetch(`./partials/${name}.html`)
      .then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.text(); })
      .then((html) => { el.outerHTML = html; })
      .catch((err) => { console.error('partials:', err); });
  });

  Promise.all(loads).then(wireNav);

  function wireNav() {
    // Hamburger drawer
    document.querySelector('.sf-nav__hamburger')?.addEventListener('click', function () {
      const nav = document.querySelector('.sf-nav__links');
      const open = nav.classList.toggle('is-open');
      this.setAttribute('aria-expanded', open);
    });

    // Day/Night theme toggle — attribute change only; cascade does the rest.
    document.querySelector('.tl-theme-toggle')?.addEventListener('click', function () {
      const root = document.documentElement;
      const next = root.dataset.theme === 'night' ? 'day' : 'night';
      root.dataset.theme = next;
      try { localStorage.setItem('tl.theme', next); } catch (e) { /* storage disabled */ }
    });

    // Nav fade — dark over the masthead, light once scrolled past the hero.
    // No-ops on pages without a .hero-blade (e.g. engage.html).
    const nav = document.querySelector('.sf-nav');
    const hero = document.querySelector('.hero-blade');
    if (!nav || !hero) return;

    let ticking = false;
    function update() {
      const navH = nav.offsetHeight;
      const threshold = hero.offsetTop + hero.offsetHeight - navH;
      nav.classList.toggle('is-scrolled', window.scrollY >= threshold);
      ticking = false;
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    update();
  }
})();

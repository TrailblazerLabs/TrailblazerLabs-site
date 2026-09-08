(function () {
  const cfg = window.CLA_CONFIG;
  const params = new URLSearchParams(window.location.search);
  const scrollbox = document.getElementById('cla-scrollbox');
  const textEl = document.getElementById('cla-text');
  const hintEl = document.getElementById('cla-scroll-hint');
  const checkbox = document.getElementById('cla-checkbox');
  const signButton = document.getElementById('cla-sign-button');
  const statusEl = document.getElementById('cla-status');
  const contextEl = document.getElementById('cla-context');

  // repo=owner/name identifies where the signer came from. Display-only —
  // it is NOT used to decide pass/fail, signing covers every repo.
  const repo = params.get('repo') || '';
  if (repo) {
    contextEl.textContent = `Before "${repo}" can accept your contribution, you need to sign our CLA once. This covers every Trailblazer Labs repo — you won't be asked again.`;
  }

  function showStatus(message, kind) {
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.className = 'cla-page__status' + (kind ? ` is-${kind}` : '');
  }

  // --- Step 1: render the CLA text and gate the checkbox on scroll ---
  function renderMarkdown(markdown) {
    return markdown
      .trim()
      .split(/\n\s*\n/)
      .map((block) => {
        if (block.startsWith('## ')) return `<h2>${escapeHtml(block.slice(3))}</h2>`;
        if (block.startsWith('> ')) {
          const lines = block.split('\n').map((l) => l.replace(/^>\s?/, ''));
          return `<blockquote>${escapeHtml(lines.join(' '))}</blockquote>`;
        }
        if (block.startsWith('# ')) return `<h1>${escapeHtml(block.slice(2))}</h1>`;
        return `<p>${escapeHtml(block)}</p>`;
      })
      .join('\n');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function initScrollGate() {
    scrollbox.addEventListener('scroll', checkScrollComplete);
    // Some CLA texts might already fit without scrolling — don't trap the user.
    requestAnimationFrame(checkScrollComplete);
  }

  function checkScrollComplete() {
    const atBottom = scrollbox.scrollTop + scrollbox.clientHeight >= scrollbox.scrollHeight - 4;
    const fitsWithoutScroll = scrollbox.scrollHeight <= scrollbox.clientHeight + 4;
    if (atBottom || fitsWithoutScroll) {
      checkbox.disabled = false;
      hintEl.textContent = 'You can now check the box below.';
      hintEl.classList.add('is-done');
    }
  }

  checkbox.addEventListener('change', () => {
    signButton.disabled = !checkbox.checked;
  });

  fetch(cfg.CLA_TEXT_PATH)
    .then((r) => r.text())
    .then((markdown) => {
      textEl.innerHTML = renderMarkdown(markdown);
      initScrollGate();
    })
    .catch(() => {
      textEl.textContent = 'Unable to load the CLA text. Please refresh and try again.';
    });

  // --- Step 2: kick off GitHub OAuth when "Sign the CLA" is clicked ---
  signButton.addEventListener('click', () => {
    signButton.disabled = true;
    signButton.textContent = 'Redirecting to GitHub…';

    // state carries the repo context + a nonce through the OAuth round trip.
    const state = btoa(JSON.stringify({ repo, nonce: crypto.randomUUID() }));
    sessionStorage.setItem('cla_oauth_state', state);

    const redirectUri = window.location.origin + window.location.pathname;
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', cfg.GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'read:user');
    authorizeUrl.searchParams.set('state', state);

    window.location.href = authorizeUrl.toString();
  });

  // --- Step 3: if we just came back from GitHub, finish the sign-up ---
  const code = params.get('code');
  const returnedState = params.get('state');
  if (code && returnedState) {
    finishSigning(code, returnedState);
  }

  function finishSigning(code, returnedState) {
    document.querySelector('.cla-page__scrollbox').style.display = 'none';
    document.querySelector('.cla-page__scroll-hint').style.display = 'none';
    document.querySelector('.cla-page__checkbox').style.display = 'none';
    signButton.style.display = 'none';

    const expectedState = sessionStorage.getItem('cla_oauth_state');
    if (!expectedState || expectedState !== returnedState) {
      showStatus('This sign-in link is invalid or expired. Please start over.', 'error');
      return;
    }

    showStatus('Finishing up — verifying your GitHub account…');

    let repoFromState = '';
    try {
      repoFromState = JSON.parse(atob(returnedState)).repo || '';
    } catch (e) {
      // Ignore — repo is display-only.
    }

    fetch(cfg.WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        claVersion: cfg.CLA_VERSION,
        repo: repoFromState,
      }),
    })
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        sessionStorage.removeItem('cla_oauth_state');
        if (!ok) {
          showStatus(body.error || 'Something went wrong signing the CLA. Please try again.', 'error');
          return;
        }
        const who = body.login ? `@${body.login}` : 'you';
        let message = `Thanks, ${who} — you've signed the CLA. You can close this tab and return to your pull request.`;
        showStatus(message, 'success');
        if (repoFromState) {
          const link = document.createElement('a');
          link.href = `https://github.com/${repoFromState}`;
          link.textContent = `Return to ${repoFromState}`;
          link.style.display = 'block';
          link.style.marginTop = '0.75rem';
          statusEl.appendChild(link);
        }
      })
      .catch(() => {
        showStatus('Could not reach the signing service. Please try again in a moment.', 'error');
      });
  }
})();

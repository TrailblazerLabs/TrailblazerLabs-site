(function () {
  function init() {
    const form = document.getElementById('pitch-form');
    if (!form) return;

    const newDiscussionUrl = 'https://github.com/TrailblazerLabs/Cohort-Applications/discussions/new';
    const category = 'pitch-an-idea';
    const submit = document.getElementById('pf-submit');
    const errorElement = document.getElementById('pf-error');
    const acknowledgments = () => [...form.querySelectorAll('input[name="ack"]')];

    function refreshSubmit() {
      submit.disabled = !acknowledgments().every((checkbox) => checkbox.checked);
    }

    function showError(message, invalidControl) {
      errorElement.textContent = message;
      errorElement.hidden = false;
      if (invalidControl) invalidControl.focus();
    }

    acknowledgments().forEach((checkbox) => checkbox.addEventListener('change', refreshSubmit));
    refreshSubmit();

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      errorElement.hidden = true;

      const username = form.elements.username.value.trim().replace(/^@/, '');
      const elevator = form.elements.elevator.value.trim();
      const problem = form.elements.problem.value.trim();
      const track = form.elements.track.value;
      const profile = form.elements.profile.value.trim();
      const firstEmpty = [...form.querySelectorAll('input[required], select[required], textarea[required]')]
        .find((control) => control.type !== 'checkbox' && !control.value.trim());

      if (firstEmpty) {
        showError('Please fill out every field before continuing.', firstEmpty);
        return;
      }
      if (!/^[A-Za-z0-9-]{1,39}$/.test(username) || username.toLowerCase() === 'me') {
        showError('Please enter your real GitHub username (for example, your-handle), not "me".', form.elements.username);
        return;
      }
      const unchecked = acknowledgments().find((checkbox) => !checkbox.checked);
      if (unchecked) {
        showError('Please confirm all four acknowledgments.', unchecked);
        return;
      }

      const acknowledgmentLines = acknowledgments().map((checkbox) => `- [x] ${checkbox.dataset.ack}`).join('\n');
      const body = [
        '## Elevator Pitch', elevator, '',
        '## Problem Statement', problem, '',
        '## Development Track', track, '',
        '## Builder Profile', profile, '',
        '## Required Acknowledgments', acknowledgmentLines, '',
        '## Submitted by', '@' + username, '',
      ].join('\n');
      const url = `${newDiscussionUrl}?category=${encodeURIComponent(category)}&title=${encodeURIComponent(elevator)}&body=${encodeURIComponent(body)}`;

      if (url.length > 8000) {
        showError('Your pitch is a bit long. Please shorten it and try again.', form.elements.problem);
        return;
      }
      window.open(url, '_blank', 'noopener');
    });
  }

  // The form markup lives in partials/pitch-form.html and is injected asynchronously
  // by js/partials.js. If it's already in the DOM (e.g. inline on some future page),
  // wire it up immediately; otherwise wait for the "all partials injected" signal.
  if (document.getElementById('pitch-form')) {
    init();
  } else {
    document.addEventListener('partials:ready', init);
  }
})();

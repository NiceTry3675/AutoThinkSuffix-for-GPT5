// Simple enable/disable toggle persisted in chrome.storage.sync
(function(){
  const checkbox = document.getElementById('toggle');
  const radios = Array.from(document.querySelectorAll('input[name="suffix"]'));

  chrome.storage.sync.get({ enabled: true, suffix: ' think harder' }, (res) => {
    checkbox.checked = !!res.enabled;
    const chosen = typeof res.suffix === 'string' ? res.suffix : ' think harder';
    const match = radios.find(r => r.value === chosen) || radios[0];
    if (match) match.checked = true;
  });

  checkbox.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: checkbox.checked });
  });

  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) {
        chrome.storage.sync.set({ suffix: r.value });
      }
    });
  });
})();

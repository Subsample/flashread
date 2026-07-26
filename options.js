/*
 * FlashRead - options.js
 * ---------------------------------------------------------------------------
 * Bindet die Formularfelder an lib/settings.js. Es gibt bewusst keinen
 * "Speichern"-Knopf: jede Aenderung wird direkt uebernommen (debounced).
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const FIELDS = {
    wpm: $('wpm'),
    chunkSize: $('chunkSize'),
    smartPauses: $('smartPauses'),
    warmup: $('warmup'),
    rememberPosition: $('rememberPosition'),
    fullscreen: $('fullscreen'),
    theme: $('theme'),
    fontSize: $('fontSize'),
    fontFamily: $('fontFamily'),
    pivotColor: $('pivotColor')
  };

  const customFontRow = $('customFontRow');
  const customFontInput = $('fontFamilyCustom');
  const savedToast = $('saved');

  // Beispielwort fuer die Vorschau
  const PREVIEW_WORD = 'Lesegeschwindigkeit';

  let current = null;
  let saveTimer = null;

  // --- Vorschau -------------------------------------------------------------

  function pivotIndex(word) {
    const len = word.length;
    if (len <= 1) return 0;
    return Math.min(Math.max(Math.round(len * 0.3), 1), len - 1);
  }

  function renderPreview(s) {
    const box = $('preview');
    box.dataset.theme = s.theme;
    box.style.setProperty('--accent', s.pivotColor);

    const word = box.querySelector('.pv-word');
    // In der Vorschau deckeln, damit lange Woerter den Kasten nicht sprengen
    word.style.fontSize = Math.min(s.fontSize, 56) + 'px';
    word.style.fontFamily = s.fontFamily;

    const p = pivotIndex(PREVIEW_WORD);
    box.querySelector('.pv-before').textContent = PREVIEW_WORD.slice(0, p);
    box.querySelector('.pv-pivot').textContent = PREVIEW_WORD.charAt(p);
    box.querySelector('.pv-after').textContent = PREVIEW_WORD.slice(p + 1);
  }

  function renderOutputs(s) {
    $('wpmOut').textContent = s.wpm + ' wpm';
    $('chunkOut').textContent = s.chunkSize === 1 ? '1 Wort' : s.chunkSize + ' Woerter';
    $('fontSizeOut').textContent = s.fontSize + ' px';
    $('pivotOut').textContent = s.pivotColor.toUpperCase();
  }

  // --- Formular <-> Settings ------------------------------------------------

  function fillForm(s) {
    FIELDS.wpm.value = s.wpm;
    FIELDS.chunkSize.value = s.chunkSize;
    FIELDS.smartPauses.checked = s.smartPauses;
    FIELDS.warmup.checked = s.warmup;
    FIELDS.rememberPosition.checked = s.rememberPosition;
    FIELDS.fullscreen.checked = s.fullscreen;
    FIELDS.theme.value = s.theme;
    FIELDS.fontSize.value = s.fontSize;
    FIELDS.pivotColor.value = toHex6(s.pivotColor);

    // Schriftart: entweder aus der Liste oder als eigene Angabe
    const known = Array.from(FIELDS.fontFamily.options).some((o) => o.value === s.fontFamily);
    if (known) {
      FIELDS.fontFamily.value = s.fontFamily;
      customFontRow.hidden = true;
    } else {
      FIELDS.fontFamily.value = '__custom__';
      customFontInput.value = s.fontFamily;
      customFontRow.hidden = false;
    }

    renderOutputs(s);
    renderPreview(s);
  }

  /** <input type="color"> versteht nur #rrggbb. */
  function toHex6(value) {
    const v = String(value).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^#[0-9a-f]{3}$/i.test(v)) {
      return '#' + v.slice(1).split('').map((c) => c + c).join('');
    }
    if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7);
    return '#ff4b4b';
  }

  function readForm() {
    const fontFamily = FIELDS.fontFamily.value === '__custom__'
      ? (customFontInput.value.trim() || window.FR_DEFAULTS.fontFamily)
      : FIELDS.fontFamily.value;

    return {
      wpm: Number(FIELDS.wpm.value),
      chunkSize: Number(FIELDS.chunkSize.value),
      smartPauses: FIELDS.smartPauses.checked,
      warmup: FIELDS.warmup.checked,
      rememberPosition: FIELDS.rememberPosition.checked,
      fullscreen: FIELDS.fullscreen.checked,
      theme: FIELDS.theme.value,
      fontSize: Number(FIELDS.fontSize.value),
      fontFamily,
      pivotColor: FIELDS.pivotColor.value
    };
  }

  function showSaved() {
    savedToast.classList.add('show');
    clearTimeout(showSaved._t);
    showSaved._t = setTimeout(() => savedToast.classList.remove('show'), 1200);
  }

  function onChange() {
    const draft = window.FRSettings.sanitize(readForm());
    current = draft;
    renderOutputs(draft);
    renderPreview(draft);

    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      current = await window.FRSettings.save(draft);
      showSaved();
    }, 250);
  }

  // --- Verdrahtung ----------------------------------------------------------

  for (const el of Object.values(FIELDS)) {
    el.addEventListener('input', onChange);
    el.addEventListener('change', onChange);
  }

  FIELDS.fontFamily.addEventListener('change', () => {
    customFontRow.hidden = FIELDS.fontFamily.value !== '__custom__';
    if (!customFontRow.hidden && !customFontInput.value) {
      customFontInput.value = window.FR_DEFAULTS.fontFamily;
    }
  });
  customFontInput.addEventListener('input', onChange);

  $('clearPositions').addEventListener('click', async () => {
    await window.FRSettings.clearPositions();
    await updatePositionCount();
    showSaved();
  });

  $('reset').addEventListener('click', async () => {
    if (!confirm('Alle Einstellungen und gespeicherten Lesepositionen zuruecksetzen?')) return;
    await window.FRSettings.clearPositions();
    const fresh = await window.FRSettings.reset();
    fillForm(fresh);
    await updatePositionCount();
    showSaved();
  });

  async function updatePositionCount() {
    const n = await window.FRSettings.countPositions();
    $('posCount').textContent = n === 0
      ? 'Aktuell sind keine Lesepositionen gespeichert.'
      : `Aktuell gespeicherte Lesepositionen: ${n}`;
  }

  // --- Start ----------------------------------------------------------------

  (async function init() {
    current = await window.FRSettings.load();
    fillForm(current);
    await updatePositionCount();
  })();
})();

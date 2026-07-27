/*
 * FlashRead - reader.js
 * ---------------------------------------------------------------------------
 * Das RSVP-Overlay. Komplett in einem Shadow DOM gekapselt, damit kein
 * Seiten-CSS hineinwirkt (und umgekehrt).
 *
 * Oeffentliche API:
 *   FlashReadReader.open(config)   - Overlay oeffnen und lesen
 *   FlashReadReader.close()        - Overlay schliessen
 *   FlashReadReader.isOpen()       - laeuft gerade eins?
 *   FlashReadReader.toast(msg)     - kurze Meldung ohne Overlay
 *
 * config = {
 *   words:        Array<{w:string, endPara:boolean}>,
 *   settings:     siehe lib/settings.js,
 *   title:        string,
 *   source:       string,           // 'Readability' | 'Auswahl' | ...
 *   resume:       {index,total}|null,
 *   onProgress:   (wordIndex) => void,
 *   onFinished:   () => void,
 *   onOpenOptions:() => void,
 *   onSaveSettings:(patch) => Promise
 * }
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  if (global.FlashReadReader) return;

  const api = global.FRAPI || global.browser || global.chrome;

  // Minimal-CSS, falls reader.css nicht geladen werden kann (sollte nicht
  // vorkommen - reader.css steht in web_accessible_resources).
  const CSS_FALLBACK = `
    .fr-root{position:fixed;inset:0;z-index:2147483647;background:#101215;color:#f2f2f2;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:system-ui,sans-serif}
    .fr-word{font-size:64px;display:grid;grid-template-columns:1fr auto 1fr;width:90vw}
    .fr-before{text-align:right}.fr-after{text-align:left}
    .fr-pivot{color:#ff4b4b}
  `;

  // --------------------------------------------------------------------------
  // Hilfsfunktionen
  // --------------------------------------------------------------------------

  /**
   * Optimal Recognition Point: der Buchstabe, auf den das Auge zielen soll.
   * Faustregel ~30 % der Wortlaenge, mindestens Position 1 (bei >1 Zeichen).
   */
  function pivotIndex(word) {
    const len = word.length;
    if (len <= 1) return 0;
    const idx = Math.round(len * 0.3);
    return Math.min(Math.max(idx, 1), len - 1);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Satzzeichen am Wortende erkennen (auch hinter Anfuehrungszeichen). */
  const RX_SENTENCE_END = /[.!?…][»"')\]]?$/;
  const RX_CLAUSE_END = /[,;:–—][»"')\]]?$/;

  /**
   * Kleiner Baum-Helfer.
   *
   * Das Overlay wird bewusst Knoten fuer Knoten aufgebaut statt ueber
   * innerHTML: Mozillas Add-on-Linter meldet jede innerHTML-Zuweisung als
   * "Unsafe assignment to innerHTML", auch bei konstanten Zeichenketten.
   * Ueber createElement/textContent kann grundsaetzlich kein Markup aus
   * Fremddaten interpretiert werden.
   *
   * @param {string} spec      "tag.klasse1.klasse2", Tag optional (Standard div)
   * @param {*}      [children] Knoten, Zeichenkette oder Feld davon
   * @param {object} [attrs]    weitere Attribute
   */
  function el(spec, children, attrs) {
    const parts = String(spec).split('.');
    const node = document.createElement(parts[0] || 'div');
    if (parts.length > 1) node.className = parts.slice(1).join(' ');
    if (attrs) {
      for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    }
    const list = Array.isArray(children) ? children : (children == null ? [] : [children]);
    for (const child of list) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  // --------------------------------------------------------------------------
  // Reader
  // --------------------------------------------------------------------------

  class Reader {
    constructor(config) {
      this.cfg = config;
      this.settings = Object.assign({}, config.settings);
      this.words = config.words;
      this.chunks = Reader.buildChunks(this.words, this.settings.chunkSize);

      this.index = 0;          // naechster anzuzeigender Chunk
      this.shown = null;       // aktuell sichtbarer Chunk
      this.playing = false;
      this.timer = null;
      this.finished = false;
      this.startedAt = 0;

      this._ownsFullscreen = false;    // haben WIR das Vollbild angefordert?
      this._pendingFullscreen = false; // Wunsch offen, wartet auf Interaktion

      this.host = null;
      this.shadow = null;
      this.el = {};
      this._ownsFullscreen = false;
      this._pendingFullscreen = false;

      this._onKeyDown = this._onKeyDown.bind(this);
      this._tick = this._tick.bind(this);
    }

    // --- Chunk-Bildung ----------------------------------------------------

    /**
     * Fasst 1-3 Woerter zu einer Anzeigeeinheit zusammen. Ein Chunk endet
     * immer spaetestens am Satz- oder Absatzende, damit Pausen sinnvoll sitzen.
     */
    static buildChunks(words, size) {
      const chunks = [];
      let i = 0;
      while (i < words.length) {
        const start = i;
        const group = [];
        for (let k = 0; k < size && i < words.length; k++) {
          const word = words[i++];
          group.push(word);
          if (word.endPara || RX_SENTENCE_END.test(word.w)) break;
        }
        const last = group[group.length - 1];
        chunks.push({
          text: group.map((g) => g.w).join(' '),
          words: group.length,
          endPara: last.endPara,
          start
        });
      }
      return chunks;
    }

    /** Letzter Chunk, der bei oder vor dem Wortindex beginnt (Binaersuche). */
    chunkIndexForWord(wordIndex) {
      let lo = 0;
      let hi = this.chunks.length - 1;
      let found = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.chunks[mid].start <= wordIndex) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return found;
    }

    // --- Timing -----------------------------------------------------------

    /** Anzeigedauer des Chunks in Millisekunden. */
    durationFor(i) {
      const chunk = this.chunks[i];
      if (!chunk) return 0;

      const perWord = 60000 / this.settings.wpm;
      let ms = perWord * chunk.words;

      if (this.settings.smartPauses) {
        // Lange Woerter brauchen mehr Zeit (ab 8 Zeichen, gedeckelt bei +60 %)
        const letters = chunk.text.replace(/[^\p{L}\p{N}]/gu, '').length;
        if (letters > 8) ms *= 1 + Math.min((letters - 8) * 0.06, 0.6);

        // Satzzeichen: Komma-Klasse ~1,3x, Satzende ~2x
        if (RX_SENTENCE_END.test(chunk.text)) ms *= 2.0;
        else if (RX_CLAUSE_END.test(chunk.text)) ms *= 1.3;

        // Absatzwechsel bekommt zusaetzlich Luft
        if (chunk.endPara) ms *= 1.6;
      }

      // Sanfter Start: die ersten 5 Chunks langsamer (2,2x -> 1,0x)
      if (this.settings.warmup && i < 5) ms *= 2.2 - i * 0.3;

      return Math.max(40, ms);
    }

    /** Grobe Restzeit-Schaetzung in Sekunden. */
    remainingSeconds() {
      const wordsLeft = this.words.length - this.currentWordIndex();
      const factor = this.settings.smartPauses ? 1.18 : 1.0;
      return (wordsLeft / this.settings.wpm) * 60 * factor;
    }

    /**
     * Index des Wortes, das gerade zu sehen ist. Bewusst `shown` und nicht
     * `index` - `index` zeigt schon auf den naechsten Chunk, sonst liefen
     * Anzeige und gespeicherte Leseposition eine Einheit voraus.
     */
    currentWordIndex() {
      const i = this.shown != null ? this.shown : this.index;
      const chunk = this.chunks[Math.min(i, this.chunks.length - 1)];
      return chunk ? chunk.start : 0;
    }

    // --- DOM --------------------------------------------------------------

    async mount() {
      this.host = document.createElement('div');
      this.host.id = 'flashread-host';
      // Der Host selbst bekommt nur das Noetigste - alles Weitere im Shadow.
      this.host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
      this.shadow = this.host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = await Reader.loadCss();
      this.shadow.appendChild(style);

      const root = document.createElement('div');
      root.className = 'fr-root';
      root.tabIndex = -1;
      Reader.buildInto(root);
      this.shadow.appendChild(root);

      const $ = (sel) => this.shadow.querySelector(sel);
      this.el = {
        root,
        title: $('.fr-title'),
        source: $('.fr-source'),
        word: $('.fr-word'),
        before: $('.fr-before'),
        pivot: $('.fr-pivot'),
        after: $('.fr-after'),
        context: $('.fr-context'),
        paraFlash: $('.fr-para'),
        barFill: $('.fr-bar-fill'),
        wpm: $('.fr-wpm'),
        slider: $('.fr-slider'),
        pos: $('.fr-pos'),
        remain: $('.fr-remain'),
        state: $('.fr-state'),
        resume: $('.fr-resume'),
        resumeText: $('.fr-resume-text')
      };

      this.applySettings();
      this.bindUi();

      (document.body || document.documentElement).appendChild(this.host);
      root.focus();

      // Seiten-Scrollen unterbinden, alten Wert merken
      this._prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';

      // Echter DOM-Zugriff -> `window`, nicht der Sandbox-Global.
      window.addEventListener('keydown', this._onKeyDown, true);

      // Verlaesst der Nutzer das Vollbild ueber F11 oder Esc des Browsers,
      // soll der Knopf das widerspiegeln.
      this._onFsChange = () => {
        this.el.root.classList.toggle('is-fullscreen', this.isFullscreen());
      };
      document.addEventListener('fullscreenchange', this._onFsChange);

      // Engines ohne Promise-Rueckgabe melden die Ablehnung nur hierueber.
      this._onFsError = () => {
        this._pendingFullscreen = true;
        console.debug('[FlashRead] Vollbild abgelehnt - wird bei der ersten Interaktion nachgeholt.');
      };
      document.addEventListener('fullscreenerror', this._onFsError);

      if (this.settings.fullscreen) await this.enterFullscreen();
    }

    static async loadCss() {
      const url = api && api.runtime && api.runtime.getURL
        ? api.runtime.getURL('reader.css')
        : null;
      if (!url) return CSS_FALLBACK;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.text();
      } catch (err) {
        console.warn('[FlashRead] reader.css konnte nicht geladen werden:', err);
        return CSS_FALLBACK;
      }
    }

    /**
     * Baut den Overlay-Baum Knoten fuer Knoten auf und haengt ihn an `root`.
     * Bewusst ohne innerHTML - siehe Kommentar bei el().
     */
    static buildInto(root) {
      const btn = (act, title, label) =>
        el('button.fr-icon-btn', label, { 'data-act': act, title });

      root.appendChild(el('div.fr-head', [
        el('div.fr-brand', [el('span.fr-dot'), 'FlashRead']),
        el('div.fr-title'),
        el('div.fr-head-right', [
          el('span.fr-source'),
          btn('fullscreen', 'Vollbild (F)', '⛶'),
          btn('options', 'Einstellungen', '⚙'),
          btn('close', 'Schliessen (Esc)', '✕')
        ])
      ]));

      root.appendChild(el('div.fr-stage', [
        el('div.fr-guide.fr-guide-top', el('i.fr-tick')),
        el('div.fr-word', [el('span.fr-before'), el('span.fr-pivot'), el('span.fr-after')]),
        el('div.fr-guide.fr-guide-bottom', el('i.fr-tick')),
        el('div.fr-context'),
        el('div.fr-para', '¶')
      ]));

      const slider = el('input.fr-slider', null, {
        type: 'range', min: '100', max: '1000', step: '25', 'aria-label': 'Tempo'
      });

      const hint = (key, text) => [el('b', key), ' ' + text + ' · '];

      root.appendChild(el('div.fr-foot', [
        el('div.fr-bar', el('div.fr-bar-fill')),
        el('div.fr-meta', [
          el('div.fr-meta-left', [
            el('button.fr-btn', el('span.fr-state', 'Pause'), { 'data-act': 'toggle' }),
            el('button.fr-btn', '← 10', { 'data-act': 'back', title: '10 Woerter zurueck' }),
            el('button.fr-btn', '10 →', { 'data-act': 'fwd', title: '10 Woerter vor' })
          ]),
          el('div.fr-meta-center', [slider, el('span.fr-wpm', '350 wpm')]),
          el('div.fr-meta-right', [
            el('span.fr-pos', '0 / 0'),
            el('span.fr-sep', '·'),
            el('span.fr-remain', '0:00')
          ])
        ]),
        el('div.fr-hint', [].concat(
          hint('Leertaste', 'Pause/Weiter'),
          hint('← →', '10 Woerter'),
          hint('↑ ↓', 'Tempo ±25'),
          hint('F', 'Vollbild'),
          [el('b', 'Esc'), ' schliessen']
        ))
      ]));

      root.appendChild(el('div.fr-resume', el('div.fr-resume-box', [
        el('h2', 'Weiterlesen?'),
        el('p.fr-resume-text'),
        el('div.fr-resume-actions', [
          el('button.fr-btn.fr-btn-primary', 'Fortsetzen', { 'data-act': 'resume' }),
          el('button.fr-btn', 'Von vorn', { 'data-act': 'restart' })
        ])
      ]), { hidden: '' }));
    }

    applySettings() {
      const s = this.settings;
      const root = this.el.root;
      root.dataset.theme = s.theme;
      root.style.setProperty('--fr-font-size', s.fontSize + 'px');
      root.style.setProperty('--fr-font-family', s.fontFamily);
      root.style.setProperty('--fr-pivot-color', s.pivotColor);
      this.el.slider.value = String(s.wpm);
      this.el.wpm.textContent = s.wpm + ' wpm';
    }

    bindUi() {
      this.shadow.addEventListener('click', (ev) => {
        // Jeder Klick im Overlay ist eine Nutzeraktivierung in der Seite -
        // damit laesst sich ein abgelehntes Vollbild nachtraeglich einloesen.
        this._consumePendingFullscreen();

        const btn = ev.target.closest('[data-act]');
        if (!btn) return;
        ev.stopPropagation();
        switch (btn.dataset.act) {
          case 'close': this.destroy(); break;
          case 'fullscreen': this.toggleFullscreen(); break;
          case 'options': this.cfg.onOpenOptions && this.cfg.onOpenOptions(); break;
          case 'toggle': this.toggle(); break;
          case 'back': this.seek(-10); break;
          case 'fwd': this.seek(10); break;
          case 'resume': this.hideResume(this.cfg.resume.index); break;
          case 'restart': this.hideResume(0); break;
        }
      });

      // Klick auf die Buehne pausiert / setzt fort
      this.el.root.querySelector('.fr-stage').addEventListener('click', () => this.toggle());

      this.el.slider.addEventListener('input', () => {
        this.setWpm(Number(this.el.slider.value), false);
      });
      this.el.slider.addEventListener('change', () => {
        this.persistWpm();
      });
    }

    // --- Steuerung --------------------------------------------------------

    start() {
      if (this.cfg.resume) {
        const r = this.cfg.resume;
        const pct = Math.round((r.index / Math.max(1, r.total)) * 100);
        this.el.resumeText.textContent =
          `Du warst bei Wort ${r.index} von ${r.total} (${pct} %).`;
        this.el.resume.hidden = false;
        this.shown = this.chunkIndexForWord(r.index);
        this.index = this.shown;
        this.renderChunk(this.shown, true);
        this.updateFooter();
        return;
      }
      this.play();
    }

    hideResume(wordIndex) {
      this.el.resume.hidden = true;
      this.index = this.chunkIndexForWord(wordIndex);
      this.el.root.focus();
      this.play();
    }

    play() {
      if (this.finished) return;
      this.playing = true;
      this.el.state.textContent = 'Pause';
      this.el.root.classList.remove('is-paused');
      this.el.context.textContent = '';
      this.startedAt = Date.now();
      this._tick();
    }

    pause() {
      this.playing = false;
      clearTimeout(this.timer);
      this.timer = null;
      this.el.state.textContent = 'Weiter';
      this.el.root.classList.add('is-paused');
      this.showContext();
      this.reportProgress();
    }

    toggle() {
      if (!this.el.resume.hidden) return;   // Startdialog ist offen
      if (this.finished) { this.index = 0; this.finished = false; this.play(); return; }
      this.playing ? this.pause() : this.play();
    }

    _tick() {
      if (!this.playing) return;
      if (this.index >= this.chunks.length) return this.finish();

      this.shown = this.index;
      this.renderChunk(this.index);
      const delay = this.durationFor(this.index);
      this.index++;
      this.updateFooter();

      // alle ~40 Chunks die Position sichern
      if (this.index % 40 === 0) this.reportProgress();

      this.timer = setTimeout(this._tick, delay);
    }

    finish() {
      this.playing = false;
      this.finished = true;
      clearTimeout(this.timer);
      this.el.state.textContent = 'Nochmal';
      this.el.root.classList.add('is-paused');
      this.setWord('Fertig');
      this.el.context.textContent = `${this.words.length} Woerter gelesen.`;
      this.updateFooter();
      this.cfg.onFinished && this.cfg.onFinished();
    }

    seek(deltaWords) {
      const from = this.chunks[Math.min(this.shown != null ? this.shown : this.index, this.chunks.length - 1)].start;
      const target = Math.max(0, Math.min(this.words.length - 1, from + deltaWords));
      this.index = this.chunkIndexForWord(target);
      this.shown = this.index;
      this.finished = false;
      clearTimeout(this.timer);

      if (this.playing) {
        this._tick();                 // sofort neu anzeigen, Timing neu starten
      } else {
        this.renderChunk(this.index, true);
        this.showContext();
      }
      this.updateFooter();
      this.reportProgress();
    }

    setWpm(value, updateSlider = true) {
      this.settings.wpm = Math.min(1000, Math.max(100, Math.round(value / 25) * 25));
      this.el.wpm.textContent = this.settings.wpm + ' wpm';
      if (updateSlider) this.el.slider.value = String(this.settings.wpm);
      this.updateFooter();
    }

    persistWpm() {
      this.cfg.onSaveSettings && this.cfg.onSaveSettings({ wpm: this.settings.wpm });
    }

    reportProgress() {
      this.cfg.onProgress && this.cfg.onProgress(this.currentWordIndex());
    }

    // --- Rendering --------------------------------------------------------

    /** Zeigt den Chunk mit rot markiertem Pivot an der festen Mittelachse. */
    renderChunk(i, silent = false) {
      const chunk = this.chunks[i];
      if (!chunk) return;
      this.setWord(chunk.text);
      if (!silent && chunk.endPara) this.flashParagraph();
    }

    setWord(textValue) {
      const p = pivotIndex(textValue);
      this.el.before.textContent = textValue.slice(0, p);
      this.el.pivot.textContent = textValue.charAt(p);
      this.el.after.textContent = textValue.slice(p + 1);

      // Sehr lange Woerter (oder 3er-Chunks) stufenweise verkleinern, damit
      // sie nicht ueber den Bildschirmrand hinauslaufen. Die Blickachse
      // bleibt davon unberuehrt.
      const len = textValue.length;
      const scale = len > 26 ? 0.55 : len > 20 ? 0.7 : len > 15 ? 0.85 : 1;
      this.el.word.style.setProperty('--fr-word-scale', String(scale));
    }

    flashParagraph() {
      const node = this.el.paraFlash;
      node.classList.remove('is-on');
      // Reflow erzwingen, damit die Animation erneut startet
      void node.offsetWidth;
      node.classList.add('is-on');
    }

    /** Bei Pause: die letzten ~5 Woerter als normalen Satz zeigen. */
    showContext() {
      const i = Math.min(this.shown != null ? this.shown : this.index, this.chunks.length - 1);
      const chunk = this.chunks[i];
      if (!chunk) return;
      const end = Math.min(this.words.length, chunk.start + chunk.words);
      const begin = Math.max(0, end - 5);
      this.el.context.textContent = this.words.slice(begin, end).map((w) => w.w).join(' ');
    }

    updateFooter() {
      const total = this.words.length;
      // Am Ende auf 100 % aufrunden, sonst bliebe der letzte Chunk offen.
      const wordIndex = this.finished ? total : Math.min(this.currentWordIndex(), total);
      const pct = total ? (wordIndex / total) * 100 : 0;
      this.el.barFill.style.width = pct.toFixed(2) + '%';
      this.el.pos.textContent = `${wordIndex} / ${total}`;
      this.el.remain.textContent = formatTime(this.remainingSeconds()) + ' verbleibend';
    }

    // --- Tastatur ---------------------------------------------------------

    _onKeyDown(ev) {
      if (!this.host || !this.host.isConnected) return;

      const keys = [' ', 'Spacebar', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', 'F'];
      if (!keys.includes(ev.key)) return;

      // Erste Taste im Overlay zaehlt als Nutzeraktivierung -> falls das
      // Vollbild beim Oeffnen abgelehnt wurde, jetzt nachholen.
      this._consumePendingFullscreen();

      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

      switch (ev.key) {
        case 'Escape':
          this.destroy();
          break;
        case ' ':
        case 'Spacebar':
          this.toggle();
          break;
        case 'ArrowLeft':
          this.seek(-10);
          break;
        case 'ArrowRight':
          this.seek(10);
          break;
        case 'ArrowUp':
          this.setWpm(this.settings.wpm + 25);
          this.persistWpm();
          break;
        case 'ArrowDown':
          this.setWpm(this.settings.wpm - 25);
          this.persistWpm();
          break;
        case 'f':
        case 'F':
          this.toggleFullscreen();
          break;
      }
    }

    // --- Vollbild ---------------------------------------------------------

    isFullscreen() {
      return document.fullscreenElement === this.host;
    }

    /**
     * Vollbild anfordern.
     *
     * Achtung: requestFullscreen verlangt eine "transiente Nutzeraktivierung"
     * IN DER SEITE. Ein Klick auf das Toolbar-Icon oder Alt+R findet in der
     * Browser-Oberflaeche statt und zaehlt dafuer nicht - der erste Versuch
     * beim Oeffnen wird deshalb je nach Browser abgelehnt. In dem Fall merken
     * wir uns den Wunsch und loesen ihn bei der ersten echten Interaktion im
     * Overlay ein (Klick oder Tastendruck), also praktisch sofort.
     */
    async enterFullscreen() {
      if (!this.host || this.isFullscreen()) return true;
      if (typeof this.host.requestFullscreen !== 'function') return false;

      try {
        // Der Options-Parameter wird von aelteren Engines schlicht ignoriert.
        const result = this.host.requestFullscreen({ navigationUI: 'hide' });
        // Aeltere Firefox-Versionen liefern hier `undefined` statt eines
        // Promise - Fehler kommen dort nur als `fullscreenerror`-Event, das
        // in mount() mitgehoert wird.
        if (result && typeof result.then === 'function') await result;
        this._ownsFullscreen = true;
        this._pendingFullscreen = false;
        return true;
      } catch (err) {
        this._pendingFullscreen = true;
        console.debug('[FlashRead] Vollbild braucht eine Interaktion in der Seite:', err && err.message);
        return false;
      }
    }

    async exitFullscreen() {
      this._pendingFullscreen = false;
      if (!this.isFullscreen()) return;
      if (typeof document.exitFullscreen !== 'function') return;
      try {
        const result = document.exitFullscreen();
        if (result && typeof result.then === 'function') await result;
      } catch (err) {
        console.debug('[FlashRead] Vollbild konnte nicht beendet werden:', err);
      }
      this._ownsFullscreen = false;
    }

    toggleFullscreen() {
      if (this.isFullscreen()) this.exitFullscreen();
      else this.enterFullscreen();
    }

    /** Beim ersten Klick/Tastendruck den aufgeschobenen Wunsch einloesen. */
    _consumePendingFullscreen() {
      if (!this._pendingFullscreen) return;
      this._pendingFullscreen = false;
      this.enterFullscreen();
    }

    // --- Abbau ------------------------------------------------------------

    destroy() {
      clearTimeout(this.timer);
      this.timer = null;
      this.playing = false;
      this._pendingFullscreen = false;

      window.removeEventListener('keydown', this._onKeyDown, true);
      if (this._onFsChange) document.removeEventListener('fullscreenchange', this._onFsChange);
      if (this._onFsError) document.removeEventListener('fullscreenerror', this._onFsError);

      // Vollbild nur beenden, wenn WIR es angefordert haben - war die Seite
      // vorher schon im Vollbild (z. B. ein Video), bleibt sie es.
      if (this.isFullscreen()) {
        document.exitFullscreen().catch(() => { /* egal, Overlay geht trotzdem */ });
      }
      this._ownsFullscreen = false;

      document.documentElement.style.overflow = this._prevOverflow || '';
      if (!this.finished) this.reportProgress();
      if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
      this.host = null;
      global.__flashreadInstance = null;
    }
  }

  // --------------------------------------------------------------------------
  // Oeffentliche API
  // --------------------------------------------------------------------------

  const FlashReadReader = {
    async open(config) {
      if (global.__flashreadInstance) global.__flashreadInstance.destroy();
      const reader = new Reader(config);
      global.__flashreadInstance = reader;
      await reader.mount();
      reader.el.title.textContent = config.title || '';
      reader.el.source.textContent = config.source || '';
      reader.updateFooter();
      reader.start();
      return reader;
    },

    close() {
      if (global.__flashreadInstance) global.__flashreadInstance.destroy();
    },

    isOpen() {
      return !!(global.__flashreadInstance && global.__flashreadInstance.host);
    },

    /** Kurze Statusmeldung, wenn gar kein Text gefunden wurde. */
    toast(message) {
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;';
      const shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent =
        '.t{font:14px/1.4 system-ui,sans-serif;background:#1c1f24;color:#f0f0f0;' +
        'padding:12px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.45);' +
        'border:1px solid #33383f;max-width:340px}';
      shadow.appendChild(style);
      shadow.appendChild(el('div.t', message));

      (document.body || document.documentElement).appendChild(host);
      setTimeout(() => host.remove(), 4000);
    }
  };

  global.FlashReadReader = FlashReadReader;

// `globalThis` statt `window` - siehe Hinweis in lib/settings.js (Firefox-Xray).
// DOM-Zugriffe im Code oben benutzen weiterhin bewusst `window` und `document`.
})(globalThis);

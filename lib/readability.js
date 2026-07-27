/*
 * FlashRead - lib/readability.js
 * ---------------------------------------------------------------------------
 * Lokale, abhaengigkeitsfreie Implementierung des Readability-Algorithmus
 * (Kandidaten-Scoring nach Absatzlaenge, Kommazahl, Klassen-/ID-Gewichtung und
 * Link-Dichte, anschliessend Einsammeln passender Geschwister-Knoten).
 *
 * Die oeffentliche API ist absichtlich identisch zu Mozillas Readability.js:
 *
 *     const article = new Readability(document.cloneNode(true)).parse();
 *     // -> { title, byline, length, excerpt, content, textContent } | null
 *
 * Dadurch kannst du diese Datei jederzeit 1:1 durch das Original ersetzen
 * (siehe README, Abschnitt "Readability austauschen") - der restliche Code
 * bleibt unveraendert.
 *
 * Kein Netzwerkzugriff, keine externen Abhaengigkeiten.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // --- Regex-Heuristiken (an Mozillas Original angelehnt) -------------------
  const RX = {
    // Container, die fast nie Artikeltext enthalten
    unlikely: /-ad-|ai2html|banner|breadcrumb|combx|comment|community|cookie|consent|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|newsletter|share|promo|masthead|nav-|-nav|subscribe|paywall/i,
    // ... ausser sie sehen trotzdem nach Inhalt aus
    maybe: /and|article|body|column|content|main|shadow|post|entry|story|text|hentry/i,
    positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story|prose|markdown/i,
    negative: /-ad-|hidden|^hid$|banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget|tool|social|newsletter|cookie|consent|nav|menu|byline|caption/i,
    whitespace: /\s+/g,
    hasContent: /\S/
  };

  // Tags, die als Text-Kandidaten gewertet werden
  const SCORE_TAGS = new Set(['P', 'TD', 'PRE', 'BLOCKQUOTE', 'ARTICLE', 'SECTION', 'DIV', 'LI', 'H2', 'H3']);

  // Tags, die beim Aufraeumen komplett verschwinden
  const STRIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
    'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA',
    'BUTTON', 'NAV', 'FOOTER', 'ASIDE', 'HEADER', 'DIALOG', 'MENU'
  ]);

  // Blockelemente -> erzeugen im Textexport einen Absatzumbruch
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'FIGCAPTION', 'UL', 'OL', 'DD', 'DT',
    'TABLE', 'HR', 'MAIN', 'ADDRESS'
  ]);

  const MIN_CONTENT_LENGTH = 250;   // darunter gilt der Treffer als Fehlschlag
  const MIN_PARAGRAPH_LENGTH = 25;  // kuerzere Knoten werden nicht gescored

  // --- kleine Helfer -------------------------------------------------------

  /*
   * Gemessener Text pro Knoten, zwischengespeichert.
   *
   * Jeder Kandidat wird mehrfach vermessen: beim Einsammeln, beim Bepunkten,
   * in linkDensity() und in der Geschwister-Schleife. Ohne Cache serialisiert
   * jeder dieser Aufrufe den Teilbaum erneut.
   *
   * Gemessen bringt das rund 10 Prozent (6000 Absaetze: 229 ms -> 207 ms) -
   * spuerbar wird es vor allem bei tief verschachtelten Containern, deren
   * Teilbaum gross ist. Kein dramatischer Gewinn, aber fuer zehn Zeilen
   * mitgenommen.
   *
   * Der Cache ist gueltig, weil nach _prepareDocument() nicht mehr am Baum
   * veraendert wird; parse() setzt ihn zu Beginn jedes Laufs zurueck.
   */
  let textCache = new WeakMap();

  function text(node) {
    let value = textCache.get(node);
    if (value === undefined) {
      value = (node.textContent || '').replace(RX.whitespace, ' ').trim();
      textCache.set(node, value);
    }
    return value;
  }

  function attrSignature(node) {
    return `${node.className || ''} ${node.id || ''}`;
  }

  /** Klassen-/ID-Gewichtung: positive Namen belohnen, negative bestrafen. */
  function classWeight(node) {
    let weight = 0;
    const sig = attrSignature(node);
    if (RX.negative.test(sig)) weight -= 25;
    if (RX.positive.test(sig)) weight += 25;
    // semantische Auszeichnung ist ein starkes Signal
    const role = node.getAttribute && node.getAttribute('role');
    if (role === 'main' || role === 'article') weight += 25;
    if (node.getAttribute && node.getAttribute('itemprop') === 'articleBody') weight += 40;
    return weight;
  }

  /** Anteil des Textes, der in Links steckt (0..1). Hohe Werte = Navigation. */
  function linkDensity(node) {
    const total = text(node).length;
    if (!total) return 0;
    let linked = 0;
    for (const a of node.getElementsByTagName('a')) {
      const href = a.getAttribute('href') || '';
      // reine Sprungmarken zaehlen nur zu einem Viertel
      const factor = /^#/.test(href) ? 0.25 : 1;
      linked += text(a).length * factor;
    }
    return linked / total;
  }

  /** Startwert eines Kandidaten je nach Tag. */
  function initialScore(node) {
    switch (node.tagName) {
      case 'ARTICLE': return 10;
      case 'MAIN': return 8;
      case 'DIV': return 5;
      case 'SECTION':
      case 'PRE':
      case 'TD':
      case 'BLOCKQUOTE': return 3;
      case 'ADDRESS':
      case 'OL':
      case 'UL':
      case 'DL':
      case 'DD':
      case 'DT':
      case 'LI':
      case 'FORM': return -3;
      case 'H1': case 'H2': case 'H3':
      case 'H4': case 'H5': case 'H6':
      case 'TH': return -5;
      default: return 0;
    }
  }

  /** Enthaelt der Knoten selbst wieder Blockelemente? Dann ist er ein Container. */
  function hasBlockChildren(node) {
    for (const child of node.children) {
      if (BLOCK_TAGS.has(child.tagName) && child.tagName !== 'BR') return true;
    }
    return false;
  }

  /** Ist das Element per CSS/Attribut versteckt? */
  function isHidden(node) {
    if (node.hasAttribute && (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true')) return true;
    const style = node.getAttribute && node.getAttribute('style');
    return !!style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
  }

  /**
   * Wandelt einen DOM-Teilbaum in Fliesstext um. Blockelemente erzeugen
   * Absatzgrenzen ("\n\n"), <br> einen einfachen Umbruch.
   */
  function toPlainText(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {                       // Textknoten
        out += child.nodeValue.replace(RX.whitespace, ' ');
      } else if (child.nodeType === 1) {                // Element
        const tag = child.tagName;
        if (STRIP_TAGS.has(tag)) continue;
        if (tag === 'BR') { out += '\n'; continue; }
        const inner = toPlainText(child);
        if (!RX.hasContent.test(inner)) continue;
        out += BLOCK_TAGS.has(tag) ? `\n\n${inner.trim()}\n\n` : inner;
      }
    }
    return out;
  }

  function normalizeText(raw) {
    return raw
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // --- Hauptklasse ---------------------------------------------------------

  /**
   * @param {Document} doc  Am besten eine Kopie: document.cloneNode(true)
   * @param {object}  [options]  { charThreshold?: number }
   */
  function Readability(doc, options) {
    this._doc = doc;
    this._options = Object.assign({ charThreshold: MIN_CONTENT_LENGTH }, options || {});
  }

  Readability.prototype._getTitle = function () {
    const doc = this._doc;
    const og = doc.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
    if (og && og.getAttribute('content')) return og.getAttribute('content').trim();
    const h1 = doc.querySelector('article h1, main h1, h1');
    if (h1 && text(h1).length > 3) return text(h1);
    return (doc.title || '').trim();
  };

  Readability.prototype._getByline = function () {
    const doc = this._doc;
    const meta = doc.querySelector('meta[name="author"], meta[property="article:author"]');
    if (meta && meta.getAttribute('content')) return meta.getAttribute('content').trim();
    const el = doc.querySelector('[rel="author"], .byline, .author, [itemprop="author"]');
    const value = el ? text(el) : '';
    return value && value.length < 120 ? value : null;
  };

  /** Entfernt Muell und offensichtliche Nicht-Inhalte aus der Kopie. */
  Readability.prototype._prepareDocument = function () {
    const doc = this._doc;

    for (const el of Array.from(doc.querySelectorAll('*'))) {
      if (!el.parentNode) continue;                    // schon mit entfernt

      if (STRIP_TAGS.has(el.tagName)) { el.remove(); continue; }
      if (isHidden(el)) { el.remove(); continue; }

      const sig = attrSignature(el);
      if (sig.length > 2 && RX.unlikely.test(sig) && !RX.maybe.test(sig)
          && el.tagName !== 'BODY' && el.tagName !== 'HTML' && el.tagName !== 'ARTICLE') {
        el.remove();
      }
    }
  };

  /** Sammelt alle Knoten, die als Textkandidaten in Frage kommen. */
  Readability.prototype._collectCandidates = function () {
    const doc = this._doc;
    const body = doc.body || doc.documentElement;
    const nodes = [];

    for (const el of body.querySelectorAll('p, td, pre, li, blockquote, div, section, h2, h3')) {
      if (!SCORE_TAGS.has(el.tagName)) continue;
      // Container ueberspringen - gescored wird der Knoten, der Text *direkt* traegt
      if ((el.tagName === 'DIV' || el.tagName === 'SECTION') && hasBlockChildren(el)) continue;
      if (text(el).length < MIN_PARAGRAPH_LENGTH) continue;
      nodes.push(el);
    }
    return nodes;
  };

  Readability.prototype._grabArticle = function () {
    const scores = new Map();   // Element -> Punktzahl

    const bump = (node, amount) => {
      if (!node || node.nodeType !== 1) return;
      if (!scores.has(node)) scores.set(node, initialScore(node) + classWeight(node));
      scores.set(node, scores.get(node) + amount);
    };

    for (const node of this._collectCandidates()) {
      const content = text(node);
      // Basispunkte: Existenz + Kommas (Satzbau) + Laenge, gedeckelt
      let score = 1;
      score += (content.match(/[,،，、]/g) || []).length;
      score += Math.min(Math.floor(content.length / 100), 3);

      // Punkte an Eltern, Grosseltern und Urgrosseltern verteilen
      let ancestor = node;
      for (let level = 0; level < 4 && ancestor; level++) {
        const divider = level === 0 ? 1 : level === 1 ? 2 : level * 3;
        bump(ancestor, score / divider);
        ancestor = ancestor.parentElement;
        if (ancestor && (ancestor.tagName === 'BODY' || ancestor.tagName === 'HTML')) break;
      }
    }

    // Link-Dichte einrechnen und Sieger bestimmen
    let best = null;
    let bestScore = 0;
    for (const [node, raw] of scores) {
      const finalScore = raw * (1 - linkDensity(node));
      scores.set(node, finalScore);
      if (finalScore > bestScore) { bestScore = finalScore; best = node; }
    }

    if (!best) return null;

    // Geschwister mit aehnlichem Profil dazunehmen (mehrteilige Artikel)
    const threshold = Math.max(10, bestScore * 0.2);
    const container = this._doc.createElement('div');
    const parent = best.parentElement;
    const siblings = parent ? Array.from(parent.children) : [best];

    for (const sibling of siblings) {
      let keep = sibling === best;
      if (!keep && scores.has(sibling) && scores.get(sibling) >= threshold) keep = true;
      if (!keep && sibling.tagName === 'P') {
        const len = text(sibling).length;
        const density = linkDensity(sibling);
        if ((len > 80 && density < 0.25) || (len > 0 && len < 80 && density === 0 && /\.( |$)/.test(text(sibling)))) {
          keep = true;
        }
      }
      if (keep) container.appendChild(sibling.cloneNode(true));
    }

    return container.childElementCount ? container : best;
  };

  /**
   * Fuehrt die Extraktion aus.
   * @returns {{title:string, byline:?string, length:number, excerpt:string,
   *            content:string, textContent:string}|null}
   */
  Readability.prototype.parse = function () {
    try {
      textCache = new WeakMap();     // Cache pro Lauf, siehe text()

      const title = this._getTitle();
      const byline = this._getByline();

      this._prepareDocument();

      // Bevorzugt: explizit ausgezeichneter Artikel-Container
      const semantic = this._doc.querySelector('article, [itemprop="articleBody"], main article, [role="main"] article');
      let article = null;

      if (semantic && text(semantic).length >= this._options.charThreshold) {
        article = semantic;
      } else {
        article = this._grabArticle();
      }
      if (!article) return null;

      const textContent = normalizeText(toPlainText(article));
      if (textContent.length < this._options.charThreshold) return null;

      return {
        title,
        byline,
        length: textContent.length,
        excerpt: textContent.slice(0, 250),
        textContent,
        // `content` gehoert zur Readability-API, wird von FlashRead aber nicht
        // gebraucht. Als Getter, damit die HTML-Serialisierung des ganzen
        // Artikels nur anfaellt, wenn jemand sie wirklich abruft.
        get content() { return article.innerHTML; }
      };
    } catch (err) {
      console.warn('[FlashRead] Readability fehlgeschlagen:', err);
      return null;
    }
  };

  // --- Zusatzhelfer fuer die Fallback-Heuristik in content.js --------------

  Readability.linkDensity = linkDensity;

  /**
   * Wie toPlainText, raeumt aber vorher auf einer Kopie auf: entfernt
   * Skripte, versteckte Knoten und Container, die nach Werbung, Kommentaren,
   * Navigation o. ae. aussehen. Fuer den Fallback-Pfad, der auf dem *lebenden*
   * DOM arbeitet und dort nichts loeschen darf.
   */
  Readability.cleanTextFrom = function (node) {
    const clone = node.cloneNode(true);
    for (const el of Array.from(clone.querySelectorAll('*'))) {
      if (!el.parentNode) continue;
      if (STRIP_TAGS.has(el.tagName) || isHidden(el)) { el.remove(); continue; }
      const sig = attrSignature(el);
      if (sig.length > 2 && RX.unlikely.test(sig) && !RX.maybe.test(sig)) el.remove();
    }
    return normalizeText(toPlainText(clone));
  };

  global.Readability = Readability;

// `globalThis` statt `window` - siehe Hinweis in lib/settings.js (Firefox-Xray).
})(globalThis);

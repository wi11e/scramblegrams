// bg-tile — single letter tile
// Letter rendered via CSS `content: attr(letter)` — avoids DOM manipulation in constructor.
class BgTile extends HTMLElement {
  static observedAttributes = ['state'];

  attributeChangedCallback(_, __, val) { this.dataset.state = val || 'unclaimed'; }
  connectedCallback()                  { this.dataset.state = this.getAttribute('state') || 'unclaimed'; }
}
customElements.define('bg-tile', BgTile);

// bg-tile-rack — unclaimed pool; tiles support tap and drag-to-tray
class BgTileRack extends HTMLElement {
  constructor() {
    super();
    this._drag = null;
  }

  setTiles(tiles, cap = 10) {
    this.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'rack-label';
    label.textContent = `Pool  ${tiles.length} / ${cap}`;
    this.appendChild(label);

    const row = document.createElement('div');
    row.className = 'rack-row';

    if (tiles.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'rack-empty';
      empty.textContent = 'Draw a tile to begin';
      row.appendChild(empty);
    } else {
      for (const tile of tiles) {
        const el = document.createElement('bg-tile');
        el.setAttribute('letter', tile.letter);
        el.setAttribute('state', 'unclaimed');
        el.dataset.tileId = tile.id;
        el.classList.add('tappable');
        this._addTileDrag(el, tile);
        row.appendChild(el);
      }
    }

    this.appendChild(row);
  }

  _addTileDrag(el, tile) {
    const THRESHOLD = 6;

    el.addEventListener('pointerdown', (e) => {
      if (this._drag) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      this._drag = {
        tileId:  tile.id,
        letter:  tile.letter,
        ghost:   null,
        started: false,
        startX:  e.clientX,
        startY:  e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        rect,
      };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      e.preventDefault();
      const moved = Math.abs(e.clientX - this._drag.startX) > THRESHOLD
                 || Math.abs(e.clientY - this._drag.startY) > THRESHOLD;
      if (!moved) return;

      if (!this._drag.started) {
        this._drag.started = true;
        el.style.opacity = '0.3';
        const ghost = document.createElement('div');
        ghost.className = 'tray-ghost';
        ghost.setAttribute('letter', this._drag.letter);
        Object.assign(ghost.style, {
          position: 'fixed',
          width:    `${this._drag.rect.width}px`,
          height:   `${this._drag.rect.height}px`,
          left:     `${this._drag.rect.left}px`,
          top:      `${this._drag.rect.top}px`,
          pointerEvents: 'none',
          zIndex:   '1000',
        });
        document.body.appendChild(ghost);
        this._drag.ghost = ghost;
      }
      this._drag.ghost.style.left = `${e.clientX - this._drag.offsetX}px`;
      this._drag.ghost.style.top  = `${e.clientY - this._drag.offsetY}px`;
    });

    const onEnd = (e) => {
      if (!this._drag) return;
      const { tileId, letter, ghost, started } = this._drag;
      this._drag = null;
      if (ghost) ghost.remove();
      el.style.opacity = '';

      if (!started) {
        // Tap — same as before
        this.dispatchEvent(new CustomEvent('tile-tap', {
          bubbles: true, detail: { tileId, letter },
        }));
        return;
      }

      // Drag — find drop target in sg-tray
      const trayEl = document.querySelector('sg-tray');
      if (!trayEl) return;
      const tr = trayEl.getBoundingClientRect();
      if (e.clientX < tr.left || e.clientX > tr.right ||
          e.clientY < tr.top  || e.clientY > tr.bottom) return;

      // Calculate insertion index using same logic as tray reorder
      const trayTiles = [...trayEl.querySelectorAll('.tray-tile')];
      let insertBefore = trayTiles.length;
      for (let i = 0; i < trayTiles.length; i++) {
        const r = trayTiles[i].getBoundingClientRect();
        if (e.clientY < r.top) { insertBefore = i; break; }
        if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) { insertBefore = i; break; }
      }
      this.dispatchEvent(new CustomEvent('tile-drag-to-tray', {
        bubbles: true, detail: { tileId, insertBefore },
      }));
    };

    el.addEventListener('pointerup',     onEnd);
    el.addEventListener('pointercancel', onEnd);
  }
}
customElements.define('bg-tile-rack', BgTileRack);

// bg-word — a single claimed word; dispatches word-tap on click
class BgWord extends HTMLElement {
  static observedAttributes = ['text', 'word-id'];

  connectedCallback() {
    this.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('word-tap', {
        bubbles: true,
        detail: { wordId: this.getAttribute('word-id') },
      }));
    });
    this._render();
  }

  attributeChangedCallback() { this._render(); }

  _render() {
    const text = this.getAttribute('text') || '';
    this.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'tile-row';
    for (const letter of text) {
      const el = document.createElement('bg-tile');
      el.setAttribute('letter', letter);
      el.setAttribute('state', 'claimed');
      row.appendChild(el);
    }

    const pts = document.createElement('span');
    pts.className = 'word-pts';
    pts.textContent = `+${text.length - 2}`;

    this.appendChild(row);
    this.appendChild(pts);
  }
}
customElements.define('bg-word', BgWord);

// bg-word-board — all claimed words
class BgWordBoard extends HTMLElement {
  setWords(words) {
    this.innerHTML = '';

    if (words.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'board-empty';
      msg.textContent = 'Tap tiles from your pool to build your first word';
      this.appendChild(msg);
      return;
    }

    for (const w of words) {
      const el = document.createElement('bg-word');
      el.setAttribute('word-id', w.id);
      el.setAttribute('text', w.text);
      this.appendChild(el);
    }
  }
}
customElements.define('bg-word-board', BgWordBoard);

// bg-game-header — score / timer / bag count + finish button
class BgGameHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="header-top">
        <span class="header-title">SCRAMBLEGRAMS</span>
      </div>
      <div class="header-stats">
        <div class="stat">
          <span class="stat-val" data-h="score">0</span>
          <span class="stat-lbl">Score</span>
        </div>
        <div class="stat">
          <span class="stat-val" data-h="bag">—</span>
          <span class="stat-lbl">In bag</span>
        </div>
        <div class="stat" data-h="timer-wrap">
          <span class="stat-val" data-h="time">0:00</span>
          <span class="stat-lbl" data-h="time-lbl">Elapsed</span>
        </div>
        <button class="header-finish-btn" aria-label="Finish game">
          <svg width="16" height="13" viewBox="0 0 16 13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 6.5L6 11.5L15 1.5"/>
          </svg>
        </button>
      </div>
    `;
    this.querySelector('.header-finish-btn').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('retire-click', { bubbles: true }));
    });
  }

  update({ score, seconds, bagCount, mode }) {
    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.abs(seconds) % 60;
    const time = `${mins}:${String(secs).padStart(2, '0')}`;
    const urgent = mode !== 'classical' && seconds <= 30;

    this.querySelector('[data-h="score"]').textContent    = score;
    this.querySelector('[data-h="bag"]').textContent      = bagCount;
    this.querySelector('[data-h="time"]').textContent     = time;
    this.querySelector('[data-h="time-lbl"]').textContent = mode === 'classical' ? 'Elapsed' : 'Left';
    this.querySelector('[data-h="timer-wrap"]').classList.toggle('urgent', urgent);
    this.querySelector('.header-finish-btn').classList.toggle('ready', bagCount === 0);
  }
}
customElements.define('bg-game-header', BgGameHeader);

// sg-tray — composing tray with drag-to-reorder
// Dispatches: tray-clear, tray-claim, tray-reorder {from, to}
class SgTray extends HTMLElement {
  constructor() {
    super();
    this._tiles = [];
    this._valid = false;
  }

  setTiles(tiles, valid) {
    this._tiles = [...tiles];
    this._valid = valid;
    this._render();
  }

  _render() {
    const prevScroll = this.querySelector('.tray-inner')?.scrollLeft ?? 0;
    this.innerHTML = '';

    // X / clear button
    const xBtn = document.createElement('button');
    xBtn.className = 'tray-x';
    xBtn.textContent = '✕';
    xBtn.setAttribute('aria-label', 'Clear tray');
    xBtn.hidden = this._tiles.length === 0;
    xBtn.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('tray-clear', { bubbles: true }))
    );
    this.appendChild(xBtn);

    // Scrollable tile row
    const inner = document.createElement('div');
    inner.className = 'tray-inner';

    if (this._tiles.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'tray-hint';
      hint.textContent = 'Tap tiles or words to build';
      inner.appendChild(hint);
    } else {
      this._tiles.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = `tray-tile${t.origin !== 'unclaimed' ? ' from-word' : ''}`;
        el.setAttribute('letter', t.letter);
        el.dataset.idx = i;
        inner.appendChild(el);
      });
      this._setupDrag(inner);
    }

    inner.scrollLeft = prevScroll;
    this.appendChild(inner);

    // Claim button — ✓ when valid, ○ when not
    const claimBtn = document.createElement('button');
    claimBtn.className = `tray-claim${this._valid ? ' valid' : ''}`;
    claimBtn.textContent = this._valid ? '✓' : '○';
    claimBtn.disabled = !this._valid;
    claimBtn.setAttribute('aria-label', 'Claim word');
    claimBtn.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('tray-claim', { bubbles: true }))
    );
    this.appendChild(claimBtn);
  }

  _setupDrag(container) {
    let drag = null;
    const THRESHOLD = 6;

    container.addEventListener('pointerdown', (e) => {
      const tileEl = e.target.closest('.tray-tile');
      if (!tileEl) return;
      e.preventDefault();

      const idx  = parseInt(tileEl.dataset.idx);
      const rect = tileEl.getBoundingClientRect();

      // Ghost is created lazily once the pointer moves past the drag threshold.
      // A pointer that never exceeds the threshold is treated as a tap.
      drag = {
        idx,
        tileEl,
        ghost:   null,
        started: false,
        startX:  e.clientX,
        startY:  e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        rect,
      };

      container.setPointerCapture(e.pointerId);
    });

    container.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();

      const moved = Math.abs(e.clientX - drag.startX) > THRESHOLD
                 || Math.abs(e.clientY - drag.startY) > THRESHOLD;

      if (!moved) return;

      // First move past threshold — create ghost and mark tile as dragging
      if (!drag.started) {
        drag.started = true;
        drag.tileEl.classList.add('tray-dragging');

        const ghost = document.createElement('div');
        ghost.className = `tray-ghost${drag.tileEl.classList.contains('from-word') ? ' from-word' : ''}`;
        ghost.setAttribute('letter', drag.tileEl.getAttribute('letter'));
        Object.assign(ghost.style, {
          position: 'fixed',
          width:  `${drag.rect.width}px`,
          height: `${drag.rect.height}px`,
          left:   `${drag.rect.left}px`,
          top:    `${drag.rect.top}px`,
          pointerEvents: 'none',
          zIndex: '1000',
        });
        document.body.appendChild(ghost);
        drag.ghost = ghost;
      }

      drag.ghost.style.left = `${e.clientX - drag.offsetX}px`;
      drag.ghost.style.top  = `${e.clientY - drag.offsetY}px`;
    });

    const end = (e) => {
      if (!drag) return;
      const { idx, ghost, tileEl, started } = drag;
      drag = null;

      if (ghost) ghost.remove();
      tileEl.classList.remove('tray-dragging');

      // Tap (never crossed drag threshold) — return unclaimed tiles to the rack
      if (!started) {
        this.dispatchEvent(new CustomEvent('tray-tile-tap', {
          bubbles: true,
          detail: { idx },
        }));
        return;
      }

      // Find insertion index in a 2D wrapped layout.
      // Tiles are in reading order; insert before the first tile where
      // the pointer is either (a) above its row, or (b) on its row and left of its centre.
      const allTiles = [...container.querySelectorAll('.tray-tile')];
      let toIdx = allTiles.length;
      for (let i = 0; i < allTiles.length; i++) {
        if (allTiles[i] === tileEl) continue;
        const r = allTiles[i].getBoundingClientRect();
        if (e.clientY < r.top) { toIdx = i; break; }
        if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) { toIdx = i; break; }
      }

      // Only dispatch if the position actually changed
      if (toIdx !== idx && toIdx !== idx + 1) {
        this.dispatchEvent(new CustomEvent('tray-reorder', {
          bubbles: true,
          detail: { from: idx, to: toIdx },
        }));
      }
    };

    container.addEventListener('pointerup',     end);
    container.addEventListener('pointercancel', end);
  }
}
customElements.define('sg-tray', SgTray);

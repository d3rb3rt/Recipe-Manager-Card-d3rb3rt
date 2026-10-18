/**
 * Shopping list view.
 * When SLM is available, embeds the full shopping-list-manager-card element
 * so it looks and behaves identically to the standalone SLM card.
 * Falls back to a simple local list when SLM is not installed.
 */
import { LitElement, html, css } from 'lit';
import { msg } from '@lit/localize';

class RmShoppingView extends LitElement {
  static properties = {
    hass: { type: Object },
    slmAvailable: { type: Boolean },
    shoppingLists: { type: Array },
    api: { type: Object },
    localItems: { type: Array },
    settings: { type: Object },
  };

  constructor() {
    super();
    this.hass = null;
    this.slmAvailable = false;
    this.shoppingLists = [];
    this.api = null;
    this.localItems = [];
    this.settings = null;
    this._slmCard = null;
    this._slmRetryTimeout = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._slmRetryTimeout) { clearTimeout(this._slmRetryTimeout); this._slmRetryTimeout = null; }
  }

  // True when the SLM frontend element is registered OR when the backend API
  // confirmed SLM is installed. Using the element registration as the primary
  // check means we try to embed even if the backend WS call failed transiently.
  get _useSLM() {
    return this.slmAvailable || !!customElements.get('shopping-list-manager-card');
  }

  updated(changedProps) {
    if (this._useSLM) {
      if (!this._slmCard) {
        this._mountSlmCard();
      } else {
        if (changedProps.has('hass') && this.hass) {
          this._slmCard.hass = this.hass;
        }
        if (changedProps.has('settings') && this.settings && this._slmCard) {
          this._syncSlmTheme();
        }
      }
    }
  }

  _syncSlmTheme() {
    if (!this._slmCard || !this.settings) return;
    const { theme, darkMode } = this.settings;
    this._slmCard.settings = { ...this._slmCard.settings, theme, darkMode };
    this._slmCard.applyColorScheme?.();
  }

  _mountSlmCard() {
    const container = this.shadowRoot?.querySelector('.slm-host');
    if (!container) return;

    const ElementClass = customElements.get('shopping-list-manager-card');
    if (!ElementClass) {
      // SLM frontend not loaded yet — retry after a short delay
      if (!this._slmRetryTimeout) {
        this._slmRetryTimeout = setTimeout(() => {
          this._slmRetryTimeout = null;
          if (this.isConnected) this._mountSlmCard();
        }, 500);
      }
      return;
    }

    // Create element BEFORE connecting so setConfig() fires before connectedCallback().
    // This matches HA's own card-loading order (setConfig → appendChild → hass).
    const card = new ElementClass();
    try { card.setConfig({}); } catch (e) { /* ignore */ }

    // Keep SLM's own ha-card visuals, but constrain host sizing to RM's body.
    card.style.cssText = 'display:block;width:100%;height:100%;max-height:100%;min-height:0;';

    // Mark as embedded so SLM can expose extra options
    card.isEmbedded = true;

    // Append to DOM → connectedCallback fires (with _baseCardId already set from setConfig)
    container.appendChild(card);

    // Set hass after connecting so subscribeToUpdates() has a live connection
    if (this.hass) card.hass = this.hass;

    this._slmCard = card;

    // Sync RMC theme to SLM after settings have loaded (hass setter triggers loadSettings)
    setTimeout(() => this._syncSlmTheme(), 0);
  }

  // -- Local mode helpers ---------------------------------------------------

  _toggleLocalItem(id) {
    const updated = this.localItems.map(item =>
      item.id === id ? { ...item, checked: !item.checked } : item
    );
    this._dispatchLocalUpdate(updated);
  }

  _clearLocalChecked() {
    this._dispatchLocalUpdate(this.localItems.filter(item => !item.checked));
  }

  _clearAllLocal() {
    this._dispatchLocalUpdate([]);
  }

  _dispatchLocalUpdate(items) {
    this.dispatchEvent(new CustomEvent('rm-shopping-local-update', {
      detail: { items },
      bubbles: true,
      composed: true,
    }));
  }

  // -- Render ---------------------------------------------------------------

  render() {
    return html`
      <div class="shopping-view">
        ${this._useSLM ? this._renderSlmMode() : this._renderLocalMode()}
      </div>
    `;
  }

  _renderSlmMode() {
    // Render a plain container; _mountSlmCard() imperatively creates the SLM
    // element inside it so setConfig() runs before connectedCallback().
    return html`
      <div class="slm-card-wrap">
        <div class="slm-host"></div>
      </div>
    `;
  }

  _renderLocalMode() {
    const hasChecked = this.localItems.some(i => i.checked);
    const unchecked = this.localItems.filter(i => !i.checked);
    const checked = this.localItems.filter(i => i.checked);

    return html`
      <div class="sv-header">
        <span class="sv-list-name">${msg('My Shopping List')}</span>
        <div class="sv-actions">
          ${hasChecked ? html`
            <button class="sv-btn danger" @click=${this._clearLocalChecked}>
              <ha-icon icon="mdi:delete-sweep-outline"></ha-icon>
              <span>${msg('Clear checked')}</span>
            </button>
          ` : ''}
          ${this.localItems.length ? html`
            <button class="sv-btn" @click=${this._clearAllLocal} title=${msg('Clear all')}>
              <ha-icon icon="mdi:delete-outline"></ha-icon>
            </button>
          ` : ''}
        </div>
      </div>

      <div class="sv-install-banner">
        <ha-icon icon="mdi:information-outline"></ha-icon>
        <div class="sv-install-text">
          <strong>${msg('Get more features with Shopping List Manager')}</strong>
          <span>${msg('Install the Shopping List Manager HACS integration for shared lists, categories, and sync.')}</span>
        </div>
      </div>

      ${this.localItems.length === 0 ? html`
        <div class="sv-empty">
          <ha-icon icon="mdi:cart-outline"></ha-icon>
          <p>${msg('Your shopping list is empty.')}</p>
          <p class="sv-hint">${msg('Add ingredients from any recipe to get started.')}</p>
        </div>
      ` : html`
        <div class="sv-items">
          ${unchecked.map(item => this._renderLocalRow(item))}
          ${checked.length ? html`
            <div class="sv-divider-label">${msg('Checked')}</div>
            ${checked.map(item => this._renderLocalRow(item))}
          ` : ''}
        </div>
      `}
    `;
  }

  _renderLocalRow(item) {
    const qtyText = [item.amount || '', item.unit || ''].filter(Boolean).join(' ');
    return html`
      <div class="sv-row ${item.checked ? 'sv-row-checked' : ''}"
        @click=${() => this._toggleLocalItem(item.id)}>
        <div class="sv-row-left">
          <div class="cat-dot"></div>
          <span class="row-emoji">📦</span>
        </div>
        <div class="sv-row-mid">
          <span class="sv-item-name">${item.name}</span>
          ${qtyText ? html`<span class="sv-item-unit">${qtyText}</span>` : ''}
        </div>
        <div class="sv-row-right">
          <div class="sv-checkbox ${item.checked ? 'checked' : ''}">
            ${item.checked ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  static styles = css`
    :host { display: block; height: 100%; }

    .shopping-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* ── Embedded SLM card ──────────────────────────────────────────────── */

    .slm-card-wrap {
      flex: 1;
      min-height: 0;
      padding: 10px 12px 12px;
      box-sizing: border-box;
      background: var(--rm-bg-main);
      overflow: hidden;
    }

    .slm-host {
      display: block;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    /* ── Header (local mode only) ───────────────────────────────────────── */

    .sv-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--rm-border);
      flex-shrink: 0;
      gap: 8px;
    }

    .sv-list-name {
      font-weight: 600;
      font-size: calc(15px * var(--rm-font-scale, 1));
      color: var(--rm-text);
    }

    .sv-actions { display: flex; gap: 6px; align-items: center; }

    .sv-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: 1px solid var(--rm-border);
      border-radius: 8px;
      color: var(--rm-text-secondary);
      padding: 5px 10px;
      font-size: calc(12px * var(--rm-font-scale, 1));
      cursor: pointer;
      transition: background 0.15s;
    }
    .sv-btn ha-icon { --mdc-icon-size: 18px; }
    .sv-btn:hover { background: var(--rm-accent-soft); color: var(--rm-text); }
    .sv-btn.danger { color: var(--error-color, #cf6679); border-color: var(--error-color, #cf6679); }
    .sv-btn.danger:hover { background: rgba(207,102,121,0.1); }

    /* ── Install banner ─────────────────────────────────────────────────── */

    .sv-install-banner {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: var(--rm-accent-soft);
      border-left: 3px solid var(--rm-accent);
      padding: 10px 14px;
      margin: 12px 16px;
      border-radius: 0 8px 8px 0;
      flex-shrink: 0;
    }
    .sv-install-banner ha-icon { --mdc-icon-size: 20px; color: var(--rm-accent); flex-shrink: 0; margin-top: 1px; }
    .sv-install-text { display: flex; flex-direction: column; gap: 2px; font-size: calc(12px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary); }
    .sv-install-text strong { color: var(--rm-text); font-size: calc(13px * var(--rm-font-scale, 1)); }

    /* ── Empty state ────────────────────────────────────────────────────── */

    .sv-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--rm-text-secondary);
      text-align: center;
      gap: 6px;
    }
    .sv-empty ha-icon { --mdc-icon-size: 48px; opacity: 0.35; }
    .sv-empty p { margin: 0; font-size: calc(15px * var(--rm-font-scale, 1)); }
    .sv-hint { font-size: calc(13px * var(--rm-font-scale, 1)) !important; color: var(--rm-text-muted) !important; }

    /* ── Local item rows ────────────────────────────────────────────────── */

    .sv-items {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0 16px;
      scrollbar-width: thin;
      scrollbar-color: var(--rm-border) transparent;
    }

    .sv-divider-label {
      padding: 12px 16px 4px;
      font-size: calc(10px * var(--rm-font-scale, 1));
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--rm-text-muted);
    }

    .sv-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px 9px 12px;
      cursor: pointer;
      transition: background 0.12s;
      border-bottom: 1px solid var(--rm-border);
      min-height: 46px;
    }
    .sv-row:hover { background: var(--rm-accent-soft); }
    .sv-row-checked { opacity: 0.5; }

    .sv-row-left { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
    .cat-dot { width: 8px; height: 8px; border-radius: 50%; background: #78909c; flex-shrink: 0; }
    .row-emoji { font-size: calc(17px * var(--rm-font-scale, 1)); line-height: 1; width: 22px; text-align: center; }

    .sv-row-mid {
      flex: 1;
      display: flex;
      align-items: baseline;
      gap: 7px;
      min-width: 0;
      flex-wrap: wrap;
    }

    .sv-item-name { font-size: calc(14px * var(--rm-font-scale, 1)); color: var(--rm-text); font-weight: 500; }
    .sv-row-checked .sv-item-name { text-decoration: line-through; }
    .sv-item-unit { font-size: calc(12px * var(--rm-font-scale, 1)); color: var(--rm-text-muted); }

    .sv-row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

    .sv-checkbox {
      width: 22px; height: 22px;
      border-radius: 50%;
      border: 2px solid var(--rm-border);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .sv-checkbox.checked { color: #fff; background: #78909c; border-color: #78909c; }
    .sv-checkbox ha-icon { --mdc-icon-size: 14px; }
  `;
}

try { customElements.define('rm-shopping-view', RmShoppingView); } catch { }

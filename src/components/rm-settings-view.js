/**
 * Recipe Manager — Settings panel.
 * Tabs: Appearance (theme, dark, font, grid, nav) | Advanced (sound, wake lock, units) | Sync | Help
 */
import { LitElement, html, css } from 'lit';
import { msg, str } from '@lit/localize';
import { CARD_VERSION } from 'virtual:card-version';
import { isWakeLockSupported } from '../services/wake-lock.js';

const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt', 'Português'],
  ['nl', 'Nederlands'],
  ['it', 'Italiano'],
];

class RmSettingsView extends LitElement {
  static properties = {
    hass:          { type: Object },
    settings:      { type: Object },
    _activeTab:    { type: String },
    _rmVersion:    { type: String },
    _rmcVersion:   { type: String },
    _backupState:  { type: String },
  };

  constructor() {
    super();
    this.settings = {};
    this._activeTab   = 'appearance';
    this._rmVersion   = '…';
    this._rmcVersion  = '…';
    this._backupState = null;
  }

  updated(changedProps) {
    if (changedProps.has('hass') && this.hass && this._rmVersion === '…') {
      this._fetchVersionsFromHacs();
    }
  }

  async _backup() {
    if (this._backupState === 'loading') return;
    this._backupState = 'loading';
    try {
      const data = await this.hass.callWS({ type: 'recipe_manager/backup' });
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recipe-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this._backupState = 'done';
    } catch (err) {
      console.error('[RM] Backup failed:', err);
      this._backupState = 'error';
    }
    setTimeout(() => { this._backupState = null; }, 3000);
  }

  _fetchVersionsFromHacs() {
    if (!this.hass) return;
    this._rmVersion  = '…';
    this._rmcVersion = '…';
    this.hass.callWS({ type: 'hacs/repositories/list' })
      .then(repos => {
        const rm  = repos.find(r => r.full_name.toLowerCase() === 'thekiwismarthome/recipe-manager');
        const rmc = repos.find(r => r.full_name.toLowerCase() === 'thekiwismarthome/recipe-manager-card');
        this._rmVersion  = rm?.installed_version  ?? '—';
        this._rmcVersion = rmc?.installed_version ?? CARD_VERSION;
      })
      .catch(() => {
        this._rmVersion  = '—';
        this._rmcVersion = CARD_VERSION;
      });
  }

  _update(patch) {
    const next = { ...this.settings, ...patch };
    this.dispatchEvent(new CustomEvent('rm-settings-change', {
      detail: { settings: next },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const s = this.settings;
    return html`
      <div class="settings-root">
        <div class="tab-bar">
          ${[
            ['appearance', 'mdi:palette-outline',      msg('Appearance')],
            ['advanced',   'mdi:tune-variant',         msg('Advanced')],
            ['sync',       'mdi:cloud-sync-outline',   msg('Sync')],
            ['help',       'mdi:help-circle-outline',  msg('Help')],
          ].map(([id, icon, label]) => html`
            <button class="tab-item ${this._activeTab === id ? 'active' : ''}"
              @click=${() => { this._activeTab = id; }}>
              <ha-icon icon="${icon}"></ha-icon>
              <span>${label}</span>
            </button>
          `)}
        </div>
        <div class="settings-body">
          ${this._activeTab === 'appearance' ? this._renderAppearance(s) : ''}
          ${this._activeTab === 'advanced'   ? this._renderAdvanced(s)   : ''}
          ${this._activeTab === 'sync'       ? this._renderSync()    : ''}
          ${this._activeTab === 'help'       ? this._renderHelp()   : ''}
        </div>
      </div>
    `;
  }

  _renderAppearance(s) {
    const alwaysDark  = s.theme === 'midnight' || s.theme === 'ember' || s.theme === 'neon';
    const alwaysLight = s.theme === 'arctic'   || s.theme === 'meadow' || s.theme === 'ocean';
    const noToggle    = alwaysDark || alwaysLight;
    return html`
      <!-- ── Language & Units ── -->
      <div class="section">
        <div class="section-label">${msg('Language & Units')}</div>

        <div class="setting-row">
          <span class="setting-name">${msg('Language')}</span>
          <select class="theme-select" @change=${e => this._update({ language: e.target.value })}>
            ${LANGUAGES.map(([code, label]) => html`
              <option value="${code}" ?selected=${(s.language ?? 'en') === code}>${label}</option>
            `)}
          </select>
        </div>

        <div class="setting-row">
          <span class="setting-name">${msg('Preferred units')}</span>
          <div class="btn-group">
            ${[['imperial', msg('Imperial')], ['metric', msg('Metric')]].map(([val, lbl]) => html`
              <button class="seg-btn ${(s.unitSystem ?? 'imperial') === val ? 'active' : ''}"
                @click=${() => this._update({ unitSystem: val })}>${lbl}</button>
            `)}
          </div>
        </div>
      </div>

      <!-- ── Theme ── -->
      <div class="section">
        <div class="section-label">${msg('Theme')}</div>

        <div class="setting-row">
          <span class="setting-name">${msg('Colour theme')}</span>
          <select class="theme-select" @change=${e => this._update({ theme: e.target.value })}>
            <optgroup label="${msg('Adaptive')}">
              <option value="soft"     ?selected=${s.theme === 'soft' || !s.theme}>${msg('🎨 Soft Pastel')}</option>
              <option value="blossom"  ?selected=${s.theme === 'blossom' }>${msg('🌸 Blossom')}</option>
            </optgroup>
            <optgroup label="${msg('Light Themes')}">
              <option value="arctic"   ?selected=${s.theme === 'arctic'  }>${msg('🧊 Arctic')}</option>
              <option value="meadow"   ?selected=${s.theme === 'meadow'  }>${msg('🌿 Meadow')}</option>
              <option value="ocean"    ?selected=${s.theme === 'ocean'   }>${msg('🌊 Ocean Blue')}</option>
            </optgroup>
            <optgroup label="${msg('Dark Themes')}">
              <option value="midnight" ?selected=${s.theme === 'midnight'}>${msg('🌙 Midnight Ocean')}</option>
              <option value="ember"    ?selected=${s.theme === 'ember'   }>${msg('🔥 Ember')}</option>
              <option value="neon"     ?selected=${s.theme === 'neon'    }>${msg('🍇 Purple & Cyan')}</option>
            </optgroup>
          </select>
        </div>

        ${noToggle ? html`
          <div class="setting-row muted-row">
            <span class="setting-name">${msg('Dark mode')}</span>
            <span class="muted-note">${alwaysDark ? msg('Always dark for this theme') : msg('Always light for this theme')}</span>
          </div>
        ` : html`
          <div class="setting-row">
            <span class="setting-name">${msg('Dark mode')}</span>
            <div class="btn-group">
              ${[['off', msg('Light')], ['system', msg('Auto')], ['on', msg('Dark')]].map(([val, lbl]) => html`
                <button class="seg-btn ${s.darkMode === val ? 'active' : ''}"
                  @click=${() => this._update({ darkMode: val })}>${lbl}</button>
              `)}
            </div>
          </div>
        `}

        <div class="setting-row">
          <span class="setting-name">${msg('Text size')}</span>
          <div class="btn-group">
            ${[['small', msg('S')], ['medium', msg('M')], ['large', msg('L')], ['xlarge', msg('XL')]].map(([val, lbl]) => html`
              <button class="seg-btn ${s.fontSize === val ? 'active' : ''}"
                @click=${() => this._update({ fontSize: val })}>${lbl}</button>
            `)}
          </div>
        </div>
      </div>

      <!-- ── Recipe Grid ── -->
      <div class="section">
        <div class="section-label">${msg('Recipe Grid')}</div>

        <div class="setting-row">
          <span class="setting-name">${msg('Recipe columns')}</span>
          <div class="btn-group">
            ${[2, 3, 4, 5, 8, 10].map(n => html`
              <button class="seg-btn ${s.columns === n ? 'active' : ''}"
                @click=${() => this._update({ columns: n })}>${n}</button>
            `)}
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-name">${msg('Favourites section')}</span>
          <label class="toggle">
            <input type="checkbox" ?checked=${s.showFavourites}
              @change=${e => this._update({ showFavourites: e.target.checked })} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">${msg('Recent recipes count')}</span>
            <span class="setting-hint">${msg('Recipes shown in the Recent filter tab')}</span>
          </div>
          <div class="btn-group">
            ${[6, 12, 24].map(n => html`
              <button class="seg-btn ${(s.recentCount ?? 12) === n ? 'active' : ''}"
                @click=${() => this._update({ recentCount: n })}>${n}</button>
            `)}
          </div>
        </div>
      </div>

      <!-- ── Navigation ── -->
      <div class="section">
        <div class="section-label">${msg('Navigation')}</div>

        <div class="setting-row">
          <span class="setting-name">${msg('Meal planner')}</span>
          <label class="toggle">
            <input type="checkbox" ?checked=${s.showPlanner}
              @change=${e => this._update({ showPlanner: e.target.checked })} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
      </div>
    `;
  }

  _renderAdvanced(s) {
    return html`
      <!-- ── Timer Sound ── -->
      <div class="section">
        <div class="section-label">${msg('Timer Sound')}</div>

        <div class="setting-row">
          <span class="setting-name">${msg('Alarm sound')}</span>
          <select class="theme-select" @change=${e => this._update({ timerSound: e.target.value })}>
            <option value="beep"  ?selected=${(s.timerSound ?? 'beep') === 'beep'}>${msg('Beep')}</option>
            <option value="ding"  ?selected=${s.timerSound === 'ding'            }>${msg('Ding')}</option>
            <option value="alarm" ?selected=${s.timerSound === 'alarm'           }>${msg('Alarm (3 beeps)')}</option>
            <option value="none"  ?selected=${s.timerSound === 'none'            }>${msg('Silent')}</option>
            <option value="file"  ?selected=${s.timerSound === 'file'            }>${msg('Custom file…')}</option>
          </select>
        </div>

        ${s.timerSound === 'file' ? html`
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">${msg('Sound file')}</span>
              <span class="setting-hint">${s.timerSoundFileName || msg('No file selected')}</span>
            </div>
            <label class="file-label">
              <input type="file" accept="audio/*" class="file-input"
                @change=${this._handleSoundFileChange} />
              <ha-icon icon="mdi:folder-music-outline"></ha-icon>
              ${s.timerSoundFile ? msg('Change') : msg('Choose file')}
            </label>
          </div>
        ` : ''}

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">${msg('Test sound')}</span>
            <span class="setting-hint">${msg('Play a preview of the selected alarm')}</span>
          </div>
          <button class="seg-btn active" @click=${() => this._testSound(s.timerSound ?? 'beep', s.timerSoundFile)}>
            <ha-icon icon="mdi:volume-high"></ha-icon> ${msg('Play')}
          </button>
        </div>
      </div>

      <!-- ── Keep Screen On ── -->
      <div class="section">
        <div class="section-label">${msg('Keep Screen On')}</div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">${msg('Keep screen on while viewing a recipe')}</span>
            <span class="setting-hint">${msg('Uses the Wake Lock API — engages automatically while a recipe is open')}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" ?checked=${s.keepScreenOn}
              @change=${e => this._update({ keepScreenOn: e.target.checked })} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>

        ${s.keepScreenOn && !isWakeLockSupported() ? html`
          <div class="setting-row muted-row">
            <span class="setting-hint">${msg('Not available in this browser/connection — the Wake Lock API requires a secure (HTTPS) connection to Home Assistant. This is the most common reason "keep screen on" doesn\'t work.')}</span>
          </div>
        ` : ''}

        ${s.keepScreenOn ? html`
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">${msg('Auto-release after')}</span>
              <span class="setting-hint">${msg('Screen lock released after this many minutes')}</span>
            </div>
            <div class="btn-group">
              ${[15, 30, 45, 60].map(n => html`
                <button class="seg-btn ${(s.wakeLockDuration ?? 60) === n ? 'active' : ''}"
                  @click=${() => this._update({ wakeLockDuration: n })}>${n}m</button>
              `)}
            </div>
          </div>
        ` : ''}
      </div>

      <!-- ── Unit Conversion ── -->
      <div class="section">
        <div class="section-label">${msg('Unit Conversion')}</div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">${msg('Show metric conversion button')}</span>
            <span class="setting-hint">${msg('Button in Ingredients tab converts oz/lb/cups/fl oz → g/ml/kg')}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" ?checked=${s.showUnitConversion}
              @change=${e => this._update({ showUnitConversion: e.target.checked })} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
      </div>

      <!-- ── Image Slideshow ── -->
      <div class="section">
        <div class="section-label">${msg('Image Slideshow')}</div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">${msg('Auto-advance interval')}</span>
            <span class="setting-hint">${msg('Seconds between slides when a recipe has multiple images (0 = off)')}</span>
          </div>
          <div class="btn-group">
            ${[0, 3, 5, 10, 15].map(n => html`
              <button class="seg-btn ${(s.slideshowInterval ?? 5) === n ? 'active' : ''}"
                @click=${() => this._update({ slideshowInterval: n })}>${n === 0 ? msg('Off') : `${n}s`}</button>
            `)}
          </div>
        </div>
      </div>

    `;
  }

  _handleSoundFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      this._update({ timerSoundFile: evt.target.result, timerSoundFileName: file.name });
    };
    reader.readAsDataURL(file);
  }

  _testSound(type, fileUrl) {
    if (type === 'file') {
      if (fileUrl) {
        const audio = new Audio(fileUrl);
        audio.play().catch(err => console.warn('Could not play file:', err));
      }
      return;
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (type === 'ding') {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(1046, ctx.currentTime);
        gain.gain.setValueAtTime(0.6, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 1.0);
      } else if (type === 'alarm') {
        for (let i = 0; i < 3; i++) {
          const t = ctx.currentTime + i * 0.35;
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'square'; osc.frequency.setValueAtTime(660, t);
          gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          osc.start(t); osc.stop(t + 0.2);
        }
      } else if (type !== 'none') {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
      }
    } catch (e) { console.warn('Audio test failed:', e); }
  }


  _renderSync() {
    const btnLabel = this._backupState === 'loading' ? msg('Backing up…')
                   : this._backupState === 'done'    ? msg('Downloaded ✓')
                   : this._backupState === 'error'   ? msg('Failed ✗')
                   : msg('Download backup');

    return html`
      <div class="section">
        <div class="section-label">${msg('Backup')}</div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">${msg('Export recipes')}</span>
            <span class="setting-hint">${msg('Download all recipes and meal plans as a JSON file')}</span>
          </div>
          <button
            class="seg-btn backup-btn ${this._backupState || ''}"
            ?disabled=${this._backupState === 'loading'}
            @click=${() => this._backup()}
          >${btnLabel}</button>
        </div>
      </div>
    `;
  }

  _renderHelp() {
    return html`
      <div class="section">
        <div class="section-label">${msg('FAQ & Support')}</div>

        <a class="help-link" href="https://github.com/thekiwismarthome/recipe-manager/wiki" target="_blank">
          <ha-icon icon="mdi:help-circle-outline"></ha-icon>
          <div class="help-link-content">
            <span class="setting-name">${msg('FAQ')}</span>
            <span class="setting-hint">${msg('Frequently asked questions')}</span>
          </div>
          <ha-icon icon="mdi:open-in-new" class="help-link-ext"></ha-icon>
        </a>

        <a class="help-link" href="https://github.com/thekiwismarthome/recipe-manager/issues" target="_blank">
          <ha-icon icon="mdi:bug-outline"></ha-icon>
          <div class="help-link-content">
            <span class="setting-name">${msg('Report a Problem')}</span>
            <span class="setting-hint">${msg('Submit an issue on GitHub')}</span>
          </div>
          <ha-icon icon="mdi:open-in-new" class="help-link-ext"></ha-icon>
        </a>

        <a class="help-link" href="https://github.com/thekiwismarthome/recipe-manager" target="_blank">
          <ha-icon icon="mdi:github"></ha-icon>
          <div class="help-link-content">
            <span class="setting-name">${msg('GitHub Repository')}</span>
            <span class="setting-hint">${msg('View source code')}</span>
          </div>
          <ha-icon icon="mdi:open-in-new" class="help-link-ext"></ha-icon>
        </a>
      </div>

      <div class="section">
        <div class="section-label">${msg('About')}</div>

        <div class="setting-row">
          <span class="setting-name">${msg('Recipe Manager')}</span>
          <span class="muted-note">${msg(str`Integration version ${this._rmVersion}`)}</span>
        </div>

        <div class="setting-row">
          <span class="setting-name">${msg('RM Card')}</span>
          <span class="muted-note">${msg(str`Card version ${this._rmcVersion}`)}</span>
        </div>

        <div class="setting-row">
          <span class="setting-name">${msg('Refresh versions')}</span>
          <button class="seg-btn" @click=${() => this._fetchVersionsFromHacs()}>
            <ha-icon icon="mdi:refresh"></ha-icon>
          </button>
        </div>
      </div>
    `;
  }

  _renderPlaceholder(title, icon, message) {
    return html`
      <div class="placeholder-tab">
        <ha-icon icon="${icon}"></ha-icon>
        <div class="placeholder-title">${title}</div>
        <div class="placeholder-msg">${message}</div>
      </div>
    `;
  }

  static styles = css`
    :host { display: block; height: 100%; overflow: hidden; }

    .settings-root { display: flex; flex-direction: column; height: 100%; }

    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--rm-border, rgba(0,0,0,0.08));
      background: var(--rm-bg-surface, #fff);
      flex-shrink: 0; overflow-x: auto; scrollbar-width: none;
    }
    .tab-bar::-webkit-scrollbar { display: none; }

    .tab-item {
      display: flex; align-items: center; gap: 5px;
      background: none; border: none;
      border-bottom: 2px solid transparent;
      padding: 10px 14px; font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 500;
      color: var(--rm-text-secondary, #6b5c4a);
      cursor: pointer; white-space: nowrap;
      transition: color 0.15s, border-color 0.15s; flex-shrink: 0;
    }
    .tab-item ha-icon { --mdc-icon-size: 16px; flex-shrink: 0; }
    .tab-item:hover { color: var(--rm-text, #2d2016); }
    .tab-item.active { color: var(--rm-accent); border-bottom-color: var(--rm-accent); }

    .settings-body { flex: 1; overflow-y: auto; padding-bottom: 24px; }

    .section { margin-bottom: 8px; }

    .section-label {
      font-size: calc(11px * var(--rm-font-scale, 1)); font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--rm-text-muted, #a08060); padding: 16px 20px 6px;
    }

    .setting-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--rm-border, rgba(0,0,0,0.08)); gap: 12px;
    }
    .setting-row.muted-row { opacity: 0.5; }

    .setting-name { font-size: calc(15px * var(--rm-font-scale, 1)); font-weight: 500; flex-shrink: 0; color: var(--rm-text); }

    .setting-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .setting-hint { font-size: calc(12px * var(--rm-font-scale, 1)); color: var(--rm-text-muted, #a08060); }

    .muted-note { font-size: calc(13px * var(--rm-font-scale, 1)); color: var(--rm-text-muted, #a08060); }

    .backup-btn { min-width: 140px; white-space: nowrap; }
    .backup-btn.done    { background: var(--rm-success, #4caf50); color: #fff; }
    .backup-btn.error   { background: var(--rm-danger,  #e53935); color: #fff; }
    .backup-btn.loading { opacity: 0.7; cursor: wait; }

    .help-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--rm-border, rgba(0,0,0,0.06));
      text-decoration: none;
      color: inherit;
    }
    .help-link:last-of-type { border-bottom: none; }
    .help-link ha-icon { color: var(--rm-accent, #a0522d); flex-shrink: 0; }
    .help-link-content { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .help-link-ext { --mdc-icon-size: 16px; opacity: 0.4; }

    .theme-select {
      background: var(--rm-bg-surface, #fff); color: var(--rm-text, #2d2016);
      border: 1px solid var(--rm-border, rgba(0,0,0,0.12));
      border-radius: 8px; padding: 6px 10px; font-size: calc(14px * var(--rm-font-scale, 1)); cursor: pointer;
      min-width: 160px; flex-shrink: 0;
    }

    .btn-group {
      display: flex; border-radius: 8px; overflow: hidden;
      border: 1px solid var(--rm-border, rgba(0,0,0,0.1)); flex-shrink: 0;
    }
    .seg-btn {
      background: transparent; border: none; padding: 6px 14px;
      font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 500; cursor: pointer;
      color: var(--rm-text-secondary, #6b5c4a);
      border-right: 1px solid var(--rm-border, rgba(0,0,0,0.1));
      transition: background 0.12s, color 0.12s;
      display: flex; align-items: center; gap: 4px;
    }
    .seg-btn ha-icon { --mdc-icon-size: 16px; }
    .seg-btn:last-child { border-right: none; }
    .seg-btn.active { background: var(--rm-accent); color: #fff; }
    .seg-btn:hover:not(.active) { background: var(--rm-border); color: var(--rm-text); }

    .toggle { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
    .toggle input { display: none; }
    .toggle-track {
      width: 44px; height: 24px;
      background: var(--rm-border, rgba(0,0,0,0.15));
      border-radius: 12px; position: relative; transition: background 0.2s;
    }
    .toggle input:checked + .toggle-track { background: var(--rm-accent); }
    .toggle-thumb {
      position: absolute; top: 2px; left: 2px;
      width: 20px; height: 20px; background: #fff; border-radius: 50%;
      transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .toggle input:checked ~ .toggle-track .toggle-thumb { transform: translateX(20px); }

    .file-label {
      display: flex; align-items: center; gap: 6px;
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 8px; padding: 6px 12px; font-size: calc(13px * var(--rm-font-scale, 1));
      color: var(--rm-text); cursor: pointer; transition: background 0.15s;
      flex-shrink: 0;
    }
    .file-label:hover { background: var(--rm-accent-soft); }
    .file-label ha-icon { --mdc-icon-size: 18px; color: var(--rm-accent); }
    .file-input { display: none; }

    .placeholder-tab {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 60px 24px; gap: 12px;
      color: var(--rm-text-secondary); text-align: center;
    }
    .placeholder-tab ha-icon { --mdc-icon-size: 48px; opacity: 0.3; }
    .placeholder-title { font-size: calc(18px * var(--rm-font-scale, 1)); font-weight: 600; color: var(--rm-text); }
    .placeholder-msg { font-size: calc(14px * var(--rm-font-scale, 1)); max-width: 280px; line-height: 1.5; }
  `;
}

try { customElements.define('rm-settings-view', RmSettingsView); } catch {}

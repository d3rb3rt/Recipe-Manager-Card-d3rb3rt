/**
 * Recipe Manager — Settings panel.
 * Tabs: Appearance (theme, dark, font, grid, nav) | Advanced (sound, wake lock, units) | Sync | Help
 */
import { LitElement, html, css } from 'lit';
import { msg, str, updateWhenLocaleChanges } from '@lit/localize';
import { CARD_VERSION } from 'virtual:card-version';
import { isWakeLockSupported } from '../services/wake-lock.js';
import { THEMES, themeEntry } from '../styles/ui-styles.js';

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
    uiStyle: { type: String, attribute: 'ui-style', reflect: true },
    hass:          { type: Object },
    settings:      { type: Object },
    _activeTab:    { type: String },
    _rmVersion:    { type: String },
    _rmcVersion:   { type: String },
    _backupState:  { type: String },
  };

  constructor() {
    super();
    updateWhenLocaleChanges(this); // re-render when the language file finishes loading
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

  // Dark palette in use right now (for the theme previews)
  get _darkNow() {
    const m = this.settings?.darkMode;
    if (m === 'on') return true;
    if (m === 'off') return false;
    const ha = this.hass?.themes?.darkMode;
    if (typeof ha === 'boolean') return ha;
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  _themeName(id) {
    return { meadow: msg('Meadow'), slate: msg('Slate'), sunset: msg('Sunset') }[id] ?? id;
  }

  // Coloured icon tile at the start of a settings row (hue 1-6, same hues as Shopping List Manager)
  _tile(icon, hue = 1) {
    return html`<span class="tile" style="--hue: var(--rm-h${hue}, var(--rm-accent))"><ha-icon icon="${icon}"></ha-icon></span>`;
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
    const style       = ['fresh', 'compact', 'classic'].includes(s.uiStyle) ? s.uiStyle : 'fresh';
    return html`
      <!-- ── Interface style ── -->
      <div class="section">
        <div class="section-label">${msg('Interface style')}</div>
        <div class="setting-row block">
          <div class="style-options" role="radiogroup" aria-label="${msg('Interface style')}">
            ${[['fresh', msg('Fresh'), msg('Soft cards, summary card, floating menu')],
               ['compact', msg('Compact'), msg('Dense list, checkboxes, flat tab bar')],
               ['classic', msg('Classic'), msg('The original look and colour themes')]].map(([id, label, hint]) => html`
              <button class="style-option ${style === id ? 'selected' : ''}" role="radio"
                aria-checked="${style === id ? 'true' : 'false'}"
                @click=${() => this._update({ uiStyle: id })}>
                <span class="sp sp-${id}" aria-hidden="true"></span>
                <span class="so-label">${label}</span>
                <span class="so-hint">${hint}</span>
              </button>
            `)}
          </div>
        </div>
      </div>

      ${style === 'classic' ? html`
        <div class="section">
          <div class="section-label">${msg('Theme')}</div>
          <div class="setting-row">
            ${this._tile('mdi:palette-outline', 1)}
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
        </div>
      ` : html`
        <div class="section">
          <div class="section-label">${msg('Theme')}</div>
          <div class="setting-row block">
            <div class="theme-cards" role="radiogroup" aria-label="${msg('Theme')}">
              ${THEMES.map(th => {
                const pv = this._darkNow ? th.preview.dark : th.preview.light;
                const sel = themeEntry(style, s.designTheme)?.id === th.id;
                return html`
                  <button class="theme-card ${sel ? 'selected' : ''}" role="radio" aria-checked="${sel ? 'true' : 'false'}"
                    @click=${() => this._update({ designTheme: th.id })}>
                    <span class="theme-sw" style="background: ${pv.bg}">
                      <i style="background: ${pv.a}; height: 14px"></i>
                      <i style="background: ${pv.s}; height: 22px"></i>
                    </span>
                    <span class="theme-name">${this._themeName(th.id)}${sel ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}</span>
                  </button>
                `;
              })}
            </div>
          </div>
        </div>
      `}

      ${style === 'classic' && noToggle ? html`
        <div class="section">
          <div class="section-label">${msg('Colour mode')}</div>
          <div class="setting-row muted-row">
            <span class="setting-name">${msg('Dark mode')}</span>
            <span class="muted-note">${alwaysDark ? msg('Always dark for this theme') : msg('Always light for this theme')}</span>
          </div>
        </div>
      ` : html`
        <div class="section">
          <div class="section-label">${msg('Colour mode')}</div>
          <div class="setting-row block">
            <div class="mode-seg" role="radiogroup" aria-label="${msg('Colour mode')}">
              ${[['off', msg('Light')], ['on', msg('Dark')], ['system', msg('Match device')]].map(([val, label]) => html`
                <button class="mode-opt ${(s.darkMode ?? 'system') === val ? 'selected' : ''}" role="radio"
                  aria-checked="${(s.darkMode ?? 'system') === val ? 'true' : 'false'}"
                  @click=${() => this._update({ darkMode: val })}>${label}</button>
              `)}
            </div>
          </div>
        </div>
      `}

      <div class="section">
        <div class="section-label">${msg('Text')}</div>
        <div class="setting-row">
          ${this._tile('mdi:format-size', 5)}
          <span class="setting-name">${msg('Text size')}</span>
          <div class="btn-group">
            ${[['small', msg('S')], ['medium', msg('M')], ['large', msg('L')], ['xlarge', msg('XL')]].map(([val, lbl]) => html`
              <button class="seg-btn ${s.fontSize === val ? 'active' : ''}"
                @click=${() => this._update({ fontSize: val })}>${lbl}</button>
            `)}
          </div>
        </div>
      </div>

      <!-- ── Language & Units ── -->
      <div class="section">
        <div class="section-label">${msg('Language & Units')}</div>

        <div class="setting-row">
          ${this._tile('mdi:translate', 2)}
          <span class="setting-name">${msg('Language')}</span>
          <select class="theme-select" @change=${e => this._update({ language: e.target.value })}>
            ${LANGUAGES.map(([code, label]) => html`
              <option value="${code}" ?selected=${(s.language ?? 'en') === code}>${label}</option>
            `)}
          </select>
        </div>

        <div class="setting-row">
          ${this._tile('mdi:scale-balance', 3)}
          <span class="setting-name">${msg('Preferred units')}</span>
          <div class="btn-group">
            ${[['imperial', msg('Imperial')], ['metric', msg('Metric')]].map(([val, lbl]) => html`
              <button class="seg-btn ${(s.unitSystem ?? 'imperial') === val ? 'active' : ''}"
                @click=${() => this._update({ unitSystem: val })}>${lbl}</button>
            `)}
          </div>
        </div>
      </div>

      <!-- ── Recipe Grid ── -->
      <div class="section">
        <div class="section-label">${msg('Recipe Grid')}</div>

        <div class="setting-row">
          ${this._tile('mdi:view-grid-outline', 2)}
          <span class="setting-name">${msg('Recipe columns')}</span>
          <div class="btn-group">
            ${[2, 3, 4, 5, 8, 10].map(n => html`
              <button class="seg-btn ${s.columns === n ? 'active' : ''}"
                @click=${() => this._update({ columns: n })}>${n}</button>
            `)}
          </div>
        </div>

        <div class="setting-row">
          ${this._tile('mdi:heart-outline', 6)}
          <span class="setting-name">${msg('Favourites section')}</span>
          <label class="toggle">
            <input type="checkbox" ?checked=${s.showFavourites}
              @change=${e => this._update({ showFavourites: e.target.checked })} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>

        <div class="setting-row">
          ${this._tile('mdi:history', 5)}
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
          ${this._tile('mdi:calendar-week', 5)}
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
          ${this._tile('mdi:bell-ring-outline', 6)}
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
              ${this._tile('mdi:file-music-outline', 4)}
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
            ${this._tile('mdi:play-circle-outline', 1)}
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
        <div class="section-label">${msg('Voice PE / ESPHome timers')}</div>

        <div class="setting-row">
          ${this._tile('mdi:microphone-outline', 4)}
          <div class="setting-info">
            <span class="setting-name">${msg('Show Voice PE timers')}</span>
            <span class="setting-hint">${msg('Lists timers started by voice in the Timers tab')}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" .checked=${s.vpeTimers !== false}
              @change=${e => this._update({ vpeTimers: e.target.checked })} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>

        ${s.vpeTimers !== false ? html`
          <div class="setting-row">
            ${this._tile('mdi:code-tags', 2)}
            <div class="setting-info">
              <span class="setting-name">${msg('Sensor prefix')}</span>
              <span class="setting-hint">${msg('Template sensors named like sensor.vpe_timer_1')}</span>
            </div>
            <input class="text-field" type="text" .value=${s.vpePrefix ?? 'sensor.vpe_timer'}
              @change=${e => this._update({ vpePrefix: e.target.value.trim() || 'sensor.vpe_timer' })} />
          </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-label">${msg('Keep Screen On')}</div>

        <div class="setting-row">
          ${this._tile('mdi:eye-outline', 1)}
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
              ${this._tile('mdi:timer-sand', 5)}
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
          ${this._tile('mdi:swap-horizontal', 3)}
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
            ${this._tile('mdi:image-multiple-outline', 4)}
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
            ${this._tile('mdi:download', 1)}
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
            ${this._tile('mdi:help-circle-outline', 2)}
          <span class="setting-name">${msg('FAQ')}</span>
            <span class="setting-hint">${msg('Frequently asked questions')}</span>
          </div>
          <ha-icon icon="mdi:open-in-new" class="help-link-ext"></ha-icon>
        </a>

        <a class="help-link" href="https://github.com/thekiwismarthome/recipe-manager/issues" target="_blank">
          <ha-icon icon="mdi:bug-outline"></ha-icon>
          <div class="help-link-content">
            ${this._tile('mdi:bug-outline', 6)}
          <span class="setting-name">${msg('Report a Problem')}</span>
            <span class="setting-hint">${msg('Submit an issue on GitHub')}</span>
          </div>
          <ha-icon icon="mdi:open-in-new" class="help-link-ext"></ha-icon>
        </a>

        <a class="help-link" href="https://github.com/thekiwismarthome/recipe-manager" target="_blank">
          <ha-icon icon="mdi:github"></ha-icon>
          <div class="help-link-content">
            ${this._tile('mdi:github', 4)}
          <span class="setting-name">${msg('GitHub Repository')}</span>
            <span class="setting-hint">${msg('View source code')}</span>
          </div>
          <ha-icon icon="mdi:open-in-new" class="help-link-ext"></ha-icon>
        </a>
      </div>

      <div class="section">
        <div class="section-label">${msg('About')}</div>

        <div class="setting-row">
          ${this._tile('mdi:chef-hat', 1)}
          <span class="setting-name">${msg('Recipe Manager')}</span>
          <span class="muted-note">${msg(str`Integration version ${this._rmVersion}`)}</span>
        </div>

        <div class="setting-row">
          ${this._tile('mdi:card-text-outline', 2)}
          <span class="setting-name">${msg('RM Card')}</span>
          <span class="muted-note">${msg(str`Card version ${this._rmcVersion}`)}</span>
        </div>

        <div class="setting-row">
          ${this._tile('mdi:refresh', 5)}
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
    .seg-btn.active { background: var(--rm-accent); color: var(--rm-ink, #fff); }
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

    /* ═══ Fresh + Compact ═══ */
    :host([ui-style="fresh"]) .tab-bar,
    :host([ui-style="compact"]) .tab-bar { background: transparent; border-bottom: none; gap: 8px; padding: 16px 16px 4px; }
    :host([ui-style="fresh"]) .tab-item,
    :host([ui-style="compact"]) .tab-item {
      min-height: 40px; padding: 0 16px; border: 1px solid var(--rm-border); border-radius: 999px;
      background: var(--rm-bg-surface); color: var(--rm-text); font-weight: 600; font-size: calc(14px * var(--rm-font-scale, 1));
    }
    :host([ui-style="compact"]) .tab-item { border-radius: 12px; border-color: transparent; }
    :host([ui-style="fresh"]) .tab-item.active,
    :host([ui-style="compact"]) .tab-item.active { background: var(--rm-text); border-color: var(--rm-text); color: var(--rm-bg-main); font-weight: 700; }
    :host([ui-style="fresh"]) .settings-body,
    :host([ui-style="compact"]) .settings-body { padding-bottom: 32px; }
    :host([ui-style="fresh"]) .section-label,
    :host([ui-style="compact"]) .section-label {
      padding: 18px 24px 8px; font-size: calc(12px * var(--rm-font-scale, 1)); letter-spacing: 0.06em; color: var(--rm-text-secondary);
    }
    /* Rows in a section read as one rounded card */
    :host([ui-style="fresh"]) .setting-row,
    :host([ui-style="compact"]) .setting-row {
      margin: 0 16px; padding: 12px 16px; min-height: 60px;
      background: var(--rm-bg-surface);
      border: 1px solid var(--rm-border); border-top: none; border-bottom-color: var(--rm-line);
    }
    :host([ui-style="compact"]) .setting-row { border-color: transparent; border-bottom-color: var(--rm-line); }
    :host([ui-style="fresh"]) .section-label + .setting-row,
    :host([ui-style="compact"]) .section-label + .setting-row { border-top: 1px solid var(--rm-border); border-radius: var(--rm-radius-card) var(--rm-radius-card) 0 0; }
    :host([ui-style="compact"]) .section-label + .setting-row { border-top-color: transparent; }
    :host([ui-style="fresh"]) .setting-row:last-child,
    :host([ui-style="compact"]) .setting-row:last-child { border-bottom-color: var(--rm-border); border-radius: 0 0 var(--rm-radius-card) var(--rm-radius-card); }
    :host([ui-style="compact"]) .setting-row:last-child { border-bottom-color: transparent; }
    :host([ui-style="fresh"]) .section-label + .setting-row:last-child,
    :host([ui-style="compact"]) .section-label + .setting-row:last-child { border-radius: var(--rm-radius-card); }
    :host([ui-style="fresh"]) .setting-name,
    :host([ui-style="compact"]) .setting-name { font-weight: 700; }
    :host([ui-style="fresh"]) .btn-group,
    :host([ui-style="compact"]) .btn-group { border-radius: 14px; padding: 3px; gap: 2px; background: var(--rm-bg-main); }
    :host([ui-style="fresh"]) .seg-btn,
    :host([ui-style="compact"]) .seg-btn { min-height: 38px; padding: 0 14px; border-right: none; border-radius: 11px; font-weight: 600; color: var(--rm-text-secondary); }
    :host([ui-style="fresh"]) .seg-btn.active,
    :host([ui-style="compact"]) .seg-btn.active { background: var(--rm-accent); color: var(--rm-ink); font-weight: 700; }
    :host([ui-style="fresh"]) .theme-select,
    :host([ui-style="compact"]) .theme-select { border-radius: 12px; min-height: 44px; padding: 0 12px; }
    :host([ui-style="fresh"]) .toggle-track,
    :host([ui-style="compact"]) .toggle-track { width: 48px; height: 28px; border-radius: 99px; background: var(--rm-bg-elevated); box-shadow: inset 0 0 0 1px var(--rm-border); }
    :host([ui-style="fresh"]) .toggle-thumb,
    :host([ui-style="compact"]) .toggle-thumb { top: 3px; left: 3px; width: 22px; height: 22px; background: var(--rm-text-secondary); box-shadow: none; }
    :host([ui-style="fresh"]) .toggle input:checked + .toggle-track,
    :host([ui-style="compact"]) .toggle input:checked + .toggle-track { background: var(--rm-accent); box-shadow: none; }
    :host([ui-style="fresh"]) .toggle input:checked ~ .toggle-track .toggle-thumb,
    :host([ui-style="compact"]) .toggle input:checked ~ .toggle-track .toggle-thumb { transform: translateX(20px); background: var(--rm-ink); }
    :host([ui-style="fresh"]) .file-label,
    :host([ui-style="compact"]) .file-label { border-radius: 999px; min-height: 40px; padding: 0 16px; }
    :host([ui-style="fresh"]) .setting-row,
    :host([ui-style="compact"]) .setting-row { flex-wrap: wrap; }
    :host([ui-style="fresh"]) .btn-group,
    :host([ui-style="compact"]) .btn-group { max-width: 100%; overflow-x: auto; scrollbar-width: none; }

    /* ═══ Settings in the demo look: icon tiles, style / theme cards, colour mode ═══ */
    .tile { display: none; }
    :host([ui-style="fresh"]) .tile,
    :host([ui-style="compact"]) .tile {
      display: inline-flex; flex: none; align-items: center; justify-content: center;
      width: 38px; height: 38px; border-radius: 12px;
      background: color-mix(in srgb, var(--hue) 18%, var(--rm-bg-surface)); color: var(--hue);
    }
    :host([ui-style="compact"]) .tile { width: 32px; height: 32px; border-radius: 9px; background: var(--hue); color: var(--rm-bg-main); }
    .tile ha-icon { --mdc-icon-size: 20px; }
    :host([ui-style="compact"]) .tile ha-icon { --mdc-icon-size: 18px; }
    :host([ui-style="fresh"]) .setting-info,
    :host([ui-style="compact"]) .setting-info { flex: 1; }
    :host([ui-style="fresh"]) .setting-row > .setting-name,
    :host([ui-style="compact"]) .setting-row > .setting-name { flex: 1; min-width: 0; text-align: left; }
    :host([ui-style="fresh"]) .setting-hint,
    :host([ui-style="compact"]) .setting-hint { color: var(--rm-text-secondary); font-size: calc(13px * var(--rm-font-scale, 1)); }
    .setting-row.block { display: block; padding: 12px; min-height: 0; }

    .style-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .style-option {
      display: flex; flex-direction: column; gap: 6px; padding: 8px;
      border: 2px solid var(--rm-border); border-radius: 14px; background: transparent;
      color: var(--rm-text); text-align: left; cursor: pointer; font: inherit;
    }
    .style-option.selected { border-color: var(--rm-accent); background: color-mix(in srgb, var(--rm-accent) 10%, transparent); }
    .style-option:focus-visible, .theme-card:focus-visible, .mode-opt:focus-visible { outline: 2px solid var(--rm-accent); outline-offset: 2px; }
    .so-label { font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 700; }
    .so-hint { font-size: calc(11px * var(--rm-font-scale, 1)); line-height: 1.25; color: var(--rm-text-secondary); }
    .sp { position: relative; display: block; height: 58px; border-radius: 8px; background: var(--rm-bg-main); border: 1px solid var(--rm-border); overflow: hidden; }
    .sp::before { content: ""; position: absolute; left: 6px; right: 6px; top: 6px; height: 8px; border-radius: 3px; background: var(--rm-border); }
    .sp::after { content: ""; position: absolute; left: 6px; right: 6px; top: 20px; height: 14px; border-radius: 3px; background: var(--rm-bg-surface); box-shadow: 0 16px 0 -2px var(--rm-bg-surface); }
    .sp-fresh::after { border-radius: 7px; border: 1px solid var(--rm-border); box-sizing: border-box; height: 16px; }
    .sp-fresh { background-image: linear-gradient(var(--rm-accent), var(--rm-accent)); background-repeat: no-repeat; background-size: 60% 7px; background-position: center bottom 5px; }
    .sp-compact { background-image: linear-gradient(var(--rm-accent), var(--rm-accent)); background-repeat: no-repeat; background-size: 26% 3px; background-position: 50% bottom 0; }
    .sp-compact::after { border-radius: 0; box-shadow: none; border-bottom: 1px solid var(--rm-border); background: transparent; height: 8px; top: 22px; }
    .sp-classic { background: #fafbfc; }
    .sp-classic::before { background: #e8eaf6; }
    .sp-classic::after { background: #fff; border-radius: 6px; border: 1px solid #e8eaf6; box-sizing: border-box; height: 16px; box-shadow: 0 16px 0 -2px #fff; }

    .theme-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .theme-card {
      display: flex; flex-direction: column; gap: 8px; padding: 8px;
      border: 2px solid var(--rm-border); border-radius: 18px; background: var(--rm-bg-surface);
      color: var(--rm-text); font: inherit; text-align: left; cursor: pointer;
    }
    .theme-card.selected { border-color: var(--rm-accent); }
    .theme-sw { display: flex; align-items: flex-end; gap: 4px; height: 56px; padding: 8px; border-radius: 12px; box-sizing: border-box; }
    .theme-sw i { flex: 1; display: block; border-radius: 5px; }
    .theme-name { display: flex; align-items: center; justify-content: space-between; font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 700; }
    .theme-name ha-icon { --mdc-icon-size: 16px; color: var(--rm-accent); }
    .mode-seg { display: flex; gap: 4px; padding: 4px; border-radius: 16px; background: var(--rm-bg-elevated); }
    .mode-opt { flex: 1; min-height: 44px; padding: 0 8px; border: none; border-radius: 12px; background: transparent; color: var(--rm-text-secondary); font: inherit; font-size: calc(14px * var(--rm-font-scale, 1)); font-weight: 600; cursor: pointer; }
    .mode-opt.selected { background: var(--rm-bg-surface); color: var(--rm-text); font-weight: 700; box-shadow: var(--rm-shadow); }

    .text-field { min-width: 0; width: 170px; min-height: 40px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--rm-border); background: var(--rm-bg-surface); color: var(--rm-text); font: inherit; font-size: calc(14px * var(--rm-font-scale, 1)); }
    .text-field:focus-visible { outline: 2px solid var(--rm-accent); outline-offset: 1px; }
  `;
}

try { customElements.define('rm-settings-view', RmSettingsView); } catch {}

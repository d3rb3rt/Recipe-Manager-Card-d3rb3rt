/**
 * Recipe detail view — full recipe with ingredients, directions, nutrition, photos and actions.
 */
import { LitElement, html, css } from 'lit';
import { msg, str } from '@lit/localize';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { scaleAmountString, computeTotal, formatTotal, parseAmount, amountValue, formatNumber } from '../utils/amounts.js';
import { acquire as acquireWakeLock, release as releaseWakeLock, isWakeLockSupported, onChange as onWakeLockChange } from '../services/wake-lock.js';

const WAKE_LOCK_REASON = 'recipe-detail';

// ---------------------------------------------------------------------------
// Minimal Markdown renderer (bold, italic, headers, lists, links, code)
// ---------------------------------------------------------------------------
function _escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _inlineMd(text) {
  return _escHtml(text)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let listTag = null;
  const closeList = () => { if (listTag) { out.push(`</${listTag}>`); listTag = null; } };
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)/); if (h3) { closeList(); out.push(`<h3>${_inlineMd(h3[1])}</h3>`); continue; }
    const h2 = line.match(/^##\s+(.+)/);  if (h2) { closeList(); out.push(`<h2>${_inlineMd(h2[1])}</h2>`); continue; }
    const h1 = line.match(/^#\s+(.+)/);   if (h1) { closeList(); out.push(`<h1>${_inlineMd(h1[1])}</h1>`); continue; }
    const ul = line.match(/^[-*]\s+(.+)/); if (ul) { if (listTag !== 'ul') { closeList(); out.push('<ul>'); listTag='ul'; } out.push(`<li>${_inlineMd(ul[1])}</li>`); continue; }
    const ol = line.match(/^\d+\.\s+(.+)/); if (ol) { if (listTag !== 'ol') { closeList(); out.push('<ol>'); listTag='ol'; } out.push(`<li>${_inlineMd(ol[1])}</li>`); continue; }
    const hr = line.match(/^---+$/); if (hr) { closeList(); out.push('<hr>'); continue; }
    closeList();
    if (line.trim() === '') { out.push('<p class="md-gap"></p>'); } else { out.push(`<p>${_inlineMd(line)}</p>`); }
  }
  closeList();
  return out.join('');
}

const NUTRITION_FIELDS = [
  { key: 'calories',      label: msg('Calories'),          unit: 'kcal', bold: true },
  { key: 'fat',           label: msg('Total Fat'),         unit: 'g' },
  { key: 'saturated_fat', label: msg('Saturated Fat'),     unit: 'g', indent: true },
  { key: 'cholesterol',   label: msg('Cholesterol'),       unit: 'mg' },
  { key: 'sodium',        label: msg('Sodium'),            unit: 'mg' },
  { key: 'carbohydrates', label: msg('Total Carbohydrate'),unit: 'g' },
  { key: 'fiber',         label: msg('Dietary Fiber'),     unit: 'g', indent: true },
  { key: 'sugar',         label: msg('Total Sugars'),      unit: 'g', indent: true },
  { key: 'protein',       label: msg('Protein'),           unit: 'g' },
];

// Regex to find time mentions in directions text
// Matches: "10 minutes", "1 hour", "30 mins", "2 hrs", "45 seconds", "1 hour 30 minutes"
const TIME_RE = /(\d+\s*(?:hours?|hrs?)\s*(?:and\s*)?\d*\s*(?:minutes?|mins?)?|\d+\s*(?:minutes?|mins?|seconds?|secs?|hours?|hrs?))/gi;

function parseTimeToSeconds(text) {
  const t = text.toLowerCase();
  let total = 0;
  const hourM = t.match(/(\d+)\s*h(?:ours?|rs?)?/);
  if (hourM) total += parseInt(hourM[1]) * 3600;
  const minM = t.match(/(\d+)\s*m(?:in(?:utes?)?)?(?!\s*l)/);
  if (minM) total += parseInt(minM[1]) * 60;
  const secM = t.match(/(\d+)\s*s(?:ec(?:onds?)?)?/);
  if (secM) total += parseInt(secM[1]);
  if (!total) {
    const bare = t.match(/^(\d+)$/);
    if (bare) total = parseInt(bare[1]) * 60;
  }
  return total || 0;
}

// Daily Reference Values (FDA / EU)
const RDA = {
  calories:      { label: msg('Calories'),          val: 2000, unit: 'kcal' },
  fat:           { label: msg('Total Fat'),         val: 65,   unit: 'g'    },
  saturated_fat: { label: msg('Saturated Fat'),     val: 20,   unit: 'g'    },
  cholesterol:   { label: msg('Cholesterol'),       val: 300,  unit: 'mg'   },
  sodium:        { label: msg('Sodium'),            val: 2300, unit: 'mg'   },
  carbohydrates: { label: msg('Total Carbohydrate'),val: 300,  unit: 'g'    },
  fiber:         { label: msg('Dietary Fiber'),     val: 28,   unit: 'g'    },
  sugar:         { label: msg('Added Sugars'),      val: 50,   unit: 'g'    },
  protein:       { label: msg('Protein'),           val: 50,   unit: 'g'    },
};

// Imperial → metric conversion factors
const IMPERIAL_TO_METRIC = {
  'oz':     { factor: 28.3495, to: 'g',  toFull: 'g'  },
  'lb':     { factor: 453.592, to: 'g',  toFull: 'g', thresholdKg: 500 },
  'cup':    { factor: 250,     to: 'ml', toFull: 'ml' },
  'cups':   { factor: 250,     to: 'ml', toFull: 'ml' },
  'fl oz':  { factor: 29.5735, to: 'ml', toFull: 'ml' },
  'pt':     { factor: 473.176, to: 'ml', toFull: 'ml' },
  'qt':     { factor: 946.353, to: 'ml', toFull: 'ml' },
};

function convertToMetric(amount, unit) {
  if (!amount || !unit) return null;
  const num = amountValue(amount);
  if (num === null || isNaN(num)) return null;
  const key = unit.toLowerCase().trim();
  const conv = IMPERIAL_TO_METRIC[key];
  if (!conv) return null;
  let result = num * conv.factor;
  let resultUnit = conv.to;
  // For lb → use kg if ≥ 500g
  if (key === 'lb' && result >= 500) { result = result / 1000; resultUnit = 'kg'; }
  // For ml → use L if ≥ 1000ml
  if (resultUnit === 'ml' && result >= 1000) { result = result / 1000; resultUnit = 'L'; }
  // Round sensibly
  const rounded = result >= 10 ? Math.round(result) : Math.round(result * 10) / 10;
  return { amount: String(rounded), unit: resultUnit };
}

class RmRecipeDetail extends LitElement {
  static properties = {
    recipe:              { type: Object },
    api:                 { type: Object },
    shoppingLists:       { type: Array },
    slmAvailable:        { type: Boolean },
    settings:            { type: Object },
    wide:                { type: Boolean },
    _editing:            { type: Boolean },
    _editData:           { type: Object },
    _servingMult:        { type: Number },
    _editingTotal:       { type: Boolean },
    _confirmSaveMult:    { type: Boolean },
    _savingMult:         { type: Boolean },
    _activeTab:          { type: String },  // 'ingredients'|'directions'|'notes'|'nutrition'|'photos'
    _showShoppingPicker: { type: Boolean },
    _selectedListId:     { type: String },
    _checkedIngredients: { type: Object },  // Set of indices
    _shoppingAdding:     { type: Boolean },
    _shoppingResult:     { type: String },
    _shoppingReview:     { type: Array },
    _confirmDelete:      { type: Boolean },
    _downloading:        { type: Boolean },
    _photoUrlInput:      { type: String },
    _addingPhotoUrl:     { type: Boolean },
    _metricMode:         { type: Boolean },
    _wakeActive:         { type: Boolean },
    _completedSteps:     { type: Object },  // Set of completed step indices
    _openStepIngs:       { type: Object },  // Set of step indices whose ingredient list is expanded
    _doneIngredients:    { type: Object },  // Set of ingredient indices ticked off while cooking
    _editIngInput:        { type: String },
    _editStepInput:       { type: String },
    _nutritionExpanded:   { type: Boolean },
    _dragIngOver:         { type: Number },
    _dragStepOver:        { type: Number },
    _editImageUploading:  { type: Boolean },
    _slideIdx:            { type: Number },
    // List picker (tags/courses/categories/collections)
    allTags:              { type: Array },
    allCourses:           { type: Array },
    allCategories:        { type: Array },
    allCollections:       { type: Array },
    _tagPickerField:      { type: String },
    _tagPickerInput:      { type: String },
    // Inline ingredient editing
    _editIngEdit:         { type: Object },
  };

  constructor() {
    super();
    this.recipe = null;
    this.api = null;
    this.shoppingLists = [];
    this.slmAvailable = false;
    this.settings = {};
    this.wide = false;
    this._editing = false;
    this._editData = {};
    this._servingMult = 1;
    this._editingTotal = false;
    this._confirmSaveMult = false;
    this._savingMult = false;
    this._activeTab = 'ingredients';
    this._showShoppingPicker = false;
    this._selectedListId = '';
    this._checkedIngredients = null;
    this._shoppingAdding = false;
    this._shoppingResult = null;
    this._shoppingReview = null;
    this._confirmDelete = false;
    this._downloading = false;
    this._photoUrlInput = '';
    this._addingPhotoUrl = false;
    this._metricMode = this.settings?.unitSystem === 'metric';
    this._wakeActive = false;
    this._completedSteps = new Set();
    this._openStepIngs = new Set();
    this._doneIngredients = new Set();
    this._editIngInput = '';
    this._editStepInput = '';
    this._nutritionExpanded = false;
    this._dragIngOver = -1;
    this._dragStepOver = -1;
    this._dragIngFrom = -1;
    this._dragStepFrom = -1;
    this._editImageUploading = false;
    this._slideIdx = 0;
    this.allTags = [];
    this.allCourses = [];
    this.allCategories = [];
    this.allCollections = [];
    this._tagPickerField = null;
    this._tagPickerInput = '';
    this._editIngEdit = null;
    this._slideTimer = null;
    this._slideTouchStartX = null;
    this._wakeLockTimeout = null;
    this._wakeLockUnsubscribeFn = null;
  }

  connectedCallback() {
    super.connectedCallback();
    // Keep _wakeActive in sync even if the lock is released by the browser
    // itself (e.g. another tab/component reason changed) rather than by us.
    this._wakeLockUnsubscribeFn = onWakeLockChange(active => { this._wakeActive = active; });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._releaseWakeLock();
    this._wakeLockUnsubscribeFn?.();
    this._wakeLockUnsubscribeFn = null;
    this._stopSlideTimer();
  }

  // -- Wake Lock -------------------------------------------------------------
  // Auto-engages whenever a recipe is open and "keep screen on" is enabled
  // in settings (see updated() below) — the button is a manual override on
  // top of that, e.g. to release it early or to engage it once even when
  // the setting is off.

  async _requestWakeLock() {
    if (this._wakeLockTimeout) { clearTimeout(this._wakeLockTimeout); this._wakeLockTimeout = null; }
    await acquireWakeLock(WAKE_LOCK_REASON);
    const durationMin = this.settings?.wakeLockDuration ?? 60;
    this._wakeLockTimeout = setTimeout(() => this._releaseWakeLock(), durationMin * 60_000);
  }

  async _releaseWakeLock() {
    if (this._wakeLockTimeout) { clearTimeout(this._wakeLockTimeout); this._wakeLockTimeout = null; }
    await releaseWakeLock(WAKE_LOCK_REASON);
  }

  updated(changedProps) {
    if (changedProps.has('recipe') && !this.recipe) {
      this._servingMult = 1;
      this._editingTotal = false;
      this._confirmSaveMult = false;
    }
    if (changedProps.has('recipe') && this.recipe) {
      const prev = changedProps.get('recipe');
      const differentRecipe = !prev || prev.id !== this.recipe.id;
      this._servingMult = 1;
      this._editingTotal = false;
      this._confirmSaveMult = false;
      if (differentRecipe) {
        this._editing = false;
        this._confirmDelete = false;
        this._shoppingResult = null;
        this._shoppingReview = null;
        this._showShoppingPicker = false;
        this._checkedIngredients = null;
        this._photoUrlInput = '';
        this._metricMode = this.settings?.unitSystem === 'metric';
        this._completedSteps = new Set();
        this._openStepIngs = new Set();
        this._doneIngredients = new Set();
      }
      this._slideIdx = 0;
      this._startSlideTimer();
    }
    if (changedProps.has('settings')) {
      this._startSlideTimer();
    }
    if ((changedProps.has('recipe') || changedProps.has('settings')) && this.recipe) {
      if (this.settings?.keepScreenOn) this._requestWakeLock();
      else this._releaseWakeLock();
    }
    if (changedProps.has('recipe') && !this.recipe) {
      this._releaseWakeLock();
    }
    if (changedProps.has('shoppingLists') && this.shoppingLists.length && !this._selectedListId) {
      this._selectedListId = this.shoppingLists[0]?.id ?? '';
    }
  }

  _formatTime(minutes) {
    if (!minutes) return null;
    if (minutes < 60) return msg(str`${minutes} min`);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? msg(str`${h}h ${m}m`) : msg(str`${h}h`);
  }

  _scaleAmount(amount) {
    return scaleAmountString(amount, this._servingMult);
  }

  // Total amount (sum of all g/ml ingredients). Shown/editable when the recipe is
  // clearly weight/volume based (e.g. ice cream, sauces), or its servings text says so.
  _baseTotal() {
    const r = this.recipe;
    const t = computeTotal(r?.ingredients);
    if (!t) return null;
    const flagged = /^\s*(gesamt|total|yield|ergibt|menge)/i.test(r.servings_text || '');
    if (!flagged && t.share < 0.8) return null;
    return t;
  }

  // Text for the "Serves" box. For total-amount recipes ("Gesamtmenge ca. 780 g")
  // show the live computed total so it always matches the total chip.
  _servesText() {
    const r = this.recipe;
    const base = this._baseTotal();
    const txt = r.servings_text || '';
    if (base && /^\s*gesamt/i.test(txt)) {
      const prefix = txt.replace(/\d[\s\S]*$/, '');
      return `${prefix}${formatTotal(base.total * this._servingMult, base.unit)}`;
    }
    return txt || r.servings;
  }

  _onSaveMultClick() {
    if (!this._confirmSaveMult) {
      this._confirmSaveMult = true;
      clearTimeout(this._confirmSaveTimer);
      this._confirmSaveTimer = setTimeout(() => { this._confirmSaveMult = false; }, 4000);
      return;
    }
    this._saveScaledRecipe();
  }

  // Persist the currently scaled amounts as the recipe's new amounts / serving size.
  _saveScaledRecipe() {
    const r = this.recipe;
    const mult = this._servingMult;
    if (!r || mult === 1) return;
    clearTimeout(this._confirmSaveTimer);
    const base = this._baseTotal();
    const ingredients = (r.ingredients || []).map(ing => (
      ing.is_heading || ing.name?.startsWith('#') || !ing.amount
        ? ing
        : { ...ing, amount: scaleAmountString(ing.amount, mult) }
    ));
    const data = { ingredients };
    if (base && /^\s*gesamt/i.test(r.servings_text || '')) {
      data.servings_text = this._servesText();
    } else {
      if (r.servings) data.servings = Math.max(1, Math.round(r.servings * mult));
      const m = /^(\s*)(\d+(?:[.,]\d+)?)(.*)$/.exec(r.servings_text || '');
      if (m) data.servings_text = `${m[1]}${scaleAmountString(m[2], mult)}${m[3]}`;
    }
    this._savingMult = true;
    this._confirmSaveMult = false;
    this.dispatchEvent(new CustomEvent('rm-update-recipe', {
      detail: { recipeId: r.id, data },
      bubbles: true,
      composed: true,
    }));
    // The recipe prop is refreshed after the update, which resets the multiplier to ×1.
    setTimeout(() => { this._savingMult = false; }, 1500);
  }

  _startTotalEdit() {
    this._editingTotal = true;
    this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector('.total-input');
      if (el) { el.focus(); el.select(); }
    });
  }

  _commitTotal(e) {
    const base = this._baseTotal();
    this._editingTotal = false;
    if (!base) return;
    const p = parseAmount(e.target.value);
    const val = p ? p.values[0] : null;
    if (!val || val <= 0) return;
    const mult = val / base.total;
    this._servingMult = Math.min(100, Math.max(0.01, mult));
  }

  // -- Actions ------------------------------------------------------------------

  _startEdit() {
    const n = this.recipe.nutrition || {};
    this._editData = {
      name:          this.recipe.name || '',
      description:   this.recipe.description || '',
      source_url:    this.recipe.source_url || '',
      servings:      this.recipe.servings || '',
      prep_time:     this.recipe.prep_time || '',
      cook_time:     this.recipe.cook_time || '',
      tags:          [...(this.recipe.tags || [])],
      courses:       [...(this.recipe.courses || [])],
      categories:    [...(this.recipe.categories || [])],
      collections:   [...(this.recipe.collections || [])],
      notes:         this.recipe.notes || '',
      rating:        this.recipe.rating || 0,
      image_url:     this.recipe.image_url || '',
      photos:        [...(this.recipe.photos || [])],
      ingredients:   [...(this.recipe.ingredients || [])],
      instructions:  [...(this.recipe.instructions || [])],
      // Nutrition
      cal:  n.calories      || '',
      fat:  n.fat           || '',
      satf: n.saturated_fat || '',
      chol: n.cholesterol   || '',
      sod:  n.sodium        || '',
      carb: n.carbohydrates || '',
      fib:  n.fiber         || '',
      sug:  n.sugar         || '',
      prot: n.protein       || '',
    };
    this._editing = true;
  }

  _cancelEdit() {
    this._editing = false;
    this._editData = {};
  }

  _handleEditField(field, value) {
    this._editData = { ...this._editData, [field]: value };
  }

  // -- List picker (tags / courses / categories / collections) ---------------

  _renderListPicker(field, label, allValues) {
    const current = this._editData[field] || [];
    const open = this._tagPickerField === field;
    const available = (allValues || []).filter(v => !current.includes(v));
    const inputVal = open ? this._tagPickerInput : '';
    return html`
      <div class="edit-field list-picker-field">
        <label>${label}</label>
        <div class="list-picker-wrap">
          <!-- Selected chips -->
          <div class="list-picker-chips">
            ${current.map(v => html`
              <span class="list-chip selected">
                ${v}
                <button class="list-chip-remove" @click=${() => this._toggleListValue(field, v)} title="${msg('Remove')}">×</button>
              </span>
            `)}
            <button class="list-chip-add-btn" @click=${() => {
              this._tagPickerField = open ? null : field;
              this._tagPickerInput = '';
            }} title="${msg(str`Add ${label.toLowerCase()}`)}">
              <ha-icon icon="mdi:plus"></ha-icon>
            </button>
          </div>
          <!-- Picker dropdown -->
          ${open ? html`
            <div class="list-picker-dropdown">
              ${available.length ? html`
                <div class="list-picker-existing">
                  ${available.map(v => html`
                    <span class="list-chip available" @click=${() => { this._toggleListValue(field, v); }}>
                      ${v}
                    </span>
                  `)}
                </div>
              ` : ''}
              <div class="list-picker-new-row">
                <input class="list-picker-input" type="text" placeholder="${msg(str`New ${label.toLowerCase()}…`)}"
                  .value=${inputVal}
                  @input=${e => { this._tagPickerInput = e.target.value; }}
                  @keydown=${e => {
                    if (e.key === 'Enter') { e.preventDefault(); this._addListValue(field, this._tagPickerInput); }
                    if (e.key === 'Escape') { this._tagPickerField = null; }
                  }}
                />
                <button class="list-picker-new-btn" @click=${() => this._addListValue(field, this._tagPickerInput)}
                  ?disabled=${!this._tagPickerInput.trim()}>
                  ${msg('Add')}
                </button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  _toggleListValue(field, value) {
    const cur = this._editData[field] || [];
    const updated = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    this._editData = { ...this._editData, [field]: updated };
  }

  _addListValue(field, rawValue) {
    const value = (rawValue || '').trim();
    if (!value) return;
    const cur = this._editData[field] || [];
    if (!cur.includes(value)) {
      this._editData = { ...this._editData, [field]: [...cur, value] };
    }
    this._tagPickerInput = '';
    this._tagPickerField = null;
  }

  // -- Inline ingredient editing --------------------------------------------

  _startEditIngredient(idx) {
    const ing = (this._editData.ingredients || [])[idx];
    if (!ing) return;
    if (ing.is_heading || ing.name?.startsWith('#')) {
      const name = ing.name?.startsWith('#') ? ing.name.slice(1).trim() : ing.name;
      this._editIngEdit = { idx, heading: true, name };
    } else {
      this._editIngEdit = { idx, heading: false, amount: ing.amount || '', unit: ing.unit || '', name: ing.name || '' };
    }
  }

  _saveEditIngredient() {
    const e = this._editIngEdit;
    if (!e) return;
    const ings = [...(this._editData.ingredients || [])];
    if (e.heading) {
      ings[e.idx] = { name: `# ${e.name}`, is_heading: true };
    } else {
      ings[e.idx] = { amount: e.amount, unit: e.unit, name: e.name };
    }
    this._editData = { ...this._editData, ingredients: ings };
    this._editIngEdit = null;
  }

  _cancelEditIngredient() {
    this._editIngEdit = null;
  }

  _editAddIngredient() {
    const raw = this._editIngInput.trim();
    if (!raw) return;
    let newIng;
    if (raw.startsWith('#')) {
      newIng = { name: raw, is_heading: true };
    } else {
      const parts = raw.split(/\s+/);
      let amount = '', unit = '', name = '';
      if (parts.length >= 3 && !isNaN(parseFloat(parts[0]))) {
        amount = parts[0]; unit = parts[1]; name = parts.slice(2).join(' ');
      } else if (parts.length === 2 && !isNaN(parseFloat(parts[0]))) {
        amount = parts[0]; name = parts[1];
      } else { name = raw; }
      newIng = { amount, unit, name };
    }
    this._editData = { ...this._editData, ingredients: [...(this._editData.ingredients || []), newIng] };
    this._editIngInput = '';
  }


  _editRemoveIngredient(idx) {
    this._editData = { ...this._editData, ingredients: (this._editData.ingredients || []).filter((_, i) => i !== idx) };
  }

  _editMoveIngredient(idx, dir) {
    const arr = [...(this._editData.ingredients || [])];
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    this._editData = { ...this._editData, ingredients: arr };
  }

  _editMoveStep(idx, dir) {
    const arr = [...(this._editData.instructions || [])];
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    this._editData = { ...this._editData, instructions: arr };
  }

  _editDropIngredient(from, to) {
    if (from === to || from < 0 || to < 0) return;
    const arr = [...(this._editData.ingredients || [])];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    this._editData = { ...this._editData, ingredients: arr };
    this._dragIngOver = -1;
    this._dragIngFrom = -1;
  }

  _editDropStep(from, to) {
    if (from === to || from < 0 || to < 0) return;
    const arr = [...(this._editData.instructions || [])];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    this._editData = { ...this._editData, instructions: arr };
    this._dragStepOver = -1;
    this._dragStepFrom = -1;
  }

  _editAddStep(text) {
    if (!text.trim()) return;
    this._editData = { ...this._editData, instructions: [...(this._editData.instructions || []), text.trim()] };
  }

  _editRemoveStep(idx) {
    this._editData = { ...this._editData, instructions: (this._editData.instructions || []).filter((_, i) => i !== idx) };
  }

  async _editUploadImage(file) {
    if (!file || !this.recipe?.id) return;
    this._editImageUploading = true;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const b64 = ev.target.result.split(',')[1];
      try {
        const result = await this.api.uploadRecipeImage(this.recipe.id, b64);
        const url = result?.image_url || result?.local_url;
        if (url) {
          this._editData = {
            ...this._editData,
            image_url: this._editData.image_url || url,
            photos: [...new Set([...(this._editData.photos || []), url])],
          };
        }
      } catch (err) {
        console.warn('Image upload failed:', err);
      } finally {
        this._editImageUploading = false;
      }
    };
    reader.readAsDataURL(file);
  }

  async _saveEdit() {
    const d = this._editData;

    const nutrition = {};
    const nMap = { cal:'calories', fat:'fat', satf:'saturated_fat', chol:'cholesterol',
                   sod:'sodium', carb:'carbohydrates', fib:'fiber', sug:'sugar', prot:'protein' };
    let hasNutrition = false;
    for (const [k, nk] of Object.entries(nMap)) {
      if (d[k] !== '' && d[k] != null) {
        nutrition[nk] = d[k];
        hasNutrition = true;
      }
    }

    const data = {
      name:        d.name,
      description: d.description,
      source_url:  d.source_url,
      image_url:   d.image_url || null,
      servings:    parseInt(d.servings) || null,
      prep_time:   parseInt(d.prep_time) || null,
      cook_time:   parseInt(d.cook_time) || null,
      tags:        Array.isArray(d.tags) ? d.tags : [],
      courses:     Array.isArray(d.courses) ? d.courses : [],
      categories:  Array.isArray(d.categories) ? d.categories : [],
      collections: Array.isArray(d.collections) ? d.collections : [],
      notes:        d.notes,
      rating:       d.rating || null,
      photos:       d.photos || [],
      ingredients:  d.ingredients || [],
      instructions: d.instructions || [],
      nutrition:    hasNutrition ? nutrition : null,
    };
    this.dispatchEvent(new CustomEvent('rm-update-recipe', {
      detail: { recipeId: this.recipe.id, data },
      bubbles: true,
      composed: true,
    }));
    this._editing = false;
  }

  _handleToggleFav() {
    this.dispatchEvent(new CustomEvent('rm-toggle-favourite', {
      detail: { recipeId: this.recipe.id },
      bubbles: true,
      composed: true,
    }));
  }

  async _handleDownloadImage() {
    if (!this.recipe.image_url) return;
    this._downloading = true;
    try {
      const result = await this.api.downloadRecipeImage(this.recipe.id, this.recipe.image_url);
      if (result?.local_url) {
        this.dispatchEvent(new CustomEvent('rm-update-recipe', {
          detail: { recipeId: this.recipe.id, data: { image_url: result.local_url } },
          bubbles: true,
          composed: true,
        }));
      }
    } catch (err) {
      console.warn('Image download failed:', err);
    } finally {
      this._downloading = false;
    }
  }

  _handleDeleteRecipe() {
    if (!this._confirmDelete) {
      this._confirmDelete = true;
      setTimeout(() => { this._confirmDelete = false; }, 3000);
      return;
    }
    this.dispatchEvent(new CustomEvent('rm-delete-recipe', {
      detail: { recipeId: this.recipe.id },
      bubbles: true,
      composed: true,
    }));
  }

  _openShoppingPicker() {
    // Default: NO items checked — user selects what they need
    this._checkedIngredients = new Set();
    this._showShoppingPicker = true;
  }

  _toggleIngredient(index) {
    const newSet = new Set(this._checkedIngredients);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    this._checkedIngredients = newSet;
  }

  _selectAllIngredients() {
    const count = this.recipe?.ingredients?.length ?? 0;
    this._checkedIngredients = new Set([...Array(count).keys()]);
  }

  _clearAllIngredients() {
    this._checkedIngredients = new Set();
  }

  async _handleAddToShopping() {
    const checked = this._checkedIngredients;
    if (!checked?.size) return;

    const ingredients = (this.recipe.ingredients || [])
      .filter((_, i) => checked.has(i) && !this.recipe.ingredients[i]?.is_heading && !this.recipe.ingredients[i]?.name?.startsWith('#'))
      .map(ing => ({ ...ing, amount: this._scaleAmount(ing.amount) }));

    // No SLM or no list selected → dispatch directly (no product matching)
    if (!this.slmAvailable || !this._selectedListId) {
      await this._dispatchShoppingAdd(ingredients.map(ing => ({ ing, selectedId: null, products: [] })));
      return;
    }

    // Search SLM product catalog for each ingredient to build review
    this._shoppingAdding = true;
    const reviewItems = await Promise.all(ingredients.map(async (ing) => {
      try {
        const res = await this.api.searchSlmProducts(ing.name, 4);
        const products = res?.products ?? [];
        const exact = products.find(p => p.name.toLowerCase() === ing.name.toLowerCase());
        return { ing, products, selectedId: exact?.id ?? null };
      } catch {
        return { ing, products: [], selectedId: null };
      }
    }));
    this._shoppingAdding = false;
    this._shoppingReview = reviewItems;
  }

  _selectReviewMatch(idx, productId) {
    this._shoppingReview = this._shoppingReview.map((item, i) =>
      i === idx ? { ...item, selectedId: productId } : item
    );
  }

  async _confirmShoppingReview() {
    await this._dispatchShoppingAdd(this._shoppingReview);
  }

  async _dispatchShoppingAdd(reviewItems) {
    const ingredients = reviewItems.map(({ ing, selectedId, products }) => {
      const product = products?.find(p => p.id === selectedId);
      return {
        ...ing,
        product_id: product?.id ?? null,
        product_name: product?.name ?? null,
        category_id: product?.category_id ?? null,
      };
    });
    this._shoppingAdding = true;
    this._shoppingResult = null;
    this.dispatchEvent(new CustomEvent('rm-add-to-shopping', {
      detail: { ingredients, listId: this._selectedListId || null, recipeName: this.recipe.name },
      bubbles: true,
      composed: true,
    }));
    await new Promise(r => setTimeout(r, 600));
    this._shoppingAdding = false;
    this._shoppingResult = 'success';
    this._shoppingReview = null;
    this._showShoppingPicker = false;
    setTimeout(() => { this._shoppingResult = null; }, 2500);
  }

  _renderShoppingReview() {
    const review = this._shoppingReview;
    if (!review) return html``;
    return html`
      <div class="shopping-review-panel">
        <div class="review-title">${msg('Match Items to Products')}</div>
        <div class="review-list">
          ${review.map((item, idx) => html`
            <div class="review-row">
              <div class="review-ing">
                ${item.ing.amount ? html`<span class="review-qty">${item.ing.amount}${item.ing.unit ? ` ${item.ing.unit}` : ''}</span>` : ''}
                <span class="review-ing-name">${item.ing.name}</span>
              </div>
              <div class="review-chips">
                ${item.products.slice(0, 3).map(p => html`
                  <button class="review-chip ${item.selectedId === p.id ? 'selected' : ''}"
                    @click=${() => this._selectReviewMatch(idx, p.id)}>
                    ${item.selectedId === p.id ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}${p.name}
                  </button>
                `)}
                <button class="review-chip manual ${item.selectedId === null ? 'selected' : ''}"
                  @click=${() => this._selectReviewMatch(idx, null)}>
                  ${item.selectedId === null ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}${msg('Add manually')}
                </button>
              </div>
            </div>
          `)}
        </div>
        <div class="picker-btns review-btns">
          <button class="action-btn" @click=${() => { this._shoppingReview = null; }}>${msg('Back')}</button>
          <button class="action-btn primary"
            ?disabled=${this._shoppingAdding}
            @click=${this._confirmShoppingReview}>
            ${this._shoppingAdding
              ? html`<ha-circular-progress active size="tiny"></ha-circular-progress>`
              : msg(str`Confirm & Add ${review.length}`)}
          </button>
        </div>
      </div>
    `;
  }

  _handleQuickRate(n) {
    const newRating = this.recipe.rating === n ? null : n;
    this.dispatchEvent(new CustomEvent('rm-update-recipe', {
      detail: { recipeId: this.recipe.id, data: { rating: newRating } },
      bubbles: true, composed: true,
    }));
  }

  _handleShowPlanner() {
    this.dispatchEvent(new CustomEvent('rm-show-planner', { bubbles: true, composed: true }));
  }

  _handleChipNav(filterMode, value) {
    this.dispatchEvent(new CustomEvent('rm-chip-nav', {
      detail: { filterMode, value },
      bubbles: true,
      composed: true,
    }));
  }

  // -- Timer helpers ----------------------------------------------------------

  _fireTimer(seconds, label) {
    const recipeName = this.recipe?.name;
    const fullLabel = recipeName ? msg(str`${recipeName} — ${label}`) : label;
    this.dispatchEvent(new CustomEvent('rm-start-timer', {
      detail: { seconds, label: fullLabel },
      bubbles: true,
      composed: true,
    }));
  }

  // -- Photos -----------------------------------------------------------------

  async _handleAddPhotoUrl() {
    const url = this._photoUrlInput.trim();
    if (!url) return;
    this._addingPhotoUrl = true;
    try {
      // For now, set it as the main image_url (first photo sets main image)
      const existingPhotos = this.recipe.photos || [];
      const newPhotos = [...existingPhotos, url];
      const updateData = { photos: newPhotos };
      // If no main image, also set it as image_url
      if (!this.recipe.image_url) updateData.image_url = url;
      this.dispatchEvent(new CustomEvent('rm-update-recipe', {
        detail: { recipeId: this.recipe.id, data: updateData },
        bubbles: true,
        composed: true,
      }));
      this._photoUrlInput = '';
    } finally {
      this._addingPhotoUrl = false;
    }
  }

  _handleCameraCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const b64 = ev.target.result.split(',')[1];
      try {
        // Backend handles appending to photos list and firing recipe_updated event
        await this.api.uploadRecipeImage(this.recipe.id, b64);
      } catch (err) {
        console.warn('Camera upload failed:', err);
      }
    };
    reader.readAsDataURL(file);
  }

  _setMainPhoto(url) {
    this.dispatchEvent(new CustomEvent('rm-update-recipe', {
      detail: { recipeId: this.recipe.id, data: { image_url: url } },
      bubbles: true,
      composed: true,
    }));
  }

  _removePhoto(url) {
    const newPhotos = (this.recipe.photos || []).filter(p => p !== url);
    const updateData = { photos: newPhotos };
    if (this.recipe.image_url === url) {
      updateData.image_url = newPhotos[0] || null;
    }
    this.dispatchEvent(new CustomEvent('rm-update-recipe', {
      detail: { recipeId: this.recipe.id, data: updateData },
      bubbles: true,
      composed: true,
    }));
  }

  // -- Slideshow ----------------------------------------------------------

  _getSlideImages() {
    const r = this.recipe;
    if (!r) return [];
    const all = [r.image_url, ...(r.photos || [])].filter(Boolean);
    return [...new Set(all)];
  }

  _prevSlide() {
    const imgs = this._getSlideImages();
    if (imgs.length < 2) return;
    this._slideIdx = (this._slideIdx - 1 + imgs.length) % imgs.length;
    this._startSlideTimer();
  }

  _nextSlide() {
    const imgs = this._getSlideImages();
    if (imgs.length < 2) return;
    this._slideIdx = (this._slideIdx + 1) % imgs.length;
    this._startSlideTimer();
  }

  _startSlideTimer() {
    this._stopSlideTimer();
    const interval = this.settings?.slideshowInterval ?? 5;
    if (interval <= 0) return;
    const imgs = this._getSlideImages();
    if (imgs.length < 2) return;
    this._slideTimer = setInterval(() => {
      this._slideIdx = (this._slideIdx + 1) % this._getSlideImages().length;
    }, interval * 1000);
  }

  _stopSlideTimer() {
    if (this._slideTimer) { clearInterval(this._slideTimer); this._slideTimer = null; }
  }

  _slideTouchStart(e) {
    this._slideTouchStartX = e.touches[0]?.clientX ?? null;
  }

  _slideTouchEnd(e) {
    if (this._slideTouchStartX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - this._slideTouchStartX;
    this._slideTouchStartX = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) this._nextSlide(); else this._prevSlide();
  }

  // -- Render -------------------------------------------------------------------

  _renderSlideshow(r) {
    const imgs = this._getSlideImages();
    const idx = Math.min(this._slideIdx, imgs.length - 1);
    const multi = imgs.length > 1;
    const src = imgs[idx] || null;
    return html`
      <div class="wide-image-square"
        @touchstart=${multi ? this._slideTouchStart : null}
        @touchend=${multi ? this._slideTouchEnd : null}>
        ${src ? html`<img src="${src}" alt="${r.name}" />` : html`
          <div class="hero-placeholder">
            <ha-icon icon="mdi:food"></ha-icon>
          </div>
        `}
        ${multi ? html`
          <button class="slide-btn slide-prev" @click=${this._prevSlide} title="${msg('Previous')}">
            <ha-icon icon="mdi:chevron-left"></ha-icon>
          </button>
          <button class="slide-btn slide-next" @click=${this._nextSlide} title="${msg('Next')}">
            <ha-icon icon="mdi:chevron-right"></ha-icon>
          </button>
          <div class="slide-dots">
            ${imgs.map((_, i) => html`<span class="slide-dot ${i === idx ? 'active' : ''}"></span>`)}
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderChipGroup(label, items, cssClass) {
    if (!items?.length) return '';
    return html`
      <div class="chip-group">
        <span class="chip-group-label">${label}:</span>
        ${items.map(t => html`<span class="chip ${cssClass}">${t}</span>`)}
      </div>
    `;
  }

  _renderChipGroups(r) {
    const courses    = r.courses    || [];
    const categories = r.categories || [];
    const collections= r.collections|| [];
    if (!courses.length && !categories.length && !collections.length) return '';
    return html`
      <div class="chips-area">
        ${courses.length ? html`
          <div class="chip-group-row">
            <span class="chip chip-label">${msg('Course:')}</span>
            ${courses.map(t => html`<button class="chip chip-course chip-nav" @click=${() => this._handleChipNav('courses', t)} title="${msg(str`Filter by course: ${t}`)}">${t}</button>`)}
          </div>` : ''}
        ${categories.length ? html`
          <div class="chip-group-row">
            <span class="chip chip-label">${msg('Category:')}</span>
            ${categories.map(t => html`<button class="chip chip-category chip-nav" @click=${() => this._handleChipNav('categories', t)} title="${msg(str`Filter by category: ${t}`)}">${t}</button>`)}
          </div>` : ''}
        ${collections.length ? html`
          <div class="chip-group-row">
            <span class="chip chip-label">${msg('Collection:')}</span>
            ${collections.map(t => html`<button class="chip chip-collection chip-nav" @click=${() => this._handleChipNav('collections', t)} title="${msg(str`Filter by collection: ${t}`)}">${t}</button>`)}
          </div>` : ''}
      </div>
    `;
  }

  _renderMetaRow(r) {
    const hasAny = r.servings || r.prep_time || r.cook_time || r.total_time;
    if (!hasAny) return '';
    const totalTime = r.total_time || (r.prep_time || 0) + (r.cook_time || 0) || null;
    const calcTotal = (r.prep_time || 0) + (r.cook_time || 0);
    const showTotal = totalTime && totalTime !== calcTotal;
    return html`
      <div class="meta-chips">
        ${r.servings ? html`
          <span class="meta-chip-icon">
            <ha-icon icon="mdi:silverware-fork-knife"></ha-icon>
            ${this._servesText()}
          </span>
        ` : ''}
        ${r.prep_time ? html`
          <span class="meta-chip-icon">
            <ha-icon icon="mdi:pencil-outline"></ha-icon>
            ${this._formatTime(r.prep_time)}
          </span>
        ` : ''}
        ${r.cook_time ? html`
          <span class="meta-chip-icon">
            <ha-icon icon="mdi:pot-steam-outline"></ha-icon>
            ${this._formatTime(r.cook_time)}
          </span>
        ` : ''}
        ${showTotal ? html`
          <span class="meta-chip-icon">
            <ha-icon icon="mdi:clock-outline"></ha-icon>
            ${this._formatTime(totalTime)}
          </span>
        ` : ''}
      </div>
    `;
  }

  _renderQuickRating(r) {
    const rating = r.rating || 0;
    return html`
      <div class="quick-rating">
        ${[1,2,3,4,5].map(n => html`
          <span class="qr-star ${n <= rating ? 'filled' : ''}"
            @click=${() => this._handleQuickRate(n)}>★</span>
        `)}
      </div>
    `;
  }

  _renderActionButtons(r) {
    return html`
      <div class="action-btns-row">
        <button class="action-icon-btn ${r.is_favourite ? 'fav-active' : ''}"
          @click=${this._handleToggleFav}
          title="${r.is_favourite ? msg('Remove from favourites') : msg('Add to favourites')}">
          <span class="btn-icon"><ha-icon icon="${r.is_favourite ? 'mdi:heart' : 'mdi:heart-outline'}"></ha-icon></span>
          <span>${msg('Favourite')}</span>
        </button>
        <button class="action-icon-btn" @click=${this._handleShowPlanner} title="${msg('Add to meal plan')}">
          <span class="btn-icon"><ha-icon icon="mdi:calendar-plus"></ha-icon></span>
          <span>${msg('Plan')}</span>
        </button>
        ${r.source_url ? html`
          <a class="action-icon-btn" href="${r.source_url}" target="_blank" rel="noopener" title="${msg('Open source')}">
            <span class="btn-icon"><ha-icon icon="mdi:open-in-new"></ha-icon></span>
            <span>${msg('Source')}</span>
          </a>
        ` : ''}
        <button class="action-icon-btn" @click=${this._startEdit} title="${msg('Edit recipe')}">
          <span class="btn-icon"><ha-icon icon="mdi:pencil-outline"></ha-icon></span>
          <span>${msg('Edit')}</span>
        </button>
      </div>
    `;
  }

  _renderScaler() {
    const r = this.recipe;
    const base = this._baseTotal();
    if (!r?.servings && !base) return '';
    const mult = Math.round(this._servingMult * 100) / 100;
    return html`
      <div class="scaler-row">
        <ha-icon class="scaler-icon" icon="mdi:silverware-fork-knife"></ha-icon>
        <div class="scaler-ctrl">
          <button class="scaler-btn" @click=${() => { if (this._servingMult > 0.25) this._servingMult = Math.round((this._servingMult - 0.25) * 4) / 4; }}>
            <ha-icon icon="mdi:minus"></ha-icon>
          </button>
          <span class="scaler-val">×${formatNumber(mult, false)}</span>
          <button class="scaler-btn" @click=${() => { this._servingMult = Math.round((this._servingMult + 0.25) * 4) / 4; }}>
            <ha-icon icon="mdi:plus"></ha-icon>
          </button>
        </div>
        ${base ? (this._editingTotal ? html`
          <span class="total-edit">
            <input class="total-input" type="text" inputmode="decimal"
              .value=${String(Math.round(base.total * this._servingMult))}
              @keydown=${(e) => {
                if (e.key === 'Enter') e.target.blur();
                else if (e.key === 'Escape') { e.target.dataset.cancel = '1'; e.target.blur(); }
              }}
              @blur=${(e) => { if (e.target.dataset.cancel) this._editingTotal = false; else this._commitTotal(e); }} />
            <span class="total-unit">${base.unit}</span>
          </span>
        ` : html`
          <button class="total-chip" @click=${() => this._startTotalEdit()}
            title="${msg('Edit')}">
            ${msg('Total')} ≈ ${formatTotal(base.total * this._servingMult, base.unit)}
            <ha-icon icon="mdi:pencil-outline"></ha-icon>
          </button>
        `) : ''}
        ${mult !== 1 ? html`
          <button class="save-mult-btn ${this._confirmSaveMult ? 'confirm' : ''}"
            ?disabled=${this._savingMult}
            @click=${() => this._onSaveMultClick()}>
            <ha-icon icon="mdi:content-save-outline"></ha-icon>
            ${this._confirmSaveMult ? msg('Tap again to confirm') : msg('Save as new amount')}
          </button>
        ` : ''}
      </div>
    `;
  }

  _renderWakeLock() {
    if (!this.settings?.keepScreenOn) return '';
    if (!isWakeLockSupported()) {
      return html`
        <div class="wakelock-row">
          <span class="wakelock-unsupported"
            title="${msg('Requires a secure (HTTPS) connection and a browser that supports the Wake Lock API')}">
            <ha-icon icon="mdi:eye-off-outline"></ha-icon>
            ${msg('Screen lock unavailable')}
          </span>
        </div>
      `;
    }
    return html`
      <div class="wakelock-row">
        <button class="wakelock-btn ${this._wakeActive ? 'active' : ''}"
          @click=${() => this._wakeActive ? this._releaseWakeLock() : this._requestWakeLock()}
          title="${this._wakeActive ? msg('Release screen lock') : msg('Keep screen on')}">
          <ha-icon icon="${this._wakeActive ? 'mdi:eye' : 'mdi:eye-off-outline'}"></ha-icon>
          ${this._wakeActive ? msg('Screen on') : msg('Keep screen on')}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.recipe) return html``;
    const r = this.recipe;
    return this.wide ? this._renderWide(r) : this._renderNarrow(r);
  }

  _renderWide(r) {
    const groups = this._groupIngredients(r.ingredients);
    const picking = this._showShoppingPicker;
    const checkedSet = this._checkedIngredients;
    const checkedCount = checkedSet?.size ?? 0;

    return html`
      <div class="detail-container wide">
        <!--
          CSS grid: 2 cols (1fr 2fr) × auto rows
          [image]   [info card]
          [ings]    [directions]
          Whole card scrolls — no independent column scrolling
        -->
        <div class="wide-layout">

          <!-- row 1: image (1/3) + info card (2/3) -->
          <div class="wide-row">

          <!-- col 1: square image card (padding-top:100% inner wrapper forces square) -->
          <div class="wide-image-card">
            ${this._renderSlideshow(r)}
          </div>

          <!-- col 2: info card -->
          <div class="wide-info-card">
            <h1 class="wide-title">${r.name}</h1>
            ${this._renderActionButtons(r)}
            ${r.description ? html`<div class="wide-desc md-content">${unsafeHTML(renderMarkdown(r.description))}</div>` : ''}
            ${this._renderMetaRow(r)}
            ${this._renderChipGroups(r)}
          </div>

          </div><!-- end wide-row 1 -->

          <!-- row 2: ingredients (1/3) + directions (2/3) -->
          <div class="wide-row">

          <!-- col 1: ingredients column -->
          <div class="wide-ing-col">
            <!-- ingredients controls: scaler left, cart right — above ingredients only -->
            <div class="wide-ing-controls">
              ${this._renderScaler()}
              ${this._shoppingResult === 'success' ? html`
                <span class="ing-shop-success"><ha-icon icon="mdi:check-circle-outline"></ha-icon></span>
              ` : html`
                <button class="ing-shop-btn ${picking ? 'active' : ''}"
                  @click=${picking ? () => { this._showShoppingPicker = false; } : this._openShoppingPicker}
                  title="${picking ? msg('Cancel') : msg('Add to shopping list')}">
                  <ha-icon icon="${picking ? 'mdi:close' : 'mdi:cart-plus'}"></ha-icon>
                </button>
              `}
            </div>

            <!-- shopping picker / review (shown inline when picking) -->
            ${picking ? (this._shoppingReview ? html`
              <div class="wide-section-card">${this._renderShoppingReview()}</div>
            ` : html`
              <div class="wide-section-card shopping-picker-panel">
                <div class="picker-select-row">
                  <button class="picker-sel-btn" @click=${this._selectAllIngredients}>${msg('Select All')}</button>
                  <button class="picker-sel-btn" @click=${this._clearAllIngredients}>${msg('Clear All')}</button>
                  ${this.slmAvailable && this.shoppingLists.length ? html`
                    <select class="list-select" .value=${this._selectedListId}
                      @change=${e => { this._selectedListId = e.target.value; }}>
                      ${this.shoppingLists.map(l => html`
                        <option value="${l.id}" ?selected=${l.id === this._selectedListId}>${l.name}</option>
                      `)}
                    </select>
                  ` : ''}
                </div>
                <div class="picker-btns">
                  <button class="action-btn" @click=${() => { this._showShoppingPicker = false; }}>${msg('Cancel')}</button>
                  <button class="action-btn primary"
                    ?disabled=${this._shoppingAdding || !checkedCount}
                    @click=${this._handleAddToShopping}>
                    ${this._shoppingAdding
                      ? html`<ha-circular-progress active size="tiny"></ha-circular-progress>`
                      : (checkedCount ? msg(str`Add (${checkedCount})`) : msg('Add'))}
                  </button>
                </div>
              </div>
            `) : ''}

            ${groups.map(g => html`
              <div class="wide-section-card">
                ${g.header ? html`<div class="wide-section-title">${g.header}</div>` : ''}
                ${g.items.length ? html`
                  <ul class="ingredient-list">
                    ${g.items.map((ing) => {
                      const globalIdx = (r.ingredients || []).indexOf(ing);
                      const { amount, unit } = this._getDisplayAmount(ing);
                      return html`
                        <li class="ingredient-item ${picking ? 'selectable' : 'cookable'} ${!picking && this._doneIngredients.has(globalIdx) ? 'done' : ''}"
                          @click=${picking ? () => this._toggleIngredient(globalIdx) : () => this._toggleIngredientDone(globalIdx)}>
                          ${picking ? html`
                            <span class="ing-check ${checkedSet?.has(globalIdx) ? 'checked' : ''}">
                              ${checkedSet?.has(globalIdx) ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}
                            </span>
                          ` : ''}
                          <span class="ing-amount">${amount} ${unit}</span>
                          <span class="ing-name">${ing.name}${ing.notes ? html` <em class="ing-notes">(${ing.notes})</em>` : ''}</span>
                          ${!picking && this._doneIngredients.has(globalIdx) ? html`<ha-icon class="ing-done-icon" icon="mdi:check-circle"></ha-icon>` : ''}
                        </li>
                      `;
                    })}
                  </ul>
                ` : ''}
              </div>
            `)}

            <div class="wide-section-card">
              ${this._renderNutritionRing(r)}
            </div>
          </div>

          <!-- col 2: directions column, each step its own card -->
          <div class="wide-dir-col">
            <div class="wide-dir-spacer"></div>
            ${this._renderWakeLock()}
            ${(r.instructions || []).length ? this._directionItems(r).map((it) => {
              if (it.type === 'heading') {
                // Wide layout: the ingredient groups are already visible in the left column,
                // so the heading is just a divider (no duplicated ingredient list).
                return html`<div class="dir-divider">${it.label}</div>`;
              }
              const step = it.text;
              const i = it.i;
              const done = this._completedSteps.has(i);
              return html`
                <div class="wide-section-card wide-step-card ${done ? 'step-done' : ''}" @click=${() => this._toggleStepComplete(i)}>
                  ${this._renderStepNum(it)}
                  <div class="step-body">
                    <span class="step-text">${this._renderStepWithTimers(step)}</span>
                    ${this._renderStepIngredients(it)}
                  </div>
                </div>
              `;
            }) : html`<p class="empty-tab">${msg('No directions listed.')}</p>`}
            ${r.notes ? html`
              <div class="wide-section-card">
                <div class="wide-section-title">${msg('Notes')}</div>
                <div class="notes-text md-content">${unsafeHTML(renderMarkdown(r.notes))}</div>
              </div>
            ` : ''}
          </div>

          </div><!-- end wide-row 2 -->

        </div>

        <!-- Edit overlay -->
        ${this._editing ? this._renderEditPanel() : ''}
      </div>
    `;
  }

  _renderNarrow(r) {
    const totalTime = r.total_time || (r.prep_time || 0) + (r.cook_time || 0) || null;

    return html`
      <div class="detail-container">
        <!-- Hero image -->
        <div class="hero ${r.image_url ? '' : 'no-image'}">
          ${r.image_url ? html`
            <img src="${r.image_url}" alt="${r.name}" />
            <div class="hero-overlay"></div>
          ` : html`
            <div class="hero-placeholder">
              <ha-icon icon="mdi:food"></ha-icon>
            </div>
          `}
          <div class="hero-actions">
            <button class="hero-btn ${r.is_favourite ? 'fav-active' : ''}" @click=${this._handleToggleFav}
              title="${r.is_favourite ? msg('Remove from favourites') : msg('Add to favourites')}">
              <ha-icon icon="${r.is_favourite ? 'mdi:heart' : 'mdi:heart-outline'}"></ha-icon>
            </button>
            ${r.source_url ? html`
              <a class="hero-btn" href="${r.source_url}" target="_blank" rel="noopener" title="${msg('Open source')}">
                <ha-icon icon="mdi:open-in-new"></ha-icon>
              </a>
            ` : ''}
          </div>
        </div>

        <div class="detail-scroll">
          <!-- Recipe meta -->
          <div class="detail-head">
            <h2 class="recipe-title">${r.name}</h2>
            ${this._renderActionButtons(r)}
            ${r.description ? html`<div class="detail-desc md-content">${unsafeHTML(renderMarkdown(r.description))}</div>` : ''}

            <div class="meta-row">
              ${r.prep_time ? html`
                <div class="meta-item">
                  <span class="meta-label">${msg('Prep')}</span>
                  <span class="meta-val">${this._formatTime(r.prep_time)}</span>
                </div>
              ` : ''}
              ${r.cook_time ? html`
                <div class="meta-item">
                  <span class="meta-label">${msg('Cook')}</span>
                  <span class="meta-val">${this._formatTime(r.cook_time)}</span>
                </div>
              ` : ''}
              ${totalTime ? html`
                <div class="meta-item">
                  <span class="meta-label">${msg('Total')}</span>
                  <span class="meta-val">${this._formatTime(totalTime)}</span>
                </div>
              ` : ''}
              ${r.servings ? html`
                <div class="meta-item">
                  <span class="meta-label">${msg('Serves')}</span>
                  <span class="meta-val">${this._servesText()}</span>
                </div>
              ` : ''}
            </div>

            ${this._renderChipGroups(r)}
          </div>

          <!-- Serving scaler -->
          ${this._renderScaler()}

          <!-- Tabs -->
          <div class="tabs-row">
            ${[['ingredients',msg('Ingredients')],['directions',msg('Directions')],['notes',msg('Notes')],['nutrition',msg('Nutrition')],['photos',msg('Photos')]].map(([val, lbl]) => html`
              <button
                class="tab-btn ${this._activeTab === val ? 'active' : ''}"
                @click=${() => { this._activeTab = val; }}
              >${lbl}</button>
            `)}
          </div>

          <!-- Wake lock button (shown when setting enabled) -->
          ${this._renderWakeLock()}

          <!-- Tab content -->
          <div class="tab-content">
            ${this._activeTab === 'ingredients' ? this._renderIngredients(r) : ''}
            ${this._activeTab === 'directions'  ? this._renderDirections(r)  : ''}
            ${this._activeTab === 'notes'       ? this._renderNotes(r)       : ''}
            ${this._activeTab === 'nutrition'   ? this._renderNutritionRing(r) : ''}
            ${this._activeTab === 'photos'      ? this._renderPhotos(r)      : ''}
          </div>
        </div>

        <!-- Edit panel (inline overlay) -->
        ${this._editing ? this._renderEditPanel() : ''}
      </div>
    `;
  }

  _getDisplayAmount(ing) {
    if (this._metricMode) {
      const conv = convertToMetric(this._scaleAmount(ing.amount), ing.unit);
      if (conv) return conv;
    }
    return { amount: this._scaleAmount(ing.amount) || '', unit: ing.unit || '' };
  }

  _groupIngredients(ingredients) {
    const groups = [];
    let current = { header: null, items: [] };
    for (const ing of (ingredients || [])) {
      if (ing.is_heading || ing.name?.startsWith('#')) {
        if (current.items.length > 0 || current.header !== null) groups.push(current);
        const label = ing.name?.startsWith('#') ? ing.name.slice(1).trim() : ing.name;
        current = { header: label || '', items: [] };
      } else {
        current.items.push(ing);
      }
    }
    if (current.items.length > 0 || current.header !== null) groups.push(current);
    return groups.length ? groups : [{ header: null, items: ingredients || [] }];
  }

  _renderIngredients(r) {
    const picking = this._showShoppingPicker;
    const checkedSet = this._checkedIngredients;
    const checkedCount = checkedSet?.size ?? 0;
    const hasImperial = (r.ingredients || []).some(ing =>
      ing.unit && IMPERIAL_TO_METRIC[ing.unit.toLowerCase().trim()]
    );

    return html`
      ${this.settings?.showUnitConversion && hasImperial ? html`
        <div class="metric-toggle-row">
          <button class="metric-btn ${this._metricMode ? 'active' : ''}"
            @click=${() => { this._metricMode = !this._metricMode; }}>
            <ha-icon icon="mdi:swap-horizontal"></ha-icon>
            ${this._metricMode ? msg('Showing metric') : msg('Convert to metric')}
          </button>
        </div>
      ` : ''}

      ${r.ingredients?.length ? html`
        <ul class="ingredient-list">
          ${r.ingredients.map((ing, i) => {
            if (ing.is_heading || ing.name?.startsWith('#')) {
              const headingText = ing.name?.startsWith('#') ? ing.name.slice(1).trim() : ing.name;
              return html`<li class="ing-heading">${headingText}</li>`;
            }
            const { amount, unit } = this._getDisplayAmount(ing);
            return html`
              <li class="ingredient-item ${picking ? 'selectable' : 'cookable'} ${!picking && this._doneIngredients.has(i) ? 'done' : ''}"
                @click=${picking ? () => this._toggleIngredient(i) : () => this._toggleIngredientDone(i)}>
                ${picking ? html`
                  <span class="ing-check ${checkedSet?.has(i) ? 'checked' : ''}">
                    ${checkedSet?.has(i) ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}
                  </span>
                ` : ''}
                <span class="ing-amount">${amount} ${unit}</span>
                <span class="ing-name">${ing.name}${ing.notes ? html` <em class="ing-notes">(${ing.notes})</em>` : ''}</span>
                ${!picking && this._doneIngredients.has(i) ? html`<ha-icon class="ing-done-icon" icon="mdi:check-circle"></ha-icon>` : ''}
              </li>
            `;
          })}
        </ul>
      ` : html`<p class="empty-tab">${msg('No ingredients listed.')}</p>`}

      <!-- Shopping section (always shown) -->
      <div class="shopping-section">
        ${this._shoppingResult === 'success' ? html`
          <div class="shopping-success">
            <ha-icon icon="mdi:check-circle-outline"></ha-icon>
            ${msg('Added to shopping list!')}
          </div>
        ` : picking && this._shoppingReview ? this._renderShoppingReview()
        : picking ? html`
          <div class="shopping-picker-panel">
            <div class="picker-select-row">
              <button class="picker-sel-btn" @click=${this._selectAllIngredients}>${msg('Select All')}</button>
              <button class="picker-sel-btn" @click=${this._clearAllIngredients}>${msg('Clear All')}</button>
              ${this.slmAvailable && this.shoppingLists.length ? html`
                <select class="list-select" .value=${this._selectedListId}
                  @change=${e => { this._selectedListId = e.target.value; }}>
                  ${this.shoppingLists.map(l => html`
                    <option value="${l.id}" ?selected=${l.id === this._selectedListId}>${l.name}</option>
                  `)}
                </select>
              ` : this.slmAvailable ? html`
                <span class="shopping-note">${msg('No lists found in Shopping List Manager')}</span>
              ` : ''}
            </div>
            <div class="picker-btns">
              <button class="action-btn" @click=${() => { this._showShoppingPicker = false; }}>${msg('Cancel')}</button>
              <button class="action-btn primary"
                ?disabled=${this._shoppingAdding || !checkedCount}
                @click=${this._handleAddToShopping}>
                ${this._shoppingAdding
                  ? html`<ha-circular-progress active size="tiny"></ha-circular-progress>`
                  : (checkedCount ? msg(str`Add (${checkedCount})`) : msg('Add'))}
              </button>
            </div>
          </div>
        ` : html`
          <button class="action-btn primary shopping-btn" @click=${this._openShoppingPicker}>
            <ha-icon icon="mdi:cart-plus"></ha-icon>
            ${msg('Add to Shopping List')}
          </button>
        `}
      </div>
    `;
  }

  _toggleIngredientDone(i) {
    const next = new Set(this._doneIngredients);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    this._doneIngredients = next;
  }

  _toggleStepComplete(i) {
    const next = new Set(this._completedSteps);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    this._completedSteps = next;
  }

  // Tapping the step number expands/collapses the ingredients that belong to the step.
  _toggleStepIngredients(i) {
    const next = new Set(this._openStepIngs);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    this._openStepIngs = next;
  }

  // A direction starting with '#' is a section heading (like '# Step 1'). The n-th
  // heading in the directions belongs to the n-th ingredient group (the n-th ingredient
  // heading). Every step below a heading shares that group: tapping its number shows
  // those ingredients. Steps before the first heading (or under a heading without a
  // matching group) have no ingredients, so their number is inert.
  _directionItems(r) {
    const groups = [];
    (r.ingredients || []).forEach((ing, idx) => {
      if (ing.is_heading || ing.name?.startsWith('#')) groups.push([]);
      else if (groups.length) groups[groups.length - 1].push({ ing, idx });
    });
    const items = [];
    let headingNo = 0;
    let stepNo = 0;
    let currentIngs = [];
    (r.instructions || []).forEach((text, i) => {
      if (typeof text === 'string' && text.trimStart().startsWith('#')) {
        currentIngs = groups[headingNo] || [];
        items.push({ type: 'heading', label: text.replace(/^\s*#+\s*/, ''), ings: currentIngs, i });
        headingNo++;
      } else {
        stepNo++;
        items.push({ type: 'step', text, num: stepNo, i, ings: currentIngs });
      }
    });
    return items;
  }

  // Step number button: opens the step's ingredient list (inert if the step has none).
  _renderStepNum(it) {
    const hasIngs = it.ings?.length > 0;
    const open = hasIngs && this._openStepIngs.has(it.i);
    return html`
      <span class="step-num ${this._completedSteps.has(it.i) ? 'done' : ''} ${hasIngs ? 'has-ings' : 'no-ings'} ${open ? 'ings-open' : ''}"
        @click=${(e) => { e.stopPropagation(); if (hasIngs) this._toggleStepIngredients(it.i); }}
        title="${hasIngs ? (open ? msg('Hide ingredients') : msg('Show ingredients')) : ''}"
      >${it.num}</span>
    `;
  }

  _renderStepIngredients(it) {
    return it.ings?.length && this._openStepIngs.has(it.i) ? this._renderDirIngredients(it.ings) : '';
  }

  _renderDirIngredients(ings) {
    if (!ings?.length) return '';
    return html`
      <ul class="ingredient-list dir-ings">
        ${ings.map(({ ing, idx }) => {
          const { amount, unit } = this._getDisplayAmount(ing);
          const done = this._doneIngredients.has(idx);
          return html`
            <li class="ingredient-item cookable ${done ? 'done' : ''}"
              @click=${(e) => { e.stopPropagation(); this._toggleIngredientDone(idx); }}>
              <span class="ing-amount">${amount} ${unit}</span>
              <span class="ing-name">${ing.name}${ing.notes ? html` <em class="ing-notes">(${ing.notes})</em>` : ''}</span>
              ${done ? html`<ha-icon class="ing-done-icon" icon="mdi:check-circle"></ha-icon>` : ''}
            </li>
          `;
        })}
      </ul>
    `;
  }

  _renderDirections(r) {
    if (!r.instructions?.length) {
      return html`<p class="empty-tab">${msg('No directions listed.')}</p>`;
    }
    return html`
      <ol class="steps-list">
        ${this._directionItems(r).map((it) => {
          if (it.type === 'heading') {
            return html`
              <li class="dir-heading-item">
                <div class="dir-heading">${it.label}</div>
              </li>`;
          }
          const step = it.text;
          const i = it.i;
          const done = this._completedSteps.has(i);
          return html`
            <li class="step-item ${done ? 'step-done' : ''}" @click=${() => this._toggleStepComplete(i)}>
              ${this._renderStepNum(it)}
              <div class="step-body">
                <span class="step-text">${this._renderStepWithTimers(step)}</span>
                ${this._renderStepIngredients(it)}
              </div>
            </li>
          `;
        })}
      </ol>
    `;
  }

  _renderStepWithTimers(text) {
    // Split text by time mentions and wrap them in clickable timer chips
    const parts = [];
    let lastIndex = 0;
    let match;
    TIME_RE.lastIndex = 0;
    while ((match = TIME_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const timeText = match[0];
      const seconds = parseTimeToSeconds(timeText);
      if (seconds > 0) {
        parts.push(html`<button class="time-chip" @click=${(e) => { e.stopPropagation(); this._fireTimer(seconds, timeText); }} title="${msg(str`Start timer for ${timeText}`)}">
          <ha-icon icon="mdi:timer-outline"></ha-icon>${timeText}
        </button>`);
      } else {
        parts.push(timeText);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts;
  }

  _renderNotes(r) {
    return html`
      ${r.notes
        ? html`<div class="notes-text md-content">${unsafeHTML(renderMarkdown(r.notes))}</div>`
        : html`<p class="empty-tab">${msg('No notes.')}</p>`}
    `;
  }

  _renderNutrition(r) {
    const n = r.nutrition || {};
    const hasAny = NUTRITION_FIELDS.some(f => n[f.key] != null && n[f.key] !== '');
    if (!hasAny) {
      return html`
        <div class="empty-tab">
          <p>${msg('No nutrition info. Add it via the edit panel.')}</p>
        </div>
      `;
    }
    const perServing = r.servings ? msg(str`Per serving (${r.servings_text || r.servings})`) : msg('Per serving');
    return html`
      <div class="nutrition-panel">
        <div class="nutr-header">${msg('Nutrition Facts')}</div>
        <div class="nutr-sub">${perServing}</div>
        <div class="nutr-divider thick"></div>
        ${NUTRITION_FIELDS.map(f => {
          const val = n[f.key];
          if (val == null || val === '') return '';
          return html`
            <div class="nutr-row ${f.bold ? 'nutr-bold' : ''} ${f.indent ? 'nutr-indent' : ''}">
              <span class="nutr-label">${f.label}</span>
              <span class="nutr-val">${val}${f.unit !== 'kcal' ? html`<em> ${f.unit}</em>` : ''}</span>
            </div>
            <div class="nutr-divider"></div>
          `;
        })}
      </div>
    `;
  }

  _renderNutritionRing(r) {
    const n = r?.nutrition || {};
    const cal = parseFloat(n.calories) || 0;
    const fat = parseFloat(n.fat) || 0;
    const carb = parseFloat(n.carbohydrates) || 0;
    const prot = parseFloat(n.protein) || 0;

    const fatCal = fat * 9;
    const carbCal = carb * 4;
    const protCal = prot * 4;
    const total = fatCal + carbCal + protCal;
    const hasData = total > 0 || cal > 0;

    if (!hasData) {
      return html`
        <div class="nutr-card">
          <p class="empty-tab" style="margin:0;padding:8px 0;text-align:center">${msg('No nutritional information available.')}</p>
        </div>`;
    }

    const MACROS = [
      { label: msg('Carbs'),    val: carb, cal: carbCal, color: '#f59e0b' },
      { label: msg('Total fat'),val: fat,  cal: fatCal,  color: '#3b82f6' },
      { label: msg('Protein'),  val: prot, cal: protCal, color: '#22c55e' },
    ];

    // SVG stroke-dasharray arcs using svg`` template tag (correct SVG namespace)
    const rad = 42, cx = 50, cy = 50;
    const strokeW = 7;
    const circ = 2 * Math.PI * rad;
    // With stroke-linecap="round", each end cap extends strokeW/2 beyond the arc endpoint.
    // gapLen must exceed strokeW (both caps combined) to leave a visible gap between rounded ends.
    const gapLen = strokeW + circ * 4 / 360; // stroke-width + 4° of visible separation

    const carbArc = total > 0 ? Math.max(0, (carbCal / total) * circ - gapLen) : 0;
    const fatArc  = total > 0 ? Math.max(0, (fatCal  / total) * circ - gapLen) : 0;
    const protArc = total > 0 ? Math.max(0, (protCal / total) * circ - gapLen) : 0;
    const carbStartDeg = -90;
    const fatStartDeg  = carbStartDeg + (total > 0 ? (carbCal / total) * 360 : 0);
    const protStartDeg = fatStartDeg  + (total > 0 ? (fatCal  / total) * 360 : 0);

    const displayCal = cal > 0 ? Math.round(cal) : (total > 0 ? Math.round(total) : null);

    // RDA progress data
    const rdaRows = Object.entries(RDA).filter(([k]) => {
      const v = parseFloat(n[k]);
      return v > 0;
    }).map(([k, rda]) => {
      const v = parseFloat(n[k]);
      const pct = Math.min(Math.round(v / rda.val * 100), 999);
      return { key: k, label: rda.label, val: v, unit: rda.unit, pct };
    });

    return html`
      <div class="nutr-card">
        <!-- Top row: donut ring + macro columns -->
        <div class="nutr-top">
          <div class="nutr-ring-wrap">
            <svg width="90" height="90" viewBox="0 0 100 100" style="display:block">
              <!-- Background track — always visible -->
              <circle cx="${cx}" cy="${cy}" r="${rad}" fill="none"
                stroke="var(--rm-border)" stroke-width="7"/>
              <!-- Colored arcs: all 3 inline in the same html template so they
                   inherit SVG namespace from the parser. Hidden via opacity when
                   there's no data. Dynamic values are attributes, not new elements. -->
              <circle cx="${cx}" cy="${cy}" r="${rad}" fill="none"
                stroke="#f59e0b" stroke-width="7" stroke-linecap="round"
                stroke-dasharray="${carbArc} ${circ}"
                transform="rotate(${carbStartDeg} ${cx} ${cy})"
                opacity="${total > 0 && carbArc > 0 ? 0.95 : 0}"/>
              <circle cx="${cx}" cy="${cy}" r="${rad}" fill="none"
                stroke="#3b82f6" stroke-width="7" stroke-linecap="round"
                stroke-dasharray="${fatArc} ${circ}"
                transform="rotate(${fatStartDeg} ${cx} ${cy})"
                opacity="${total > 0 && fatArc > 0 ? 0.95 : 0}"/>
              <circle cx="${cx}" cy="${cy}" r="${rad}" fill="none"
                stroke="#22c55e" stroke-width="7" stroke-linecap="round"
                stroke-dasharray="${protArc} ${circ}"
                transform="rotate(${protStartDeg} ${cx} ${cy})"
                opacity="${total > 0 && protArc > 0 ? 0.95 : 0}"/>
              <text x="${cx}" y="${cy - 2}" text-anchor="middle"
                fill="var(--rm-text)" font-size="16" font-weight="700" font-family="inherit">
                ${displayCal ?? '–'}
              </text>
              <text x="${cx}" y="${cy + 12}" text-anchor="middle"
                fill="var(--rm-text-secondary)" font-size="9" font-family="inherit">${msg('cals')}</text>
            </svg>
          </div>

          <div class="nutr-macro-cols">
            ${MACROS.map(m => {
              const pct = total > 0 ? Math.round(m.cal / total * 100) : 0;
              return html`
                <div class="nutr-macro-col">
                  <span class="nutr-mcol-num" style="color:${m.color}">${m.val > 0 ? `${m.val} g` : '\u2014'}</span>
                  <span class="nutr-mcol-label">${m.label}</span>
                  ${pct > 0 ? html`<span class="nutr-mcol-pct" style="color:${m.color}">${pct}% cals</span>` : ''}
                </div>
              `;
            })}
          </div>
        </div>

        ${r?.servings ? html`
          <div class="nutr-serving-note">
            ${r.servings_text ? msg(str`Per ${r.servings_text}`) : msg(str`Per ${r.servings} serving${r.servings !== 1 ? 's' : ''}`)}
          </div>
        ` : ''}

        <!-- Daily RDA collapsible -->
        ${rdaRows.length ? html`
          <button class="nutr-rda-toggle" @click=${() => { this._nutritionExpanded = !this._nutritionExpanded; }}>
            <span class="nutr-rda-title">${msg('Daily RDA Nutrition')}</span>
            <span class="nutr-rda-count">${rdaRows.length}</span>
            <ha-icon icon="${this._nutritionExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}"></ha-icon>
          </button>
          ${this._nutritionExpanded ? html`
            <div class="nutr-rda-rows">
              ${rdaRows.map(row => html`
                <div class="nutr-rda-row">
                  <span class="nutr-rda-label">${row.label}</span>
                  <span class="nutr-rda-val">${row.val} ${row.unit}</span>
                  <span class="nutr-rda-pct">${row.pct}%</span>
                  <div class="nutr-rda-bar-wrap">
                    <div class="nutr-rda-bar ${row.pct > 100 ? 'over' : ''}" style="width:${Math.min(row.pct, 100)}%"></div>
                  </div>
                </div>
              `)}
            </div>
          ` : ''}
        ` : ''}
      </div>
    `;
  }

  _renderPhotos(r) {
    const photos = r.photos || [];
    const mainImage = r.image_url;
    // Combine main image with extra photos (deduplicated)
    const allPhotos = mainImage
      ? [mainImage, ...photos.filter(p => p !== mainImage)]
      : photos;

    return html`
      <div class="photos-tab">
        ${allPhotos.length ? html`
          <div class="photos-grid">
            ${allPhotos.map(url => html`
              <div class="photo-item ${url === mainImage ? 'main-photo' : ''}">
                <img src="${url}" alt="${msg('Recipe photo')}" loading="lazy" />
                ${url === mainImage ? html`<span class="photo-badge">${msg('Main')}</span>` : html`
                  <button class="photo-action set-main" @click=${() => this._setMainPhoto(url)} title="${msg('Set as main photo')}">
                    <ha-icon icon="mdi:star-outline"></ha-icon>
                  </button>
                `}
                <button class="photo-action remove-photo" @click=${() => this._removePhoto(url)} title="${msg('Remove photo')}">
                  <ha-icon icon="mdi:close"></ha-icon>
                </button>
              </div>
            `)}
          </div>
        ` : html`
          <div class="empty-tab">
            <ha-icon icon="mdi:image-off-outline"></ha-icon>
            <p>${msg('No photos yet.')}</p>
          </div>
        `}

        <div class="photo-add-section">
          <div class="photo-add-label">${msg('Add a photo')}</div>
          <div class="photo-url-row">
            <input
              type="url"
              class="photo-url-input"
              placeholder="${msg('Paste image URL…')}"
              .value=${this._photoUrlInput}
              @input=${e => { this._photoUrlInput = e.target.value; }}
              @keydown=${e => { if (e.key === 'Enter') this._handleAddPhotoUrl(); }}
            />
            <button class="action-btn primary" ?disabled=${!this._photoUrlInput.trim() || this._addingPhotoUrl}
              @click=${this._handleAddPhotoUrl}>
              ${msg('Add')}
            </button>
          </div>
          <div class="camera-btns">
            <label class="camera-btn-split">
              <ha-icon icon="mdi:camera"></ha-icon>
              <span>${msg('Take Photo')}</span>
              <input type="file" accept="image/*" capture="environment" class="camera-input"
                @change=${this._handleCameraCapture} />
            </label>
            <label class="camera-btn-split">
              <ha-icon icon="mdi:image-multiple-outline"></ha-icon>
              <span>${msg('Choose from Library')}</span>
              <input type="file" accept="image/*" class="camera-input"
                @change=${this._handleCameraCapture} />
            </label>
          </div>
        </div>
      </div>
    `;
  }

  _renderEditPanel() {
    const d = this._editData;
    return html`
      <div class="edit-overlay" @click=${(e) => { if (e.target === e.currentTarget) this._cancelEdit(); }}>
        <div class="edit-panel">
          <div class="edit-header">
            <span>${msg('Edit Recipe')}</span>
            <button class="icon-btn" @click=${this._cancelEdit}><ha-icon icon="mdi:close"></ha-icon></button>
          </div>
          <div class="edit-body">

            ${this._renderField(msg('Name'), 'name', 'text')}

            <!-- Image section -->
            <div class="edit-section-label">${msg('Image')}</div>
            <div class="edit-photo-row">
              ${(() => {
                const allUrls = [...new Set([
                  d.image_url,
                  ...(d.photos || []),
                ].filter(Boolean))];
                return html`
                  ${allUrls.map(url => html`
                    <div class="edit-photo-thumb ${url === d.image_url ? 'selected' : ''}"
                      @click=${() => this._handleEditField('image_url', url)}
                      title="${msg('Set as main image')}">
                      <img src="${url}" alt="" />
                      ${url === d.image_url ? html`<span class="edit-thumb-badge"><ha-icon icon="mdi:check"></ha-icon></span>` : ''}
                    </div>
                  `)}
                  <label class="edit-photo-add ${this._editImageUploading ? 'loading' : ''}" title="${msg('Upload photo')}">
                    <input type="file" accept="image/*" style="display:none"
                      @change=${e => { const f = e.target.files?.[0]; if (f) this._editUploadImage(f); e.target.value = ''; }} />
                    <ha-icon icon="${this._editImageUploading ? 'mdi:loading' : 'mdi:plus'}"></ha-icon>
                  </label>
                `;
              })()}
            </div>
            <div class="edit-field">
              <label>${msg('Or paste image URL')}</label>
              <input type="url" .value=${d.image_url ?? ''}
                @input=${e => this._handleEditField('image_url', e.target.value)}
                placeholder="https://…" />
            </div>

            ${this._renderField(msg('Description'), 'description', 'textarea')}
            ${this._renderField(msg('Source URL'), 'source_url', 'url')}

            <div class="edit-row-3">
              ${this._renderField(msg('Prep (min)'), 'prep_time', 'number')}
              ${this._renderField(msg('Cook (min)'), 'cook_time', 'number')}
              ${this._renderField(msg('Servings'), 'servings', 'number')}
            </div>

            <!-- Star rating picker -->
            <div class="edit-field">
              <label>${msg('Rating')}</label>
              <div class="edit-stars">
                ${[1,2,3,4,5].map(n => html`
                  <span class="edit-star ${n <= (d.rating || 0) ? 'filled' : ''}"
                    @click=${() => this._handleEditField('rating', d.rating === n ? 0 : n)}
                  >★</span>
                `)}
              </div>
            </div>

            ${this._renderListPicker('tags', msg('Tags'), this.allTags)}
            ${this._renderListPicker('courses', msg('Courses'), this.allCourses)}
            ${this._renderListPicker('categories', msg('Categories'), this.allCategories)}
            ${this._renderListPicker('collections', msg('Collections'), this.allCollections)}
            ${this._renderField(msg('Notes'), 'notes', 'textarea')}

            <!-- Ingredients editor -->
            <div class="edit-section-label">${msg(str`Ingredients (${(d.ingredients || []).length})`)}</div>
            ${(d.ingredients || []).length ? html`
              <ul class="edit-ing-list">
                ${(d.ingredients || []).map((ing, i) => {
                  const isEditing = this._editIngEdit?.idx === i;
                  const isHeading = ing.is_heading || ing.name?.startsWith('#');
                  if (isEditing) {
                    const ee = this._editIngEdit;
                    return html`
                      <li class="edit-ing-inline-edit ${isHeading ? 'edit-ing-heading' : ''}">
                        ${ee.heading ? html`
                          <input class="ing-inline-input ing-inline-name" type="text" placeholder="${msg('Section header')}"
                            .value=${ee.name}
                            @input=${e => { this._editIngEdit = { ...ee, name: e.target.value }; }}
                            @keydown=${e => { if (e.key === 'Enter') this._saveEditIngredient(); if (e.key === 'Escape') this._cancelEditIngredient(); }}
                          />
                        ` : html`
                          <input class="ing-inline-input ing-inline-amt" type="text" placeholder="${msg('Amt')}"
                            .value=${ee.amount}
                            @input=${e => { this._editIngEdit = { ...ee, amount: e.target.value }; }}
                            @keydown=${e => { if (e.key === 'Enter') this._saveEditIngredient(); if (e.key === 'Escape') this._cancelEditIngredient(); }}
                          />
                          <input class="ing-inline-input ing-inline-unit" type="text" placeholder="${msg('Unit')}"
                            .value=${ee.unit}
                            @input=${e => { this._editIngEdit = { ...ee, unit: e.target.value }; }}
                            @keydown=${e => { if (e.key === 'Enter') this._saveEditIngredient(); if (e.key === 'Escape') this._cancelEditIngredient(); }}
                          />
                          <input class="ing-inline-input ing-inline-name" type="text" placeholder="${msg('Ingredient')}"
                            .value=${ee.name}
                            @input=${e => { this._editIngEdit = { ...ee, name: e.target.value }; }}
                            @keydown=${e => { if (e.key === 'Enter') this._saveEditIngredient(); if (e.key === 'Escape') this._cancelEditIngredient(); }}
                          />
                        `}
                        <button class="ing-inline-save" @click=${this._saveEditIngredient} title="${msg('Save')}">
                          <ha-icon icon="mdi:check"></ha-icon>
                        </button>
                        <button class="ing-inline-cancel" @click=${this._cancelEditIngredient} title="${msg('Cancel')}">
                          <ha-icon icon="mdi:close"></ha-icon>
                        </button>
                      </li>
                    `;
                  }
                  return html`
                    <li
                      draggable="true"
                      class="${isHeading ? 'edit-ing-heading' : ''} ${this._dragIngOver === i ? 'drag-over' : ''}"
                      @dragstart=${e => { this._dragIngFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                      @dragover=${e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (this._dragIngOver !== i) this._dragIngOver = i; }}
                      @dragleave=${() => { if (this._dragIngOver === i) this._dragIngOver = -1; }}
                      @drop=${e => { e.preventDefault(); this._editDropIngredient(this._dragIngFrom, i); }}
                      @dragend=${() => { this._dragIngOver = -1; this._dragIngFrom = -1; }}
                    >
                      <ha-icon icon="mdi:drag-vertical" class="drag-handle"></ha-icon>
                      <span class="edit-ing-text" @click=${() => this._startEditIngredient(i)} title="${msg('Click to edit')}">
                        ${isHeading
                          ? html`<strong>${ing.name?.startsWith('#') ? ing.name.slice(1).trim() : ing.name}</strong>`
                          : html`${ing.amount ? `${ing.amount}${ing.unit ? ' ' + ing.unit : ''} ` : ''}${ing.name}`}
                      </span>
                      <div class="edit-reorder-btns">
                        <button class="edit-move-btn" ?disabled=${i === 0} @click=${() => this._editMoveIngredient(i, -1)} title="${msg('Move up')}">
                          <ha-icon icon="mdi:chevron-up"></ha-icon>
                        </button>
                        <button class="edit-move-btn" ?disabled=${i === (d.ingredients.length - 1)} @click=${() => this._editMoveIngredient(i, 1)} title="${msg('Move down')}">
                          <ha-icon icon="mdi:chevron-down"></ha-icon>
                        </button>
                      </div>
                      <button class="edit-remove-btn" @click=${() => this._editRemoveIngredient(i)}>
                        <ha-icon icon="mdi:close"></ha-icon>
                      </button>
                    </li>
                  `;
                })}
              </ul>
            ` : ''}
            <div class="edit-add-row">
              <input
                type="text"
                .value=${this._editIngInput}
                @input=${e => { this._editIngInput = e.target.value; }}
                @keydown=${e => { if (e.key === 'Enter') this._editAddIngredient(); }}
                placeholder="${msg('e.g. "2 cups flour" or "# Section Header"')}"
              />
              <button class="edit-add-btn" @click=${this._editAddIngredient}>${msg('Add')}</button>
            </div>

            <!-- Instructions editor -->
            <div class="edit-section-label">${msg(str`Directions (${(d.instructions || []).length} steps)`)}</div>
            ${(d.instructions || []).length ? html`
              <ol class="edit-steps-list">
                ${(d.instructions || []).map((step, i) => html`
                  <li
                    draggable="true"
                    class="${this._dragStepOver === i ? 'drag-over' : ''}"
                    @dragstart=${e => { this._dragStepFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                    @dragover=${e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (this._dragStepOver !== i) this._dragStepOver = i; }}
                    @dragleave=${() => { if (this._dragStepOver === i) this._dragStepOver = -1; }}
                    @drop=${e => { e.preventDefault(); this._editDropStep(this._dragStepFrom, i); }}
                    @dragend=${() => { this._dragStepOver = -1; this._dragStepFrom = -1; }}
                  >
                    <ha-icon icon="mdi:drag-vertical" class="drag-handle"></ha-icon>
                    <span class="edit-ing-text">${step}</span>
                    <div class="edit-reorder-btns">
                      <button class="edit-move-btn" ?disabled=${i === 0} @click=${() => this._editMoveStep(i, -1)} title="${msg('Move up')}">
                        <ha-icon icon="mdi:chevron-up"></ha-icon>
                      </button>
                      <button class="edit-move-btn" ?disabled=${i === (d.instructions.length - 1)} @click=${() => this._editMoveStep(i, 1)} title="${msg('Move down')}">
                        <ha-icon icon="mdi:chevron-down"></ha-icon>
                      </button>
                    </div>
                    <button class="edit-remove-btn" @click=${() => this._editRemoveStep(i)}>
                      <ha-icon icon="mdi:close"></ha-icon>
                    </button>
                  </li>
                `)}
              </ol>
            ` : ''}
            <div class="edit-add-row">
              <textarea
                rows="2"
                .value=${this._editStepInput}
                @input=${e => { this._editStepInput = e.target.value; }}
                @keydown=${e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this._editAddStep(this._editStepInput);
                    this._editStepInput = '';
                  }
                }}
                placeholder="${msg('Type a step, press Enter to add…')}"
              ></textarea>
              <button class="edit-add-btn" @click=${() => {
                this._editAddStep(this._editStepInput);
                this._editStepInput = '';
              }}>${msg('Add')}</button>
            </div>

            <!-- Nutrition section -->
            <div class="edit-section-label">${msg('Nutrition Facts (per serving)')}</div>
            <div class="edit-row-3">
              ${this._renderField(msg('Calories (kcal)'), 'cal', 'number')}
              ${this._renderField(msg('Protein (g)'), 'prot', 'number')}
              ${this._renderField(msg('Fat (g)'), 'fat', 'number')}
            </div>
            <div class="edit-row-3">
              ${this._renderField(msg('Saturated Fat (g)'), 'satf', 'number')}
              ${this._renderField(msg('Carbs (g)'), 'carb', 'number')}
              ${this._renderField(msg('Fiber (g)'), 'fib', 'number')}
            </div>
            <div class="edit-row-3">
              ${this._renderField(msg('Sugar (g)'), 'sug', 'number')}
              ${this._renderField(msg('Sodium (mg)'), 'sod', 'number')}
              ${this._renderField(msg('Cholesterol (mg)'), 'chol', 'number')}
            </div>

          </div>
          <div class="edit-footer">
            <button class="action-btn danger-outline" @click=${this._handleDeleteRecipe}
              title="${this._confirmDelete ? msg('Click again to confirm delete') : msg('Delete recipe')}">
              <ha-icon icon="${this._confirmDelete ? 'mdi:alert' : 'mdi:trash-can-outline'}"></ha-icon>
              ${this._confirmDelete ? msg('Confirm?') : msg('Delete')}
            </button>
            <div class="edit-footer-right">
              <button class="action-btn" @click=${this._cancelEdit}>${msg('Cancel')}</button>
              <button class="action-btn primary" @click=${this._saveEdit}>${msg('Save')}</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderField(label, field, type) {
    const val = this._editData[field] ?? '';
    if (type === 'textarea') {
      return html`
        <div class="edit-field">
          <label>${label}</label>
          <textarea
            .value=${val}
            @input=${e => this._handleEditField(field, e.target.value)}
            rows="3"
          ></textarea>
        </div>
      `;
    }
    return html`
      <div class="edit-field">
        <label>${label}</label>
        <input
          type="${type}"
          .value=${String(val)}
          @input=${e => this._handleEditField(field, e.target.value)}
        />
      </div>
    `;
  }

  static styles = css`
    :host { display: block; height: 100%; }

    .detail-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
      overflow: hidden;
    }

    /* Wide two-column layout */
    .detail-container.wide { flex-direction: row; }
    .detail-left {
      width: 320px; flex-shrink: 0; display: flex; flex-direction: column;
      border-right: 1px solid var(--rm-border); overflow: hidden;
    }
    .detail-left .hero-img {
      height: 240px; flex-shrink: 0; position: relative; overflow: hidden;
      background: var(--rm-bg-elevated);
    }
    .detail-left .hero-img img { width: 100%; height: 100%; object-fit: cover; }
    .detail-left .hero-img .hero-placeholder {
      width: 100%; height: 100%; display: flex; align-items: center;
      justify-content: center; color: var(--rm-text-secondary);
    }
    .detail-left .hero-img .hero-placeholder ha-icon { --mdc-icon-size: 64px; opacity: 0.3; }
    .detail-left-scroll {
      flex: 1; overflow-y: auto; padding: 12px 14px 16px;
      scrollbar-width: thin; scrollbar-color: var(--rm-border) transparent;
    }
    .detail-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-right-header { padding: 16px 16px 0; flex-shrink: 0; }
    .detail-right-scroll {
      flex: 1; overflow-y: auto; padding: 6px 16px 24px;
      scrollbar-width: thin; scrollbar-color: var(--rm-border) transparent;
    }
    .notes-section { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--rm-border); }
    .notes-section h3 { margin: 0 0 8px; font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--rm-text-secondary); }

    /* Recipe title */
    .recipe-title {
      margin: 0 0 6px; font-size: calc(20px * var(--rm-font-scale, 1)); font-weight: 700;
      color: var(--rm-text); line-height: 1.2;
    }
    .recipe-title.wide-centered { text-align: center; font-size: calc(22px * var(--rm-font-scale, 1)); }
    .detail-desc.wide-centered { text-align: center; }
    .detail-right-header .quick-rating { justify-content: center; }
    .detail-right-header .action-btns-row { justify-content: center; }

    /* Quick rating */
    .quick-rating { display: flex; gap: 2px; margin: 0 0 8px; }
    .qr-star { font-size: calc(20px * var(--rm-font-scale, 1)); cursor: pointer; color: var(--rm-border); -webkit-text-stroke: 1px rgba(200,150,0,0.4); transition: color 0.15s; }
    .qr-star.filled { color: #f5a623; -webkit-text-stroke: 1px #c47f0a; }
    .qr-star:hover { color: #f5a623; }

    /* Action buttons row */
    .action-btns-row {
      display: flex; gap: 16px; flex-wrap: wrap; margin: 6px 0 10px; justify-content: center;
    }
    .action-icon-btn {
      display: flex; flex-direction: column; align-items: center; gap: 5px;
      background: none; border: none; cursor: pointer;
      color: var(--rm-text-secondary); font-size: calc(10px * var(--rm-font-scale, 1)); font-weight: 600;
      transition: color 0.15s; text-decoration: none; width: 56px;
    }
    .action-icon-btn .btn-icon {
      width: 46px; height: 46px; border-radius: 50%;
      background: var(--rm-accent-soft, rgba(255,107,53,0.12));
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s; flex-shrink: 0;
    }
    .action-icon-btn ha-icon { --mdc-icon-size: 22px; }
    .action-icon-btn:hover .btn-icon { background: rgba(255,107,53,0.25); }
    .action-icon-btn:hover { color: var(--rm-accent, #ff6b35); }
    .action-icon-btn.fav-active .btn-icon { background: rgba(207,102,121,0.15); }
    .action-icon-btn.fav-active { color: var(--error-color, #cf6679); }
    .action-icon-btn.danger .btn-icon { background: var(--error-color, #cf6679); }
    .action-icon-btn.danger { color: #fff; }

    /* Meta chips (wide layout) */
    .meta-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; justify-content: center; }
    .meta-chip-icon {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 20px; padding: 5px 12px; font-size: calc(12px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary); font-weight: 600;
    }
    .meta-chip-icon ha-icon { --mdc-icon-size: 14px; }

    /* Chip groups: column of rows, each row = label chip + value chips */
    .chips-area { display: flex; flex-direction: column; gap: 5px; }
    .chip-group-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .chip-label {
      background: var(--rm-bg); border: 1px solid var(--rm-border);
      color: var(--rm-text-secondary); font-weight: 600; cursor: default;
    }

    /* Hero */
    .hero {
      flex-shrink: 0;
      height: 180px;
      position: relative;
      background: var(--rm-surface, #2c2c2e);
      overflow: hidden;
    }
    .hero.no-image { height: 80px; }
    .hero img { width: 100%; height: 100%; object-fit: cover; }
    .hero-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.7) 100%);
    }
    .hero-placeholder {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rm-text-secondary, #8e8e93);
    }
    .hero-placeholder ha-icon { --mdc-icon-size: 48px; opacity: 0.4; }

    .hero-actions {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      gap: 6px;
    }
    .hero-btn {
      background: rgba(0,0,0,0.55);
      border: none;
      border-radius: 50%;
      width: 34px;
      height: 34px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255,255,255,0.85);
      text-decoration: none;
      transition: background 0.15s, color 0.15s;
      padding: 0;
    }
    .hero-btn ha-icon { --mdc-icon-size: 18px; }
    .hero-btn:hover { background: rgba(0,0,0,0.75); }
    .hero-btn.fav-active { color: var(--error-color, #cf6679); }
    .hero-btn.delete-btn.confirm { background: var(--error-color, #cf6679); color: #fff; }

    /* Scroll area */
    .detail-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px 24px;
      scrollbar-width: thin;
      scrollbar-color: var(--rm-border, rgba(255,255,255,0.08)) transparent;
    }

    .detail-head { margin-bottom: 12px; }
    .detail-desc {
      margin: 0 0 8px;
      font-size: calc(14px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      line-height: 1.5;
    }

    .meta-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: var(--rm-bg-elevated, #2c2c2e);
      border-radius: 8px;
      padding: 6px 12px;
      min-width: 60px;
    }
    .meta-label { font-size: calc(10px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary, #8e8e93); text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-val { font-size: calc(14px * var(--rm-font-scale, 1)); font-weight: 600; color: var(--rm-text, #e5e5ea); }

    .tags-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .tag-chip {
      background: var(--rm-accent-soft, rgba(255,107,53,0.15));
      color: var(--rm-accent, #ff6b35);
      border-radius: 20px;
      padding: 3px 10px;
      font-size: calc(12px * var(--rm-font-scale, 1));
    }

    /* Chip groups (courses, categories, collections) */
    .chip-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 5px;
    }
    .chip-group-label {
      font-size: calc(11px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .chip {
      border-radius: 20px;
      padding: 3px 10px;
      font-size: calc(12px * var(--rm-font-scale, 1));
      border: none;
      cursor: default;
    }
    .chip-nav {
      cursor: pointer;
      transition: filter 0.15s, opacity 0.15s;
    }
    .chip-nav:hover { filter: brightness(1.25); opacity: 0.9; }
    .chip-course    { background: rgba(88,166,255,0.15); color: #58a6ff; }
    .chip-category  { background: rgba(63,185,80,0.15);  color: #3fb950; }
    .chip-collection{ background: rgba(210,153,34,0.15); color: #d2a01e; }
    .chip-tag { background: var(--rm-accent-soft); color: var(--rm-accent); }

    /* Scaler */
    .scaler-row { display: flex; align-items: center; gap: 8px; }
    .scaler-icon { --mdc-icon-size: 18px; color: var(--rm-text-secondary); flex-shrink: 0; }
    .scaler-ctrl { display: flex; align-items: center; gap: 6px; }
    .scaler-btn {
      background: var(--rm-bg-elevated);
      border: 1px solid var(--rm-border);
      border-radius: 50%;
      width: 34px; height: 34px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--rm-text-secondary); padding: 0; transition: all 0.15s;
    }
    .scaler-btn:hover { background: var(--rm-accent-soft); color: var(--rm-accent); border-color: var(--rm-accent); }
    .scaler-btn ha-icon { --mdc-icon-size: 18px; }
    .total-chip {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--rm-accent-soft); color: var(--rm-accent);
      border: 1px solid var(--rm-accent); border-radius: 16px;
      padding: 4px 10px; font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 600; cursor: pointer; font-family: inherit;
    }
    .total-chip ha-icon { --mdc-icon-size: 14px; }
    .save-mult-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: transparent; color: var(--rm-text, inherit);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.3)); border-radius: 16px;
      padding: 4px 10px; font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 600; cursor: pointer; font-family: inherit;
    }
    .save-mult-btn.confirm { background: var(--rm-accent); color: #fff; border-color: var(--rm-accent); }
    .save-mult-btn ha-icon { --mdc-icon-size: 14px; }
    .save-mult-btn[disabled] { opacity: 0.5; cursor: default; }
    .total-edit { display: inline-flex; align-items: center; gap: 4px; }
    .total-input {
      width: 72px; padding: 4px 8px; font-size: calc(14px * var(--rm-font-scale, 1)); font-family: inherit;
      background: var(--rm-surface, transparent); color: var(--rm-text, inherit);
      border: 1px solid var(--rm-accent); border-radius: 8px;
    }
    .total-unit { font-size: calc(13px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary); }
    .scaler-row { flex-wrap: wrap; }
    .scaler-val {
      font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 600; color: var(--rm-text);
      min-width: 34px; height: 34px; text-align: center;
      display: flex; align-items: center; justify-content: center;
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 8px;
    }

    /* Tabs */
    .tabs-row {
      display: flex;
      border-bottom: 1px solid var(--rm-border, rgba(255,255,255,0.08));
      margin-bottom: 14px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs-row::-webkit-scrollbar { display: none; }
    .tab-btn {
      flex-shrink: 0;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 11px 14px;
      cursor: pointer;
      font-size: calc(14px * var(--rm-font-scale, 1));
      font-weight: 600;
      color: var(--rm-text-secondary, #8e8e93);
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .tab-btn.active {
      color: var(--rm-accent, #ff6b35);
      border-bottom-color: var(--rm-accent, #ff6b35);
    }

    /* Wake lock button */
    .wakelock-row {
      display: flex;
      justify-content: flex-end;
      padding: 4px 0 10px;
    }
    .wakelock-btn {
      display: inline-flex; align-items: center; gap: 5px;
      background: none; border: 1px solid var(--rm-border);
      border-radius: 20px; padding: 4px 12px;
      font-size: calc(12px * var(--rm-font-scale, 1)); cursor: pointer;
      color: var(--rm-text-secondary);
      transition: all 0.15s;
    }
    .wakelock-btn ha-icon { --mdc-icon-size: 14px; }
    .wakelock-btn.active {
      background: var(--rm-accent-soft); color: var(--rm-accent);
      border-color: var(--rm-accent);
    }
    .wakelock-unsupported {
      display: inline-flex; align-items: center; gap: 5px;
      border: 1px dashed var(--rm-border);
      border-radius: 20px; padding: 4px 12px;
      font-size: calc(12px * var(--rm-font-scale, 1)); color: var(--rm-text-muted); opacity: 0.8;
    }
    .wakelock-unsupported ha-icon { --mdc-icon-size: 14px; }

    /* Metric toggle */
    .metric-toggle-row {
      display: flex;
      justify-content: flex-end;
      padding: 0 0 8px;
    }
    .metric-btn {
      display: inline-flex; align-items: center; gap: 5px;
      background: none; border: 1px solid var(--rm-border);
      border-radius: 20px; padding: 4px 12px;
      font-size: calc(12px * var(--rm-font-scale, 1)); cursor: pointer;
      color: var(--rm-text-secondary);
      transition: all 0.15s;
    }
    .metric-btn ha-icon { --mdc-icon-size: 14px; }
    .metric-btn.active {
      background: var(--rm-accent-soft); color: var(--rm-accent);
      border-color: var(--rm-accent);
    }

    /* Ingredient section heading */
    .ing-heading {
      list-style: none;
      font-size: calc(11px * var(--rm-font-scale, 1)); font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--rm-accent); padding: 10px 0 4px;
      margin-top: 6px;
    }

    /* Ingredients */
    .ingredient-list { list-style: none; padding: 0; margin: 0 0 16px; }
    .ingredient-item {
      display: flex;
      gap: 10px;
      align-items: baseline;
      padding: 10px 0;
      border-bottom: 1px solid var(--rm-border, rgba(255,255,255,0.06));
    }
    .ingredient-item:last-child { border-bottom: none; }
    .ing-amount {
      font-size: calc(14px * var(--rm-font-scale, 1));
      font-weight: 700;
      color: var(--rm-accent, #ff6b35);
      min-width: 70px;
      flex-shrink: 0;
    }
    .ing-name { font-size: calc(15px * var(--rm-font-scale, 1)); color: var(--rm-text, #e5e5ea); }
    .ing-notes { font-size: calc(13px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary, #8e8e93); font-style: italic; }

    /* Tick off ingredients while cooking */
    .ingredient-item.cookable { cursor: pointer; -webkit-tap-highlight-color: transparent; user-select: none; }
    .ingredient-item.done .ing-amount,
    .ingredient-item.done .ing-name { opacity: 0.4; text-decoration: line-through; }
    .ing-done-icon { --mdc-icon-size: 20px; color: var(--success-color, #4caf50); margin-left: auto; align-self: center; flex-shrink: 0; }

    /* Ingredient checkbox selection */
    .ingredient-item.selectable { cursor: pointer; border-radius: 6px; padding-left: 4px; }
    .ingredient-item.selectable:hover { background: var(--rm-accent-soft, rgba(255,107,53,0.1)); }
    .ing-check {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid var(--rm-border, rgba(255,255,255,0.15));
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s;
    }
    .ing-check.checked {
      background: var(--rm-accent, #ff6b35);
      border-color: var(--rm-accent, #ff6b35);
      color: #fff;
    }
    .ing-check ha-icon { --mdc-icon-size: 12px; }

    /* Shopping */
    .shopping-section { margin-top: 12px; }
    .shopping-btn { width: 100%; justify-content: center; gap: 6px; }
    .shopping-btn ha-icon { --mdc-icon-size: 18px; }
    .shopping-picker-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--rm-bg-elevated, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 10px;
      padding: 10px;
    }
    .picker-select-row {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .picker-sel-btn {
      background: none;
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 6px;
      color: var(--rm-text-secondary, #8e8e93);
      padding: 4px 10px;
      cursor: pointer;
      font-size: calc(12px * var(--rm-font-scale, 1));
    }
    .picker-sel-btn:hover { background: var(--rm-accent-soft); color: var(--rm-text); }
    .picker-btns { display: flex; gap: 8px; justify-content: flex-end; }
    .shopping-note { font-size: calc(12px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary, #8e8e93); }
    .list-select {
      flex: 1;
      background: var(--rm-bg-elevated, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 8px 10px;
      font-size: calc(14px * var(--rm-font-scale, 1));
      min-width: 120px;
    }
    .shopping-success {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--success-color, #4caf50);
      font-size: calc(14px * var(--rm-font-scale, 1));
      padding: 8px 0;
    }
    .shopping-success ha-icon { --mdc-icon-size: 20px; }

    /* Directions */
    .steps-list { list-style: none; padding: 0; margin: 0; }
    .step-item {
      display: flex;
      gap: 14px;
      margin-bottom: 20px;
      align-items: flex-start;
    }
    .dir-heading-item { margin: 4px 0 14px; }
    .dir-heading {
      font-size: calc(12px * var(--rm-font-scale, 1)); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--rm-accent, #ff6b35); margin-bottom: 6px;
    }
    .dir-ings { margin: 0 0 6px; }
    .dir-divider {
      font-size: calc(12px * var(--rm-font-scale, 1)); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--rm-accent, #ff6b35); margin: 10px 4px 0;
    }
    .step-num {
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      background: var(--rm-accent, #ff6b35);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: calc(13px * var(--rm-font-scale, 1));
      font-weight: 700;
      color: #fff;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      user-select: none;
      position: relative;
    }
    /* Larger touch target than the 30px circle, so the number is easy to hit
       without triggering the step text (which ticks the step off). */
    .step-num::after { content: ''; position: absolute; inset: -6px; }
    .step-num.has-ings:hover { opacity: 0.8; }
    .step-num.no-ings { cursor: default; }
    .step-num.ings-open { outline: 2px solid var(--rm-accent, #ff6b35); outline-offset: 2px; }
    .step-num.done {
      background: transparent;
      border: 2px solid var(--rm-border, rgba(255,255,255,0.2));
      color: var(--rm-text-muted);
    }
    .step-num.done ha-icon { --mdc-icon-size: 16px; }
    .step-body { flex: 1; min-width: 0; }
    .step-body .dir-ings { margin: 8px 0 0; }
    .step-item.step-done .step-text {
      opacity: 0.45;
      text-decoration: line-through;
      text-decoration-color: var(--rm-border);
    }
    .step-item, .wide-step-card { cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .step-text { font-size: calc(15px * var(--rm-font-scale, 1)); color: var(--rm-text, #e5e5ea); line-height: 1.7; transition: opacity 0.2s; }

    /* Timer chip in directions */
    .time-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--rm-accent-soft, rgba(255,107,53,0.15));
      color: var(--rm-accent, #ff6b35);
      border: 1px solid var(--rm-accent, #ff6b35);
      border-radius: 12px;
      padding: 1px 7px;
      font-size: calc(12px * var(--rm-font-scale, 1));
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      vertical-align: middle;
    }
    .time-chip ha-icon { --mdc-icon-size: 12px; }
    .time-chip:hover { background: var(--rm-accent, #ff6b35); color: #fff; }

    /* Notes */
    .notes-text { font-size: calc(14px * var(--rm-font-scale, 1)); color: var(--rm-text, #e5e5ea); line-height: 1.6; }
    .empty-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      font-size: calc(14px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      text-align: center;
      padding: 20px 0;
      margin: 0;
    }
    .empty-tab ha-icon { --mdc-icon-size: 40px; opacity: 0.35; }
    .empty-tab p { margin: 0; }

    /* Nutrition (legacy table) */
    .nutrition-panel {
      max-width: 340px;
      border: 2px solid var(--rm-text, #e5e5ea);
      border-radius: 4px;
      padding: 8px 12px;
      margin: 0 auto;
    }
    .nutr-header {
      font-size: calc(28px * var(--rm-font-scale, 1));
      font-weight: 900;
      color: var(--rm-text, #e5e5ea);
      line-height: 1;
      margin-bottom: 2px;
    }
    .nutr-sub {
      font-size: calc(11px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      margin-bottom: 6px;
    }
    .nutr-divider { border-top: 1px solid var(--rm-border, rgba(255,255,255,0.15)); margin: 2px 0; }
    .nutr-divider.thick { border-top: 6px solid var(--rm-text, #e5e5ea); margin: 4px 0; }
    .nutr-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 2px 0;
      font-size: calc(13px * var(--rm-font-scale, 1));
      color: var(--rm-text, #e5e5ea);
    }
    .nutr-bold { font-weight: 700; font-size: calc(15px * var(--rm-font-scale, 1)); }
    .nutr-indent { padding-left: 14px; font-size: calc(12px * var(--rm-font-scale, 1)); }
    .nutr-val { font-weight: 600; white-space: nowrap; }
    .nutr-val em { font-style: normal; font-size: calc(11px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary, #8e8e93); }

    /* Nutrition card */
    .nutr-card { display: flex; flex-direction: column; gap: 10px; }
    .nutr-top { display: flex; align-items: center; gap: 14px; }
    .nutr-ring-wrap { flex-shrink: 0; width: 90px; height: 90px; }
    .nutr-macro-cols { display: flex; gap: 10px; flex: 1; justify-content: space-around; }
    .nutr-macro-col { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .nutr-mcol-num { font-size: calc(17px * var(--rm-font-scale, 1)); font-weight: 700; line-height: 1; }
    .nutr-mcol-label { font-size: calc(11px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary); font-weight: 500; }
    .nutr-mcol-pct { font-size: calc(10px * var(--rm-font-scale, 1)); font-weight: 600; }
    .nutr-serving-note {
      font-size: calc(11px * var(--rm-font-scale, 1)); color: var(--rm-text-muted); text-align: center; margin-top: -4px;
    }
    /* Daily RDA expandable */
    .nutr-rda-toggle {
      display: flex; align-items: center; gap: 6px;
      background: none; border: none; border-top: 1px solid var(--rm-border);
      padding: 10px 0 0; cursor: pointer; color: var(--rm-text); font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 600;
      width: 100%; text-align: left;
    }
    .nutr-rda-title { flex: 1; }
    .nutr-rda-count {
      font-size: calc(12px * var(--rm-font-scale, 1)); font-weight: 700; color: var(--rm-text-secondary);
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 10px; padding: 1px 7px;
    }
    .nutr-rda-toggle ha-icon { --mdc-icon-size: 18px; color: var(--rm-text-secondary); }
    .nutr-rda-rows { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
    .nutr-rda-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      grid-template-rows: auto 4px;
      column-gap: 8px;
      row-gap: 4px;
      font-size: calc(12px * var(--rm-font-scale, 1));
    }
    .nutr-rda-label { color: var(--rm-text-secondary); grid-column: 1; grid-row: 1; }
    .nutr-rda-val { color: var(--rm-text); font-weight: 600; grid-column: 2; grid-row: 1; white-space: nowrap; }
    .nutr-rda-pct { color: var(--rm-text-muted); grid-column: 3; grid-row: 1; white-space: nowrap; min-width: 36px; text-align: right; }
    .nutr-rda-bar-wrap { grid-column: 1 / -1; grid-row: 2; background: var(--rm-border); border-radius: 2px; height: 4px; overflow: hidden; }
    .nutr-rda-bar { height: 100%; background: var(--rm-accent); border-radius: 2px; transition: width 0.3s; }
    .nutr-rda-bar.over { background: var(--error-color, #cf6679); }

    /* Photos tab */
    .photos-tab { display: flex; flex-direction: column; gap: 16px; }
    .photos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
    }
    .photo-item {
      position: relative;
      aspect-ratio: 4/3;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid transparent;
    }
    .photo-item.main-photo { border-color: var(--rm-accent, #ff6b35); }
    .photo-item img { width: 100%; height: 100%; object-fit: cover; }
    .photo-badge {
      position: absolute;
      bottom: 4px;
      left: 4px;
      background: var(--rm-accent, #ff6b35);
      color: #fff;
      font-size: calc(10px * var(--rm-font-scale, 1));
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .photo-action {
      position: absolute;
      background: rgba(0,0,0,0.6);
      border: none;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      padding: 0;
      transition: background 0.15s;
    }
    .photo-action ha-icon { --mdc-icon-size: 14px; }
    .photo-action:hover { background: rgba(0,0,0,0.85); }
    .remove-photo { top: 4px; right: 4px; }
    .set-main { bottom: 4px; left: 4px; }

    .photo-add-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--rm-border, rgba(255,255,255,0.08));
    }
    .photo-add-label {
      font-size: calc(12px * var(--rm-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--rm-text-secondary, #8e8e93);
    }
    .photo-url-row { display: flex; gap: 8px; }
    .photo-url-input {
      flex: 1;
      background: var(--rm-bg-elevated, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 8px 10px;
      font-size: calc(13px * var(--rm-font-scale, 1));
    }
    .photo-url-input:focus { outline: none; border-color: var(--rm-accent, #ff6b35); }
    .camera-btns {
      display: flex;
      gap: 10px;
    }
    .camera-btn-split {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--rm-bg-elevated, #2c2c2e);
      border: 2px solid var(--rm-accent, #ff6b35);
      border-radius: 10px;
      color: var(--rm-text, #e5e5ea);
      padding: 16px 8px;
      cursor: pointer;
      font-size: calc(12px * var(--rm-font-scale, 1));
      text-align: center;
      transition: background 0.15s, border-color 0.15s;
    }
    .camera-btn-split:hover { background: var(--rm-accent-soft, rgba(255,107,53,0.12)); }
    .camera-btn-split ha-icon { --mdc-icon-size: 28px; color: var(--rm-accent, #ff6b35); }
    .camera-input { display: none; }

    /* Buttons */
    .action-btn {
      background: var(--rm-bg-elevated, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 8px 14px;
      cursor: pointer;
      font-size: calc(14px * var(--rm-font-scale, 1));
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .action-btn.primary {
      background: var(--rm-accent, #ff6b35);
      border-color: var(--rm-accent, #ff6b35);
      color: #fff;
    }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .icon-btn {
      background: none; border: none; cursor: pointer;
      color: var(--rm-text-secondary, #8e8e93);
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; padding: 0;
    }

    /* Edit overlay */
    .edit-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: flex-end;
      z-index: 10;
    }
    .edit-panel {
      background: var(--rm-bg-surface, #1c1c1e);
      border-radius: var(--rm-radius, 12px) var(--rm-radius, 12px) 0 0;
      width: 100%;
      max-height: 82vh;
      display: flex;
      flex-direction: column;
    }
    .edit-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--rm-border, rgba(255,255,255,0.08));
      font-weight: 600;
      font-size: calc(16px * var(--rm-font-scale, 1));
      color: var(--rm-text, #e5e5ea);
      flex-shrink: 0;
    }
    .edit-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .edit-section-label {
      font-size: calc(11px * var(--rm-font-scale, 1));
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--rm-text-muted, #8e8e93);
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid var(--rm-border, rgba(255,255,255,0.08));
    }
    .edit-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .edit-field { display: flex; flex-direction: column; gap: 4px; }
    .edit-field label { font-size: calc(11px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary, #8e8e93); text-transform: uppercase; letter-spacing: 0.05em; }
    .edit-field input, .edit-field textarea {
      background: var(--rm-bg-elevated, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 8px 10px;
      font-size: calc(14px * var(--rm-font-scale, 1));
      font-family: inherit;
      resize: vertical;
    }
    .edit-field input:focus, .edit-field textarea:focus {
      outline: none;
      border-color: var(--rm-accent, #ff6b35);
    }
    .edit-photo-row {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start;
    }
    .edit-photo-thumb {
      position: relative; width: 144px; height: 144px;
      border-radius: 8px; overflow: hidden; cursor: pointer; flex-shrink: 0;
      border: 2px solid transparent; transition: border-color 0.15s;
    }
    .edit-photo-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .edit-photo-thumb.selected { border-color: var(--rm-accent, #ff6b35); }
    .edit-thumb-badge {
      position: absolute; bottom: 6px; right: 6px;
      background: var(--rm-accent, #ff6b35); border-radius: 50%;
      width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
    }
    .edit-thumb-badge ha-icon { --mdc-icon-size: 16px; color: #fff; }
    .edit-photo-add {
      width: 144px; height: 144px; border-radius: 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--rm-accent-soft, rgba(255,107,53,0.12));
      border: 2px dashed var(--rm-accent, #ff6b35);
      cursor: pointer; color: var(--rm-accent, #ff6b35);
      transition: background 0.15s;
    }
    .edit-photo-add:hover { background: rgba(255,107,53,0.22); }
    .edit-photo-add.loading { opacity: 0.6; cursor: not-allowed; }
    .edit-photo-add ha-icon { --mdc-icon-size: 40px; }
    .edit-stars {
      display: flex;
      gap: 4px;
      padding: 4px 0;
    }
    .edit-star {
      font-size: calc(32px * var(--rm-font-scale, 1));
      color: var(--rm-border, rgba(255,255,255,0.3));
      cursor: pointer;
      transition: color 0.12s;
      line-height: 1;
      -webkit-text-stroke: 1px rgba(200,150,50,0.5);
    }
    .edit-star.filled { color: #f5a623; -webkit-text-stroke: 1px #d4881b; }
    .edit-star:hover { color: #f5a623; }
    .edit-footer {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-top: 1px solid var(--rm-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }
    .edit-footer-right { display: flex; gap: 8px; }

    /* Edit ingredient/step lists */
    .edit-ing-list, .edit-steps-list {
      list-style: none; padding: 0; margin: 0 0 6px;
    }
    .edit-ing-list li, .edit-steps-list li {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 5px 0; border-bottom: 1px solid var(--rm-border, rgba(255,255,255,0.06));
      font-size: calc(13px * var(--rm-font-scale, 1)); color: var(--rm-text, #e5e5ea);
    }
    .edit-ing-heading { font-weight: 700; color: var(--rm-accent) !important; }
    .edit-ing-text { flex: 1; line-height: 1.4; }
    .drag-handle {
      flex-shrink: 0; cursor: grab; color: var(--rm-text-muted, #636366);
      --mdc-icon-size: 18px; touch-action: none;
    }
    .drag-handle:active { cursor: grabbing; }
    .edit-ing-list li.drag-over,
    .edit-steps-list li.drag-over {
      border-top: 2px solid var(--rm-accent); margin-top: -1px;
    }
    .edit-reorder-btns { display: flex; flex-direction: column; flex-shrink: 0; gap: 0; }
    .edit-move-btn {
      background: none; border: none; cursor: pointer; padding: 0; line-height: 1;
      color: var(--rm-text-secondary, #8e8e93); --mdc-icon-size: 14px;
    }
    .edit-move-btn:disabled { opacity: 0.2; cursor: default; }
    .edit-remove-btn {
      background: none; border: none; cursor: pointer; flex-shrink: 0;
      color: var(--rm-text-secondary, #8e8e93); padding: 2px; margin-top: 1px;
    }
    .edit-remove-btn ha-icon { --mdc-icon-size: 14px; }
    .edit-add-row {
      display: flex; gap: 8px; align-items: flex-end; margin-bottom: 4px;
    }
    .edit-add-row input, .edit-add-row textarea {
      flex: 1; background: var(--rm-bg-elevated, #232833);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px; color: var(--rm-text, #e5e5ea);
      padding: 7px 10px; font-size: calc(13px * var(--rm-font-scale, 1)); font-family: inherit; resize: none;
    }
    .edit-add-row input:focus, .edit-add-row textarea:focus {
      outline: none; border-color: var(--rm-accent, #9fa8da);
    }
    .edit-add-btn {
      background: var(--rm-accent, #9fa8da); border: none; border-radius: 8px;
      color: #fff; padding: 7px 12px; cursor: pointer; font-size: calc(13px * var(--rm-font-scale, 1));
      white-space: nowrap; flex-shrink: 0;
    }

    /* Danger outline button */
    .action-btn.danger-outline {
      color: var(--error-color, #cf6679);
      border-color: var(--error-color, #cf6679);
    }
    .action-btn.danger-outline:hover {
      background: var(--error-color, #cf6679); color: #fff;
    }

    /* ── Wide grid layout (2 cols × auto rows) ─────────────── */
    /* Whole card scrolls — no independent column scrolling */
    .detail-container.wide {
      overflow-x: hidden;
      overflow-y: auto;
    }

    .wide-layout {
      --ion-grid-columns: 12;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 14px;
      width: 100%;
      box-sizing: border-box;
      flex-shrink: 0;
    }

    /* Each row is a flex container — no gap (columns are exact % fractions summing to 100%).
       align-items:stretch makes both columns the same height.
       Column spacing uses margin-left + reduced width on col-2 items. */
    .wide-row {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      width: 100%;
      box-sizing: border-box;
    }

    /* Col 1 — image card: exact Ionic 4/12 column; aspect-ratio:1/1 makes height = width */
    .wide-image-card {
      flex: 0 0 calc(calc(4 / var(--ion-grid-columns, 12)) * 100%);
      width: calc(calc(4 / var(--ion-grid-columns, 12)) * 100%);
      max-width: calc(calc(4 / var(--ion-grid-columns, 12)) * 100%);
      min-width: 0;
      aspect-ratio: 1 / 1;
      border-radius: 16px;
      overflow: hidden;
      background: var(--rm-bg-elevated);
      border: 1px solid var(--rm-border);
    }
    .wide-image-square {
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
    }
    .wide-image-square img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .wide-image-square .hero-placeholder {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      color: var(--rm-text-secondary);
    }
    .wide-image-square .hero-placeholder ha-icon { --mdc-icon-size: 64px; opacity: 0.3; }
    .slide-btn {
      position: absolute; top: 50%; transform: translateY(-50%);
      background: rgba(0,0,0,0.45); border: none; color: #fff; cursor: pointer;
      border-radius: 50%; width: 30px; height: 30px;
      display: flex; align-items: center; justify-content: center; padding: 0;
      z-index: 2; transition: background 0.15s;
    }
    .slide-btn:hover { background: rgba(0,0,0,0.7); }
    .slide-btn ha-icon { --mdc-icon-size: 20px; }
    .slide-prev { left: 6px; }
    .slide-next { right: 6px; }
    .slide-dots {
      position: absolute; bottom: 7px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 5px; z-index: 2;
    }
    .slide-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: rgba(255,255,255,0.45); transition: background 0.15s;
    }
    .slide-dot.active { background: #fff; }

    /* Col 2 — info card: 8/12 minus the 14px gap, with margin-left for the gap */
    .wide-info-card {
      flex: 0 0 calc(calc(8 / var(--ion-grid-columns, 12)) * 100% - 14px);
      width: calc(calc(8 / var(--ion-grid-columns, 12)) * 100% - 14px);
      max-width: calc(calc(8 / var(--ion-grid-columns, 12)) * 100% - 14px);
      min-width: 0;
      box-sizing: border-box;
      margin-left: 14px;
      border-radius: 16px;
      background: var(--rm-bg-elevated);
      border: 1px solid var(--rm-border);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .wide-title {
      margin: 0 0 4px; font-size: calc(22px * var(--rm-font-scale, 1)); font-weight: 700;
      color: var(--rm-text); line-height: 1.2; text-align: center;
    }
    .wide-desc {
      text-align: center; margin: 6px 0;
      font-size: calc(13px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary); line-height: 1.5;
    }
    .wide-info-card .quick-rating { justify-content: center; margin-bottom: 6px; }
    .wide-info-card .action-btns-row { justify-content: center; flex-wrap: wrap; width: 100%; }
    .wide-info-card .meta-chips { justify-content: center; margin-top: 6px; }
    /* Chips pushed to bottom-left of info card */
    .wide-info-card .chips-area { align-self: flex-start; margin-top: auto; padding-top: 10px; }

    /* Row 2, Col 1 — ingredients column: exact Ionic 4/12, aligns with image above */
    .wide-ing-col {
      flex: 0 0 calc(calc(4 / var(--ion-grid-columns, 12)) * 100%);
      width: calc(calc(4 / var(--ion-grid-columns, 12)) * 100%);
      max-width: calc(calc(4 / var(--ion-grid-columns, 12)) * 100%);
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Row 2, Col 2 — directions column: 8/12 minus gap, margin-left for spacing */
    .wide-dir-col {
      flex: 0 0 calc(calc(8 / var(--ion-grid-columns, 12)) * 100% - 14px);
      width: calc(calc(8 / var(--ion-grid-columns, 12)) * 100% - 14px);
      max-width: calc(calc(8 / var(--ion-grid-columns, 12)) * 100% - 14px);
      min-width: 0;
      margin-left: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Ingredients column controls: scaler left, cart right — above ingredients only */
    .wide-ing-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 2px;
      min-height: 42px;
    }
    .wide-dir-spacer { min-height: 42px; }
    .ing-shop-btn {
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 50%; width: 34px; height: 34px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--rm-text-secondary); padding: 0; transition: all 0.15s;
    }
    .ing-shop-btn ha-icon { --mdc-icon-size: 18px; }
    .ing-shop-btn:hover { background: var(--rm-accent-soft); color: var(--rm-accent); border-color: var(--rm-accent); }
    .ing-shop-btn.active { background: var(--rm-accent-soft); color: var(--rm-accent); border-color: var(--rm-accent); }
    .ing-shop-success { color: var(--success-color, #4caf50); display: flex; align-items: center; }
    .ing-shop-success ha-icon { --mdc-icon-size: 22px; }
    .shopping-review-panel {
      display: flex; flex-direction: column; gap: 10px;
      background: var(--rm-bg-elevated, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 10px; padding: 12px;
    }
    .review-title {
      font-size: calc(11px * var(--rm-font-scale, 1)); font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--rm-text-secondary, #8e8e93);
    }
    .review-list {
      display: flex; flex-direction: column; gap: 10px;
      max-height: 300px; overflow-y: auto;
    }
    .review-row { display: flex; flex-direction: column; gap: 4px; }
    .review-ing { display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
    .review-qty { font-size: 0.8rem; color: var(--rm-text-secondary, #8e8e93); flex-shrink: 0; }
    .review-ing-name { font-size: 0.9rem; font-weight: 500; }
    .review-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .review-chip {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 4px 10px; border-radius: 999px;
      border: 1.5px solid var(--rm-border, rgba(255,255,255,0.12));
      background: none; cursor: pointer;
      font-size: calc(12px * var(--rm-font-scale, 1)); color: var(--rm-text, #e5e5ea);
      font-family: inherit; transition: all 0.15s; white-space: nowrap;
    }
    .review-chip ha-icon { --mdc-icon-size: 13px; }
    .review-chip.selected {
      border-color: var(--rm-accent, #ff6b35);
      background: var(--rm-accent-soft, rgba(255,107,53,0.12));
      color: var(--rm-accent, #ff6b35); font-weight: 600;
    }
    .review-chip.manual { border-style: dashed; }
    .review-btns { margin-top: 2px; }

    /* Section cards (ingredients, nutrition, notes) */
    .wide-section-card {
      background: var(--rm-bg-elevated);
      border: 1px solid var(--rm-border);
      border-radius: 14px;
      padding: 12px 14px;
    }
    .wide-section-title {
      font-size: calc(14px * var(--rm-font-scale, 1)); font-weight: 700; color: var(--rm-text);
      margin-bottom: 10px; padding-bottom: 6px;
      border-bottom: 1px solid var(--rm-border);
    }

    /* Per-step direction cards in wide layout */
    .wide-step-card {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .wide-step-card .step-num { flex-shrink: 0; }
    .wide-step-card.step-done .step-text {
      opacity: 0.45;
      text-decoration: line-through;
      text-decoration-color: var(--rm-border);
    }

    /* ── Markdown content ─────────────────────────────── */
    .md-content { font-size: calc(14px * var(--rm-font-scale, 1)); line-height: 1.65; }
    .md-content p { margin: 0 0 6px; }
    .md-content p.md-gap { margin: 0 0 10px; }
    .md-content h1 { font-size: calc(18px * var(--rm-font-scale, 1)); font-weight: 700; margin: 10px 0 4px; }
    .md-content h2 { font-size: calc(16px * var(--rm-font-scale, 1)); font-weight: 700; margin: 8px 0 4px; }
    .md-content h3 { font-size: calc(14px * var(--rm-font-scale, 1)); font-weight: 700; margin: 6px 0 3px; }
    .md-content ul, .md-content ol { padding-left: 20px; margin: 4px 0 8px; }
    .md-content li { margin: 2px 0; }
    .md-content strong { font-weight: 700; }
    .md-content em { font-style: italic; }
    .md-content code { font-family: monospace; font-size: calc(12px * var(--rm-font-scale, 1)); background: var(--rm-bg-elevated); padding: 1px 4px; border-radius: 3px; }
    .md-content a { color: var(--rm-accent); text-decoration: none; }
    .md-content a:hover { text-decoration: underline; }
    .md-content hr { border: none; border-top: 1px solid var(--rm-border); margin: 8px 0; }

    /* ── List picker (tags / courses / categories / collections) ─── */
    .list-picker-field { position: relative; }
    .list-picker-wrap { display: flex; flex-direction: column; gap: 6px; }
    .list-picker-chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; min-height: 28px; }
    .list-chip {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 3px 8px; border-radius: 14px; font-size: calc(12px * var(--rm-font-scale, 1));
      border: 1px solid var(--rm-border); background: var(--rm-bg-elevated);
      color: var(--rm-text); cursor: default; transition: all 0.12s;
    }
    .list-chip.selected { background: var(--rm-accent-soft); border-color: var(--rm-accent); color: var(--rm-accent); }
    .list-chip.available { cursor: pointer; color: var(--rm-text-muted); }
    .list-chip.available:hover { border-color: var(--rm-accent); color: var(--rm-accent); background: var(--rm-accent-soft); }
    .list-chip-remove {
      background: none; border: none; padding: 0 0 0 2px; cursor: pointer;
      color: inherit; font-size: calc(14px * var(--rm-font-scale, 1)); line-height: 1; opacity: 0.7;
    }
    .list-chip-remove:hover { opacity: 1; }
    .list-chip-add-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 50%; border: 1px dashed var(--rm-border);
      background: none; cursor: pointer; color: var(--rm-text-muted); transition: all 0.12s;
    }
    .list-chip-add-btn:hover { border-color: var(--rm-accent); color: var(--rm-accent); }
    .list-chip-add-btn ha-icon { --mdc-icon-size: 14px; }
    .list-picker-dropdown {
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
    }
    .list-picker-existing { display: flex; flex-wrap: wrap; gap: 5px; }
    .list-picker-new-row { display: flex; gap: 6px; }
    .list-picker-input {
      flex: 1; background: var(--rm-bg-surface, var(--rm-bg)); border: 1px solid var(--rm-border);
      border-radius: 7px; color: var(--rm-text); padding: 5px 9px; font-size: calc(13px * var(--rm-font-scale, 1));
      font-family: inherit; min-width: 0;
    }
    .list-picker-input:focus { outline: none; border-color: var(--rm-accent); }
    .list-picker-new-btn {
      padding: 5px 12px; border-radius: 7px; border: 1px solid var(--rm-accent);
      background: var(--rm-accent); color: #fff; cursor: pointer; font-size: calc(13px * var(--rm-font-scale, 1)); font-family: inherit;
    }
    .list-picker-new-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    /* ── Inline ingredient edit ──────────────────────── */
    .edit-ing-text { cursor: pointer; flex: 1; }
    .edit-ing-text:hover { color: var(--rm-accent); }
    .edit-ing-inline-edit {
      display: flex; align-items: center; gap: 4px; padding: 4px 0; list-style: none;
    }
    .ing-inline-input {
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-accent);
      border-radius: 6px; color: var(--rm-text); padding: 4px 6px; font-size: calc(13px * var(--rm-font-scale, 1));
      font-family: inherit; min-width: 0;
    }
    .ing-inline-input:focus { outline: none; }
    .ing-inline-amt { width: 52px; flex: 0 0 52px; }
    .ing-inline-unit { width: 60px; flex: 0 0 60px; }
    .ing-inline-name { flex: 1; }
    .ing-inline-save, .ing-inline-cancel {
      width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--rm-border);
      background: none; cursor: pointer; color: var(--rm-text-muted);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .ing-inline-save { border-color: var(--rm-accent); color: var(--rm-accent); }
    .ing-inline-save:hover { background: var(--rm-accent); color: #fff; }
    .ing-inline-save ha-icon, .ing-inline-cancel ha-icon { --mdc-icon-size: 13px; }

  `;
}

try { customElements.define('rm-recipe-detail', RmRecipeDetail); } catch {}

/**
 * Add Recipe dialog — URL scrape or manual entry.
 */
import { LitElement, html, css } from 'lit';
import { msg, str } from '@lit/localize';
import JSZip from 'jszip';

class RmAddRecipeDialog extends LitElement {
  static properties = {
    api:     { type: Object },
    asPanel:    { type: Boolean },  // true = right-side panel (wide), false = bottom sheet
    inlineMode: { type: Boolean },  // true = render as full inline view (no overlay)
    _mode: { type: String },   // 'url' | 'manual' | 'import'
    _url: { type: String },
    _scraping: { type: Boolean },
    _scrapeError: { type: String },
    _form: { type: Object },
    _saving: { type: Boolean },
    _ingredientInput: { type: String },
    _ratingHover: { type: Number },
    // Import state
    _importFile: { type: Object },
    _importing: { type: Boolean },
    _importResult: { type: Object },
    _importError: { type: String },
    _importDownloadImages: { type: Boolean },
  };

  constructor() {
    super();
    this.api = null;
    this.asPanel = false;
    this.inlineMode = false;
    this._mode = 'url';
    this._url = '';
    this._scraping = false;
    this._scrapeError = null;
    this._saving = false;
    this._ingredientInput = '';
    this._ratingHover = 0;
    this._form = this._emptyForm();
    this._importFile = null;
    this._importing = false;
    this._importResult = null;
    this._importError = null;
    this._importDownloadImages = true;
  }

  _emptyForm() {
    return {
      name: '',
      description: '',
      source_url: '',
      servings: '',
      prep_time: '',
      cook_time: '',
      image_url: '',
      tags: '',
      courses: '',
      categories: '',
      collections: '',
      rating: 0,
      notes: '',
      ingredients: [],
      instructions: [],
      // Nutrition (flat for form; serialized to object on save)
      cal: '', fat: '', satf: '', chol: '', sod: '', carb: '', fib: '', sug: '', prot: '',
    };
  }

  _close() {
    this.dispatchEvent(new CustomEvent('rm-close', { bubbles: true, composed: true }));
  }

  async _handleScrape() {
    if (!this._url.trim() || this._scraping) return;
    this._scraping = true;
    this._scrapeError = null;
    try {
      const result = await this.api.scrapeRecipe(this._url.trim());
      if (result?.recipe) {
        const r = result.recipe;
        const n = r.nutrition || {};
        this._form = {
          name:         r.name || '',
          description:  r.description || '',
          source_url:   r.source_url || this._url.trim(),
          servings:     r.servings || '',
          prep_time:    r.prep_time || '',
          cook_time:    r.cook_time || '',
          image_url:    r.image_url || '',
          tags:         (r.tags || []).join(', '),
          courses:      (r.courses || []).join(', '),
          categories:   (r.categories || []).join(', '),
          collections:  (r.collections || []).join(', '),
          rating:       r.rating || 0,
          notes:        r.notes || '',
          ingredients:  r.ingredients || [],
          instructions: r.instructions || [],
          // Nutrition
          cal:  n.calories      ?? '',
          fat:  n.fat           ?? '',
          satf: n.saturated_fat ?? '',
          chol: n.cholesterol   ?? '',
          sod:  n.sodium        ?? '',
          carb: n.carbohydrates ?? '',
          fib:  n.fiber         ?? '',
          sug:  n.sugar         ?? '',
          prot: n.protein       ?? '',
        };
        this._mode = 'manual';
      } else {
        this._scrapeError = result?.error || msg('Could not extract recipe from this URL.');
      }
    } catch (err) {
      this._scrapeError = err.message || msg('Scraping failed.');
    } finally {
      this._scraping = false;
    }
  }

  _handleImportFileChange(e) {
    this._importFile = e.target.files[0] || null;
    this._importResult = null;
    this._importError = null;
  }

  async _handleImport() {
    if (!this._importFile || this._importing) return;
    this._importing = true;
    this._importResult = null;
    this._importError = null;

    try {
      let zip;
      try {
        zip = await JSZip.loadAsync(this._importFile);
      } catch (zipErr) {
        throw new Error(msg(str`Could not open ZIP file: ${zipErr.message}`));
      }

      const htmlEntry = Object.values(zip.files).find(
        f => !f.dir && f.name.endsWith('.html'),
      );
      if (!htmlEntry) {
        throw new Error(msg('No HTML file found inside the ZIP — is this a valid Recipe Keeper export?'));
      }
      const htmlContent = await htmlEntry.async('text');
      console.log(`[Recipe Keeper Import] HTML extracted (${htmlContent.length} chars), sending to backend`);

      const result = await this.api.importRecipeKeeper(htmlContent);
      console.log(`[Recipe Keeper Import] Phase 1 done: ${result.imported} imported, ${result.failed} failed, ${result.recipe_images?.length ?? 0} need images`);

      let imagesSaved = 0;
      let imagesFailed = 0;
      if (this._importDownloadImages && result.recipe_images?.length) {
        const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

        for (const { recipe_id, image_filename } of result.recipe_images) {
          const imgEntry = zip.files[image_filename]
            ?? Object.values(zip.files).find(f => {
              const base = image_filename.split('/').pop();
              return !f.dir && f.name.split('/').pop() === base
                && IMAGE_EXTS.has(f.name.slice(f.name.lastIndexOf('.')).toLowerCase());
            });

          if (!imgEntry) continue;

          try {
            const b64 = await imgEntry.async('base64');
            await this.api.uploadRecipeImage(recipe_id, b64);
            imagesSaved++;
          } catch (imgErr) {
            console.warn(`[Recipe Keeper Import] Could not save image for recipe ${recipe_id}:`, imgErr);
            imagesFailed++;
          }
        }
        console.log(`[Recipe Keeper Import] Phase 2 done: ${imagesSaved} images saved, ${imagesFailed} failed`);
      }

      this._importResult = { ...result, imagesSaved };

      if (result.imported > 0) {
        this.dispatchEvent(new CustomEvent('rm-import-done', { bubbles: true, composed: true }));
      }
    } catch (err) {
      console.error('[Recipe Keeper Import] Failed:', err);
      this._importError = err.message || String(err) || msg('Import failed.');
    } finally {
      this._importing = false;
    }
  }

  async _handleSave() {
    if (!this._form.name.trim() || this._saving) return;
    this._saving = true;
    try {
      const f = this._form;
      const splitList = v => v ? v.split(',').map(t => t.trim()).filter(Boolean) : [];

      const nMap = {
        cal: 'calories', fat: 'fat', satf: 'saturated_fat', chol: 'cholesterol',
        sod: 'sodium', carb: 'carbohydrates', fib: 'fiber', sug: 'sugar', prot: 'protein',
      };
      const nutrition = {};
      let hasNutrition = false;
      for (const [k, nk] of Object.entries(nMap)) {
        if (f[k] !== '' && f[k] != null) {
          nutrition[nk] = f[k];
          hasNutrition = true;
        }
      }

      const data = {
        name:         f.name,
        description:  f.description,
        source_url:   f.source_url,
        image_url:    f.image_url,
        servings:     parseInt(f.servings) || null,
        prep_time:    parseInt(f.prep_time) || null,
        cook_time:    parseInt(f.cook_time) || null,
        tags:         splitList(f.tags),
        courses:      splitList(f.courses),
        categories:   splitList(f.categories),
        collections:  splitList(f.collections),
        rating:       f.rating || null,
        notes:        f.notes,
        ingredients:  f.ingredients,
        instructions: f.instructions,
        nutrition:    hasNutrition ? nutrition : null,
      };

      this.dispatchEvent(new CustomEvent('rm-add-recipe', {
        detail: { data },
        bubbles: true,
        composed: true,
      }));
      this._form = this._emptyForm();
    } finally {
      this._saving = false;
    }
  }

  _setField(field, value) {
    this._form = { ...this._form, [field]: value };
  }

  _addIngredient() {
    const raw = this._ingredientInput.trim();
    if (!raw) return;
    let newIng;
    if (raw.startsWith('#')) {
      newIng = { name: raw, is_heading: true };
    } else {
      const parts = raw.split(/\s+/);
      let amount = '', unit = '', name = '';
      if (parts.length >= 3 && !isNaN(parseFloat(parts[0]))) {
        amount = parts[0];
        unit = parts[1];
        name = parts.slice(2).join(' ');
      } else if (parts.length === 2 && !isNaN(parseFloat(parts[0]))) {
        amount = parts[0];
        name = parts[1];
      } else {
        name = raw;
      }
      newIng = { amount, unit, name };
    }
    this._form = {
      ...this._form,
      ingredients: [...this._form.ingredients, newIng],
    };
    this._ingredientInput = '';
  }

  _addIngredientsBulk(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const newIngs = lines.map(raw => {
      if (raw.startsWith('#')) return { name: raw, is_heading: true };
      const parts = raw.split(/\s+/);
      let amount = '', unit = '', name = '';
      if (parts.length >= 3 && !isNaN(parseFloat(parts[0]))) {
        amount = parts[0]; unit = parts[1]; name = parts.slice(2).join(' ');
      } else if (parts.length === 2 && !isNaN(parseFloat(parts[0]))) {
        amount = parts[0]; name = parts[1];
      } else { name = raw; }
      return { amount, unit, name };
    });
    if (newIngs.length) {
      this._form = { ...this._form, ingredients: [...this._form.ingredients, ...newIngs] };
    }
  }

  _removeIngredient(idx) {
    this._form = { ...this._form, ingredients: this._form.ingredients.filter((_, i) => i !== idx) };
  }

  _addStep(text) {
    if (!text.trim()) return;
    this._form = { ...this._form, instructions: [...this._form.instructions, text.trim()] };
  }

  _removeStep(idx) {
    this._form = { ...this._form, instructions: this._form.instructions.filter((_, i) => i !== idx) };
  }

  _renderPanelContent() {
    return html`
      <div class="dialog-header">
        <div class="mode-toggle">
          <button class="mode-btn ${this._mode === 'url' ? 'active' : ''}" @click=${() => { this._mode = 'url'; }}>
            <ha-icon icon="mdi:link-variant"></ha-icon> ${msg('From URL')}
          </button>
          <button class="mode-btn ${this._mode === 'manual' ? 'active' : ''}" @click=${() => { this._mode = 'manual'; }}>
            <ha-icon icon="mdi:pencil-outline"></ha-icon> ${msg('Manual')}
          </button>
          <button class="mode-btn ${this._mode === 'import' ? 'active' : ''}" @click=${() => { this._mode = 'import'; }}>
            <ha-icon icon="mdi:import"></ha-icon> ${msg('Import')}
          </button>
        </div>
        ${!this.inlineMode ? html`<button class="icon-btn" @click=${this._close}><ha-icon icon="mdi:close"></ha-icon></button>` : ''}
      </div>

      <div class="dialog-body">
        ${this._mode === 'url'    ? this._renderUrlMode()    : ''}
        ${this._mode === 'import' ? this._renderImportMode() : ''}
        ${this._mode === 'manual' ? this._renderManualMode() : ''}
      </div>

      ${this._mode === 'manual' ? html`
        <div class="dialog-footer">
          <button class="action-btn" @click=${this._close}>${msg('Cancel')}</button>
          <button
            class="action-btn primary"
            ?disabled=${!this._form.name.trim() || this._saving}
            @click=${this._handleSave}
          >
            ${this._saving
              ? html`<ha-circular-progress active size="tiny"></ha-circular-progress>`
              : html`<ha-icon icon="mdi:content-save-outline"></ha-icon>`}
            ${msg('Save Recipe')}
          </button>
        </div>
      ` : ''}
    `;
  }

  render() {
    if (this.inlineMode) {
      return html`<div class="dialog-panel inline-panel">${this._renderPanelContent()}</div>`;
    }
    return html`
      <div class="dialog-overlay ${this.asPanel ? 'panel-mode' : ''}" @click=${(e) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog-panel">${this._renderPanelContent()}</div>
      </div>
    `;
  }

  _renderImportMode() {
    return html`
      <div class="import-mode">
        <div class="import-info">
          <ha-icon icon="mdi:information-outline"></ha-icon>
          <div>
            <strong>${msg('Recipe Keeper import')}</strong><br/>
            ${msg(html`Export your recipes from the Recipe Keeper app
            (<em>Menu → Export → Recipe Keeper File</em>), then select the
            exported <code>.zip</code> file below. Recipe photos will be saved
            locally if available.`)}
          </div>
        </div>

        <label class="file-label">
          <ha-icon icon="mdi:file-import-outline"></ha-icon>
          ${this._importFile ? this._importFile.name : msg('Choose .zip file…')}
          <input
            type="file"
            accept=".zip,application/zip"
            class="file-input"
            @change=${this._handleImportFileChange}
          />
        </label>

        <label class="toggle-row">
          <input
            type="checkbox"
            ?checked=${this._importDownloadImages}
            @change=${e => { this._importDownloadImages = e.target.checked; }}
          />
          ${msg('Save recipe photos locally')}
        </label>

        ${this._importResult ? html`
          <div class="import-result ${this._importResult.failed > 0 ? 'partial' : 'success'}">
            <ha-icon icon="${this._importResult.failed > 0 ? 'mdi:alert-circle-outline' : 'mdi:check-circle-outline'}"></ha-icon>
            <div>
              <strong>${msg(str`${this._importResult.imported} recipe${this._importResult.imported !== 1 ? 's' : ''} imported`)}</strong>
              ${this._importResult.imagesSaved > 0 ? html` ${msg(str`with ${this._importResult.imagesSaved} photo${this._importResult.imagesSaved !== 1 ? 's' : ''}`)}` : ''}
              ${this._importResult.failed > 0 ? html`<br/><small>${msg(str`${this._importResult.failed} failed — check HA logs for details`)}</small>` : ''}
            </div>
          </div>
        ` : this._importError ? html`
          <div class="import-result error">
            <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
            <div><strong>${msg('Import failed')}</strong><br/><small>${this._importError}</small></div>
          </div>
        ` : ''}

        <button
          class="action-btn primary import-btn"
          ?disabled=${!this._importFile || this._importing}
          @click=${this._handleImport}
        >
          ${this._importing
            ? html`<ha-circular-progress active size="tiny"></ha-circular-progress> ${msg('Importing…')}`
            : html`<ha-icon icon="mdi:import"></ha-icon> ${msg('Import Recipes')}`}
        </button>
      </div>
    `;
  }

  _renderUrlMode() {
    return html`
      <div class="url-mode">
        <div class="url-hint">
          <ha-icon icon="mdi:information-outline"></ha-icon>
          ${msg('Paste a recipe URL to automatically extract the recipe details.')}
        </div>
        <div class="url-row">
          <input
            type="url"
            class="url-input"
            placeholder="https://www.example.com/recipe/..."
            .value=${this._url}
            @input=${e => { this._url = e.target.value; }}
            @keydown=${e => { if (e.key === 'Enter') this._handleScrape(); }}
          />
          <button
            class="action-btn primary"
            ?disabled=${!this._url.trim() || this._scraping}
            @click=${this._handleScrape}
          >
            ${this._scraping
              ? html`<ha-circular-progress active size="tiny"></ha-circular-progress>`
              : html`<ha-icon icon="mdi:download-outline"></ha-icon>`}
            ${msg('Fetch')}
          </button>
        </div>
        ${this._scrapeError ? html`
          <div class="error-msg">
            <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
            ${this._scrapeError}
          </div>
          <button class="action-btn" @click=${() => { this._mode = 'manual'; this._form = { ...this._emptyForm(), source_url: this._url }; }}>
            ${msg('Enter manually instead')}
          </button>
        ` : ''}
      </div>
    `;
  }

  _renderManualMode() {
    const f = this._form;
    const starRating = this._ratingHover || f.rating || 0;

    return html`
      <div class="manual-mode">

        <!-- Name -->
        <div class="field">
          <label>${msg('Recipe Name *')}</label>
          <input type="text" .value=${f.name}
            @input=${e => this._setField('name', e.target.value)}
            placeholder="${msg('e.g. Spaghetti Bolognese')}" />
        </div>

        <!-- Description -->
        <div class="field">
          <label>${msg('Description')}</label>
          <textarea rows="2" .value=${f.description}
            @input=${e => this._setField('description', e.target.value)}
            placeholder="${msg('Short description…')}"></textarea>
        </div>

        <!-- Source URL + Image URL -->
        <div class="field-row">
          <div class="field">
            <label>${msg('Source URL')}</label>
            <input type="url" .value=${f.source_url}
              @input=${e => this._setField('source_url', e.target.value)}
              placeholder="https://…" />
          </div>
          <div class="field">
            <label>${msg('Image URL')}</label>
            <input type="url" .value=${f.image_url}
              @input=${e => this._setField('image_url', e.target.value)}
              placeholder="https://…/image.jpg" />
          </div>
        </div>

        <!-- Times + servings -->
        <div class="field-row-3">
          <div class="field">
            <label>${msg('Prep (min)')}</label>
            <input type="number" .value=${String(f.prep_time)}
              @input=${e => this._setField('prep_time', e.target.value)} placeholder="15" min="0" />
          </div>
          <div class="field">
            <label>${msg('Cook (min)')}</label>
            <input type="number" .value=${String(f.cook_time)}
              @input=${e => this._setField('cook_time', e.target.value)} placeholder="30" min="0" />
          </div>
          <div class="field">
            <label>${msg('Servings')}</label>
            <input type="number" .value=${String(f.servings)}
              @input=${e => this._setField('servings', e.target.value)} placeholder="4" min="1" />
          </div>
        </div>

        <!-- Rating -->
        <div class="field">
          <label>${msg('Rating')}</label>
          <div class="star-row"
            @mouseleave=${() => { this._ratingHover = 0; }}>
            ${[1,2,3,4,5].map(n => html`
              <span
                class="star ${n <= starRating ? 'filled' : ''}"
                @mouseenter=${() => { this._ratingHover = n; }}
                @click=${() => this._setField('rating', f.rating === n ? 0 : n)}
              >★</span>
            `)}
            ${f.rating ? html`<button class="clear-rating" @click=${() => this._setField('rating', 0)}>${msg('Clear')}</button>` : ''}
          </div>
        </div>

        <!-- Categorisation row -->
        <div class="field">
          <label>${msg('Tags (comma-separated)')}</label>
          <input type="text" .value=${f.tags}
            @input=${e => this._setField('tags', e.target.value)}
            placeholder="${msg('quick, weeknight, family')}" />
        </div>

        <div class="field">
          <label>${msg('Courses (comma-separated)')}</label>
          <input type="text" .value=${f.courses}
            @input=${e => this._setField('courses', e.target.value)}
            placeholder="${msg('Dinner, Main Course')}" />
        </div>

        <div class="field-row">
          <div class="field">
            <label>${msg('Categories (comma-separated)')}</label>
            <input type="text" .value=${f.categories}
              @input=${e => this._setField('categories', e.target.value)}
              placeholder="${msg('Italian, Gluten Free')}" />
          </div>
          <div class="field">
            <label>${msg('Collections (comma-separated)')}</label>
            <input type="text" .value=${f.collections}
              @input=${e => this._setField('collections', e.target.value)}
              placeholder="${msg('30 Minutes, Summer')}" />
          </div>
        </div>

        <!-- Ingredients -->
        <div class="field">
          <label>${msg(str`Ingredients (${f.ingredients.length})`)}</label>
          ${f.ingredients.length ? html`
            <ul class="ing-list">
              ${f.ingredients.map((ing, i) => html`
                <li class="${ing.is_heading || ing.name?.startsWith('#') ? 'ing-heading' : ''}">
                  <span class="ing-text">
                    ${ing.is_heading || ing.name?.startsWith('#')
                      ? html`<strong>${ing.name?.startsWith('#') ? ing.name.slice(1).trim() : ing.name}</strong>`
                      : html`${ing.amount ? `${ing.amount}${ing.unit ? ' ' + ing.unit : ''} ` : ''}${ing.name}`}
                  </span>
                  <button class="remove-btn" @click=${() => this._removeIngredient(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </li>
              `)}
            </ul>
          ` : ''}
          <div class="add-row">
            <input
              type="text"
              .value=${this._ingredientInput}
              @input=${e => { this._ingredientInput = e.target.value; }}
              @keydown=${e => { if (e.key === 'Enter') this._addIngredient(); }}
              placeholder='${msg('e.g. "2 cups flour", "salt", or "# Section"')}'
            />
            <button class="action-btn sm" @click=${this._addIngredient}>${msg('Add')}</button>
          </div>
          <div class="bulk-hint">
            ${msg(html`Tip: Use <code>#Section Name</code> to add a section header. Or paste multiple lines at once:`)}
            <button class="action-btn sm bulk-btn" @click=${() => {
              const text = prompt(msg('Paste ingredients (one per line, use # for headers):'));
              if (text) this._addIngredientsBulk(text);
            }}>
              <ha-icon icon="mdi:text-box-multiple-outline"></ha-icon> ${msg('Bulk paste')}
            </button>
          </div>
        </div>

        <!-- Directions -->
        <div class="field">
          <label>${msg(str`Directions (${f.instructions.length} steps)`)}</label>
          ${f.instructions.length ? html`
            <ol class="steps-edit">
              ${f.instructions.map((step, i) => html`
                <li>
                  <span class="step-text">${step}</span>
                  <button class="remove-btn" @click=${() => this._removeStep(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </li>
              `)}
            </ol>
          ` : ''}
          <div class="add-row">
            <textarea
              rows="2"
              @keydown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._addStep(e.target.value); e.target.value = ''; } }}
              placeholder="${msg('Type a step, press Enter to add…')}"
            ></textarea>
            <button class="action-btn sm" @click=${e => {
              const ta = e.target.closest('.add-row').querySelector('textarea');
              this._addStep(ta.value);
              ta.value = '';
            }}>${msg('Add')}</button>
          </div>
        </div>

        <!-- Notes -->
        <div class="field">
          <label>${msg('Notes')}</label>
          <textarea rows="2" .value=${f.notes}
            @input=${e => this._setField('notes', e.target.value)}
            placeholder="${msg('Variations, tips…')}"></textarea>
        </div>

        <!-- Nutrition -->
        <div class="section-divider">${msg('Nutrition Facts (per serving — optional)')}</div>
        <div class="field-row-3">
          <div class="field">
            <label>${msg('Calories (kcal)')}</label>
            <input type="number" .value=${String(f.cal)}
              @input=${e => this._setField('cal', e.target.value)} placeholder="0" min="0" />
          </div>
          <div class="field">
            <label>${msg('Protein (g)')}</label>
            <input type="number" .value=${String(f.prot)}
              @input=${e => this._setField('prot', e.target.value)} placeholder="0" min="0" />
          </div>
          <div class="field">
            <label>${msg('Fat (g)')}</label>
            <input type="number" .value=${String(f.fat)}
              @input=${e => this._setField('fat', e.target.value)} placeholder="0" min="0" />
          </div>
        </div>
        <div class="field-row-3">
          <div class="field">
            <label>${msg('Saturated Fat (g)')}</label>
            <input type="number" .value=${String(f.satf)}
              @input=${e => this._setField('satf', e.target.value)} placeholder="0" min="0" />
          </div>
          <div class="field">
            <label>${msg('Carbohydrates (g)')}</label>
            <input type="number" .value=${String(f.carb)}
              @input=${e => this._setField('carb', e.target.value)} placeholder="0" min="0" />
          </div>
          <div class="field">
            <label>${msg('Dietary Fiber (g)')}</label>
            <input type="number" .value=${String(f.fib)}
              @input=${e => this._setField('fib', e.target.value)} placeholder="0" min="0" />
          </div>
        </div>
        <div class="field-row-3">
          <div class="field">
            <label>${msg('Sugars (g)')}</label>
            <input type="number" .value=${String(f.sug)}
              @input=${e => this._setField('sug', e.target.value)} placeholder="0" min="0" />
          </div>
          <div class="field">
            <label>${msg('Sodium (mg)')}</label>
            <input type="number" .value=${String(f.sod)}
              @input=${e => this._setField('sod', e.target.value)} placeholder="0" min="0" />
          </div>
          <div class="field">
            <label>${msg('Cholesterol (mg)')}</label>
            <input type="number" .value=${String(f.chol)}
              @input=${e => this._setField('chol', e.target.value)} placeholder="0" min="0" />
          </div>
        </div>

      </div>
    `;
  }

  static styles = css`
    :host { display: block; height: 100%; }

    .inline-panel {
      border-radius: 0 !important;
      max-width: 100% !important;
      max-height: 100% !important;
      height: 100%;
      border-left: none !important;
      box-shadow: none !important;
      border-top: 1px solid var(--rm-border, rgba(0,0,0,0.08));
    }

    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      z-index: 1000;
    }

    /* Right-side panel mode (wide/tablet layout) */
    .dialog-overlay.panel-mode {
      align-items: stretch;
      justify-content: flex-end;
      background: rgba(0,0,0,0.45);
    }

    .dialog-panel {
      background: var(--rm-bg-surface, #1c1c1e);
      border-radius: var(--rm-radius, 12px) var(--rm-radius, 12px) 0 0;
      width: 100%;
      max-width: 620px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }

    .panel-mode .dialog-panel {
      border-radius: 0;
      max-width: 420px;
      max-height: 100%;
      height: 100%;
      border-left: 1px solid var(--rm-border, rgba(0,0,0,0.1));
      box-shadow: -4px 0 24px rgba(0,0,0,0.2);
    }

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--rm-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }

    .mode-toggle {
      display: flex;
      gap: 4px;
      background: var(--rm-surface, #2c2c2e);
      border-radius: 8px;
      padding: 3px;
    }
    .mode-btn {
      background: none;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: calc(13px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      display: flex;
      align-items: center;
      gap: 5px;
      transition: background 0.15s, color 0.15s;
    }
    .mode-btn ha-icon { --mdc-icon-size: 16px; }
    .mode-btn.active { background: var(--rm-accent, #ff6b35); color: #fff; }

    .icon-btn {
      background: none; border: none; cursor: pointer;
      color: var(--rm-text-secondary, #8e8e93);
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; padding: 0;
    }

    .dialog-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      scrollbar-width: thin;
      scrollbar-color: var(--rm-border, rgba(255,255,255,0.08)) transparent;
    }

    /* URL mode */
    .url-mode { display: flex; flex-direction: column; gap: 14px; }
    .url-hint {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: calc(13px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      background: var(--rm-surface, #2c2c2e);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .url-hint ha-icon { --mdc-icon-size: 18px; flex-shrink: 0; }
    .url-row { display: flex; gap: 8px; }
    .url-input {
      flex: 1;
      background: var(--rm-surface, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 10px 12px;
      font-size: calc(14px * var(--rm-font-scale, 1));
    }
    .url-input:focus { outline: none; border-color: var(--rm-accent, #ff6b35); }
    .error-msg {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--error-color, #cf6679);
      font-size: calc(13px * var(--rm-font-scale, 1));
    }
    .error-msg ha-icon { --mdc-icon-size: 16px; }

    /* Manual form */
    .manual-mode { display: flex; flex-direction: column; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label {
      font-size: calc(11px * var(--rm-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--rm-text-secondary, #8e8e93);
    }
    .field input, .field textarea {
      background: var(--rm-surface, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 8px 10px;
      font-size: calc(14px * var(--rm-font-scale, 1));
      font-family: inherit;
      resize: vertical;
    }
    .field input:focus, .field textarea:focus { outline: none; border-color: var(--rm-accent, #ff6b35); }

    .field-row   { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .field-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }

    /* Star rating */
    .star-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 0;
    }
    .star {
      font-size: calc(28px * var(--rm-font-scale, 1));
      color: var(--rm-border, rgba(255,255,255,0.2));
      cursor: pointer;
      line-height: 1;
      transition: color 0.1s;
    }
    .star.filled { color: #f5a623; }
    .star:hover  { color: #f5a623; }
    .clear-rating {
      margin-left: 8px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: calc(11px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      text-decoration: underline;
      padding: 0;
    }

    /* Section divider */
    .section-divider {
      font-size: calc(11px * var(--rm-font-scale, 1));
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--rm-text-secondary, #8e8e93);
      padding-top: 8px;
      border-top: 1px solid var(--rm-border, rgba(255,255,255,0.08));
    }

    /* Ingredient / step lists */
    .ing-list, .steps-edit { list-style: none; padding: 0; margin: 0 0 6px; }
    .ing-list li, .steps-edit li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid var(--rm-border, rgba(255,255,255,0.06));
      font-size: calc(13px * var(--rm-font-scale, 1));
      color: var(--rm-text, #e5e5ea);
    }
    .ing-list li.ing-heading { font-weight: 700; color: var(--rm-accent, #9fa8da); }
    .ing-text, .step-text { flex: 1; }
    .bulk-hint {
      font-size: calc(11px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary, #8e8e93);
      margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    .bulk-hint code {
      background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 5px; font-size: calc(11px * var(--rm-font-scale, 1));
    }
    .bulk-btn { padding: 4px 8px !important; font-size: calc(11px * var(--rm-font-scale, 1)) !important; }
    .remove-btn {
      background: none; border: none; cursor: pointer;
      color: var(--rm-text-secondary, #8e8e93); padding: 2px; flex-shrink: 0;
    }
    .remove-btn ha-icon { --mdc-icon-size: 14px; }

    .add-row { display: flex; gap: 8px; align-items: flex-end; }
    .add-row input, .add-row textarea {
      flex: 1;
      background: var(--rm-surface, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 8px 10px;
      font-size: calc(13px * var(--rm-font-scale, 1));
      font-family: inherit;
      resize: none;
    }
    .add-row input:focus, .add-row textarea:focus { outline: none; border-color: var(--rm-accent, #ff6b35); }

    /* Buttons */
    .action-btn {
      background: var(--rm-surface, #2c2c2e);
      border: 1px solid var(--rm-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      color: var(--rm-text, #e5e5ea);
      padding: 9px 14px;
      cursor: pointer;
      font-size: calc(14px * var(--rm-font-scale, 1));
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .action-btn ha-icon { --mdc-icon-size: 16px; }
    .action-btn.primary { background: var(--rm-accent, #ff6b35); border-color: var(--rm-accent, #ff6b35); color: #fff; }
    .action-btn.sm { padding: 6px 10px; font-size: calc(13px * var(--rm-font-scale, 1)); }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Import mode */
    .import-mode { display: flex; flex-direction: column; gap: 16px; }
    .import-info {
      display: flex;
      gap: 12px;
      background: var(--rm-surface, #2c2c2e);
      border-radius: 10px;
      padding: 12px 14px;
      font-size: calc(13px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      line-height: 1.5;
    }
    .import-info ha-icon { --mdc-icon-size: 20px; flex-shrink: 0; margin-top: 2px; }
    .import-info strong { color: var(--rm-text, #e5e5ea); }
    .import-info code {
      background: rgba(255,255,255,0.08);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: calc(12px * var(--rm-font-scale, 1));
    }

    .file-label {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--rm-surface, #2c2c2e);
      border: 2px dashed var(--rm-border, rgba(255,255,255,0.15));
      border-radius: 10px;
      padding: 16px 14px;
      cursor: pointer;
      font-size: calc(14px * var(--rm-font-scale, 1));
      color: var(--rm-text, #e5e5ea);
      transition: border-color 0.15s;
    }
    .file-label:hover { border-color: var(--rm-accent, #ff6b35); }
    .file-label ha-icon { --mdc-icon-size: 22px; color: var(--rm-accent, #ff6b35); }
    .file-input { display: none; }

    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: calc(13px * var(--rm-font-scale, 1));
      color: var(--rm-text-secondary, #8e8e93);
      cursor: pointer;
    }
    .toggle-row input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }

    .import-result {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: calc(13px * var(--rm-font-scale, 1));
    }
    .import-result ha-icon { --mdc-icon-size: 20px; flex-shrink: 0; margin-top: 1px; }
    .import-result.success { background: rgba(76, 175, 80, 0.12); color: var(--success-color, #4caf50); }
    .import-result.partial { background: rgba(255, 152, 0, 0.12); color: #ff9800; }
    .import-result.error   { background: rgba(207, 102, 121, 0.12); color: var(--error-color, #cf6679); }
    .import-result strong { display: block; }
    .import-result small { opacity: 0.85; }

    .import-btn { width: 100%; justify-content: center; gap: 8px; }
    .import-btn ha-icon { --mdc-icon-size: 18px; }

    .dialog-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 12px 16px;
      border-top: 1px solid var(--rm-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }
  `;
}

try { customElements.define('rm-add-recipe-dialog', RmAddRecipeDialog); } catch {}

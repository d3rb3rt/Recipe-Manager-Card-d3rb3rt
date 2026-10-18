/**
 * Recipe grid view — filter tabs, tag chips, and recipe tiles.
 * In wide (tablet/desktop) mode the search bar is hidden (it lives in the sidebar).
 */
import { LitElement, html, css } from 'lit';
import { msg, str } from '@lit/localize';

class RmRecipeGrid extends LitElement {
  static properties = {
    recipes:        { type: Array },
    allRecipes:     { type: Array },
    tags:           { type: Array },
    searchQuery:    { type: String },
    activeTag:      { type: String },
    columns:        { type: Number },
    showFavourites: { type: Boolean },
    hideSidebar:    { type: Boolean },
    scrollPos:      { type: Number },
    recentRecipes:  { type: Array },
    recentCount:    { type: Number },
    _filterMode:         { type: String },   // 'all'|'courses'|'categories'|'collections'|'favourites'|'recent'
    _starFilter:         { type: Number },   // 0 = no filter; 1-5 = minimum rating
    _sortByRating:       { type: Boolean },  // sort recipes by rating desc
    _showRatingMenu:     { type: Boolean },  // star filter dropdown open
    _selectedCourses:    { type: Object },
    _selectedCategories: { type: Object },
    _selectedCollections:{ type: Object },
    filterPreset:        { type: Object },  // { filterMode, selectedValues } — applied once on change
  };

  constructor() {
    super();
    this.recipes = [];
    this.allRecipes = [];
    this.tags = [];
    this.searchQuery = '';
    this.activeTag = null;
    this.columns = 3;
    this.showFavourites = true;
    this.hideSidebar = false;
    this.scrollPos = 0;
    this.recentRecipes = [];
    this.recentCount = 12;
    this._filterMode = 'all';
    this._starFilter = 0;
    this._sortByRating = false;
    this._showRatingMenu = false;
    this._selectedCourses = new Set();
    this._selectedCategories = new Set();
    this._selectedCollections = new Set();
    this._lastScrollPos = 0;
    this._hasRestoredScroll = false;
    this.filterPreset = null;
  }

  _toggleChip(type, value) {
    const key = type === 'courses' ? '_selectedCourses'
      : type === 'categories' ? '_selectedCategories'
      : '_selectedCollections';
    const next = new Set(this[key]);
    if (next.has(value)) next.delete(value); else next.add(value);
    this[key] = next;
  }

  updated(changedProps) {
    // Apply filterPreset when it changes (chip navigation from recipe detail)
    if (changedProps.has('filterPreset') && this.filterPreset) {
      const { filterMode, selectedValues } = this.filterPreset;
      this._filterMode = filterMode;
      this._selectedCourses = new Set();
      this._selectedCategories = new Set();
      this._selectedCollections = new Set();
      if (filterMode === 'courses')     this._selectedCourses    = new Set(selectedValues);
      if (filterMode === 'categories')  this._selectedCategories  = new Set(selectedValues);
      if (filterMode === 'collections') this._selectedCollections = new Set(selectedValues);
    }
    if (changedProps.has('scrollPos')) {
      // New target position — allow a single restore
      this._hasRestoredScroll = false;
    }
    if (this.scrollPos != null && !this._hasRestoredScroll) {
      this._hasRestoredScroll = true;
      this.updateComplete.then(() => {
        requestAnimationFrame(() => {
          const el = this.shadowRoot?.querySelector('.grid-scroll');
          if (el) el.scrollTop = this.scrollPos;
        });
      });
    }
  }

  _handleSearchInput(e) {
    this.dispatchEvent(new CustomEvent('rm-search', {
      detail: { query: e.target.value },
      bubbles: true, composed: true,
    }));
  }

  _handleClearSearch() {
    this.dispatchEvent(new CustomEvent('rm-search', {
      detail: { query: '' },
      bubbles: true, composed: true,
    }));
  }

  _handleTagClick(tag) {
    this.dispatchEvent(new CustomEvent('rm-tag-filter', {
      detail: { tag },
      bubbles: true, composed: true,
    }));
  }

  _handleOpenRecipe(recipe) {
    this.dispatchEvent(new CustomEvent('rm-open-recipe', {
      detail: { recipe },
      bubbles: true, composed: true,
    }));
  }

  _handleToggleFavourite(e, recipe) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('rm-toggle-favourite', {
      detail: { recipeId: recipe.id },
      bubbles: true, composed: true,
    }));
  }

  _recipeMatchesTag(recipe, tag) {
    if (!tag) return true;
    return recipe.tags?.includes(tag)
      || recipe.courses?.includes(tag)
      || recipe.categories?.includes(tag)
      || recipe.collections?.includes(tag);
  }

  _recipeMatchesSearch(recipe, q) {
    const query = (q || '').trim().toLowerCase();
    if (!query) return true;
    return recipe.name?.toLowerCase().includes(query)
      || recipe.description?.toLowerCase().includes(query)
      || recipe.tags?.some(t => t.toLowerCase().includes(query));
  }

  _formatTime(minutes) {
    if (!minutes) return null;
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // -- Compute filtered + sorted list --------------------------------------

  _getFilteredList() {
    const hasCourseFilter    = this._selectedCourses.size > 0;
    const hasCategoryFilter  = this._selectedCategories.size > 0;
    const hasCollectionFilter= this._selectedCollections.size > 0;
    const hasMultiFilter = hasCourseFilter || hasCategoryFilter || hasCollectionFilter;

    let base;
    if (hasMultiFilter) {
      // Filter from ALL recipes (bypass parent's single-tag filter)
      base = this.allRecipes.filter(r => {
        const mc = !hasCourseFilter     || (r.courses     || []).some(c => this._selectedCourses.has(c));
        const mk = !hasCategoryFilter   || (r.categories  || []).some(c => this._selectedCategories.has(c));
        const ml = !hasCollectionFilter || (r.collections || []).some(c => this._selectedCollections.has(c));
        return mc && mk && ml && this._recipeMatchesSearch(r, this.searchQuery);
      });
    } else {
      base = this.recipes; // uses parent's already-filtered list
    }

    switch (this._filterMode) {
      case 'favourites':
        base = this.allRecipes.filter(r => r.is_favourite)
          .filter(r => !hasMultiFilter || base.some(b => b.id === r.id));
        break;
      case 'recent':
        base = this.recentRecipes.slice(0, this.recentCount)
          .filter(r => !hasMultiFilter || base.some(b => b.id === r.id));
        break;
    }

    if (this._starFilter > 0) base = base.filter(r => (r.rating || 0) >= this._starFilter);
    if (this._sortByRating) base = [...base].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return base;
  }

  get _allCourses() {
    const set = new Set();
    this.allRecipes.forEach(r => (r.courses || []).forEach(c => set.add(c)));
    return [...set].sort();
  }

  get _coursecounts() {
    const map = {};
    this.allRecipes.forEach(r => (r.courses || []).forEach(c => { map[c] = (map[c] || 0) + 1; }));
    return map;
  }

  get _allCategories() {
    const set = new Set();
    this.allRecipes.forEach(r => (r.categories || []).forEach(c => set.add(c)));
    return [...set].sort();
  }

  get _categorycounts() {
    const map = {};
    this.allRecipes.forEach(r => (r.categories || []).forEach(c => { map[c] = (map[c] || 0) + 1; }));
    return map;
  }

  get _allCollections() {
    const set = new Set();
    this.allRecipes.forEach(r => (r.collections || []).forEach(c => set.add(c)));
    return [...set].sort();
  }

  get _collectioncounts() {
    const map = {};
    this.allRecipes.forEach(r => (r.collections || []).forEach(c => { map[c] = (map[c] || 0) + 1; }));
    return map;
  }

  _renderStars(rating) {
    const r = rating || 0;
    return html`
      <div class="card-stars">
        ${[1,2,3,4,5].map(n => html`<span class="card-star ${n <= r ? 'filled' : ''}">${n <= r ? '★' : '☆'}</span>`)}
      </div>
    `;
  }

  _renderRecipeCard(recipe) {
    const totalTime = recipe.total_time || (recipe.prep_time || 0) + (recipe.cook_time || 0) || null;
    return html`
      <div class="recipe-card" @click=${() => this._handleOpenRecipe(recipe)}>
        <div class="recipe-thumb">
          ${recipe.image_url ? html`
            <img src="${recipe.image_url}" alt="${recipe.name}" loading="lazy" />
          ` : html`
            <div class="recipe-thumb-placeholder">
              <ha-icon icon="mdi:food"></ha-icon>
            </div>
          `}
          <button
            class="fav-btn ${recipe.is_favourite ? 'active' : ''}"
            @click=${(e) => this._handleToggleFavourite(e, recipe)}
            title="${recipe.is_favourite ? msg('Remove from favourites') : msg('Add to favourites')}"
          >
            <ha-icon icon="${recipe.is_favourite ? 'mdi:heart' : 'mdi:heart-outline'}"></ha-icon>
          </button>
        </div>
        <div class="recipe-info">
          <h3 class="recipe-name">${recipe.name}</h3>
          ${this._renderStars(recipe.rating)}
          <div class="recipe-meta">
            ${totalTime ? html`
              <span class="meta-chip">
                <ha-icon icon="mdi:clock-outline"></ha-icon>
                ${this._formatTime(totalTime)}
              </span>
            ` : ''}
            ${recipe.servings ? html`
              <span class="meta-chip">
                <ha-icon icon="mdi:account-group-outline"></ha-icon>
                ${recipe.servings}
              </span>
            ` : ''}
            ${recipe.tags?.length ? html`
              <span class="meta-chip tag-chip">${recipe.tags[0]}</span>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  _renderRatingMenu() {
    return html`
      <div class="rating-menu" @click=${e => e.stopPropagation()}>
        <div class="rating-menu-section">${msg('Filter by rating')}</div>
        ${[0,1,2,3,4,5].map(n => html`
          <button class="rating-menu-item ${this._starFilter === n ? 'active' : ''}"
            @click=${() => { this._starFilter = n; this._showRatingMenu = false; }}>
            ${n === 0 ? msg('All ratings') : msg(str`${'★'.repeat(n)}${'☆'.repeat(5-n)} ${n}+`)}
          </button>
        `)}
        <div class="rating-menu-section" style="margin-top:6px">${msg('Sort')}</div>
        <button class="rating-menu-item ${this._sortByRating ? 'active' : ''}"
          @click=${() => { this._sortByRating = !this._sortByRating; this._showRatingMenu = false; }}>
          ${msg(str`${this._sortByRating ? '✓ ' : ''}Sort by rating`)}
        </button>
      </div>
    `;
  }

  render() {
    const list = this._getFilteredList();
    const showFavSection = this._filterMode === 'all' && this.showFavourites && !this.activeTag && !this.searchQuery && !this._starFilter && !this._sortByRating;
    const favourites = showFavSection ? list.filter(r => r.is_favourite) : [];
    const mainList = showFavSection && favourites.length ? list.filter(r => !r.is_favourite) : list;
    const gridStyle = `grid-template-columns: var(--rm-grid-columns, repeat(${this.columns}, minmax(0, 1fr)));`;
    const hasActiveFilter = this._starFilter > 0 || this._sortByRating;

    return html`
      <div class="grid-container" @click=${() => { if (this._showRatingMenu) this._showRatingMenu = false; }}>
        <!-- Search bar — only shown on narrow (sidebar-less) view -->
        ${!this.hideSidebar ? html`
          <div class="search-row">
            <div class="search-wrap">
              <ha-icon icon="mdi:magnify" class="search-icon"></ha-icon>
              <input
                type="text"
                class="search-input"
                placeholder="${msg('Search recipes…')}"
                .value=${this.searchQuery}
                @input=${this._handleSearchInput}
              />
              ${this.searchQuery ? html`
                <button class="clear-btn" @click=${this._handleClearSearch}>
                  <ha-icon icon="mdi:close"></ha-icon>
                </button>
              ` : ''}
            </div>
          </div>
        ` : ''}

        <!-- Filter tabs + rating filter button (wide view) -->
        ${this.hideSidebar ? html`
          <div class="filter-tabs-row">
            <div class="filter-tabs">
              ${[
                ['all',         'mdi:view-grid',           msg('All'),         null],
                ['courses',     'mdi:silverware-fork-knife',msg('Courses'),    '_selectedCourses'],
                ['categories',  'mdi:tag-multiple-outline', msg('Categories'), '_selectedCategories'],
                ['collections', 'mdi:folder-multiple-outline', msg('Collections'), '_selectedCollections'],
                ['favourites',  'mdi:heart-outline',        msg('Favourites'), null],
                ['recent',      'mdi:history',              msg('Recent'),     null],
              ].map(([mode, icon, label, badgeKey]) => html`
                <button
                  class="filter-tab ${this._filterMode === mode ? 'active' : ''}"
                  @click=${() => {
                    this._filterMode = mode;
                    if (mode === 'all') {
                      this._selectedCourses = new Set();
                      this._selectedCategories = new Set();
                      this._selectedCollections = new Set();
                    }
                  }}
                >
                  <ha-icon icon="${icon}"></ha-icon>
                  <span>${label}</span>
                  ${badgeKey && this[badgeKey]?.size > 0 ? html`<span class="tab-badge"></span>` : ''}
                </button>
              `)}
            </div>
            <!-- Rating filter button -->
            <div class="rating-filter-wrap">
              <button
                class="rating-filter-btn ${hasActiveFilter ? 'active' : ''}"
                @click=${(e) => { e.stopPropagation(); this._showRatingMenu = !this._showRatingMenu; }}
                title="${msg('Filter/sort by rating')}"
              >
                <ha-icon icon="mdi:filter-menu-outline"></ha-icon>
                ${hasActiveFilter ? html`<span class="rating-filter-badge"></span>` : ''}
              </button>
              ${this._showRatingMenu ? this._renderRatingMenu() : ''}
            </div>
          </div>
        ` : ''}

        <!-- Sub-filter chips for Courses / Categories / Collections (multi-select) -->
        ${this.hideSidebar && this._filterMode === 'courses' && this._allCourses.length ? html`
          <div class="sub-filter-row">
            <button class="sub-chip ${!this._selectedCourses.size ? 'active' : ''}"
              @click=${() => { this._selectedCourses = new Set(); }}>${msg('All')}</button>
            ${this._allCourses.map(c => html`
              <button
                class="sub-chip ${this._selectedCourses.has(c) ? 'active' : ''}"
                @click=${() => this._toggleChip('courses', c)}
              >${c}<span class="sub-chip-count">${this._coursecounts[c] || 0}</span></button>
            `)}
          </div>
        ` : ''}
        ${this.hideSidebar && this._filterMode === 'categories' && this._allCategories.length ? html`
          <div class="sub-filter-row">
            <button class="sub-chip ${!this._selectedCategories.size ? 'active' : ''}"
              @click=${() => { this._selectedCategories = new Set(); }}>${msg('All')}</button>
            ${this._allCategories.map(c => html`
              <button
                class="sub-chip ${this._selectedCategories.has(c) ? 'active' : ''}"
                @click=${() => this._toggleChip('categories', c)}
              >${c}<span class="sub-chip-count">${this._categorycounts[c] || 0}</span></button>
            `)}
          </div>
        ` : ''}
        ${this.hideSidebar && this._filterMode === 'collections' && this._allCollections.length ? html`
          <div class="sub-filter-row">
            <button class="sub-chip ${!this._selectedCollections.size ? 'active' : ''}"
              @click=${() => { this._selectedCollections = new Set(); }}>${msg('All')}</button>
            ${this._allCollections.map(c => html`
              <button
                class="sub-chip ${this._selectedCollections.has(c) ? 'active' : ''}"
                @click=${() => this._toggleChip('collections', c)}
              >${c}<span class="sub-chip-count">${this._collectioncounts[c] || 0}</span></button>
            `)}
          </div>
        ` : ''}

        <!-- Tag chips (narrow view only) -->
        ${!this.hideSidebar && this.tags.length ? html`
          <div class="tags-row">
            ${this.tags.map(tag => html`
              <button
                class="tag-btn ${this.activeTag === tag ? 'active' : ''}"
                @click=${() => this._handleTagClick(tag)}
              >${tag}</button>
            `)}
          </div>
        ` : ''}

        <!-- Active filter hint -->
        ${hasActiveFilter ? html`
          <div class="active-filter-bar">
            ${this._starFilter > 0 ? html`<span>${msg(str`⭐ ${this._starFilter}+ stars`)}</span>` : ''}
            ${this._sortByRating ? html`<span>${msg('Sorted by rating')}</span>` : ''}
            <button class="clear-filter-btn" @click=${() => { this._starFilter = 0; this._sortByRating = false; }}>
              <ha-icon icon="mdi:close"></ha-icon> ${msg('Clear')}
            </button>
          </div>
        ` : ''}

        <!-- Recipe content -->
        <div class="grid-scroll" @scroll=${e => { this._lastScrollPos = e.target.scrollTop; }}>
          ${list.length === 0 ? html`
            <div class="empty-state">
              <ha-icon icon="mdi:pot-steam-outline"></ha-icon>
              <p>${this.searchQuery || this.activeTag
                ? msg('No matching recipes')
                : this._starFilter > 0
                  ? msg(str`No recipes with ${this._starFilter}+ stars`)
                  : this._filterMode === 'favourites'
                    ? msg('No favourites yet — heart a recipe!')
                    : this._filterMode === 'recent'
                      ? msg('No recently viewed recipes yet.')
                      : msg('No recipes yet — add one!')}</p>
            </div>
          ` : html`
            ${showFavSection && favourites.length ? html`
              <div class="section-label">${msg('Favourites')}</div>
              <div class="recipe-grid" style=${gridStyle}>
                ${favourites.map(r => this._renderRecipeCard(r))}
              </div>
              ${mainList.length ? html`<div class="section-label">${msg('All Recipes')}</div>` : ''}
            ` : ''}

            <div class="recipe-grid" style=${gridStyle}>
              ${mainList.map(r => this._renderRecipeCard(r))}
            </div>
          `}
        </div>
      </div>
    `;
  }

  static styles = css`
    :host { display: block; height: 100%; position: relative; }

    .grid-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Search (narrow only) */
    .search-row {
      padding: 10px 14px 6px;
      flex-shrink: 0;
    }
    .search-wrap {
      display: flex;
      align-items: center;
      background: var(--rm-bg-elevated, #2c2c2e);
      border-radius: 10px;
      padding: 0 10px;
      gap: 8px;
    }
    .search-icon { color: var(--rm-text-secondary, #8e8e93); --mdc-icon-size: 18px; }
    .search-input {
      flex: 1; background: none; border: none; outline: none;
      color: var(--rm-text, #e5e5ea); font-size: calc(14px * var(--rm-font-scale, 1)); padding: 9px 0;
    }
    .search-input::placeholder { color: var(--rm-text-secondary, #8e8e93); }
    .clear-btn {
      background: none; border: none; cursor: pointer;
      color: var(--rm-text-secondary, #8e8e93); padding: 2px; display: flex; align-items: center;
    }
    .clear-btn ha-icon { --mdc-icon-size: 16px; }

    /* Filter tabs row (wide view) */
    .filter-tabs-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 14px 4px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--rm-border, rgba(255,255,255,0.08));
    }

    .filter-tabs {
      display: flex;
      gap: 2px;
      flex: 1;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .filter-tabs::-webkit-scrollbar { display: none; }

    .filter-tab {
      display: flex; align-items: center; gap: 5px;
      background: none; border: none; border-radius: 8px;
      padding: 6px 12px; font-size: calc(13px * var(--rm-font-scale, 1)); font-weight: 500;
      color: var(--rm-text-secondary, #8e8e93);
      cursor: pointer; white-space: nowrap;
      transition: background 0.12s, color 0.12s;
    }
    .filter-tab ha-icon { --mdc-icon-size: 16px; flex-shrink: 0; }
    .filter-tab:hover { background: var(--rm-accent-soft); color: var(--rm-text); }
    .filter-tab { position: relative; }
    .tab-badge {
      position: absolute; top: 4px; right: 4px;
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--rm-accent);
    }
    .filter-tab.active {
      background: var(--rm-accent-soft);
      color: var(--rm-accent); font-weight: 600;
    }

    /* Rating filter button */
    .rating-filter-wrap {
      position: relative;
      flex-shrink: 0;
    }
    .rating-filter-btn {
      background: none; border: 1px solid var(--rm-border);
      border-radius: 8px; padding: 6px 10px; cursor: pointer;
      color: var(--rm-text-secondary); display: flex; align-items: center;
      gap: 4px; position: relative; transition: background 0.12s, color 0.12s;
    }
    .rating-filter-btn ha-icon { --mdc-icon-size: 18px; }
    .rating-filter-btn:hover { background: var(--rm-accent-soft); color: var(--rm-text); }
    .rating-filter-btn.active { color: var(--rm-accent); border-color: var(--rm-accent); background: var(--rm-accent-soft); }
    .rating-filter-badge {
      position: absolute; top: 4px; right: 4px;
      width: 7px; height: 7px;
      background: var(--rm-accent); border-radius: 50%;
    }

    .rating-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      background: var(--rm-bg-surface);
      border: 1px solid var(--rm-border);
      border-radius: 10px;
      box-shadow: var(--rm-shadow, 0 4px 12px rgba(0,0,0,0.2));
      min-width: 170px;
      z-index: 50;
      overflow: hidden;
      padding: 4px 0;
    }
    .rating-menu-section {
      font-size: calc(10px * var(--rm-font-scale, 1)); font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--rm-text-muted); padding: 8px 14px 4px;
    }
    .rating-menu-item {
      display: block; width: 100%;
      background: none; border: none; text-align: left;
      padding: 8px 14px; font-size: calc(13px * var(--rm-font-scale, 1)); cursor: pointer;
      color: var(--rm-text-secondary); transition: background 0.12s;
    }
    .rating-menu-item:hover { background: var(--rm-accent-soft); color: var(--rm-text); }
    .rating-menu-item.active { color: var(--rm-accent); font-weight: 600; }

    /* Active filter hint bar */
    .active-filter-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 14px;
      font-size: calc(12px * var(--rm-font-scale, 1)); color: var(--rm-accent);
      background: var(--rm-accent-soft);
      flex-shrink: 0;
    }
    .clear-filter-btn {
      margin-left: auto; background: none; border: none;
      display: flex; align-items: center; gap: 3px;
      color: var(--rm-text-secondary); font-size: calc(12px * var(--rm-font-scale, 1)); cursor: pointer;
    }
    .clear-filter-btn ha-icon { --mdc-icon-size: 14px; }

    /* Sub-filter chips */
    .sub-filter-row {
      display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 14px;
      flex-shrink: 0; max-height: 88px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--rm-border) transparent;
    }
    .sub-filter-row::-webkit-scrollbar { width: 4px; }
    .sub-filter-row::-webkit-scrollbar-track { background: transparent; }
    .sub-filter-row::-webkit-scrollbar-thumb { background: var(--rm-border); border-radius: 4px; }
    .sub-chip {
      display: inline-flex; align-items: center; gap: 5px;
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 20px; color: var(--rm-text-secondary);
      font-size: calc(12px * var(--rm-font-scale, 1)); padding: 4px 8px 4px 12px; cursor: pointer;
      white-space: nowrap; transition: all 0.15s;
    }
    .sub-chip.active {
      background: var(--rm-accent-soft); border-color: var(--rm-accent); color: var(--rm-accent);
    }
    .sub-chip-count {
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--rm-accent); color: #fff;
      border-radius: 10px; font-size: calc(10px * var(--rm-font-scale, 1)); font-weight: 700;
      padding: 1px 5px; min-width: 16px; line-height: 1.4;
    }

    /* Tags (narrow view) */
    .tags-row {
      display: flex; gap: 6px; padding: 4px 14px 8px;
      overflow-x: auto; flex-shrink: 0; scrollbar-width: none;
    }
    .tags-row::-webkit-scrollbar { display: none; }
    .tag-btn {
      background: var(--rm-bg-elevated); border: 1px solid var(--rm-border);
      border-radius: 20px; color: var(--rm-text-secondary);
      font-size: calc(12px * var(--rm-font-scale, 1)); padding: 4px 10px; cursor: pointer;
      white-space: nowrap; transition: all 0.15s;
    }
    .tag-btn.active {
      background: var(--rm-accent-soft); border-color: var(--rm-accent); color: var(--rm-accent);
    }

    /* Grid scroll area */
    .grid-scroll {
      flex: 1; overflow-y: auto;
      padding: 4px 14px 16px;
      scrollbar-width: thin;
      scrollbar-color: var(--rm-border) transparent;
    }

    .section-label {
      font-size: calc(11px * var(--rm-font-scale, 1)); font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--rm-text-secondary);
      margin: 8px 0 6px;
    }

    .recipe-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }

    /* Recipe card */
    .recipe-card {
      background: var(--rm-bg-surface); border-radius: var(--rm-radius, 12px);
      overflow: hidden; cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
      border: 1px solid var(--rm-border);
    }
    .recipe-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--rm-shadow);
    }

    .recipe-thumb {
      position: relative; aspect-ratio: 4/3;
      background: var(--rm-border); overflow: hidden;
    }
    .recipe-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .recipe-thumb-placeholder {
      width: 100%; height: 100%; display: flex;
      align-items: center; justify-content: center;
      color: var(--rm-text-secondary);
    }
    .recipe-thumb-placeholder ha-icon { --mdc-icon-size: 36px; }

    .fav-btn {
      position: absolute; top: 6px; right: 6px;
      background: rgba(0,0,0,0.5); border: none; border-radius: 50%;
      width: 28px; height: 28px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: rgba(255,255,255,0.7); transition: color 0.15s; padding: 0;
    }
    .fav-btn ha-icon { --mdc-icon-size: 16px; }
    .fav-btn.active { color: var(--error-color, #cf6679); }

    .recipe-info { padding: 8px 10px 10px; }
    .recipe-name {
      margin: 0 0 4px; font-size: calc(14px * var(--rm-font-scale, 1)); font-weight: 600;
      color: var(--rm-text); overflow: hidden; text-overflow: ellipsis;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }

    /* Star rating on cards */
    .card-stars {
      display: flex; gap: 1px; margin-bottom: 5px;
    }
    .card-star {
      font-size: calc(14px * var(--rm-font-scale, 1)); line-height: 1;
      color: var(--rm-border, rgba(200,150,0,0.25));
      -webkit-text-stroke: 1px rgba(200,150,0,0.5);
    }
    .card-star.filled {
      color: #f5a623;
      -webkit-text-stroke: 1px #c47f0a;
    }

    .recipe-meta { display: flex; flex-wrap: wrap; gap: 4px; }
    .meta-chip {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: calc(11px * var(--rm-font-scale, 1)); color: var(--rm-text-secondary);
      background: rgba(128,128,128,0.08); border-radius: 6px; padding: 2px 6px;
    }
    .meta-chip ha-icon { --mdc-icon-size: 12px; }
    .tag-chip { background: var(--rm-accent-soft); color: var(--rm-accent); }

    /* Empty state */
    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 60px 20px; gap: 12px;
      color: var(--rm-text-secondary); text-align: center;
    }
    .empty-state ha-icon { --mdc-icon-size: 56px; opacity: 0.4; }
    .empty-state p { margin: 0; font-size: calc(15px * var(--rm-font-scale, 1)); }
  `;
}

try { customElements.define('rm-recipe-grid', RmRecipeGrid); } catch {}

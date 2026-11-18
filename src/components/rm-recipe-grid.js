/**
 * Recipe grid view — filter tabs, tag chips, and recipe tiles.
 * In wide (tablet/desktop) mode the search bar is hidden (it lives in the sidebar).
 */
import { LitElement, html, css } from 'lit';
import { msg, str, updateWhenLocaleChanges } from '@lit/localize';
import { getLocale } from '../services/localize.js';

const hasAny = (g) => g._filterMode !== 'all' || g._sort !== 'default' || g._sortByRating || g._starFilter > 0
  || g._selectedCourses.size > 0 || g._selectedCategories.size > 0 || g._selectedCollections.size > 0;

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
    uiStyle:        { type: String, attribute: 'ui-style', reflect: true },
    weekPlan:       { type: Array },
    showPlanner:    { type: Boolean },
    _collapsed:     { type: Object },
    _filterMode:         { type: String },   // 'all'|'courses'|'categories'|'collections'|'favourites'|'recent'
    _starFilter:         { type: Number },   // 0 = no filter; 1-5 = minimum rating
    _sortByRating:       { type: Boolean },  // sort recipes by rating desc
    _showRatingMenu:     { type: Boolean },  // star filter dropdown open
    _sort:               { type: String },   // 'default'|'rating'|'time'|'name' (Fresh/Compact sheet)
    _showSheet:          { type: Boolean },  // filter + sort sheet (Fresh/Compact)
    _selectedCourses:    { type: Object },
    _selectedCategories: { type: Object },
    _selectedCollections:{ type: Object },
    filterPreset:        { type: Object },  // { filterMode, selectedValues } — applied once on change
  };

  constructor() {
    super();
    updateWhenLocaleChanges(this); // re-render when the language file finishes loading
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
    this.uiStyle = 'classic';
    this.weekPlan = [];
    this.showPlanner = true;
    this._collapsed = {};
    this._filterMode = 'all';
    this._starFilter = 0;
    this._sortByRating = false;
    this._showRatingMenu = false;
    this._sort = 'default';
    this._showSheet = false;
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
    if (changedProps.has('_showSheet')) {
      this.dispatchEvent(new CustomEvent('rm-overlay', { detail: { open: this._showSheet }, bubbles: true, composed: true }));
    }
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
    if (this._sortByRating || this._sort === 'rating') base = [...base].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (this._sort === 'time') {
      const t = r => r.total_time || (r.prep_time || 0) + (r.cook_time || 0) || 9999;
      base = [...base].sort((a, b) => t(a) - t(b));
    } else if (this._sort === 'name') base = [...base].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

  get _styled() { return this.uiStyle === 'fresh' || this.uiStyle === 'compact'; }

  _todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // "Tonight" hero (Fresh): today's planned dinner, how many dinners are planned this week.
  _renderHero() {
    const plan = this.weekPlan || [];
    const today = this._todayISO();
    const dinners = new Set(plan.filter(e => e.meal_type === 'dinner').map(e => e.date));
    const entry = plan.find(e => e.date === today && e.meal_type === 'dinner');
    const recipe = entry ? this.allRecipes.find(r => r.id === entry.recipe_id) : null;
    const total = recipe ? (recipe.total_time || (recipe.prep_time || 0) + (recipe.cook_time || 0) || null) : null;
    const day = new Date().toLocaleDateString(getLocale(), { weekday: 'long' });
    const n = dinners.size;
    return html`
      <section class="hero" aria-label="${msg('Tonight')}">
        <div class="hero-row">
          <span class="hero-label">${msg(str`Tonight · ${day}`)}</span>
          <span class="hero-label">${msg(str`${n} of 7 dinners planned`)}</span>
        </div>
        <div class="hero-row">
          <div class="hero-main">
            ${recipe ? html`
              <div class="hero-big">${recipe.name}</div>
              <div class="hero-sub">${[total ? this._formatTime(total) : null, recipe.servings ? msg(str`serves ${recipe.servings}`) : null].filter(Boolean).join(' · ')}</div>
            ` : html`
              <div class="hero-big">${msg('Nothing planned')}</div>
              <div class="hero-sub">${msg('Pick a recipe for tonight')}</div>
            `}
          </div>
          ${recipe ? html`
            <button class="hero-cta" @click=${() => this._handleOpenRecipe(recipe)}>
              <ha-icon icon="mdi:play"></ha-icon>${msg('Cook')}
            </button>
          ` : html`
            <button class="hero-cta" @click=${() => this.dispatchEvent(new CustomEvent('rm-open-planner', { bubbles: true, composed: true }))}>
              ${msg('Plan')}
            </button>
          `}
        </div>
        <div class="hero-progress"><i style="width:${Math.round(n / 7 * 100)}%"></i></div>
      </section>
    `;
  }

  _renderRecipeRow(recipe) {
    const totalTime = recipe.total_time || (recipe.prep_time || 0) + (recipe.cook_time || 0) || null;
    const course = recipe.courses?.[0] || recipe.category || '';
    return html`
      <div class="recipe-row" role="button" tabindex="0"
        @click=${() => this._handleOpenRecipe(recipe)}
        @keydown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._handleOpenRecipe(recipe); } }}>
        <div class="row-thumb">
          ${recipe.image_url ? html`<img src="${recipe.image_url}" alt="" loading="lazy" />` : html`<ha-icon icon="mdi:food"></ha-icon>`}
        </div>
        <div class="row-body">
          <div class="row-name">${recipe.name}</div>
          <div class="row-meta">
            ${[course, totalTime ? this._formatTime(totalTime) : null].filter(Boolean).map((t, i) => html`${i ? html`<span>·</span>` : ''}<span>${t}</span>`)}
            ${recipe.rating ? html`<span>·</span><span class="row-rating"><ha-icon icon="mdi:star"></ha-icon>${recipe.rating.toFixed ? recipe.rating.toFixed(1) : recipe.rating}</span>` : ''}
          </div>
        </div>
        <button class="row-fav ${recipe.is_favourite ? 'active' : ''}"
          @click=${(e) => this._handleToggleFavourite(e, recipe)}
          title="${recipe.is_favourite ? msg('Remove from favourites') : msg('Add to favourites')}"
          aria-pressed="${recipe.is_favourite ? 'true' : 'false'}">
          <ha-icon icon="${recipe.is_favourite ? 'mdi:heart' : 'mdi:heart-outline'}"></ha-icon>
        </button>
      </div>
    `;
  }

  // One titled section: a card grid (Fresh / Classic) or collapsible rows (Compact).
  _renderSection(key, label, list, gridStyle) {
    if (this.uiStyle === 'compact' && !label) {
      return html`<div class="recipe-rows">${list.map(r => this._renderRecipeRow(r))}</div>`;
    }
    if (this.uiStyle === 'compact') {
      const open = !this._collapsed[key];
      return html`
        <button class="sec-head" aria-expanded="${open ? 'true' : 'false'}"
          @click=${() => { this._collapsed = { ...this._collapsed, [key]: open }; }}>
          <span>${label}</span><span class="sec-count">${list.length}</span>
          <ha-icon icon="mdi:chevron-down"></ha-icon>
        </button>
        ${open ? html`<div class="recipe-rows">${list.map(r => this._renderRecipeRow(r))}</div>` : ''}
      `;
    }
    return html`
      ${label ? html`<div class="section-label"><span>${label}</span>${this._styled ? html`<span class="sec-count">${list.length}</span>` : ''}</div>` : ''}
      <div class="recipe-grid" style=${gridStyle}>${list.map(r => this._renderRecipeCard(r))}</div>
    `;
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
    if (this._styled) {
      const course = recipe.courses?.[0] || recipe.category || '';
      return html`
        <div class="recipe-card" role="button" tabindex="0"
          @click=${() => this._handleOpenRecipe(recipe)}
          @keydown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._handleOpenRecipe(recipe); } }}>
          <div class="recipe-thumb">
            ${recipe.image_url ? html`<img src="${recipe.image_url}" alt="${recipe.name}" loading="lazy" />` : html`
              <div class="recipe-thumb-placeholder"><span class="plate"><ha-icon icon="mdi:food"></ha-icon></span></div>
            `}
            <button class="fav-btn ${recipe.is_favourite ? 'active' : ''}"
              @click=${(e) => this._handleToggleFavourite(e, recipe)}
              title="${recipe.is_favourite ? msg('Remove from favourites') : msg('Add to favourites')}"
              aria-pressed="${recipe.is_favourite ? 'true' : 'false'}">
              <span><ha-icon icon="${recipe.is_favourite ? 'mdi:heart' : 'mdi:heart-outline'}"></ha-icon></span>
            </button>
          </div>
          <div class="recipe-info">
            ${course ? html`<div class="eyebrow">${course}</div>` : ''}
            <h3 class="recipe-name">${recipe.name}</h3>
            <div class="recipe-meta">
              ${totalTime ? html`<span class="meta-chip"><ha-icon icon="mdi:clock-outline"></ha-icon>${this._formatTime(totalTime)}</span>` : ''}
              ${recipe.servings ? html`<span class="meta-chip"><ha-icon icon="mdi:account-group-outline"></ha-icon>${recipe.servings}</span>` : ''}
              ${recipe.rating ? html`<span class="meta-chip rating"><ha-icon icon="mdi:star"></ha-icon>${recipe.rating.toFixed ? recipe.rating.toFixed(1) : recipe.rating}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }
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
    const showFavSection = this._filterMode === 'all' && this.showFavourites && !this.activeTag && !this.searchQuery && !this._starFilter && !this._sortByRating && this._sort === 'default';
    const favourites = showFavSection ? list.filter(r => r.is_favourite) : [];
    const mainList = showFavSection && favourites.length ? list.filter(r => !r.is_favourite) : list;
    const gridStyle = `grid-template-columns: var(--rm-grid-columns, repeat(${this.columns}, minmax(0, 1fr)));`;
    const hasActiveFilter = this._starFilter > 0 || this._sortByRating || this._sort !== 'default';
    const showHero = this.uiStyle === 'fresh' && this.showPlanner && this._filterMode === 'all' && !this.activeTag && !this.searchQuery && !hasActiveFilter;

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
                @keydown=${e => { if (e.key === 'Escape' && this.searchQuery) this._handleClearSearch(); }}
              />
              ${this.searchQuery ? html`
                <button class="clear-btn" title="${msg('Clear search')}" aria-label="${msg('Clear search')}" @click=${this._handleClearSearch}>
                  <ha-icon icon="mdi:close"></ha-icon>
                </button>
              ` : ''}
            </div>
          </div>
        ` : ''}

        <!-- Filter tabs + rating filter button (wide view) -->
        ${this.hideSidebar || this._styled ? html`
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
                @click=${(e) => { e.stopPropagation(); if (this._styled) this._showSheet = true; else this._showRatingMenu = !this._showRatingMenu; }}
                title="${this._styled ? msg('Filter and sort') : msg('Filter/sort by rating')}"
                aria-label="${this._styled ? msg('Filter and sort') : msg('Filter/sort by rating')}"
              >
                <ha-icon icon="${this._styled ? 'mdi:tune-variant' : 'mdi:filter-menu-outline'}"></ha-icon>
                ${hasActiveFilter ? html`<span class="rating-filter-badge"></span>` : ''}
              </button>
              ${this._showRatingMenu && !this._styled ? this._renderRatingMenu() : ''}
            </div>
          </div>
        ` : ''}

        <!-- Sub-filter chips for Courses / Categories / Collections (multi-select) -->
        ${(this.hideSidebar || this._styled) && this._filterMode === 'courses' && this._allCourses.length ? html`
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
        ${(this.hideSidebar || this._styled) && this._filterMode === 'categories' && this._allCategories.length ? html`
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
        ${(this.hideSidebar || this._styled) && this._filterMode === 'collections' && this._allCollections.length ? html`
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
            ${showHero ? this._renderHero() : ''}
            ${showFavSection && favourites.length
              ? this._renderSection('fav', msg('Favourites'), favourites, gridStyle) : ''}
            ${mainList.length
              ? this._renderSection('all', showFavSection && favourites.length ? msg('All Recipes') : (this._styled && this._filterMode === 'all' ? msg('All Recipes') : ''), mainList, gridStyle)
              : ''}
          `}
        </div>
        ${this._showSheet ? this._renderSheet() : ''}
      </div>
    `;
  }

  // Filter + sort sheet (Fresh / Compact): what to show, sort order, minimum star rating
  _renderSheet() {
    const all = this.allRecipes;
    const favs = all.filter(r => r.is_favourite).length;
    const show = (mode) => this._filterMode === mode && !this._selectedCourses.size && !this._selectedCategories.size && !this._selectedCollections.size;
    const setMode = (mode) => {
      this._filterMode = mode;
      this._selectedCourses = new Set(); this._selectedCategories = new Set(); this._selectedCollections = new Set();
    };
    const pickValue = (type, value) => {
      setMode(type);
      const key = type === 'courses' ? '_selectedCourses' : type === 'categories' ? '_selectedCategories' : '_selectedCollections';
      this[key] = new Set([value]);
    };
    const valueGroup = (label, type, values, selected, counts) => values.length ? html`
      <div class="sheet-label">${label}</div>
      <div class="sheet-opts">
        ${values.map(v => html`
          <button class="sheet-opt" aria-pressed="${selected.has(v) ? 'true' : 'false'}" @click=${() => pickValue(type, v)}>
            ${v}<span class="so-count">${counts[v] || 0}</span>
          </button>`)}
      </div>` : '';
    const opt = (label, pressed, onClick, extra = '') => html`
      <button class="sheet-opt" aria-pressed="${pressed ? 'true' : 'false'}" @click=${onClick}>
        ${label}${extra}${pressed ? html`<ha-icon class="so-ok" icon="mdi:check"></ha-icon>` : ''}
      </button>`;
    return html`
      <div class="sheet-layer ${this.hideSidebar ? 'modal' : ''}" @click=${e => e.stopPropagation()}>
        <div class="sheet-scrim" @click=${() => { this._showSheet = false; }}></div>
        <div class="sheet" role="dialog" aria-modal="true" aria-label="${msg('Filter and sort')}">
          <div class="sheet-grab"></div>
          <div class="sheet-head">
            <h2>${msg('Filter and sort')}</h2>
            <button class="sheet-done" @click=${() => { this._showSheet = false; }}>${msg('Done')}</button>
          </div>

          <div class="sheet-label">${msg('Show')}</div>
          <div class="sheet-opts">
            ${opt(msg('All recipes'), show('all'), () => setMode('all'), html`<span class="so-count">${all.length}</span>`)}
            ${opt(msg('Favourites'), show('favourites'), () => setMode('favourites'), html`<span class="so-count">${favs}</span>`)}
            ${opt(msg('Recent'), show('recent'), () => setMode('recent'), html`<span class="so-count">${Math.min(this.recentRecipes.length, this.recentCount)}</span>`)}
          </div>
          ${valueGroup(msg('Course'), 'courses', this._allCourses, this._selectedCourses, this._coursecounts)}
          ${valueGroup(msg('Category'), 'categories', this._allCategories, this._selectedCategories, this._categorycounts)}
          ${valueGroup(msg('Collection'), 'collections', this._allCollections, this._selectedCollections, this._collectioncounts)}

          <div class="sheet-label">${msg('Sort by')}</div>
          <div class="sheet-opts">
            ${[['default', msg('Favourites first')], ['rating', msg('Highest rated')], ['time', msg('Quickest')], ['name', msg('A to Z')]]
              .map(([v, l]) => opt(l, this._sort === v && !(v === 'default' && this._sortByRating), () => { this._sort = v; this._sortByRating = false; }))}
          </div>

          <div class="sheet-label">${msg('Minimum rating')}</div>
          <div class="sheet-opts">
            ${opt(msg('Any rating'), this._starFilter === 0, () => { this._starFilter = 0; })}
            ${[5, 4, 3, 2, 1].map(n => html`
              <button class="sheet-opt" aria-pressed="${this._starFilter === n ? 'true' : 'false'}" @click=${() => { this._starFilter = n; }}
                aria-label="${msg(str`${n} stars and up`)}">
                <span class="so-stars" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => html`<ha-icon icon="${i <= n ? 'mdi:star' : 'mdi:star-outline'}"></ha-icon>`)}</span>
                ${n < 5 ? html`<span class="so-plus">${n}+</span>` : ''}
                ${this._starFilter === n ? html`<ha-icon class="so-ok" icon="mdi:check"></ha-icon>` : ''}
              </button>`)}
          </div>

          ${hasAny(this) ? html`<button class="sheet-reset" @click=${() => { setMode('all'); this._sort = 'default'; this._sortByRating = false; this._starFilter = 0; }}>${msg('Reset filters')}</button>` : ''}
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
      color: var(--rm-text, #e5e5ea); font-size: 14px; padding: 9px 0;
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
      padding: 6px 12px; font-size: 13px; font-weight: 500;
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
      font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--rm-text-muted); padding: 8px 14px 4px;
    }
    .rating-menu-item {
      display: block; width: 100%;
      background: none; border: none; text-align: left;
      padding: 8px 14px; font-size: 13px; cursor: pointer;
      color: var(--rm-text-secondary); transition: background 0.12s;
    }
    .rating-menu-item:hover { background: var(--rm-accent-soft); color: var(--rm-text); }
    .rating-menu-item.active { color: var(--rm-accent); font-weight: 600; }

    /* Active filter hint bar */
    .active-filter-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 14px;
      font-size: 12px; color: var(--rm-accent);
      background: var(--rm-accent-soft);
      flex-shrink: 0;
    }
    .clear-filter-btn {
      margin-left: auto; background: none; border: none;
      display: flex; align-items: center; gap: 3px;
      color: var(--rm-text-secondary); font-size: 12px; cursor: pointer;
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
      font-size: 12px; padding: 4px 8px 4px 12px; cursor: pointer;
      white-space: nowrap; transition: all 0.15s;
    }
    .sub-chip.active {
      background: var(--rm-accent-soft); border-color: var(--rm-accent); color: var(--rm-accent);
    }
    .sub-chip-count {
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--rm-accent); color: var(--rm-ink, #fff);
      border-radius: 10px; font-size: 10px; font-weight: 700;
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
      font-size: 12px; padding: 4px 10px; cursor: pointer;
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
      font-size: 11px; font-weight: 600; text-transform: uppercase;
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
      margin: 0 0 4px; font-size: 14px; font-weight: 600;
      color: var(--rm-text); overflow: hidden; text-overflow: ellipsis;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }

    /* Star rating on cards */
    .card-stars {
      display: flex; gap: 1px; margin-bottom: 5px;
    }
    .card-star {
      font-size: 14px; line-height: 1;
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
      font-size: 11px; color: var(--rm-text-secondary);
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
    .empty-state p { margin: 0; font-size: 15px; }

    /* ═══ Fresh + Compact ═══════════════════════════════════════════ */

    /* Search field: pill */
    :host([ui-style="fresh"]) .search-row,
    :host([ui-style="compact"]) .search-row { padding: 12px 20px 0; }
    :host([ui-style="fresh"]) .search-wrap,
    :host([ui-style="compact"]) .search-wrap {
      height: 48px; padding: 0 8px 0 16px; border-radius: 999px;
      background: var(--rm-bg-surface); border: 1px solid var(--rm-border);
    }
    :host([ui-style="compact"]) .search-wrap { border-radius: 14px; border-color: transparent; background: var(--rm-bg-elevated); }
    :host([ui-style="fresh"]) .search-wrap:focus-within,
    :host([ui-style="compact"]) .search-wrap:focus-within { outline: 2px solid var(--rm-accent); outline-offset: 1px; }
    :host([ui-style="fresh"]) .search-input,
    :host([ui-style="compact"]) .search-input { font-size: 15px; padding: 0; }
    :host([ui-style="fresh"]) .clear-btn,
    :host([ui-style="compact"]) .clear-btn { width: 36px; height: 36px; justify-content: center; border-radius: 50%; background: var(--rm-bg-elevated); color: var(--rm-text); }

    /* Filter tabs: pill chips */
    :host([ui-style="fresh"]) .filter-tabs-row,
    :host([ui-style="compact"]) .filter-tabs-row { border-bottom: none; padding: 14px 20px 0; gap: 8px; }
    :host([ui-style="fresh"]) .filter-tabs,
    :host([ui-style="compact"]) .filter-tabs { gap: 8px; }
    :host([ui-style="fresh"]) .filter-tab,
    :host([ui-style="compact"]) .filter-tab {
      min-height: 40px; padding: 0 16px; border-radius: 999px; font-size: 14px; font-weight: 600;
      border: 1px solid var(--rm-border); background: var(--rm-bg-surface); color: var(--rm-text);
    }
    :host([ui-style="compact"]) .filter-tab { border-radius: 12px; }
    :host([ui-style="fresh"]) .filter-tab ha-icon,
    :host([ui-style="compact"]) .filter-tab ha-icon { display: none; }
    :host([ui-style="fresh"]) .filter-tab:hover,
    :host([ui-style="compact"]) .filter-tab:hover { background: var(--rm-accent-soft); color: var(--rm-accent-text); }
    :host([ui-style="fresh"]) .filter-tab.active,
    :host([ui-style="compact"]) .filter-tab.active {
      background: var(--rm-text); border-color: var(--rm-text); color: var(--rm-bg-main); font-weight: 700;
    }
    :host([ui-style="fresh"]) .tab-badge,
    :host([ui-style="compact"]) .tab-badge { top: 8px; right: 8px; }
    :host([ui-style="fresh"]) .rating-filter-btn,
    :host([ui-style="compact"]) .rating-filter-btn {
      width: 44px; height: 44px; padding: 0; justify-content: center; border-radius: 50%;
      background: var(--rm-bg-surface); color: var(--rm-text);
    }
    :host([ui-style="compact"]) .rating-filter-btn { border-radius: 12px; border-color: transparent; background: var(--rm-bg-elevated); }
    :host([ui-style="fresh"]) .rating-filter-btn.active,
    :host([ui-style="compact"]) .rating-filter-btn.active { color: var(--rm-accent-text); border-color: var(--rm-accent); background: var(--rm-accent-soft); }
    :host([ui-style="fresh"]) .rating-menu,
    :host([ui-style="compact"]) .rating-menu { border-radius: 20px; padding: 8px; box-shadow: var(--rm-shadow-float); }
    :host([ui-style="fresh"]) .rating-menu-item,
    :host([ui-style="compact"]) .rating-menu-item { border-radius: 12px; min-height: 40px; }
    :host([ui-style="fresh"]) .rating-menu-item.active,
    :host([ui-style="compact"]) .rating-menu-item.active { color: var(--rm-accent-text); background: var(--rm-accent-soft); }

    /* Sub-filter + tag chips */
    :host([ui-style="fresh"]) .sub-filter-row,
    :host([ui-style="compact"]) .sub-filter-row { padding: 10px 20px 0; }
    :host([ui-style="fresh"]) .tags-row,
    :host([ui-style="compact"]) .tags-row { padding: 10px 20px 0; }
    :host([ui-style="fresh"]) .sub-chip,
    :host([ui-style="fresh"]) .tag-btn,
    :host([ui-style="compact"]) .sub-chip,
    :host([ui-style="compact"]) .tag-btn {
      min-height: 36px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 600;
      background: var(--rm-bg-surface); color: var(--rm-text); display: inline-flex; align-items: center;
    }
    :host([ui-style="compact"]) .sub-chip, :host([ui-style="compact"]) .tag-btn { border-radius: 12px; }
    :host([ui-style="fresh"]) .sub-chip, :host([ui-style="compact"]) .sub-chip { padding-right: 8px; }
    :host([ui-style="fresh"]) .sub-chip.active, :host([ui-style="fresh"]) .tag-btn.active,
    :host([ui-style="compact"]) .sub-chip.active, :host([ui-style="compact"]) .tag-btn.active {
      background: var(--rm-accent-soft); border-color: var(--rm-accent); color: var(--rm-accent-text);
    }
    :host([ui-style="fresh"]) .sub-chip-count,
    :host([ui-style="compact"]) .sub-chip-count { color: var(--rm-ink); }
    :host([ui-style="fresh"]) .active-filter-bar,
    :host([ui-style="compact"]) .active-filter-bar { margin: 10px 20px 0; padding: 8px 14px; border-radius: 12px; color: var(--rm-accent-text); }

    /* Scroll area + section labels */
    :host([ui-style="fresh"]) .grid-scroll,
    :host([ui-style="compact"]) .grid-scroll { padding: 4px 20px 24px; }
    :host([ui-style="fresh"]) .section-label,
    :host([ui-style="compact"]) .section-label {
      display: flex; align-items: center; gap: 8px; margin: 18px 4px 10px;
      font-size: 12px; font-weight: 700; letter-spacing: 0.06em; color: var(--rm-text-secondary);
    }
    .sec-count { font-weight: 600; }

    /* Hero (Fresh) */
    .hero {
      display: grid; gap: 12px; margin: 16px 0 0; padding: 18px 20px;
      border-radius: 24px; background: var(--rm-accent); color: var(--rm-ink);
    }
    .hero-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .hero-label { font-size: 13px; font-weight: 600; }
    .hero-main { min-width: 0; }
    .hero-big { font-size: 26px; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; overflow-wrap: anywhere; }
    .hero-sub { font-size: 13px; font-weight: 600; margin-top: 4px; }
    .hero-cta {
      flex: none; display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 18px 0 14px;
      border: none; border-radius: 999px; background: var(--rm-ink); color: var(--rm-accent);
      font-size: 14px; font-weight: 700; cursor: pointer;
    }
    .hero-cta ha-icon { --mdc-icon-size: 18px; }
    .hero-progress { height: 8px; border-radius: 99px; overflow: hidden; background: color-mix(in srgb, var(--rm-ink) 28%, transparent); }
    .hero-progress i { display: block; height: 100%; border-radius: 99px; background: var(--rm-ink); }

    /* Cards (Fresh + Compact when the grid is used) */
    :host([ui-style="fresh"]) .recipe-grid,
    :host([ui-style="compact"]) .recipe-grid { gap: 14px; margin-bottom: 8px; }
    :host([ui-style="fresh"]) .recipe-card,
    :host([ui-style="compact"]) .recipe-card {
      border-radius: var(--rm-radius-card); box-shadow: none; transform: none;
    }
    :host([ui-style="fresh"]) .recipe-card:hover { border-color: var(--rm-accent); box-shadow: none; transform: none; }
    :host([ui-style="fresh"]) .recipe-card:focus-visible,
    :host([ui-style="compact"]) .recipe-card:focus-visible,
    :host([ui-style="compact"]) .recipe-row:focus-visible { outline: 2px solid var(--rm-accent); outline-offset: 2px; }
    :host([ui-style="fresh"]) .recipe-thumb-placeholder {
      background: linear-gradient(135deg, var(--rm-accent-soft), var(--rm-bg-elevated));
    }
    :host([ui-style="fresh"]) .plate {
      display: flex; align-items: center; justify-content: center;
      width: 56%; aspect-ratio: 1; border-radius: 50%;
      background: var(--rm-bg-surface); color: var(--rm-accent-text);
      box-shadow: 0 0 0 7px color-mix(in srgb, var(--rm-bg-surface) 45%, transparent);
    }
    :host([ui-style="fresh"]) .plate ha-icon { --mdc-icon-size: 32px; }
    :host([ui-style="fresh"]) .fav-btn {
      top: 2px; right: 2px; width: 44px; height: 44px; background: none; color: #12201B;
    }
    :host([ui-style="fresh"]) .fav-btn > span {
      width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.94);
      display: flex; align-items: center; justify-content: center;
    }
    :host([ui-style="fresh"]) .fav-btn ha-icon { --mdc-icon-size: 18px; }
    :host([ui-style="fresh"]) .fav-btn.active { color: #A32B2B; }
    :host([ui-style="fresh"]) .recipe-info { padding: 12px 14px 14px; display: grid; gap: 6px; }
    .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--rm-text-secondary); }
    :host([ui-style="fresh"]) .recipe-name { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.25; min-height: 2.5em; }
    :host([ui-style="fresh"]) .recipe-meta { flex-wrap: nowrap; gap: 10px; align-items: center; }
    :host([ui-style="fresh"]) .meta-chip {
      background: none; padding: 0; border-radius: 0; font-size: 12.5px; font-weight: 500; gap: 4px; white-space: nowrap;
    }
    :host([ui-style="fresh"]) .meta-chip ha-icon { --mdc-icon-size: 15px; }
    :host([ui-style="fresh"]) .meta-chip.rating { margin-left: auto; color: var(--rm-warn); font-weight: 700; }

    /* Rows (Compact) */
    :host([ui-style="compact"]) .sec-head {
      display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px;
      margin-top: 8px; padding: 10px 4px 4px; border: none; background: transparent; text-align: left;
      font: inherit; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--rm-text-secondary); cursor: pointer;
    }
    :host([ui-style="compact"]) .sec-head .sec-count { flex: 1; }
    :host([ui-style="compact"]) .sec-head ha-icon { --mdc-icon-size: 18px; transition: transform 0.15s; }
    :host([ui-style="compact"]) .sec-head[aria-expanded="false"] ha-icon { transform: rotate(-90deg); }
    .recipe-rows { display: block; }
    .recipe-row {
      display: flex; align-items: center; gap: 12px; padding: 10px 0;
      border-bottom: 1px solid var(--rm-line); cursor: pointer;
    }
    .recipe-row:last-child { border-bottom: none; }
    .row-thumb {
      flex: none; width: 56px; height: 56px; border-radius: 14px; overflow: hidden;
      background: linear-gradient(135deg, var(--rm-accent-soft), var(--rm-bg-elevated));
      display: flex; align-items: center; justify-content: center; color: var(--rm-accent-text);
    }
    .row-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .row-thumb ha-icon { --mdc-icon-size: 26px; }
    .row-body { flex: 1; min-width: 0; }
    .row-name { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12.5px; font-weight: 500; color: var(--rm-text-secondary); white-space: nowrap; }
    .row-rating { display: inline-flex; align-items: center; gap: 2px; color: var(--rm-warn); font-weight: 700; }
    .row-rating ha-icon { --mdc-icon-size: 14px; }
    .row-fav {
      flex: none; width: 44px; height: 44px; padding: 0; border: none; background: transparent;
      color: var(--rm-text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer;
    }
    .row-fav.active { color: var(--rm-danger); }
    :host([ui-style="compact"]) .empty-state ha-icon,
    :host([ui-style="fresh"]) .empty-state ha-icon { color: var(--rm-accent-text); opacity: 0.6; }

    /* ── Filter + sort sheet ── */
    .sheet-layer { position: absolute; inset: 0; z-index: 300; }
    .sheet-scrim { position: absolute; inset: 0; background: rgba(10,16,13,0.5); }
    .sheet {
      position: absolute; left: 0; right: 0; bottom: 0; max-height: 90%; overflow-y: auto; box-sizing: border-box;
      padding: 10px 20px 28px; border-radius: 32px 32px 0 0; background: var(--rm-bg-main); color: var(--rm-text);
      box-shadow: 0 -10px 40px rgba(0,0,0,0.22);
    }
    .sheet-layer.modal .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: min(480px, 92%); max-height: 86%; border-radius: 28px; }
    .sheet-grab { width: 40px; height: 5px; border-radius: 99px; margin: 0 auto 8px; background: var(--rm-border); }
    .sheet-layer.modal .sheet-grab { display: none; }
    .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 4px 6px; }
    .sheet-head h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .sheet-done { flex: none; min-height: 44px; padding: 0 20px; border: none; border-radius: 999px; background: var(--rm-accent); color: var(--rm-ink, #fff); font-weight: 700; font-size: 14px; cursor: pointer; }
    .sheet-label { padding: 14px 4px 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--rm-text-secondary); }
    .sheet-opts { border-radius: 22px; border: 1px solid var(--rm-border); background: var(--rm-bg-surface); padding: 0 14px; }
    :host([ui-style="compact"]) .sheet-opts { border-color: transparent; border-radius: 18px; }
    .sheet-opt {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 0;
      border: none; border-bottom: 1px solid var(--rm-line); background: transparent; text-align: left;
      font: inherit; font-size: 15px; font-weight: 600; color: var(--rm-text); cursor: pointer;
    }
    .sheet-opts > .sheet-opt:last-child { border-bottom: none; }
    .sheet-opt[aria-pressed="true"] { color: var(--rm-accent-text); font-weight: 700; }
    .sheet-opt:focus-visible, .sheet-done:focus-visible, .sheet-reset:focus-visible { outline: 2px solid var(--rm-accent); outline-offset: 2px; }
    .so-count { margin-left: auto; font-size: 13px; font-weight: 600; color: var(--rm-text-secondary); }
    .so-ok { margin-left: auto; --mdc-icon-size: 20px; color: var(--rm-accent-text); }
    .so-count + .so-ok { margin-left: 8px; }
    .so-stars { display: inline-flex; color: var(--rm-warn); }
    .so-stars ha-icon { --mdc-icon-size: 20px; }
    .so-plus { font-size: 13px; font-weight: 700; color: var(--rm-text-secondary); }
    .sheet-reset { display: block; width: 100%; margin-top: 16px; min-height: 48px; border: 1px solid var(--rm-border); border-radius: 999px; background: var(--rm-bg-surface); color: var(--rm-text); font: inherit; font-weight: 700; cursor: pointer; }
  `;
}

try { customElements.define('rm-recipe-grid', RmRecipeGrid); } catch {}

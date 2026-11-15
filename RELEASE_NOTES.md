# Recipe Manager Card 2026.11.2 — Complete German

> **Requires:** Recipe Manager 2026.11.2 or later.

## Changes
- **German:** every string added since 2026.11.1 is translated (Fresh and Compact styles, filter and sort, timers, settings, planner), the formal "Sie" is used throughout, and about 25 existing translations that lost the space next to a number or name are fixed ("Zurück zu Pasta", "5 Min.").
- **Plurals:** "1 Rezept / 3 Rezepte importiert", "Pro Portion / Pro 4 Portionen" and the photo count are now correct in every language. They were built by adding an English "s".
- **Language loading:** the card now re-renders as soon as the language file has loaded, so German no longer waits for the next tap.
- The "Tonight" card names the weekday in the card's language, and the theme names are translated (Wiese, Schiefer, Sonnenuntergang in German).
- **First run:** the card starts on metric units when Home Assistant is metric or the country is Germany, Austria, Switzerland and other metric countries.

---

# Recipe Manager Card 2026.11.1 — Fresh and Compact interface styles

First release on calendar versioning (`YYYY.M.N`, the same as Shopping List Manager).

> **Requires:** Recipe Manager 2026.11.1 or later. For the embedded shopping list to follow the style and theme, also update Shopping List Manager to 2026.11.3 or later.

## Filters, timers, settings and planner colours
- **Filter and sort:** the tune button opens a sheet with Show (all, favourites, recent, course, category, collection), Sort by (favourites first, highest rated, quickest, A to Z) and **Minimum rating** (star rows).
- **Timers:** new Timers view for Fresh and Compact. Quick-start chips, one card per timer with a big clock and progress bar, a green Ready card when a timer finishes. Local, Home Assistant global and Voice PE timers appear together.
- **Voice PE / ESPHome timers:** mirrors the template sensors from the ha-timer-card guide (`sensor.vpe_timer_1`, state active, paused, finished, idle). Pause, resume and cancel work when the sensor exposes `timer_id` and `control_entity`. Turn on or off, and change the sensor prefix, in Settings > Advanced.
- **Settings:** icon tiles on every row, and Appearance now matches Shopping List Manager: **Interface style** cards with previews, **Theme** (Meadow, Slate, Sunset), and **Colour mode** (Light, Dark, Match device, which follows Home Assistant's theme first).
- **Planner:** meal slots use the demo's icons and colours (breakfast amber sun, lunch blue cutlery, dinner purple moon, snack pink cup).
- Sheets (filter, planner picker) now cover the bottom nav and + button.
- The embedded Shopping List Manager follows the chosen theme too (needs Shopping List Manager 2026.11.3).

## Interface styles
- **Interface style** setting (Settings > Appearance): **Fresh** (default), **Compact**, or **Classic** (the previous look and named colour themes, unchanged).
- Fresh and Compact use the same palettes and shapes as Shopping List Manager, in light and dark.
- **Fresh:** pill header, round buttons, rounded recipe cards, a "Tonight" card showing today's planned dinner and how many dinners are planned this week, floating bottom nav and a + button.
- **Compact:** bold title, square buttons, collapsible recipe rows, flat bottom tab bar, + in the header.
- Restyled: recipe grid and filters, recipe detail (narrow and wide), planner, settings, add recipe, timers, sidebar.
- **Meal planner** has a new day view in Fresh and Compact: pick a day, see its breakfast, lunch, dinner and snack in one card, with today and the next day shown together (side by side on wide screens). Classic keeps the week grid.
- The embedded **Shopping List Manager** follows the style and light/dark mode (needs Shopping List Manager 2026.11.3 or later; older versions only pick up the colours). Its own tab bar sits flat inside the card.

---

# Release Notes — Recipe Manager Card v1.0.0

First public release of the Recipe Manager Card for Home Assistant.

> **Requires:** [Recipe Manager](https://github.com/thekiwismarthome/Recipe-Manager) backend integration v1.0.0 or later.

## What's Included

### Recipe Grid
- Browse all recipes in a responsive grid
- Live search bar with clear button
- Filter by tag, course or category using chip selectors
- Sort by rating or filter to favourites / recently viewed
- Configurable column count (2–10 columns)

### Recipe Detail View
- Full ingredients list with serving scaler (tap +/− to scale all quantities)
- Metric unit conversion — converts oz, lb, cups, fl oz → g, ml, kg on demand
- Step-by-step directions with tappable timers (tap any time mention to start a countdown)
- Ingredient checklist — tap ingredients to tick them off while cooking
- Nutrition panel with macro ring showing carbs, fat and protein arcs
- Photo gallery with swipe navigation and configurable auto-advance slideshow
- Favourite, Plan and Edit quick-action buttons (circular icon style)

### Wide Layout (Tablet/Desktop)
- Two-column layout: image + info card on the top row, ingredients + directions on the bottom row
- Collapsible sidebar with search, navigation and recipe count

### Narrow Layout (Phone)
- Single-column layout with full-width hero image
- Bottom navigation bar
- Tag/filter chips in the recipe grid

### Edit Mode
- Edit all recipe fields inline: name, description, source URL, prep/cook time, servings, rating, tags, courses, categories, collections and notes
- Upload a new photo from your device or paste an image URL — current image shown as preview at the top of the edit form
- Drag-and-drop ingredient and step reordering
- ▲/▼ reorder buttons as an alternative to dragging
- Inline ingredient and step editors with keyboard shortcuts (Enter to add)
- Nutrition facts editor (calories, fat, saturated fat, carbs, fibre, sugar, protein, sodium, cholesterol)
- Delete recipe with confirmation

### Adding Recipes
- **Scrape from URL** — paste any recipe website link and import in one tap
- **Manual entry** — fill in any fields you want
- **Recipe Keeper import** — drag-and-drop or upload an HTML export from Recipe Keeper for bulk import

### Meal Planner
- Weekly calendar view — navigate forward/backward through weeks
- Assign recipes to breakfast, lunch, dinner or snack slots on any day
- Remove meals with a single tap
- Back-to-recipe arrow when opening the planner from a recipe detail view

### Shopping List
- Add recipe ingredients to a shopping list from the recipe detail
- Integrates with Shopping List Manager Card (optional)

### Timers
- Start timers by tapping any time mention in recipe directions
- Multiple simultaneous timers
- Configurable presets for your most-used durations
- Audio alert on completion (built-in sounds or upload your own)
- Wake lock — keeps your screen on while cooking (configurable duration)

### Settings
- Light / dark / system-auto theme
- Grid column count (2–10)
- Show/hide metric unit conversion button
- Show/hide meal planner in navigation
- Image slideshow interval (Off / 3 s / 5 s / 10 s / 15 s)
- Wake lock duration (15 / 30 / 45 / 60 min)
- Timer sound selection

## Installation

See the [README](README.md) for full HACS installation instructions.

> **Also required:** Install [Recipe Manager](https://github.com/thekiwismarthome/Recipe-Manager) first — the card will not work without the backend integration.

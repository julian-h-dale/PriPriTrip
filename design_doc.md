# Tailwind + shadcn Design Guide

## Purpose

This guide defines the shared visual and interaction direction for projects using Tailwind CSS and shadcn/ui.

The goal is to provide a consistent starting point for one-off applications so that visual and behavioral decisions do not need to be revisited for every project. It covers visual styling (color, surfaces, radius) as well as common interaction conventions (feedback, loading, empty states). General project structure, stack choices, and application-specific design are outside its scope.

## Design Direction

The default visual style should be:

- Modern and minimal
- Sharp rather than soft
- Strong, solid color contrast
- Clean typography
- Clearly defined surfaces and controls
- Restrained use of decorative effects
- Compact enough to feel like an application rather than a marketing site

The default shadcn appearance should be treated as a starting point, not a fixed design. In particular, reduce the rounded appearance of the default components.

## Corner Radius

Use a **4px base corner radius** as the project default.

This is the primary theme change from standard shadcn styling. It keeps controls visually distinct without giving the interface the soft, highly rounded appearance common in many default shadcn examples.

Set the global shadcn radius token to:

```css
:root {
  --radius: 0.25rem;
}
```

Components should inherit their radius from the shared theme wherever possible rather than defining unrelated radius values individually.

### Radius Guidelines

Most controls — buttons, inputs, selects, cards, panels, badges — share the same low base radius. Dialogs and menus may use a low to moderate radius. Elements that are inherently circular, such as avatar images or toggle handles, may remain circular.

Avoid pill-shaped controls unless the shape communicates a specific purpose.

## Borders and Surfaces

Prefer **clear borders over shadows** for separating interface elements.

Cards, panels, inputs, and similar surfaces should generally use a visible 1px border. Stronger borders may be used where additional hierarchy is useful.

Shadows should be subtle or omitted. Avoid relying on large or soft shadows as the primary way to distinguish components.

This should produce interfaces that feel crisp and structured rather than layered and floating.

## Color

Favor a restrained base palette with **strong solid accent colors**.

**Dark mode is the default; light is kept in step.** The root element carries `dark`, or `light` when someone chooses Light mode (the All trips drawer; a choice per phone, applied before first paint in `index.html`). Design against dark backgrounds first, then check the page in light. Use dark neutral backgrounds and high-contrast foreground text as the foundation. Accent and status colors should be clear and saturated enough to be immediately distinguishable against the dark base.

Light exists for reading outdoors in bright sun, so its targets are higher than a usual light theme's: text, *including secondary text* (`muted-foreground`), at least **7:1** against its surface (WCAG AAA); status colors at least 4.5:1 as text; the coverage colors at least 3:1 on a card. Both themes are one set of tokens each in `index.css`, and `src/test/contrast.test.js` checks the key pairs, so a token change that breaks a target fails `make verify`. Every token defined for dark must be defined for light.

Drive color from shadcn's **semantic CSS variable tokens** (`primary`, `destructive`, `muted`, `border`, and so on), defined once in `index.css`. Use the token rather than hardcoding hex values in individual components, so the palette stays consistent and adjustable in one place.

Keep a small, consistent set of **status intents** across the application — typically success, warning, destructive, and info — each mapped to a semantic color rather than chosen ad hoc per component.

## Component Styling

Use the shared shadcn theme for broad visual decisions first.

When a shadcn component needs a permanent visual adjustment, modify the shared component rather than repeatedly applying the same styling wherever it is used.

One-off styling at the point of use is appropriate for genuinely exceptional cases, but repeated overrides indicate that the shared component or theme should be updated.

The objective is for normal component usage to automatically produce the project's intended visual style.

## Application-Specific Components

shadcn components should provide the common UI building blocks. Application-specific concepts should be composed from those building blocks rather than forcing application behavior into the base shadcn components.

For example, a project may define its own task card, itinerary item, status display, or editor toolbar while relying on the shared Button, Card, Dialog, Input, and other base components underneath.

This allows each application to develop its own interface while retaining the same overall visual language.

## Interaction Patterns

Beyond static styling, keep common behaviors consistent so the application feels predictable. These are defaults, not rules.

- **Feedback on writes** — successful create, update, and delete actions surface a brief toast; failures surface an error toast. Keep this consistent rather than notifying in some places and staying silent in others.
- **Loading states** — prefer inline or skeleton loading on the surface being loaded over full-page spinners, and disable submit controls while a request is in flight.
- **Destructive actions** — confirm before irreversible actions, and use the semantic destructive color for the control.
- **Empty states** — lists and collections show a simple empty state with a clear primary action rather than a blank area.
- **Focus and hover** — preserve visible focus rings for keyboard users rather than removing them for aesthetics, and give interactive elements a clear hover state.
- **Forms** — validate on submit and show errors inline next to the relevant field.

## Default Visual Checklist

When starting a new project using this pattern:

- Set the global radius to **4px**
- Default to dark mode (`dark` class on the root); keep any light theme as a second token set, checked for contrast
- Drive color from semantic theme tokens rather than hardcoded values
- Prefer visible borders to prominent shadows
- Keep backgrounds and typography high contrast
- Use strong, solid colors for important actions and statuses
- Avoid unnecessary gradients and decorative effects
- Avoid pill-shaped controls by default
- Keep spacing clean and moderately compact
- Give write actions consistent toast feedback and lists a clear empty state
- Make shared component changes globally rather than repeating local overrides
- Allow application-specific components to build on the shared visual foundation

These conventions are defaults, not restrictions. Individual projects may intentionally depart from them when the application's design calls for it.

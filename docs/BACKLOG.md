# Backlog

Feature ideas not yet scheduled into a plan. Each entry says what the user gets and what it touches. When an idea is picked up, move it into a plan under `docs/superpowers/plans/` and remove it here.

## Model picker with pricing when setting up a provider

**Idea.** When the user connects a new provider profile, the "Default model" field is a dropdown of the models that provider offers, instead of a free-text input. Where the provider reports prices, each option shows them (for example "gpt-4o-mini · $0.15 / $0.60 per 1M tokens").

**Behaviour.**

- The list loads as soon as it can: right after the API key is entered, or before it for providers whose model list needs no key (OpenRouter, local servers such as Ollama).
- Searchable, since some providers list hundreds of models. Manual entry stays available for models the list omits.
- Prices come from provider metadata when reported (OpenRouter returns them in `/models`); otherwise fall back to the profile's editable price table, or show no price rather than a guessed one.
- Capability flags (vision, audio) are prefilled from the same metadata where available.
- If listing fails (CORS, bad key, endpoint missing), say what failed and keep the free-text field working.

**Touches.** `src/settings/ProfileForm.tsx` (Default model field), `LlmProvider.listModels` in the adapters under `src/ai/`, `cachedModels` and `priceTable` on the profile. Fits SPEC "Model selection" and "Token and cost tracking", which already describe `/models` loading and provider-reported prices.

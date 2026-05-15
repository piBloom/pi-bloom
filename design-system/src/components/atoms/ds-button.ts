/**
 * @element ds-button
 * @summary Button primitive used by NixPi production controls.
 */

import { LitElement, html, css, type CSSResultGroup } from "lit";
import { customElement, property } from "lit/decorators.js";

export type DsButtonVariant =
	| "filled"
	| "outlined"
	| "surface"
	| "error"
	| "tab"
	| "text"
	| "fab";

@customElement("ds-button")
export class DsButton extends LitElement {
	static styles: CSSResultGroup = css`
    :host {
      display: inline-flex;
      position: relative;
      width: max-content;
      height: max-content;
    }

    :host([full]) {
      display: flex;
      width: 100%;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-xs, 8px);
      border: 1px solid transparent;
      border-radius: var(--radius-default, 4px);
      background: transparent;
      color: var(--color-on-surface-variant, #dcc1b8);
      font-family: var(--font-label, 'JetBrains Mono', monospace);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      position: relative;
      overflow: visible;
      transition: all 0.15s ease-out;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .variant-filled {
      background: var(--color-primary-container, #b85736);
      color: var(--color-on-primary-container, #fffaf9);
      border-color: var(--color-primary-container, #b85736);
    }

    .variant-filled:hover:not(:disabled) {
      background: var(--color-inverse-primary, #9d4323);
      border-color: var(--color-inverse-primary, #9d4323);
    }

    .variant-outlined {
      border-color: var(--color-secondary, #e9c267);
      color: var(--color-secondary, #e9c267);
    }

    .variant-outlined:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-secondary, #e9c267) 8%, transparent);
    }

    .variant-surface {
      background: var(--color-surface-container, #271d1a);
      border-color: var(--color-outline-variant, #56423c);
      color: var(--color-on-surface-variant, #dcc1b8);
    }

    .variant-surface:hover:not(:disabled) {
      background: var(--color-surface-container-high, #322824);
    }

    .variant-error {
      background: color-mix(in srgb, var(--color-error, #ffb4ab) 12%, transparent);
      border-color: var(--color-error-container, #93000a);
      color: var(--color-error, #ffb4ab);
    }

    .variant-error:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-error, #ffb4ab) 22%, transparent);
    }

    .variant-tab {
      border: 0;
      border-radius: 0;
      color: var(--color-on-surface-variant, #dcc1b8);
    }

    .variant-tab:hover:not(:disabled) {
      background: var(--color-surface-container-highest, #3e322f);
    }

    :host([active]) .variant-tab {
      color: var(--color-tertiary-fixed-dim, #76d5dc);
      border-bottom: 2px solid var(--color-tertiary-fixed-dim, #76d5dc);
      font-weight: 700;
    }

    .variant-text {
      border: 0;
      border-radius: var(--radius-full, 9999px);
    }

    .variant-text:hover:not(:disabled),
    .variant-fab:hover:not(:disabled) {
      background: var(--color-surface-container-high, #322824);
      color: var(--color-primary, #ffb59d);
    }

    :host(.text-primary) button {
      color: var(--color-primary, #ffb59d);
    }

    .variant-fab {
      border: 0;
      border-radius: var(--radius-full, 9999px);
      padding: 0;
    }

    .variant-fab.primary {
      background: var(--color-primary-container, #b85736);
      color: var(--color-on-primary-container, #fffaf9);
    }

    .variant-fab.primary:hover:not(:disabled) {
      background: var(--color-inverse-primary, #9d4323);
    }

    button:active:not(:disabled) {
      transform: scale(0.95);
    }

    .size-sm:not(.variant-fab) { padding: 4px 10px; font-size: var(--typo-label-sm-size, 12px); }
    .size-md:not(.variant-fab) { padding: 6px 14px; font-size: var(--typo-label-md-size, 14px); }
    .size-lg:not(.variant-fab) { padding: 10px 20px; font-size: var(--typo-label-md-size, 14px); }

    :host([full]) button {
      width: 100%;
      justify-content: flex-start;
      text-align: left;
    }

    .variant-fab.size-xs { width: 20px; height: 20px; font-size: 12px; }
    .variant-fab.size-sm { width: 32px; height: 32px; }
    .variant-fab.size-md { width: 40px; height: 40px; }
    .variant-fab.size-lg { width: 48px; height: 48px; }

    ::slotted(.material-symbols-outlined) {
      font-size: 24px;
      line-height: 1;
    }

    ::slotted(.material-symbols-outlined.text-sm) {
      font-size: 18px;
    }

    ::slotted(#thinking-indicator) {
      position: absolute;
      top: 8px;
      right: 8px;
    }
  `;

	@property({ type: String }) variant: DsButtonVariant = "filled";
	@property({ type: String }) size: "xs" | "sm" | "md" | "lg" = "md";
	@property({ type: Boolean, reflect: true }) disabled = false;
	@property({ type: Boolean, reflect: true }) full = false;
	@property({ type: Boolean, reflect: true }) primary = false;
	@property({ type: Boolean, reflect: true }) active = false;
	@property({ type: String }) type: "button" | "submit" | "reset" = "button";

	render() {
		const classes = [`variant-${this.variant}`, `size-${this.size}`];
		if (this.primary) classes.push("primary");

		return html`
      <button
        class=${classes.join(" ")}
        ?disabled=${this.disabled}
        type=${this.type}
        aria-label=${this.getAttribute("aria-label") || this.getAttribute("title") || ""}
        title=${this.getAttribute("title") || ""}
        @click=${this.handleClick}
      >
        <slot></slot>
      </button>
    `;
	}

	private handleClick(event: Event) {
		if (!this.disabled) return;
		event.preventDefault();
		event.stopPropagation();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"ds-button": DsButton;
	}
}

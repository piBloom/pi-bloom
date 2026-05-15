/**
 * @element ds-session-item
 * @summary Accessible session row for sidebars.
 */

import { LitElement, html, css, type CSSResultGroup } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("ds-session-item")
export class DsSessionItem extends LitElement {
	static styles: CSSResultGroup = css`
    :host { display: block; }

    button {
      display: flex;
      width: 100%;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-sm, 12px);
      padding: 8px 12px;
      border: 0;
      border-left: 2px solid transparent;
      border-radius: var(--radius-default, 4px);
      background: transparent;
      color: var(--color-on-surface, #f1dfd9);
      cursor: pointer;
      text-align: left;
      transition: all 0.15s ease;
    }

    button:hover,
    button:focus-visible,
    :host([active]) button {
      background: var(--color-surface-container, #271d1a);
    }

    button:hover,
    button:focus-visible {
      color: var(--color-primary, #ffb59d);
      outline: none;
    }

    :host([active]) button {
      border-left-color: var(--color-primary, #ffb59d);
      padding-left: 10px;
    }

    .content {
      overflow: hidden;
      min-width: 0;
    }

    .title {
      font-family: var(--font-body, 'Work Sans', sans-serif);
      font-size: 14px;
      color: inherit;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .subtitle {
      margin-top: 2px;
      color: var(--color-on-surface-variant, #dcc1b8);
      font-family: var(--font-label, 'JetBrains Mono', monospace);
      font-size: 11px;
    }
  `;

	@property({ type: String }) title = "";
	@property({ type: String }) subtitle = "";
	@property({ type: Boolean, reflect: true }) active = false;

	render() {
		return html`
      <button type="button" aria-current=${this.active ? "true" : "false"}>
        <span class="content">
          <span class="title">${this.title}</span>
          <span class="subtitle">${this.subtitle}</span>
        </span>
      </button>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"ds-session-item": DsSessionItem;
	}
}

/**
 * @element ds-input
 * @summary Text input/textarea used by NixPi search and prompt fields.
 */

import { LitElement, html, css, type CSSResultGroup } from "lit";
import { customElement, property, query } from "lit/decorators.js";

@customElement("ds-input")
export class DsInput extends LitElement {
	static styles: CSSResultGroup = css`
    :host {
      display: block;
      width: 100%;
    }

    .field {
      position: relative;
      width: 100%;
    }

    .icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-on-surface-variant, #dcc1b8);
      pointer-events: none;
      transition: color 0.15s ease;
    }

    .field:focus-within .icon {
      color: var(--color-primary, #ffb59d);
    }

    input,
    textarea {
      width: 100%;
      box-sizing: border-box;
      border: 0;
      border-bottom: 1px solid var(--color-outline-variant, #56423c);
      background: var(--color-surface-container, #271d1a);
      color: var(--color-on-surface, #f1dfd9);
      font-family: var(--font-label, 'JetBrains Mono', monospace);
      font-size: var(--typo-label-md-size, 14px);
      outline: none;
      padding: 8px 12px;
      transition: border-color 0.15s ease;
    }

    textarea {
      min-height: 64px;
      resize: vertical;
    }

    :host([icon]) input {
      padding-left: 40px;
    }

    :host([variant='plain']) input,
    :host([variant='plain']) textarea {
      border: 0;
      background: transparent;
      font-family: var(--font-body, 'Work Sans', sans-serif);
      font-size: var(--typo-body-md-size, 16px);
      line-height: var(--typo-body-md-line, 1.5);
      padding: 8px;
      resize: none;
    }

    input:focus,
    textarea:focus {
      border-bottom-color: var(--color-primary, #ffb59d);
    }

    input::placeholder,
    textarea::placeholder {
      color: var(--color-on-surface-variant, #dcc1b8);
    }
  `;

	@property({ type: String }) icon = "";
	@property({ type: Boolean, reflect: true }) multiline = false;
	@property({ type: String }) placeholder = "";
	@property({ type: Number }) rows = 3;
	@property({ type: String }) type = "text";
	@property({ type: String }) value = "";
	@property({ type: String, reflect: true }) variant = "default";

	@query("input, textarea") private field?: HTMLInputElement | HTMLTextAreaElement;

	focus() {
		this.field?.focus();
	}

	render() {
		return html`
      <span class="field">
        ${this.icon ? html`<span class="icon material-symbols-outlined">${this.icon}</span>` : ""}
        ${this.multiline
					? html`<textarea
              .value=${this.value}
              placeholder=${this.placeholder}
              rows=${this.rows}
              @input=${this.onInput}
              @change=${this.onChange}
            ></textarea>`
					: html`<input
              .value=${this.value}
              type=${this.type}
              placeholder=${this.placeholder}
              @input=${this.onInput}
              @change=${this.onChange}
            />`}
      </span>
    `;
	}

	private onInput(event: Event) {
		event.stopPropagation();
		const target = event.target as HTMLInputElement | HTMLTextAreaElement;
		this.value = target.value;
		this.dispatchEvent(new Event("input", { bubbles: true }));
	}

	private onChange(event: Event) {
		event.stopPropagation();
		const target = event.target as HTMLInputElement | HTMLTextAreaElement;
		this.value = target.value;
		this.dispatchEvent(new Event("change", { bubbles: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"ds-input": DsInput;
	}
}

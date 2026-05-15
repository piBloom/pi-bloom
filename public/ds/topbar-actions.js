const buttonStyles = `
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
    font-family: var(--font-label, "JetBrains Mono", monospace);
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

const avatarStyles = `
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-outline-variant, #56423c);
    border-radius: var(--radius-full, 9999px);
    background: var(--color-surface-container-high, #322824);
    color: var(--color-primary, #ffb59d);
    font-family: var(--font-label, "JetBrains Mono", monospace);
    overflow: hidden;
    user-select: none;
  }

  .size-sm { width: 24px; height: 24px; font-size: 11px; }
  .size-md { width: 32px; height: 32px; font-size: 12px; }
  .size-lg { width: 40px; height: 40px; font-size: 14px; }
`;

const sessionItemStyles = `
  :host {
    display: block;
  }

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
    font-family: var(--font-body, "Work Sans", sans-serif);
    font-size: 14px;
    color: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subtitle {
    margin-top: 2px;
    color: var(--color-on-surface-variant, #dcc1b8);
    font-family: var(--font-label, "JetBrains Mono", monospace);
    font-size: 11px;
  }
`;

class DsButton extends HTMLElement {
	static observedAttributes = [
		"disabled",
		"primary",
		"size",
		"type",
		"variant",
	];

	get disabled() {
		return this.hasAttribute("disabled");
	}

	set disabled(value) {
		this.toggleAttribute("disabled", Boolean(value));
	}

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	connectedCallback() {
		this.render();
	}

	attributeChangedCallback() {
		if (this.isConnected) this.render();
	}

	render() {
		const variant = this.getAttribute("variant") || "filled";
		const size = this.getAttribute("size") || "md";
		const type = this.getAttribute("type") || "button";
		const disabled = this.hasAttribute("disabled");
		const primary = this.hasAttribute("primary");

		const style = document.createElement("style");
		style.textContent = buttonStyles;

		const button = document.createElement("button");
		button.type = type;
		button.disabled = disabled;
		button.ariaLabel =
			this.getAttribute("aria-label") || this.getAttribute("title") || "";
		button.classList.add(`variant-${variant}`, `size-${size}`);
		if (primary) button.classList.add("primary");

		button.appendChild(document.createElement("slot"));
		this.shadowRoot.replaceChildren(style, button);
	}
}

class DsSessionItem extends HTMLElement {
	static observedAttributes = ["active", "subtitle", "title"];

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	connectedCallback() {
		this.render();
	}

	attributeChangedCallback() {
		if (this.isConnected) this.render();
	}

	render() {
		const title = this.getAttribute("title") || "";
		const subtitle = this.getAttribute("subtitle") || "";
		const active = this.hasAttribute("active");

		const style = document.createElement("style");
		style.textContent = sessionItemStyles;

		const button = document.createElement("button");
		button.type = "button";
		button.ariaCurrent = active ? "true" : "false";

		const content = document.createElement("span");
		content.className = "content";

		const titleEl = document.createElement("span");
		titleEl.className = "title";
		titleEl.textContent = title;

		const subtitleEl = document.createElement("span");
		subtitleEl.className = "subtitle";
		subtitleEl.textContent = subtitle;

		content.append(titleEl, subtitleEl);
		button.appendChild(content);
		this.shadowRoot.replaceChildren(style, button);
	}
}

class DsAvatar extends HTMLElement {
	static observedAttributes = ["fallback", "size"];

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	connectedCallback() {
		this.render();
	}

	attributeChangedCallback() {
		if (this.isConnected) this.render();
	}

	render() {
		const fallback = this.getAttribute("fallback") || "";
		const size = this.getAttribute("size") || "md";

		const style = document.createElement("style");
		style.textContent = avatarStyles;

		const avatar = document.createElement("span");
		avatar.classList.add("avatar", `size-${size}`);

		const slot = document.createElement("slot");
		slot.textContent = fallback;
		avatar.appendChild(slot);

		this.shadowRoot.replaceChildren(style, avatar);
	}
}

customElements.define("ds-button", DsButton);
customElements.define("ds-session-item", DsSessionItem);
customElements.define("ds-avatar", DsAvatar);

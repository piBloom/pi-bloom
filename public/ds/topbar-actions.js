const buttonStyles = `
  :host {
    display: inline-flex;
    position: relative;
    width: max-content;
    height: max-content;
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

  .variant-text {
    border: 0;
    border-radius: var(--radius-full, 9999px);
  }

  .variant-text:hover:not(:disabled),
  .variant-fab:hover:not(:disabled) {
    background: var(--color-surface-container-high, #322824);
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

  .variant-fab.size-sm { width: 32px; height: 32px; }
  .variant-fab.size-md { width: 40px; height: 40px; }
  .variant-fab.size-lg { width: 48px; height: 48px; }

  ::slotted(.material-symbols-outlined) {
    font-size: 24px;
    line-height: 1;
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

class DsButton extends HTMLElement {
  static observedAttributes = ["disabled", "primary", "size", "type", "variant"];

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
    button.ariaLabel = this.getAttribute("aria-label") || this.getAttribute("title") || "";
    button.classList.add(`variant-${variant}`, `size-${size}`);
    if (primary) button.classList.add("primary");

    button.appendChild(document.createElement("slot"));
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
customElements.define("ds-avatar", DsAvatar);

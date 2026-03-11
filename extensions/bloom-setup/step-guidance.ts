/**
 * Step guidance constants for bloom-setup.
 * Defines what Pi should say/do at each first-boot setup step.
 */
import type { StepName } from "../../lib/setup.js";

/** Step guidance — what Pi should say/do at each step. */
export const STEP_GUIDANCE: Record<StepName, string> = {
	welcome:
		"Introduce Bloom to the user. Explain: Bloom is their personal AI companion OS. Pi (you) is the AI agent that lives here. Bloom can self-evolve — the user can teach you new skills, install services, and customize your persona. Mention that they can run commands themselves with ! (e.g. !netbird status) or !! to open an interactive shell — this is their device and they're encouraged to explore hands-on. Keep it to 2-3 short messages, warm and conversational. Don't overwhelm.",
	network:
		"Check network connectivity by running: nmcli general status. If connected, confirm and move on. If not, scan for WiFi with: nmcli device wifi list, show the results, ask the user to pick a network, then connect with: nmcli device wifi connect <SSID> password <password>. Retry if it fails.",
	netbird:
		"Explain that NetBird creates a private mesh network so the user can access this device from anywhere. Ask the user how they'd like to authenticate:\n\n1. **URL authentication** — run: sudo netbird up. This prints a URL. The user opens it in a browser on another device to log in via SSO. Best for interactive setup.\n2. **Setup key** — ask for their NetBird setup key from the NetBird dashboard. Run: sudo netbird up --setup-key <KEY>. Best for headless/automated setup.\n\nAfter either method, check status with: netbird status. Show the assigned mesh IP.\n\nThen ask: 'Would you like automatic subdomain routing for services (e.g. cinny.bloom.mesh)? If so, you'll need a NetBird API token. Go to app.netbird.io → Team → Service Users, create a service user with admin role, then create an access token for it.' If they provide a token, write it to ~/.config/bloom/netbird.env as NETBIRD_API_TOKEN=<token>. If they want to skip, that's fine — services still work via direct IP and path-based routing.",
	connectivity:
		"Summarize how to connect: (1) Locally at localhost if sitting at the device, (2) Via NetBird mesh IP from any peer device. Show the mesh IP from: netbird status. Mention SSH: ssh pi@<mesh-ip>. The default password is set in bib-config.toml during image build — remind the user they can change it with: passwd. Recommend they add their SSH key with ssh-copy-id for passwordless access.",
	webdav:
		"Ask if the user wants a file server. Explain: dufs (WebDAV) lets you access your files from any device via a web browser or file manager. If yes, use service_install(name='dufs') to install it.",
	matrix:
		"Matrix is your private communication hub — it's already running on this device. Verify Continuwuity is healthy: systemctl status bloom-matrix. Then create accounts:\n\n1. Read the registration token from /var/lib/continuwuity/registration_token (it's auto-generated on first boot)\n2. Register @pi:bloom bot account using the Matrix registration API\n3. Register @user:bloom account for the human user\n4. Store credentials in ~/.pi/matrix-credentials.json using the canonical schema: { homeserver, botUserId, botAccessToken, botPassword, userUserId, userPassword, registrationToken }\n5. Create #general:bloom room and auto-join @user:bloom to it using the Matrix invite+join API\n6. Tell the user: 'Matrix is ready. Open Cinny at http://<hostname>/cinny/ to chat. Username: user (just the localpart, not @user:bloom). Password: <shown>. You're already in #general:bloom — DM @pi:bloom to chat directly.'\n7. Ask: 'Want me to connect your WhatsApp, Telegram, or Signal?'",
	git_identity:
		"Ask for the user's name and email for git commits. Run: git config --global user.name '<name>' and git config --global user.email '<email>'. Confirm the settings.",
	contributing:
		"Developer tools let you contribute to Bloom from this device:\n- **code-server**: Edit code in a web browser\n- **Local OS builds**: Rebuild and test the OS image without waiting for CI\n- **Upstream contributions**: Push skills, services, and extensions as PRs\n\nAsk the user: \"Would you like to enable developer tools? You can always enable them later with dev_enable.\"\n\nIf yes: Call dev_enable to activate dev mode, then guide through bloom_repo(action: 'configure') if not already done.\nIf no: Acknowledge and move on. Mention they can run dev_enable anytime.",
	persona:
		"Guide the user through personalizing their AI companion. Ask one question at a time: SOUL — 'What should I call you?', 'How formal or casual should I be?', 'Any values important to you?'. BODY — 'Short messages on mobile, longer on terminal?'. FACULTY — 'Step-by-step thinker or quick and direct?'. Update ~/Bloom/Persona/ files with their preferences. Fully skippable.",
	test_message:
		"If a messaging channel (Matrix) was set up, send a test message: 'Hi. Can you hear me?' using the channel. If no channel was set up, skip this step.",
	complete:
		"Congratulate the user! Setup is complete. Mention they can chat here on the terminal or on their connected messaging channel. Let them know Pi is always running in the background — even when they log out, Pi stays connected to Matrix rooms and responds to messages. When they log in interactively, they get a separate terminal session while the daemon keeps running in parallel. Both share the same persona and filesystem. Remind them they can revisit any setup step by asking.",
};

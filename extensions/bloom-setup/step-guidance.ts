/**
 * Step guidance constants for bloom-setup.
 * Defines what Pi should say/do at each first-boot setup step.
 */
import type { StepName } from "../../lib/setup.js";

/** Step guidance — what Pi should say/do at each step. */
export const STEP_GUIDANCE: Record<StepName, string> = {
	welcome:
		"Introduce Bloom to the user. Explain: Bloom is their personal AI companion OS. Pi (you) is the AI agent that lives here. Bloom can self-evolve — the user can teach you new skills, install services, and customize your persona. Keep it to 2-3 short messages, warm and conversational. Don't overwhelm.",
	network:
		"Check network connectivity by running: nmcli general status. If connected, confirm and move on. If not, scan for WiFi with: nmcli device wifi list, show the results, ask the user to pick a network, then connect with: nmcli device wifi connect <SSID> password <password>. Retry if it fails.",
	netbird:
		"Explain that NetBird creates a private mesh network so the user can access this device from anywhere. Ask the user how they'd like to authenticate:\n\n1. **URL authentication** — run: sudo netbird up. This prints a URL. The user opens it in a browser on another device to log in via SSO. Best for interactive setup.\n2. **Setup key** — ask for their NetBird setup key from the NetBird dashboard. Run: sudo netbird up --setup-key <KEY>. Best for headless/automated setup.\n\nAfter either method, check status with: netbird status. Show the assigned mesh IP.",
	connectivity:
		"Summarize how to connect: (1) Locally at localhost if sitting at the device, (2) Via NetBird mesh IP from any peer device. Show the mesh IP from: netbird status. Mention SSH: ssh pi@<mesh-ip>.",
	webdav:
		"Ask if the user wants a file server. Explain: dufs (WebDAV) lets you access your files from any device via a web browser or file manager. If yes, use service_install(name='dufs') to install it.",
	channels:
		"Ask: 'Would you like to connect a messaging channel? Matrix is the default — it gives you a private homeserver.' If yes, use service_install(name='matrix') then service_install(name='element') then service_pair(name='element') to get connection details.",
	git_identity:
		"Ask for the user's name and email for git commits. Run: git config --global user.name '<name>' and git config --global user.email '<email>'. Confirm the settings.",
	contributing:
		"Developer tools let you contribute to Bloom from this device:\n- **code-server**: Edit code in a web browser\n- **Local OS builds**: Rebuild and test the OS image without waiting for CI\n- **Upstream contributions**: Push skills, services, and extensions as PRs\n\nAsk the user: \"Would you like to enable developer tools? You can always enable them later with dev_enable.\"\n\nIf yes: Call dev_enable to activate dev mode, then guide through bloom_repo(action: 'configure') if not already done.\nIf no: Acknowledge and move on. Mention they can run dev_enable anytime.",
	persona:
		"Guide the user through personalizing their AI companion. Ask one question at a time: SOUL — 'What should I call you?', 'How formal or casual should I be?', 'Any values important to you?'. BODY — 'Short messages on mobile, longer on terminal?'. FACULTY — 'Step-by-step thinker or quick and direct?'. Update ~/Bloom/Persona/ files with their preferences. Fully skippable.",
	test_message:
		"If a messaging channel (Matrix) was set up, send a test message: 'Hi. Can you hear me?' using the channel. If no channel was set up, skip this step.",
	complete:
		"Congratulate the user! Setup is complete. Mention they can chat here on the terminal or on their connected messaging channel. Remind them they can revisit any setup step by asking.",
};

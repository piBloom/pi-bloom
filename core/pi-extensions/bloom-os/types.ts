// Extension-specific types for bloom-os

/** Update status persisted to the primary Bloom user's ~/.bloom/update-status.json. */
export interface UpdateStatus {
	available: boolean;
	checked: string;
	generation?: string;   // NixOS generation number
	notified?: boolean;
}
